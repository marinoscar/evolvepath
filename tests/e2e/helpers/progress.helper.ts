import type { Page } from '@playwright/test';

import { apiGet } from './path.helper';
import { apiPost, type Domain } from './commitments.helper';

// =============================================================================
// Seeding a history the momentum engine can read (issue #121, epic E11)
// =============================================================================
//
// SEEDED THROUGH THE API, NEVER THE DATABASE — the same rule the rest of the
// e2e suite follows, and here it earns its keep twice over: the seeding path
// exercises E02's create contract and E05's action contract, so a fixture that
// drifts from either fails loudly rather than testing a state the API would
// never produce.
//
// The one "unnatural" step is `simulateIdle`, and it is a documented
// non-production helper rather than a back door: every rule the comeback loop
// enforces is about elapsed time, and a suite that could only run at the real
// `now` would have to wait three days.
// =============================================================================

const DAY_MS = 24 * 3_600_000;

export interface SeededRoutinePlan {
  outcomeId: string;
  planId: string;
  planVersionId: string;
  routineId: string;
}

/**
 * An outcome, its plan, its first ACTIVE version and one routine — the shape
 * the restart picker reads.
 */
export async function seedRoutinePlan(
  page: Page,
  input: {
    domain: Domain;
    outcomeTitle: string;
    routineTitle: string;
    minimumMinutes?: number;
    estimatedMinutes?: number;
    fallbackBehavior?: string;
    importance?: number;
  },
): Promise<SeededRoutinePlan> {
  const outcome = await apiPost<{ id: string }>(page, '/api/outcomes', {
    domain: input.domain,
    title: input.outcomeTitle,
    importance: input.importance ?? 5,
  });

  const plan = await apiPost<{ id: string; activeVersion: { id: string } }>(
    page,
    `/api/outcomes/${outcome.id}/plans`,
    {
      rationale: 'Seeded by the E11 end-to-end suite',
      routines: [
        {
          title: input.routineTitle,
          domain: input.domain,
          triggerType: 'TIME',
          triggerValue: '07:00',
          frequency: 'WEEKDAYS',
          daysOfWeek: [],
          preferredTime: '07:00',
          sortOrder: 0,
          estimatedDurationMin: input.estimatedMinutes ?? 40,
          minimumDurationMin: input.minimumMinutes ?? 12,
          fallbackBehavior: input.fallbackBehavior ?? null,
        },
      ],
    },
  );

  // `POST /outcomes/:id/plans` answers with a version SUMMARY (a count, not the
  // rows), so the routine id comes from the list endpoint rather than from a
  // shape the API does not return.
  const routines = await apiGet<Array<{ id: string }>>(
    page,
    `/api/routines?planVersionId=${plan.activeVersion.id}`,
  );

  return {
    outcomeId: outcome.id,
    planId: plan.id,
    planVersionId: plan.activeVersion.id,
    routineId: routines[0].id,
  };
}

export type HistoryOutcome = 'complete' | 'complete_min' | 'skip' | 'leave';

export interface HistoryDay {
  /** Days before today. `0` is today. */
  offset: number;
  outcome: HistoryOutcome;
}

/**
 * A run of past commitments, driven through the real action endpoints.
 *
 * `leave` is the interesting one: the row stays `PLANNED` with its time in the
 * past, which is exactly what a user who disappeared produces — and what the
 * comeback sweep is there to close.
 */
export async function seedHistory(
  page: Page,
  input: {
    domain: Domain;
    plan: SeededRoutinePlan;
    title: string;
    days: HistoryDay[];
    minimumMinutes?: number;
    commitmentType?: string;
  },
): Promise<string[]> {
  const ids: string[] = [];

  for (const day of input.days) {
    const when = new Date(Date.now() - day.offset * DAY_MS);
    when.setUTCHours(9, 0, 0, 0);

    const commitment = await apiPost<{ id: string }>(page, '/api/commitments', {
      domain: input.domain,
      title: input.title,
      scheduledStart: when.toISOString(),
      importance: 4,
      outcomeId: input.plan.outcomeId,
      planVersionId: input.plan.planVersionId,
      routineId: input.plan.routineId,
      commitmentType: input.commitmentType ?? null,
      fullVersion: input.title,
      fullMinutes: 40,
      minimumVersion: `${input.minimumMinutes ?? 12}-minute version`,
      minimumMinutes: input.minimumMinutes ?? 12,
    });

    ids.push(commitment.id);

    if (day.outcome === 'complete_min') {
      await apiPost(page, `/api/commitments/${commitment.id}/actions/fallback`, {
        version: 'minimum',
      });
    }

    if (day.outcome === 'complete' || day.outcome === 'complete_min') {
      await apiPost(page, `/api/commitments/${commitment.id}/actions/complete`, {
        notes: 'Seeded',
      });
    } else if (day.outcome === 'skip') {
      await apiPost(page, `/api/commitments/${commitment.id}/actions/skip`, {
        reason: 'AVOIDED',
      });
    }
    // `leave` writes nothing: the row stays open with its time in the past.
  }

  return ids;
}

