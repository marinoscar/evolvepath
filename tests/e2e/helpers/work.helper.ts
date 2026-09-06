import type { Page } from '@playwright/test';

import { apiGet } from './path.helper';
import { apiPost } from './commitments.helper';

// =============================================================================
// Reading the Work domain over the API (issue #122, epic E07)
// =============================================================================
//
// Every assertion in `work.spec.ts` lands in TWO places: what the browser shows,
// and what the API says afterwards. These are the second half.
// =============================================================================

export interface WorkPlanSession {
  id: string;
  title: string;
  status: string;
  scheduledStart: string;
  durationMinutes: number | null;
  milestoneId: string | null;
  rescheduleCount: number;
}

export interface OutcomeWorkPlan {
  milestones: Array<{ id: string; title: string; order: number }>;
  sessions: WorkPlanSession[];
  implementationIntention: { when: string; then: string } | null;
  reviewCadence: string | null;
  latestProposal: { id: string; status: string; source: string } | null;
}

export interface AvoidanceAssessment {
  level: number;
  interventionType: string;
  signals: string[];
  rationale: string;
  suggestedAction: string;
}

export interface FocusSessionRow {
  id: string;
  commitmentId: string;
  plannedMinutes: number;
  endedAt: string | null;
  outcome: string | null;
  actualMinutes: number | null;
  continuedCount: number;
  distractionNotes: string[];
  commitment: { title: string; status: string; timer: { timerMinutes: number | null } | null };
}

export interface WorkSummary {
  focusSessions: {
    planned: number;
    started: number;
    done: number;
    partial: number;
    abandoned: number;
  };
  starts: { commitmentsDue: number; started: number; completed: number };
  repeatedlyPostponed: Array<{ commitmentId: string; rescheduleCount: number; level: number }>;
  timeWindows: Record<string, { planned: number; completed: number }>;
  distractionNoteCount: number;
}

export async function getWorkPlan(page: Page, outcomeId: string): Promise<OutcomeWorkPlan> {
  return apiGet<OutcomeWorkPlan>(page, `/api/outcomes/${outcomeId}/work-plan`);
}

export async function getAvoidance(
  page: Page,
  commitmentId: string,
): Promise<AvoidanceAssessment> {
  return apiGet<AvoidanceAssessment>(page, `/api/commitments/${commitmentId}/avoidance`);
}

export async function listFocusSessions(
  page: Page,
  commitmentId: string,
): Promise<FocusSessionRow[]> {
  const result = await apiGet<{ sessions: FocusSessionRow[] }>(
    page,
    `/api/focus-sessions?commitmentId=${commitmentId}`,
  );

  return result.sessions;
}

export async function getWorkSummary(page: Page): Promise<WorkSummary> {
  return apiGet<WorkSummary>(page, '/api/work/summary');
}

/** Move a commitment. Returns the NEW row — `RESCHEDULED` is terminal. */
export async function reschedule(
  page: Page,
  commitmentId: string,
  scheduledStart: string,
  isProtected = false,
): Promise<{ id: string; rescheduleCount: number; status: string }> {
  return apiPost(page, `/api/commitments/${commitmentId}/actions/reschedule`, {
    scheduledStart,
    ...(isProtected ? { protected: true } : {}),
  });
}

/** Start a focus session directly, for the cases that need one already running. */
export async function startFocusSession(
  page: Page,
  commitmentId: string,
  plannedMinutes: number,
): Promise<FocusSessionRow> {
  return apiPost(page, '/api/focus-sessions', { commitmentId, plannedMinutes });
}
