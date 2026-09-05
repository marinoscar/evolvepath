import type { Page } from '@playwright/test';

import { apiGet, withToken } from './path.helper';
import { apiPost } from './commitments.helper';

// =============================================================================
// Seeding a week for the weekly review (issue #89, epic E10)
// =============================================================================
//
// A SIBLING of `commitments.helper.ts` and `coach.helper.ts`, not a second copy
// of them: `apiPost`, `apiGet` and `loginAsTestUser` are imported, never
// reimplemented. What lives here is the E10-shaped fixture — a whole week of
// mixed outcomes — which would bury `commitments.helper.ts`'s Today-focused
// primitives if it were inlined there.
//
// SEEDED THROUGH THE API, NEVER THROUGH THE DATABASE, for the reason
// `coach.helper.ts` gives: Playwright cannot reach Postgres, and going through
// `POST /outcomes → /plans → /commitments → /actions/*` means a drifted create
// contract fails loudly here rather than being tested in a state the API would
// never produce.
//
// EVERY INSTANT IS UTC. A test user has no `user_profiles` row until something
// writes one, so the API resolves "this week" in UTC — which is exactly what
// `mondayOfThisWeekUtc` below computes. Using the runner's local zone would
// make the fixture pass or fail depending on where CI runs.
// =============================================================================

export type Domain = 'WORK' | 'FAMILY' | 'HEALTH';

export interface SeededWeeklyPlan {
  outcomeId: string;
  planId: string;
  versionId: string;
  routineId: string;
}

export interface SeededWeek {
  weekStart: string;
  health: SeededWeeklyPlan;
  work: SeededWeeklyPlan;
  /** The HEALTH row that was moved twice and is still open. */
  movedCommitmentId: string;
}

const DAY_MS = 24 * 3600_000;

/** The Monday of the current UTC week, as `'YYYY-MM-DD'`. */
export function mondayOfThisWeekUtc(now = new Date()): string {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  // Sunday is 0; a Monday-start week puts it six days after the start.
  const daysSinceMonday = (new Date(midnight).getUTCDay() + 6) % 7;

  return new Date(midnight - daysSinceMonday * DAY_MS).toISOString().slice(0, 10);
}

