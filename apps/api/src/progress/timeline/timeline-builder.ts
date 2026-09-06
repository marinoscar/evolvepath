import type { Domain } from '@prisma/client';

import type { MilestoneView } from '../milestones/milestones.service';

// =============================================================================
// The evidence timeline (issue #115, epic E11)
// =============================================================================
//
// PRD §76 wants MEANINGFUL events, and the word is doing work: the evidence
// table records `started`, `paused`, `continued`, `fallback_selected` and
// `rescheduled` too, and a timeline that showed all of them would be a log
// rather than a story. "Paused at 14:32, continued at 14:41" is true and tells
// the user nothing they want to know about themselves.
//
// So the mapping below is a WHITELIST, not a rename. A row with no rule
// produces no event.
//
// Pure: the caller loads the rows and this file decides what they mean, which
// is what lets the four PRD §76 examples be pinned by plain-object fixtures.
// =============================================================================

export type TimelineKind =
  | 'completed'
  | 'completed_fallback'
  | 'partially_completed'
  | 'started_after_postpone'
  | 'family_kept'
  | 'returned_after_miss'
  | 'plan_change_accepted'
  | 'comeback_completed'
  | 'milestone';

/**
 * How loudly to render it (PRD §77: "avoid constant confetti").
 *
 * A property of the payload rather than of the API: the client shows a
 * `milestone` once as a toast, highlights a `notable`, and renders an
 * `ordinary` plainly. Putting the intensity here means one definition of
 * "significant" instead of one per screen.
 */
export type Significance = 'ordinary' | 'notable' | 'milestone';

export interface TimelineEvent {
  id: string;
  at: string;
  kind: TimelineKind;
  significance: Significance;
  domain: Domain | null;
  title: string;
  detail: string | null;
  commitmentId: string | null;
  milestoneId: string | null;
}

export interface TimelineEvidenceRow {
  id: string;
  evidenceType: string;
  occurredAt: Date;
  commitmentId: string | null;
  commitment: {
    title: string;
    domain: Domain;
    rescheduleCount: number;
    versionUsed: string | null;
    commitmentType: string | null;
  } | null;
}

export interface TimelineMissRow {
  id: string;
  domain: Domain;
  scheduledStart: Date;
}

export interface TimelinePlanChangeRow {
  id: string;
  at: Date;
  toVersion: number | null;
  rationale: string | null;
}

export interface TimelineRows {
  evidence: TimelineEvidenceRow[];
  misses: TimelineMissRow[];
  planChanges: TimelinePlanChangeRow[];
  milestones: MilestoneView[];
}

/** Rationale is a paragraph; a timeline line is a line. */
const DETAIL_MAX = 120;

function firstLine(text: string | null): string | null {
  if (!text) return null;
  const line = text.split('\n')[0].trim();
  if (line.length === 0) return null;
  return line.length > DETAIL_MAX ? `${line.slice(0, DETAIL_MAX - 1)}…` : line;
}

function titleCase(domain: Domain): string {
  return domain.charAt(0) + domain.slice(1).toLowerCase();
}

const SUCCESS_TYPES = ['completed', 'partially_completed'];

