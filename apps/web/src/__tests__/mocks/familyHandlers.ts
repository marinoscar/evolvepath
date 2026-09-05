import { http, HttpResponse } from 'msw';

import type {
  FamilyMember,
  FamilyMemberInput,
  FamilySummary,
  MaterializeResult,
  Ritual,
  RitualInput,
  RitualWeekCounts,
} from '../../types';
import { allCommitments, insertCommitment } from './pathHandlers';

// =============================================================================
// A stateful in-memory Family API (issue #50, epic E08)
// =============================================================================
//
// STATEFUL, and it enforces the rules the real API enforces — because a mock
// that accepted everything would let page tests pass against behaviour the
// server rejects, which reads as coverage and is worse than no test.
//
// What is enforced here, matching `apps/api/src/family`:
//
//   * The BEHAVIOUR LINT (PRD §32). A person-targeting title is a 400 with
//     `details.reason = 'BEHAVIOUR_TARGETS_OTHER_PERSON'` and the offending
//     substring, on ritual create AND update, exactly as the API answers.
//   * `minimumMinutes <= idealMinutes`, checked against the MERGED ritual.
//   * MATERIALIZATION: creating a ritual really does write `PLANNED` FAMILY
//     commitments into the same store `GET /commitments` reads, seven days
//     ahead, idempotently — a second call is `skipped`, never a duplicate.
//   * A member response carries EXACTLY the five permitted keys.
//
// `resetFamilyState()` runs from the global `afterEach`.
// =============================================================================

const API_BASE = '*/api';
const HORIZON_DAYS = 7;

interface FamilyState {
  members: FamilyMember[];
  rituals: Ritual[];
  /** What `POST /family/lint` offers. `null` stands for "AI is unavailable". */
  suggestion: string | null;
  sequence: number;
}

function emptyState(): FamilyState {
  return { members: [], rituals: [], suggestion: 'Read with Mia for 15 minutes', sequence: 0 };
}

let state: FamilyState = emptyState();

export function resetFamilyState(): void {
  state = emptyState();
}

export function seedFamilyState(patch: Partial<FamilyState>): void {
  state = { ...state, ...patch };
}

export function getFamilyState(): Readonly<FamilyState> {
  return state;
}

function nextId(prefix: string): string {
  state.sequence += 1;
  return `${prefix}-${state.sequence}`;
}

const now = () => new Date().toISOString();

const ok = <T>(data: T) => HttpResponse.json({ data, meta: { timestamp: now() } });

const notFound = (what: string) =>
  HttpResponse.json(
    { statusCode: 404, code: 'NOT_FOUND', message: `${what} not found` },
    { status: 404 },
  );

// --- The lint, in the shape the real one answers ----------------------------

const VERBS = 'make|get|force|convince|persuade|teach|train|fix|improve|change|correct';
const TARGETS =
  'spouse|wife|husband|partner|kid|kids|child|children|son|daughter|mom|mum|dad|mother|father|parents|brother|sister|family|everyone';
const STATES =
  'happier|happy|calmer|calm|nicer|behave|listen|obey|understand|appreciate|respect|attitude|mood|habits|manners|grades';

/**
 * A faithful-enough stand-in for `behaviour-lint.ts`.
 *
 * Deliberately NOT a copy of the real rules: the real ones are unit-tested
 * against every PRD §32 example on the API side, and duplicating them here
 * would be a second implementation to keep in step. What the web tests need is
 * that the WIRING works — a refused title becomes a field error with the
 * server's `match` — so this catches the same canonical sentences.
 */
