import type { PlanChange, RoutineSnapshot } from './plan-change.schema';

// =============================================================================
// Applying a proposal, as a pure function (issue #76, epic E06)
// =============================================================================
//
// NO PRISMA, NO CLOCK, NO NEST. This function is called twice for every
// proposal and the two calls must agree:
//
//   1. `GET /proposals/:id` renders `diff` as the preview the user reads
//      before deciding.
//   2. `POST /proposals/:id/accept` applies the same changes to produce the
//      new version.
//
// If those were two implementations, the user would approve one thing and get
// another — which is precisely the failure PRD §15's protocol exists to
// prevent. One function, called from both, is the only way to make "what you
// saw is what happened" a property rather than a hope.
//
// It also never mutates its input. The snapshot handed in comes straight from
// the database rows the caller is about to re-read inside a transaction.
// =============================================================================

export interface RoutineSnapshotWithId extends RoutineSnapshot {
  id: string;
  title: string;
  domain: 'WORK' | 'FAMILY' | 'HEALTH';
  sortOrder: number;
}

export interface CommitmentSnapshotWithId {
  id: string;
  routineId: string | null;
  title: string;
  scheduledStart: string;
}

export interface PlanVersionSnapshot {
  routines: RoutineSnapshotWithId[];
  futureCommitments: CommitmentSnapshotWithId[];
  expectedWeeklyLoad: number | null;
  fallbackStrategy: string | null;
}

export interface DiffField {
  field: string;
  before: unknown;
  after: unknown;
}

export interface DiffEntry {
  op: PlanChange['op'];
  target: { type: 'routine' | 'commitment'; id: string; title: string };
  reason: string;
  fields: DiffField[];
}

export interface CommitmentEffect {
  commitmentId: string;
  effect: 'cancel' | 'reschedule';
  to?: { preferredTime?: string | null; triggerValue?: string | null };
}

export type ApplyErrorCode =
  | 'target_not_found'
  | 'invalid_after'
  | 'duplicate_target'
  | 'nothing_changes';

export interface ApplyError {
  index: number;
  code: ApplyErrorCode;
  message: string;
}

export type ApplyResult =
  | {
      ok: true;
      next: PlanVersionSnapshot;
      diff: DiffEntry[];
      commitmentEffects: CommitmentEffect[];
    }
  | {
      ok: false;
      errors: ApplyError[];
    };

/** Fields a snapshot may carry, in the order a diff lists them. */
const SNAPSHOT_FIELDS = [
  'title',
  'triggerType',
  'triggerValue',
  'frequency',
  'daysOfWeek',
  'preferredTime',
  'estimatedDurationMin',
  'minimumDurationMin',
  'fallbackBehavior',
  'active',
] as const;

/**
 * The id an added routine carries until the service writes it.
 *
 * A placeholder rather than a generated uuid, because `applyChanges` is pure
 * and a uuid would make the preview a different object on every request — the
 * diff a user reads would change under them on a refresh.
 */
export const tempRoutineId = (index: number) => `tmp:${index}`;