export function buildTimeline(rows: TimelineRows): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  const successes = rows.evidence
    .filter((row) => SUCCESS_TYPES.includes(row.evidenceType) && row.commitment)
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  for (const row of rows.evidence) {
    const commitment = row.commitment;

    if (row.evidenceType === 'recovery') {
      events.push({
        id: row.id,
        at: row.occurredAt.toISOString(),
        kind: 'comeback_completed',
        significance: 'notable',
        domain: commitment?.domain ?? null,
        title: 'Back on Path',
        detail: null,
        commitmentId: row.commitmentId,
        milestoneId: null,
      });
      continue;
    }

    if (!commitment) continue;

    if (row.evidenceType === 'started') {
      // The ONLY start worth a line. PRD §76's own example is "Started avoided
      // proposal after two postponements" — a start is remarkable exactly when
      // the thing had been put off.
      if (commitment.rescheduleCount < 2) continue;

      events.push({
        id: row.id,
        at: row.occurredAt.toISOString(),
        kind: 'started_after_postpone',
        significance: 'notable',
        domain: commitment.domain,
        title: `Started ${commitment.title} after ${commitment.rescheduleCount} postponements`,
        detail: null,
        commitmentId: row.commitmentId,
        milestoneId: null,
      });
      continue;
    }

    if (row.evidenceType === 'partially_completed') {
      events.push({
        id: row.id,
        at: row.occurredAt.toISOString(),
        kind: 'partially_completed',
        significance: 'ordinary',
        domain: commitment.domain,
        title: `Made progress on ${commitment.title}`,
        detail: null,
        commitmentId: row.commitmentId,
        milestoneId: null,
      });
    } else if (row.evidenceType === 'completed') {
      const fallback =
        commitment.versionUsed === 'SHORT' || commitment.versionUsed === 'MINIMUM';

      if (commitment.domain === 'FAMILY') {
        // PRD §76's wording, and the only family sentence in this file. A
        // family ritual kept is protected, never "completed" — VISION §12 is
        // clear that the family domain is not a scoreboard.
        events.push({
          id: row.id,
          at: row.occurredAt.toISOString(),
          kind: 'family_kept',
          significance: 'notable',
          domain: 'FAMILY',
          title: `Protected ${commitment.title}`,
          detail: null,
          commitmentId: row.commitmentId,
          milestoneId: null,
        });
      } else {
        events.push({
          id: row.id,
          at: row.occurredAt.toISOString(),
          kind: fallback ? 'completed_fallback' : 'completed',
          significance: 'ordinary',
          domain: commitment.domain,
          // A fallback completion is a COMPLETION (PRD §44), labelled rather
          // than diminished.
          title: fallback
            ? `Completed ${commitment.title} — minimum version`
            : `Completed ${commitment.title}`,
          detail: null,
          commitmentId: row.commitmentId,
          milestoneId: null,
        });
      }
    } else {
      // paused, continued, rescheduled, fallback_selected — a log, not a story.
      continue;
    }

    const returned = returnedAfterMiss(row, successes, rows.misses);
    if (returned > 0) {
      events.push({
        id: `${row.id}:returned`,
        at: row.occurredAt.toISOString(),
        kind: 'returned_after_miss',
        significance: 'notable',
        domain: commitment.domain,
        title: `Returned to ${titleCase(commitment.domain)} plan after ${returned} missed`,
        detail: null,
        commitmentId: row.commitmentId,
        milestoneId: null,
      });
    }
  }

  for (const change of rows.planChanges) {
    events.push({
      id: change.id,
      at: change.at.toISOString(),
      kind: 'plan_change_accepted',
      significance: 'notable',
      domain: null,
      title: `Plan updated to v${change.toVersion ?? '?'}`,
      // PRD §80: history should say WHY the plan changed, and the only place
      // that reason exists is the version's own rationale.
      detail: firstLine(change.rationale),
      commitmentId: null,
      milestoneId: null,
    });
  }

  for (const milestone of rows.milestones) {
    events.push({
      id: milestone.id,
      at: milestone.achievedAt,
      kind: 'milestone',
      significance: 'milestone',
      domain: (milestone.domain as Domain | null) ?? null,
      title: milestone.title,
      detail: milestone.body || null,
      commitmentId: null,
      milestoneId: milestone.id,
    });
  }

  // Newest first, ties broken by id — a stable total order, which is what makes
  // cursor pagination able to promise no duplicates and no gaps.
  return events.sort((a, b) => (a.at === b.at ? a.id.localeCompare(b.id) : b.at.localeCompare(a.at)));
}

/**
 * How many misses this success ended, in its own domain — 0 when it ended none.
 *
 * "After one missed workout" is PRD §76's example and the number is the whole
 * of it: a return is only worth saying when there was something to return from.
 */
function returnedAfterMiss(
  success: TimelineEvidenceRow,
  successes: TimelineEvidenceRow[],
  misses: TimelineMissRow[],
): number {
  const domain = success.commitment?.domain;
  if (!domain) return 0;

  const previous = successes
    .filter(
      (row) =>
        row.commitment?.domain === domain && row.occurredAt < success.occurredAt,
    )
    .pop();

  const since = previous?.occurredAt ?? new Date(0);

  return misses.filter(
    (miss) =>
      miss.domain === domain &&
      miss.scheduledStart > since &&
      miss.scheduledStart < success.occurredAt,
  ).length;
}

/** `at|id`, base64. Opaque to the client, and stable across pages. */
export function encodeCursor(event: TimelineEvent): string {
  return Buffer.from(`${event.at}|${event.id}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): { at: string; id: string } | null {
  try {
    const [at, ...rest] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    const id = rest.join('|');
    if (!at || !id) return null;
    return { at, id };
  } catch {
    return null;
  }
}

/** Everything strictly after the cursor in the sort order above. */
export function afterCursor(
  events: TimelineEvent[],
  cursor: { at: string; id: string },
): TimelineEvent[] {
  return events.filter((event) =>
    event.at === cursor.at ? event.id > cursor.id : event.at < cursor.at,
  );
}