export function lintTitle(title: string): { ok: boolean; match: string | null } {
  const names = title
    .trim()
    .split(/\s+/)
    .slice(1)
    .map((word) => word.replace(/[^\p{L}\p{N}'’-]/gu, ''))
    .filter((word) => /^\p{Lu}/u.test(word));

  const person = [TARGETS, ...names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))]
    .filter(Boolean)
    .join('|');

  const patterns = [
    new RegExp(`\\b(?:${VERBS})\\s+(?:(?:my|the|our)\\s+)?(?:${person})\\b.{0,40}?\\b(?:${STATES})\\b`, 'iu'),
    new RegExp(`\\b(?:fix|improve|change|correct)\\s+(?:(?:my|the|our)\\s+)?(?:${person})(?:'s|’s)\\s+(?:${STATES})\\b`, 'iu'),
    new RegExp(`\\b(?:${person})\\s+(?:should|must|needs to|has to)\\b`, 'iu'),
  ];

  for (const pattern of patterns) {
    const found = pattern.exec(title);
    if (found) return { ok: false, match: found[0] };
  }

  return { ok: true, match: null };
}

const lintRefusal = (match: string) =>
  HttpResponse.json(
    {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Describe what you will do, not how someone else should feel or behave.',
      details: { reason: 'BEHAVIOUR_TARGETS_OTHER_PERSON', match, rule: 'A' },
    },
    { status: 400 },
  );

// --- Materialization --------------------------------------------------------

function localDate(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/**
 * Write the next seven days of a ritual's occurrences, skipping any that exist.
 *
 * The "skip" is by `(ritualId, scheduledStart)`, which is exactly what the
 * server's unique index does — so a page test that calls materialize twice
 * observes the same `{created: 0}` a real one would.
 */
function materialize(ritual: Ritual): MaterializeResult {
  const start = new Date();
  let created = 0;
  let skipped = 0;

  for (let offset = 0; offset <= HORIZON_DAYS; offset += 1) {
    const day = new Date(start.getTime() + offset * 24 * 3600_000);
    if (!ritual.recurrence.weekdays.includes(day.getDay())) continue;

    const [hour, minute] = ritual.recurrence.time.split(':').map(Number);
    const at = new Date(day);
    at.setHours(hour, minute, 0, 0);
    if (at.getTime() <= start.getTime()) continue;

    const scheduledStart = at.toISOString();
    const exists = allCommitments().some(
      (row) => row.ritualId === ritual.id && row.scheduledStart === scheduledStart,
    );

    if (exists) {
      skipped += 1;
      continue;
    }

    const spread = ritual.idealMinutes - ritual.minimumMinutes;

    insertCommitment({
      domain: 'FAMILY',
      title: ritual.title,
      status: 'PLANNED',
      scheduledStart,
      scheduledEnd: new Date(at.getTime() + ritual.idealMinutes * 60_000).toISOString(),
      importance: 4,
      ritualId: ritual.id,
      familyMemberId: ritual.familyMemberId,
      fullVersion: ritual.title,
      fullMinutes: ritual.idealMinutes,
      shortVersion: spread >= 10 ? ritual.title : null,
      shortMinutes: spread >= 10 ? Math.round((ritual.idealMinutes + ritual.minimumMinutes) / 2) : null,
      minimumVersion: ritual.fallbackBehavior ?? ritual.title,
      minimumMinutes: ritual.minimumMinutes,
    });
    created += 1;
  }

  const through = localDate(new Date(start.getTime() + HORIZON_DAYS * 24 * 3600_000));
  ritual.lastMaterializedThrough = through;

  return { created, skipped, through };
}

/** Withdraw the future PLANNED/READY occurrences, as the API's edit path does. */
function cancelFuture(ritualId: string): void {
  const nowMs = Date.now();

  for (const row of allCommitments()) {
    if (
      row.ritualId === ritualId &&
      new Date(row.scheduledStart).getTime() > nowMs &&
      (row.status === 'PLANNED' || row.status === 'READY')
    ) {
      (row as { status: string }).status = 'CANCELLED';
    }
  }
}

// --- Builders ---------------------------------------------------------------

export function makeMember(overrides: Partial<FamilyMember> = {}): FamilyMember {
  return {
    id: nextId('member'),
    nickname: 'Mia',
    relationship: 'CHILD',
    birthday: null,
    createdAt: now(),
    ...overrides,
  };
}

export function makeRitual(overrides: Partial<Ritual> = {}): Ritual {
  return {
    id: nextId('ritual'),
    title: 'Phone-free dinner',
    purpose: null,
    familyMemberId: null,
    recurrence: { weekdays: [2, 4, 0], time: '18:30', everyNWeeks: 1 },
    idealMinutes: 45,
    minimumMinutes: 10,
    fallbackBehavior: null,
    active: true,
    lastMaterializedThrough: null,
    routineId: null,
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  };
}

// --- Handlers ---------------------------------------------------------------

export const familyHandlers = [
  http.get(`${API_BASE}/family/members`, () => ok(state.members)),

  http.post(`${API_BASE}/family/members`, async ({ request }) => {
    const body = (await request.json()) as FamilyMemberInput;

    const created = makeMember({
      nickname: body.nickname,
      relationship: body.relationship,
      birthday: body.birthday ?? null,
    });

    state.members.push(created);
    return HttpResponse.json({ data: created }, { status: 201 });
  }),

  http.patch(`${API_BASE}/family/members/:id`, async ({ params, request }) => {
    const member = state.members.find((entry) => entry.id === params.id);
    if (!member) return notFound('Family member');

    const body = (await request.json()) as Partial<FamilyMemberInput>;
    if (body.nickname !== undefined) member.nickname = body.nickname;
    if (body.relationship !== undefined) member.relationship = body.relationship;
    if (body.birthday !== undefined) member.birthday = body.birthday ?? null;

    return ok(member);
  }),

  http.delete(`${API_BASE}/family/members/:id`, ({ params }) => {
    const index = state.members.findIndex((entry) => entry.id === params.id);
    if (index < 0) return notFound('Family member');

    state.members.splice(index, 1);
    return new HttpResponse(null, { status: 204 });
  }),

  http.get(`${API_BASE}/family/rituals`, ({ request }) => {
    const active = new URL(request.url).searchParams.get('active');
    const rows = state.rituals.filter(
      (ritual) => active === null || ritual.active === (active === 'true'),
    );

    return ok(rows);
  }),

  http.get(`${API_BASE}/family/rituals/:id`, ({ params }) => {
    const ritual = state.rituals.find((entry) => entry.id === params.id);
    if (!ritual) return notFound('Ritual');

    return ok({ ...ritual, upcoming: [] });
  }),

  http.post(`${API_BASE}/family/rituals`, async ({ request }) => {
    const body = (await request.json()) as RitualInput;

    const verdict = lintTitle(body.title ?? '');
    if (!verdict.ok) return lintRefusal(verdict.match!);

    if ((body.minimumMinutes ?? 0) > (body.idealMinutes ?? 0)) {
      return HttpResponse.json(
        {
          statusCode: 400,
          code: 'VALIDATION_ERROR',
          message: 'The minimum version cannot be longer than the ideal one',
          details: { reason: 'MINIMUM_EXCEEDS_IDEAL' },
        },
        { status: 400 },
      );
    }

    const created = makeRitual({
      title: body.title ?? 'Ritual',
      purpose: body.purpose ?? null,
      familyMemberId: body.familyMemberId ?? null,
      recurrence: body.recurrence ?? { weekdays: [1], time: '18:30', everyNWeeks: 1 },
      idealMinutes: body.idealMinutes ?? 45,
      minimumMinutes: body.minimumMinutes ?? 10,
      fallbackBehavior: body.fallbackBehavior ?? null,
    });

    state.rituals.push(created);
    // Synchronously, as the API does: the occurrences are on Today before the
    // response returns.
    materialize(created);

    return HttpResponse.json({ data: created }, { status: 201 });
  }),

  http.patch(`${API_BASE}/family/rituals/:id`, async ({ params, request }) => {
    const ritual = state.rituals.find((entry) => entry.id === params.id);
    if (!ritual) return notFound('Ritual');

    const body = (await request.json()) as RitualInput;

    if (body.title !== undefined) {
      const verdict = lintTitle(body.title);
      if (!verdict.ok) return lintRefusal(verdict.match!);
    }

    const merged = {
      ideal: body.idealMinutes ?? ritual.idealMinutes,
      minimum: body.minimumMinutes ?? ritual.minimumMinutes,
    };
    if (merged.minimum > merged.ideal) {
      return HttpResponse.json(
        {
          statusCode: 400,
          code: 'VALIDATION_ERROR',
          message: 'The minimum version cannot be longer than the ideal one',
          details: { reason: 'MINIMUM_EXCEEDS_IDEAL' },
        },
        { status: 400 },
      );
    }

    const material =
      body.title !== undefined ||
      body.recurrence !== undefined ||
      body.idealMinutes !== undefined ||
      body.minimumMinutes !== undefined ||
      body.fallbackBehavior !== undefined ||
      body.active !== undefined;

    Object.assign(ritual, {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.purpose !== undefined ? { purpose: body.purpose ?? null } : {}),
      ...(body.familyMemberId !== undefined
        ? { familyMemberId: body.familyMemberId ?? null }
        : {}),
      ...(body.recurrence !== undefined ? { recurrence: body.recurrence } : {}),
      ...(body.idealMinutes !== undefined ? { idealMinutes: body.idealMinutes } : {}),
      ...(body.minimumMinutes !== undefined ? { minimumMinutes: body.minimumMinutes } : {}),
      ...(body.fallbackBehavior !== undefined
        ? { fallbackBehavior: body.fallbackBehavior ?? null }
        : {}),
      ...(body.active !== undefined ? { active: body.active } : {}),
      updatedAt: now(),
    });

    if (material) {
      cancelFuture(ritual.id);
      if (ritual.active) materialize(ritual);
    }

    return ok(ritual);
  }),

  http.delete(`${API_BASE}/family/rituals/:id`, ({ params }) => {
    const index = state.rituals.findIndex((entry) => entry.id === params.id);
    if (index < 0) return notFound('Ritual');

    cancelFuture(String(params.id));
    state.rituals.splice(index, 1);
    return new HttpResponse(null, { status: 204 });
  }),

  http.post(`${API_BASE}/family/rituals/:id/materialize`, ({ params }) => {
    const ritual = state.rituals.find((entry) => entry.id === params.id);
    if (!ritual) return notFound('Ritual');

    return ok(materialize(ritual));
  }),

  http.post(`${API_BASE}/family/lint`, async ({ request }) => {
    const { title } = (await request.json()) as { title: string };
    const verdict = lintTitle(title);

    if (verdict.ok) {
      return ok({ ok: true, code: null, match: null, suggestion: null, source: 'none' });
    }

    // `state.suggestion === null` is how a test says "the coach is down": the
    // verdict still comes back, without the shortcut.
    return ok({
      ok: false,
      code: 'TARGETS_OTHER_PERSON',
      match: verdict.match,
      suggestion: state.suggestion,
      source: state.suggestion ? 'ai' : 'none',
    });
  }),

  http.get(`${API_BASE}/family/summary`, ({ request }) => {
    const weeks = Number(new URL(request.url).searchParams.get('weeks') ?? 4);
    const rows = allCommitments().filter(
      (row) => row.domain === 'FAMILY' && row.status !== 'CANCELLED',
    );

    const byRitual = new Map<string | null, RitualWeekCounts>();

    for (const ritual of state.rituals.filter((entry) => entry.active)) {
      byRitual.set(ritual.id, {
        ritualId: ritual.id,
        title: ritual.title,
        planned: 0,
        kept: 0,
        partial: 0,
        moved: 0,
        skipped: 0,
        missed: 0,
        open: 0,
      });
    }

    for (const row of rows) {
      const counts =
        byRitual.get(row.ritualId) ??
        ({
          ritualId: row.ritualId,
          title: row.ritualId ? row.title : 'Other family commitments',
          planned: 0,
          kept: 0,
          partial: 0,
          moved: 0,
          skipped: 0,
          missed: 0,
          open: 0,
        } satisfies RitualWeekCounts);

      byRitual.set(row.ritualId, counts);
      counts.planned += 1;

      if (row.status === 'COMPLETED') counts.kept += 1;
      else if (row.status === 'PARTIALLY_COMPLETED') counts.partial += 1;
      else if (row.status === 'RESCHEDULED') counts.moved += 1;
      else if (row.status === 'SKIPPED') counts.skipped += 1;
      else if (row.status === 'MISSED') counts.missed += 1;
      else counts.open += 1;
    }

    const list = [...byRitual.values()];
    const sum = (key: keyof Omit<RitualWeekCounts, 'ritualId' | 'title'>) =>
      list.reduce((total, counts) => total + counts[key], 0);

    const summary: FamilySummary = {
      timezone: 'UTC',
      weeks: [
        {
          weekStart: localDate(new Date()),
          rituals: list,
          totals: {
            planned: sum('planned'),
            kept: sum('kept'),
            partial: sum('partial'),
            moved: sum('moved'),
            skipped: sum('skipped'),
            missed: sum('missed'),
            open: sum('open'),
          },
        },
      ],
      coachNote: null,
    };

    void weeks;
    return ok(summary);
  }),
];