/**
 * Make the user look idle, and shift their whole history with them.
 *
 * `@Public()` on the API, which is why this uses a bare request rather than a
 * token: an e2e can call it before it has one.
 */
export async function simulateIdle(
  page: Page,
  email: string,
  idleDays: number,
): Promise<{ shiftedCommitments: number; shiftedEvidence: number }> {
  const response = await page.request.post('/api/auth/test/simulate-idle', {
    data: { email, idleDays },
  });

  if (!response.ok()) {
    throw new Error(`simulate-idle → ${response.status()}: ${await response.text()}`);
  }

  const body = (await response.json()) as {
    data: { shiftedCommitments: number; shiftedEvidence: number };
  };
  return body.data;
}

export interface SweepResult {
  job: string;
  closedCount?: number;
  trigger?: string | null;
  comebackState?: string;
  awarded?: number;
}

/** Runs the REAL job the cron calls, for one named user. */
export async function runJob(
  page: Page,
  job: 'comeback' | 'milestones',
  email: string,
): Promise<SweepResult> {
  return apiPost<SweepResult>(page, '/api/auth/test/run-job', { job, email });
}

export interface MomentumView {
  domain: Domain;
  state: string;
  evidence: string[];
  signals: { planned: number; completed: number; fallback: number; missed: number };
}

export interface ProgressView {
  momentum: Record<Domain, MomentumView>;
  consistencyRun: { weeks: number; graceUsed: number; weekly: unknown[] };
  recovery: { medianDays: number | null; samples: number };
  independence: { ratio: number | null };
  milestones: Array<{ id: string; kind: string; acknowledgedAt: string | null }>;
}

export async function getProgress(page: Page): Promise<ProgressView> {
  return apiGet<ProgressView>(page, '/api/progress');
}

export interface ComebackView {
  state: string;
  trigger: string | null;
  closedCount: number;
  planReviewSuggested: boolean;
  restart: { id: string; title: string; domain: Domain } | null;
  recommendation: { domain: Domain; reason: string } | null;
  alternatives: Array<{ domain: Domain; title: string; minutes: number }>;
}

export async function getComeback(page: Page): Promise<ComebackView> {
  return apiGet<ComebackView>(page, '/api/comeback');
}

export async function getMilestones(
  page: Page,
  unacknowledged = false,
): Promise<{ items: Array<{ id: string; kind: string; acknowledgedAt: string | null }> }> {
  const suffix = unacknowledged ? '?unacknowledged=true' : '';
  return apiGet<{ items: Array<{ id: string; kind: string; acknowledgedAt: string | null }> }>(
    page,
    `/api/progress/milestones${suffix}`,
  );
}

/** Open commitments whose time has passed — the "overdue flood" PRD §109 bans. */
export async function pastDueOpenCommitments(page: Page): Promise<unknown[]> {
  const from = new Date(Date.now() - 60 * DAY_MS).toISOString();
  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);

  return apiGet<unknown[]>(
    page,
    `/api/commitments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(
      startOfToday.toISOString(),
    )}&status=PLANNED,READY`,
  );
}

export async function evidenceCount(page: Page): Promise<number> {
  const from = new Date(Date.now() - 90 * DAY_MS).toISOString();
  const to = new Date(Date.now() + DAY_MS).toISOString();

  const rows = await apiGet<unknown[]>(
    page,
    `/api/evidence?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  );
  return rows.length;
}

export async function latestEvidenceType(page: Page): Promise<string | null> {
  const from = new Date(Date.now() - 90 * DAY_MS).toISOString();
  const to = new Date(Date.now() + DAY_MS).toISOString();

  const rows = await apiGet<Array<{ evidenceType: string }>>(
    page,
    `/api/evidence?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  );
  return rows[0]?.evidenceType ?? null;
}

/** The three regexes PRD P13 and §54 forbid, in one place. */
export const NO_SCORE_PATTERNS = [
  /\b\d{1,3}\s*\/\s*100\b/,
  /\bscore\b/i,
  /\d+\s*%/,
];
