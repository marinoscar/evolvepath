import type { Page } from '@playwright/test';

import { apiGet } from './path.helper';
import { apiPost } from './commitments.helper';

// =============================================================================
// Seeding the coach's world over the API (issue #93, epic E06)
// =============================================================================
//
// SEEDED THROUGH THE API, NEVER THROUGH THE UI. The spec is about the coach,
// not about onboarding — and a UI seed would make every coach assertion depend
// on a screen it is not testing. It is also not seeded through the database,
// because Playwright cannot reach Postgres and, more usefully, because going
// through `POST /outcomes` and `POST /outcomes/:id/plans` means a drifted
// create contract fails loudly here rather than being tested in a state the
// API would never produce.
//
// The shape below is the epic's own fixture: one HEALTH outcome, one plan at
// v1 ACTIVE, one "Strength workout" routine on WEDNESDAY at 18:30. Every test
// in `coach.spec.ts` starts from it, because PRD §68's sentence — "I can't work
// out Wednesday anymore" — only means anything against a Wednesday routine.
// =============================================================================

export interface SeededPlan {
  outcomeId: string;
  planId: string;
  versionId: string;
  routineId: string;
  commitmentId: string;
}

export interface PlanVersionSummary {
  id: string;
  version: number;
  status: string;
  rationale: string | null;
  createdBy: string;
}

/** Today at a given UTC hour, as an ISO instant. */
export function todayUtcAt(hour: number, minute = 0): string {
  const when = new Date();
  when.setUTCHours(hour, minute, 0, 0);
  return when.toISOString();
}

/**
 * The epic fixture: outcome → plan → v1 → routine → one commitment today.
 *
 * The commitment is TODAY on purpose: `assemble(userId, 'coach')` renders
 * `todayCommitments`, and the activation-reduction scenario needs a
 * `commitmentId` in the context to point its "Start 10 min" at.
 */
export async function seedCoachFixture(page: Page): Promise<SeededPlan> {
  const outcome = await apiPost<{ id: string }>(page, '/api/outcomes', {
    domain: 'HEALTH',
    title: 'Get strong again',
    importance: 5,
    motivation: 'I want to keep up with my kids.',
  });

  const plan = await apiPost<{ id: string; activeVersion: { id: string } }>(
    page,
    `/api/outcomes/${outcome.id}/plans`,
    {
      rationale: 'Start with one solid session a week.',
      expectedWeeklyLoad: 40,
      routines: [
        {
          title: 'Strength workout',
          domain: 'HEALTH',
          triggerType: 'TIME',
          triggerValue: 'WED',
          frequency: 'WEEKLY',
          daysOfWeek: [3],
          preferredTime: '18:30',
          estimatedDurationMin: 40,
          minimumDurationMin: 15,
          fallbackBehavior: 'Ten minutes of mobility',
        },
      ],
    },
  );

  const version = await apiGet<{ routines: Array<{ id: string }> }>(
    page,
    `/api/plans/${plan.id}/versions/1`,
  );
  const routineId = version.routines[0]!.id;

  const commitment = await apiPost<{ id: string }>(page, '/api/commitments', {
    domain: 'HEALTH',
    title: 'Strength workout',
    scheduledStart: todayUtcAt(18, 30),
    importance: 4,
    outcomeId: outcome.id,
    planVersionId: plan.activeVersion.id,
    routineId,
    fullVersion: 'Strength workout',
    fullMinutes: 40,
    minimumVersion: 'Ten minutes of mobility',
    minimumMinutes: 10,
  });

  return {
    outcomeId: outcome.id,
    planId: plan.id,
    versionId: plan.activeVersion.id,
    routineId,
    commitmentId: commitment.id,
  };
}

/** Every version of a plan, newest first — the count is the E06 invariant. */
export async function listVersions(
  page: Page,
  planId: string,
): Promise<PlanVersionSummary[]> {
  return apiGet<PlanVersionSummary[]>(page, `/api/plans/${planId}/versions`);
}

export interface CoachThreadMessage {
  id: string;
  role: string;
  content: string;
  structured: Record<string, unknown> | null;
  safety: { decision: string; category: string; userFacingNote?: string } | null;
}

export async function latestConversationId(page: Page): Promise<string> {
  const list = await apiGet<{ items: Array<{ id: string }> }>(
    page,
    '/api/coach/conversations',
  );

  if (list.items.length === 0) throw new Error('no coach conversations exist yet');
  return list.items[0]!.id;
}

export async function listMessages(
  page: Page,
  conversationId: string,
): Promise<CoachThreadMessage[]> {
  const result = await apiGet<{ items: CoachThreadMessage[] }>(
    page,
    `/api/coach/conversations/${conversationId}/messages`,
  );
  return result.items;
}

export async function proposeInsights(page: Page) {
  return apiPost<{ created: Array<{ id: string; statement: string }>; skipped: string | null }>(
    page,
    '/api/memory-insights/propose',
    {},
  );
}

export async function listInsights(page: Page) {
  const result = await apiGet<{
    items: Array<{
      id: string;
      statement: string;
      userConfirmed: boolean;
      doNotUse: boolean;
      source: string;
    }>;
  }>(page, '/api/memory-insights?includeDoNotUse=true');

  return result.items;
}