/** `weekStart` shifted by `n` days, still `'YYYY-MM-DD'`. */
export function addDays(dateUtc: string, n: number): string {
  const [year, month, day] = dateUtc.split('-').map(Number);

  return new Date(Date.UTC(year, month - 1, day) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Next Monday, which is the week the planning wizard opens on by default. */
export function nextMondayUtc(now = new Date()): string {
  return addDays(mondayOfThisWeekUtc(now), 7);
}

/**
 * Turn the deployment's AI on, and CHECK THAT IT TOOK.
 *
 * `ai_settings` ships `enabled: false` with no provider, so a fresh stack
 * answers every persona with `ai_disabled` — and E10's review would degrade to
 * its template while looking, from the outside, exactly like a coach that
 * simply chose not to propose anything. That is the one outcome this fixture
 * exists to rule out, so the write is asserted rather than fired and forgotten
 * (the same reason `family.spec.ts` asserts its own `baseUrl` write: the
 * settings row is system-wide and version-checked, so a stale `If-Match` makes
 * the PUT a silent 412).
 */
export async function enableAi(page: Page, model = 'gpt-5.4'): Promise<void> {
  const current = await withToken(page, (token) =>
    page.request.get('/api/ai-settings', { headers: { Authorization: `Bearer ${token}` } }),
  );
  if (!current.ok()) throw new Error(`reading AI settings → ${current.status()}`);

  const etag = current.headers()['etag'];
  // A FULL REPLACE: `PUT /ai-settings` validates the whole object, and
  // `platformKey` is the read-only status block the GET adds and the PUT
  // refuses.
  const { platformKey: _status, ...writable } = ((await current.json()) as {
    data: Record<string, unknown>;
  }).data;

  const written = await withToken(page, (token) =>
    page.request.put('/api/ai-settings', {
      headers: { Authorization: `Bearer ${token}`, ...(etag ? { 'If-Match': etag } : {}) },
      data: { ...writable, provider: 'openai', enabled: true, defaultModel: model },
    }),
  );

  if (!written.ok()) {
    throw new Error(`enabling AI → ${written.status()}: ${await written.text()}`);
  }
}

/** A UTC instant on a `'YYYY-MM-DD'` date at an `HH:mm` wall clock. */
export function atUtc(dateUtc: string, time: string): string {
  const [year, month, day] = dateUtc.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);

  return new Date(Date.UTC(year, month - 1, day, hours, minutes)).toISOString();
}

async function seedPlan(
  page: Page,
  input: {
    domain: Domain;
    title: string;
    routine: Record<string, unknown>;
  },
): Promise<SeededWeeklyPlan> {
  const outcome = await apiPost<{ id: string }>(page, '/api/outcomes', {
    domain: input.domain,
    title: input.title,
    importance: 5,
  });

  const plan = await apiPost<{ id: string; activeVersion: { id: string } }>(
    page,
    `/api/outcomes/${outcome.id}/plans`,
    {
      rationale: 'The first plan.',
      expectedWeeklyLoad: 120,
      routines: [{ domain: input.domain, triggerType: 'TIME', ...input.routine }],
    },
  );

  const version = await apiGet<{ routines: Array<{ id: string }> }>(
    page,
    `/api/plans/${plan.id}/versions/1`,
  );

  return {
    outcomeId: outcome.id,
    planId: plan.id,
    versionId: plan.activeVersion.id,
    routineId: version.routines[0]!.id,
  };
}

/**
 * The epic-script week, seeded through the public API — into LAST week.
 *
 * LAST WEEK, NOT THIS ONE, and that is the difference between a spec that
 * passes and one that passes on Fridays. A partially-elapsed week aggregates
 * only as far as `coverage.to = min(weekEnd, now)`, so seeding "Monday to
 * today" makes every count depend on the day and hour CI happens to run: the
 * workout moved to Saturday is in the future on a Wednesday and simply absent
 * from the numbers. A finished week is the same week whenever it is read.
 *
 * The plan is then made for the week AFTER it — the week that has just started
 * — so approving it still closes the review it came from, which is the link
 * step 9 of the epic script asserts.
 *
 *   WORK    5 blocks at 07:30 — 4 completed, 1 skipped
 *   HEALTH  3 workouts at 18:30 — 1 completed FULL, 1 completed after a
 *           MINIMUM fallback, 1 moved twice and still open
 *   FAMILY  3 dinners at 19:00 — 2 completed, 1 skipped
 *   plus one day reflection carrying a friction tag
 *
 * The HEALTH routine runs Mon/Wed/Sat so the planning wizard has something to
 * materialise on a Saturday once the accepted proposal moves it there.
 */
export async function seedMixedWeek(page: Page): Promise<SeededWeek> {
  const weekStart = addDays(mondayOfThisWeekUtc(), -7);

  const health = await seedPlan(page, {
    domain: 'HEALTH',
    title: 'Get strong again',
    routine: {
      title: 'Strength workout',
      triggerValue: '18:30',
      frequency: 'CUSTOM',
      daysOfWeek: [1, 3, 6],
      preferredTime: '18:30',
      estimatedDurationMin: 40,
      minimumDurationMin: 15,
      fallbackBehavior: '10-minute circuit',
    },
  });

  const work = await seedPlan(page, {
    domain: 'WORK',
    title: 'Ship the proposal',
    routine: {
      title: 'Morning focus block',
      frequency: 'WEEKDAYS',
      daysOfWeek: [],
      preferredTime: '07:30',
      estimatedDurationMin: 50,
      minimumDurationMin: 10,
    },
  });

  const create = (input: {
    domain: Domain;
    title: string;
    date: string;
    time: string;
    minutes: number;
    plan: SeededWeeklyPlan;
  }) =>
    apiPost<{ id: string }>(page, '/api/commitments', {
      domain: input.domain,
      title: input.title,
      scheduledStart: atUtc(input.date, input.time),
      importance: 3,
      outcomeId: input.plan.outcomeId,
      planVersionId: input.plan.versionId,
      routineId: input.plan.routineId,
      fullVersion: input.title,
      fullMinutes: input.minutes,
      minimumVersion: '10-minute version',
      minimumMinutes: 10,
    });

  // WORK — four done, one skipped.
  for (const [index, offset] of [0, 1, 2, 3, 4].entries()) {
    const row = await create({
      domain: 'WORK',
      title: 'Morning focus block',
      date: addDays(weekStart, offset),
      time: '07:30',
      minutes: 50,
      plan: work,
    });

    if (index === 4) {
      await apiPost(page, `/api/commitments/${row.id}/actions/skip`, {
        reason: 'TOO_MUCH',
      });
    } else {
      await apiPost(page, `/api/commitments/${row.id}/actions/complete`, {
        minutesSpent: 50,
      });
    }
  }

  // HEALTH — one full, one after a minimum fallback, one moved twice.
  const monday = await create({
    domain: 'HEALTH',
    title: 'Strength workout',
    date: weekStart,
    time: '18:30',
    minutes: 40,
    plan: health,
  });
  await apiPost(page, `/api/commitments/${monday.id}/actions/complete`, {
    minutesSpent: 40,
  });

  const wednesday = await create({
    domain: 'HEALTH',
    title: 'Strength workout',
    date: addDays(weekStart, 2),
    time: '18:30',
    minutes: 40,
    plan: health,
  });
  // A fallback names which size is being attempted; it is not a status change.
  await apiPost(page, `/api/commitments/${wednesday.id}/actions/fallback`, {
    version: 'minimum',
  });
  await apiPost(page, `/api/commitments/${wednesday.id}/actions/complete`, {
    minutesSpent: 15,
  });

  const saturday = await create({
    domain: 'HEALTH',
    title: 'Strength workout',
    date: addDays(weekStart, 5),
    time: '18:30',
    minutes: 40,
    plan: health,
  });
  // Each reschedule closes the row and opens a new one carrying the count, so
  // the second move has to be applied to the row the first one produced.
  const firstMove = await apiPost<{ id: string }>(
    page,
    `/api/commitments/${saturday.id}/actions/reschedule`,
    { scheduledStart: atUtc(addDays(weekStart, 5), '19:30') },
  );
  const secondMove = await apiPost<{ id: string }>(
    page,
    `/api/commitments/${firstMove.id}/actions/reschedule`,
    { scheduledStart: atUtc(addDays(weekStart, 6), '18:30') },
  );

  // FAMILY — two kept, one skipped. Quick adds, with no plan behind them.
  for (const [index, offset] of [0, 2, 4].entries()) {
    const row = await apiPost<{ id: string }>(page, '/api/commitments', {
      domain: 'FAMILY',
      title: 'Sit down for dinner together',
      scheduledStart: atUtc(addDays(weekStart, offset), '19:00'),
      importance: 4,
      fullVersion: 'Sit down for dinner together',
      fullMinutes: 45,
    });

    if (index === 2) {
      await apiPost(page, `/api/commitments/${row.id}/actions/skip`, {
        reason: 'UNEXPECTED_CONFLICT',
      });
    } else {
      await apiPost(page, `/api/commitments/${row.id}/actions/complete`, {
        minutesSpent: 45,
      });
    }
  }

  await apiPost(page, '/api/today/reflection', { quickOption: 'BAD_TIMING' });

  return { weekStart, health, work, movedCommitmentId: secondMove.id };
}

export interface WeeklyReviewDetail {
  id: string;
  weekStart: string;
  status: string;
  counts: Record<Domain, { planned: number; completed: number }>;
  aggregates: {
    domains: Record<Domain, Record<string, number>>;
    rescheduleLeaders: Array<{ title: string; rescheduleCount: number }>;
  };
  aiSummary: { source: string; patterns: Array<{ observation: string }> } | null;
  proposals: Array<{ id: string; summary: string }>;
  plan: { id: string; status: string } | null;
}

export async function generateReview(
  page: Page,
  weekStart?: string,
): Promise<WeeklyReviewDetail> {
  return apiPost<WeeklyReviewDetail>(
    page,
    '/api/weekly/reviews/generate',
    weekStart ? { weekStart } : {},
  );
}

export async function currentReview(page: Page): Promise<WeeklyReviewDetail | null> {
  return apiGet<WeeklyReviewDetail | null>(page, '/api/weekly/reviews/current');
}

export interface WeeklySettings {
  weeklyReviewWeekday: number;
  weeklyReviewTime: string;
}

export async function weeklySettings(page: Page): Promise<WeeklySettings> {
  return apiGet<WeeklySettings>(page, '/api/weekly/settings');
}

export async function listCommitmentsBetween(
  page: Page,
  from: string,
  to: string,
): Promise<Array<{ id: string; title: string; status: string; scheduledStart: string }>> {
  return apiGet(
    page,
    `/api/commitments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  );
}

export async function domainModes(
  page: Page,
): Promise<Array<{ domain: Domain; mode: string }>> {
  return apiGet(page, '/api/me/domain-modes');
}