export function applyChanges(
  snapshot: PlanVersionSnapshot,
  changes: PlanChange[],
): ApplyResult {
  const errors: ApplyError[] = [];
  const seenTargets = new Set<string>();

  for (const [index, change] of changes.entries()) {
    if (change.target.id !== null) {
      if (seenTargets.has(change.target.id)) {
        // Two ops on one routine cannot be shown as one reviewable sentence,
        // and the order they would apply in is not something the user chose.
        errors.push({
          index,
          code: 'duplicate_target',
          message: `Two changes target ${change.target.id}`,
        });
        continue;
      }
      seenTargets.add(change.target.id);

      if (
        change.target.type === 'routine' &&
        !snapshot.routines.some((r) => r.id === change.target.id)
      ) {
        errors.push({
          index,
          code: 'target_not_found',
          message: `No routine ${change.target.id} in the active version`,
        });
      }
    }

    if (change.op === 'add' && !change.after?.title) {
      errors.push({
        index,
        code: 'invalid_after',
        message: 'add requires a title',
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  // Copied, not mutated: the caller re-reads these rows inside a transaction.
  const routines = snapshot.routines.map((routine) => ({ ...routine }));
  const diff: DiffEntry[] = [];
  const commitmentEffects: CommitmentEffect[] = [];

  const futureOf = (routineId: string) =>
    snapshot.futureCommitments.filter((c) => c.routineId === routineId);

  for (const [index, change] of changes.entries()) {
    if (change.op === 'add') {
      const created: RoutineSnapshotWithId = {
        id: tempRoutineId(index),
        title: change.after!.title!,
        domain: routines[0]?.domain ?? 'HEALTH',
        sortOrder: routines.length,
        ...change.after,
      };
      routines.push(created);
      diff.push({
        op: 'add',
        target: { type: 'routine', id: created.id, title: created.title },
        reason: change.reason,
        fields: fieldsOf(null, change.after ?? null),
      });
      continue;
    }

    const position = routines.findIndex((r) => r.id === change.target.id);
    const current = routines[position];

    if (change.op === 'remove') {
      routines.splice(position, 1);
      diff.push({
        op: 'remove',
        target: { type: 'routine', id: current.id, title: current.title },
        reason: change.reason,
        fields: [],
      });
      // A routine that no longer exists cannot have occurrences waiting for it.
      for (const commitment of futureOf(current.id)) {
        commitmentEffects.push({ commitmentId: commitment.id, effect: 'cancel' });
      }
      continue;
    }

    if (change.op === 'pause') {
      routines[position] = { ...current, active: false };
      diff.push({
        op: 'pause',
        target: { type: 'routine', id: current.id, title: current.title },
        reason: change.reason,
        fields: [{ field: 'active', before: current.active ?? true, after: false }],
      });
      for (const commitment of futureOf(current.id)) {
        commitmentEffects.push({ commitmentId: commitment.id, effect: 'cancel' });
      }
      continue;
    }

    // move / reduce / replace are all "merge the after snapshot".
    const merged = { ...current, ...stripUndefined(change.after ?? {}) };
    routines[position] = merged;

    const fields = fieldsOf(current, change.after ?? null);

    if (fields.length === 0) {
      errors.push({
        index,
        code: 'nothing_changes',
        message: `${change.op} on ${current.title} would change nothing`,
      });
      continue;
    }

    diff.push({
      op: change.op,
      target: { type: 'routine', id: current.id, title: current.title },
      reason: change.reason,
      fields,
    });

    if (change.op === 'move') {
      // The plan moved, so the occurrences it already produced move with it.
      // Cancelling and recreating them would lose their ids, and with them any
      // reflection or evidence already attached (PRD §103).
      for (const commitment of futureOf(current.id)) {
        commitmentEffects.push({
          commitmentId: commitment.id,
          effect: 'reschedule',
          to: {
            preferredTime: merged.preferredTime ?? null,
            triggerValue: merged.triggerValue ?? null,
          },
        });
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    next: {
      routines,
      futureCommitments: snapshot.futureCommitments,
      expectedWeeklyLoad: snapshot.expectedWeeklyLoad,
      fallbackStrategy: snapshot.fallbackStrategy,
    },
    diff,
    commitmentEffects,
  };
}

/** The fields an `after` snapshot actually changes, in declaration order. */
function fieldsOf(
  before: RoutineSnapshot | null,
  after: RoutineSnapshot | null,
): DiffField[] {
  if (!after) return [];

  const fields: DiffField[] = [];

  for (const field of SNAPSHOT_FIELDS) {
    const next = after[field];
    if (next === undefined) continue;

    const previous = before ? before[field] : null;
    // Deep-compared because `daysOfWeek` is an array; `[1,3]` and `[1,3]` are
    // not the same value and would otherwise show as a change every time.
    if (JSON.stringify(previous ?? null) === JSON.stringify(next ?? null)) continue;

    fields.push({ field, before: previous ?? null, after: next });
  }

  return fields;
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}
