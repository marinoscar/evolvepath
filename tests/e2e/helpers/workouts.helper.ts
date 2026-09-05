import type { Page } from '@playwright/test';

import { apiGet } from './path.helper';
import { apiPost } from './commitments.helper';

// =============================================================================
// Seeding the Health domain over the API (issue #114, epic E09)
// =============================================================================
//
// A SIBLING of `commitments.helper.ts` and `weekly.helper.ts`, not a copy:
// `apiGet`, `apiPost` and `loginAsTestUser` are imported. What lives here is
// the E09-shaped fixture — a program, its approval, and a completed session's
// worth of history — which the Today-focused helpers have no business knowing
// about.
//
// EVERYTHING GOES THROUGH THE API, for the reason the other helpers give:
// Playwright cannot reach Postgres, and seeding through the real endpoints
// means a drifted contract fails loudly here rather than being tested against
// a state the API would never produce.
//
// AND NOTHING WAITS ON A WEEKDAY. `moveCommitmentToNow` reschedules the first
// training day to right now, so the spec runs identically on a Sunday.
// =============================================================================

export interface SeededProgram {
  id: string;
  name: string;
  status: string;
  planId: string | null;
  templates: Array<{
    id: string;
    name: string;
    variant: 'FULL' | 'SHORT' | 'MINIMUM';
    targetMinutes: number;
    routineId: string | null;
    exercises: Array<{ id: string; exerciseId: string; name: string; sets: number }>;
  }>;
  weeklyStructure: Array<{ weekday: number; templateId: string }>;
}

export interface GenerateResult {
  program: SeededProgram;
  source: 'ai' | 'starter';
  reason: string | null;
  message: string | null;
}

export const DEFAULT_REQUEST = {
  goal: 'Get stronger and look better',
  experience: 'BEGINNER' as const,
  daysPerWeek: 3,
  minutesPerSession: 40,
  equipment: ['DUMBBELL', 'BENCH'] as string[],
};

export async function generateProgram(
  page: Page,
  overrides: Partial<typeof DEFAULT_REQUEST> & { limitations?: string } = {},
): Promise<GenerateResult> {
  return apiPost<GenerateResult>(page, '/api/workouts/programs/generate', {
    ...DEFAULT_REQUEST,
    ...overrides,
  });
}

export async function approveProgram(
  page: Page,
  programId: string,
  body: { preferredTime?: string; startDate?: string } = {},
): Promise<{ program: SeededProgram; planVersionId: string; commitmentIds: string[] }> {
  return apiPost(page, `/api/workouts/programs/${programId}/approve`, body);
}

/** Generate and approve in one call — the state most cases start from. */
export async function seedProgramViaApi(
  page: Page,
  overrides: Partial<typeof DEFAULT_REQUEST> = {},
): Promise<{ program: SeededProgram; commitmentIds: string[]; planVersionId: string }> {
  const generated = await generateProgram(page, overrides);
  const approved = await approveProgram(page, generated.program.id, {
    // Today, so the first training day is never in the past.
    startDate: new Date().toISOString().slice(0, 10),
  });

  return {
    program: approved.program,
    commitmentIds: approved.commitmentIds,
    planVersionId: approved.planVersionId,
  };
}

export interface CommitmentRow {
  id: string;
  title: string;
  status: string;
  scheduledStart: string;
  workoutTemplateId?: string | null;
}

export async function listCommitments(page: Page): Promise<CommitmentRow[]> {
  const from = new Date(Date.now() - 24 * 3600_000).toISOString();
  const to = new Date(Date.now() + 30 * 24 * 3600_000).toISOString();

  return apiGet<CommitmentRow[]>(page, `/api/commitments?from=${from}&to=${to}`);
}

/**
 * Move a scheduled workout to right now.
 *
 * The reschedule action, not a database update: it returns the NEW row (E02-04
 * closes the original as RESCHEDULED), which is why this hands the new id back.
 */
export async function moveCommitmentToNow(page: Page, id: string): Promise<string> {
  const moved = await apiPost<{ id: string }>(
    page,
    `/api/commitments/${id}/actions/reschedule`,
    { scheduledStart: new Date(Date.now() + 60_000).toISOString() },
  );

  return moved.id;
}

export interface SessionView {
  id: string;
  status: string;
  variant: string;
  header: { title: string; sessionIndex: number; sessionTotal: number };
  exercises: Array<{
    exerciseId: string;
    name: string;
    sets: number;
    repMax: number;
    lastTime: { sets: Array<{ weightKg: number | null; reps: number }> } | null;
    progression: { action: string; suggestedWeightKg: number | null } | null;
    logged: Array<{ clientId: string; setNumber: number; weightKg: number | null }>;
  }>;
}

export async function startSession(
  page: Page,
  body: { commitmentId?: string; templateId?: string; variant?: string },
): Promise<SessionView> {
  return apiPost<SessionView>(page, '/api/workouts/sessions', body);
}

export async function getSession(page: Page, id: string): Promise<SessionView> {
  return apiGet<SessionView>(page, `/api/workouts/sessions/${id}`);
}

/**
 * A whole completed session, for history.
 *
 * Used to reach "two sessions at the top of the range" without driving the
 * runner twice — the progression case is about the THIRD session, and the two
 * before it are setup rather than subject.
 */
export async function completeSessionViaApi(
  page: Page,
  options: { templateId: string; weightKg: number; reps: number; rpe?: number },
): Promise<string> {
  const session = await startSession(page, {
    templateId: options.templateId,
    variant: 'FULL',
  });

  for (const exercise of session.exercises) {
    for (let setNumber = 1; setNumber <= exercise.sets; setNumber += 1) {
      await apiPost(page, `/api/workouts/sessions/${session.id}/sets`, {
        clientId: crypto.randomUUID(),
        exerciseId: exercise.exerciseId,
        setNumber,
        weightKg: options.weightKg,
        reps: options.reps,
        rpe: options.rpe ?? 7,
        discomfort: 'NONE',
      });
    }
  }

  await apiPost(page, `/api/workouts/sessions/${session.id}/finish`, {
    status: 'COMPLETED',
  });

  return session.id;
}

/** Skip one scheduled workout through the ordinary action. */
export async function skipCommitment(page: Page, id: string): Promise<void> {
  await apiPost(page, `/api/commitments/${id}/actions/skip`, { reason: 'TOO_MUCH' });
}
