import { http, HttpResponse } from 'msw';

import type {
  Exercise,
  GenerateProgramRequest,
  LogSetBody,
  SetLog,
  WorkoutProgram,
  WorkoutSessionView,
  WorkoutTemplate,
  WorkoutVariant,
} from '../../types';

// =============================================================================
// A stateful in-memory Workouts API (issue #95, epic E09)
// =============================================================================
//
// STATEFUL, and it enforces what the real API enforces — a mock that accepted
// everything would let page tests pass against behaviour the server refuses:
//
//   * `generate` writes a DRAFT and nothing else. Approving is a separate call.
//   * `approve` on a program that is not DRAFT is a 409, as the API answers.
//   * `DELETE` is refused for anything but a DRAFT.
//
// `nextGenerateResult` is how a spec asks for the starter path without
// pretending the endpoint failed: `source: 'starter'` is a 200 in production
// too (PRD §120).
//
// `resetWorkoutState()` runs from the global `afterEach`.
// =============================================================================

const API_BASE = '*/api';

export const MOCK_EXERCISES: Exercise[] = [
  {
    id: 'exercise-bench',
    name: 'Dumbbell Bench Press',
    equipment: ['DUMBBELL', 'BENCH'],
    movementPattern: 'PUSH_H',
    instructions: 'Press both dumbbells up until your arms are straight.',
    contraindicationTags: ['shoulder'],
    substitutionGroup: 'horizontal_push',
    isCustom: false,
  },
  {
    id: 'exercise-row',
    name: 'Dumbbell Row',
    equipment: ['DUMBBELL', 'BENCH'],
    movementPattern: 'PULL_H',
    instructions: 'Row the dumbbell towards your hip with your torso still.',
    contraindicationTags: [],
    substitutionGroup: 'horizontal_pull',
    isCustom: false,
  },
];

function template(
  name: string,
  variant: WorkoutTemplate['variant'],
  minutes: number,
  exercises: Array<[string, string, number]>,
): WorkoutTemplate {
  return {
    id: `${name}-${variant}`.toLowerCase().replace(/\s+/g, '-'),
    name,
    variant,
    targetMinutes: minutes,
    routineId: variant === 'FULL' ? `routine-${name.toLowerCase().replace(/\s+/g, '-')}` : null,
    exercises: exercises.map(([exerciseId, exerciseName, sets], index) => ({
      id: `${name}-${variant}-${index}`,
      exerciseId,
      name: exerciseName,
      order: index + 1,
      sets,
      repMin: 8,
      repMax: 12,
      restSeconds: 90,
      notes: null,
    })),
  };
}

export function buildProgram(overrides: Partial<WorkoutProgram> = {}): WorkoutProgram {
  const templates = [
    template('Upper A', 'FULL', 40, [
      ['exercise-bench', 'Dumbbell Bench Press', 3],
      ['exercise-row', 'Dumbbell Row', 3],
    ]),
    template('Upper A', 'SHORT', 24, [['exercise-bench', 'Dumbbell Bench Press', 3]]),
    template('Upper A', 'MINIMUM', 10, [['exercise-bench', 'Dumbbell Bench Press', 2]]),
    template('Lower A', 'FULL', 40, [['exercise-row', 'Dumbbell Row', 3]]),
    template('Lower A', 'SHORT', 24, [['exercise-row', 'Dumbbell Row', 2]]),
    template('Lower A', 'MINIMUM', 10, [['exercise-row', 'Dumbbell Row', 2]]),
  ];

  return {
    id: 'program-1',
    name: 'Two-day upper/lower',
    status: 'DRAFT',
    durationWeeks: 6,
    weeklyStructure: [
      { weekday: 1, templateId: 'upper-a-full' },
      { weekday: 4, templateId: 'lower-a-full' },
    ],
    planId: null,
    createdAt: '2026-09-05T10:00:00.000Z',
    rationale: 'Two sessions a week, four movements, room to add weight.',
    templates,
    substitutions: [
      { exerciseId: 'exercise-row', alternativeExerciseIds: ['exercise-bench'] },
    ],
    ...overrides,
  };
}

export interface MediaCheckStub {
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

interface SessionState {
  view: WorkoutSessionView;
  logged: SetLog[];
}

interface WorkoutState {
  session: SessionState | null;
  loggedBodies: LogSetBody[];
  batches: LogSetBody[][];
  finished: Array<{ status: string; notes: string | null }>;
  /** When set, the next set POST fails with this status. `0` means a network error. */
  setPostStatus: number | null;
  formCheck: MediaCheckStub | null;
  equipmentCheck: MediaCheckStub | null;
  mealCheck: MediaCheckStub | null;
  formCheckRequests: Array<Record<string, unknown>>;
  programs: WorkoutProgram[];
  generateRequests: GenerateProgramRequest[];
  approveRequests: Array<{ id: string; body: { preferredTime?: string; startDate?: string } }>;
  deleted: string[];
  /** What the next `generate` answers. Defaults to an AI-sourced draft. */
  nextGenerateResult: { source: 'ai' | 'starter'; reason: string | null } | null;
  /** When set, `generate` fails with this status. */
  generateStatus: number | null;
  sequence: number;
}

const state: WorkoutState = {
  session: null,
  loggedBodies: [],
  batches: [],
  finished: [],
  setPostStatus: null,
  formCheck: null,
  equipmentCheck: null,
  mealCheck: null,
  formCheckRequests: [],
  programs: [],
  generateRequests: [],
  approveRequests: [],
  deleted: [],
  nextGenerateResult: null,
  generateStatus: null,
  sequence: 0,
};

export function resetWorkoutState(): void {
  state.session = null;
  state.loggedBodies = [];
  state.batches = [];
  state.finished = [];
  state.setPostStatus = null;
  state.formCheck = null;
  state.equipmentCheck = null;
  state.mealCheck = null;
  state.formCheckRequests = [];
  state.programs = [];
  state.generateRequests = [];
  state.approveRequests = [];
  state.deleted = [];
  state.nextGenerateResult = null;
  state.generateStatus = null;
  state.sequence = 0;
}

export function seedPrograms(programs: WorkoutProgram[]): void {
  state.programs = [...programs];
}

export function generateRequests(): ReadonlyArray<GenerateProgramRequest> {
  return state.generateRequests;
}

export function approveRequests(): ReadonlyArray<WorkoutState['approveRequests'][number]> {
  return state.approveRequests;
}

export function deletedPrograms(): ReadonlyArray<string> {
  return state.deleted;
}

export function setNextGenerateResult(
  result: { source: 'ai' | 'starter'; reason: string | null } | null,
): void {
  state.nextGenerateResult = result;
}

export function setGenerateStatus(status: number | null): void {
  state.generateStatus = status;
}

// ---------------------------------------------------------------------------
// Sessions (issue #109)
// ---------------------------------------------------------------------------

export function buildSessionView(
  overrides: Partial<WorkoutSessionView> = {},
): WorkoutSessionView {
  return {
    id: 'session-1',
    status: 'IN_PROGRESS',
    variant: 'FULL',
    templateId: 'upper-a-full',
    templateName: 'Upper A',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    discomfortFlag: false,
    commitmentId: 'commitment-1',
    setCount: 0,
    program: { id: 'program-1', name: 'Two-day upper/lower' },
    template: { id: 'upper-a-full', name: 'Upper A', variant: 'FULL', targetMinutes: 40 },
    header: { title: 'Upper A', sessionIndex: 3, sessionTotal: 18 },
    availableVariants: ['FULL', 'MINIMUM', 'SHORT'],
    exercises: [
      {
        order: 1,
        exerciseId: 'exercise-bench',
        name: 'Dumbbell Bench Press',
        equipment: ['DUMBBELL', 'BENCH'],
        instructions: 'Press both dumbbells up until your arms are straight.',
        sets: 3,
        repMin: 8,
        repMax: 12,
        restSeconds: 90,
        notes: null,
        lastTime: {
          sessionDate: '2026-09-03T13:00:00.000Z',
          sets: [
            {
              id: 'old-1',
              clientId: 'old-1',
              exerciseId: 'exercise-bench',
              setNumber: 1,
              weightKg: 20,
              reps: 12,
              rpe: 7,
              discomfort: 'NONE',
              loggedAt: '2026-09-03T13:10:00.000Z',
            },
          ],
        },
        progression: {
          action: 'increase',
          currentWeightKg: 20,
          suggestedWeightKg: 22.5,
          deltaKg: 2.5,
          reason: 'top_of_range_twice',
          basis: { sessions: 2, lastReps: [12, 12, 12], lastRpe: [7, 7, 7] },
        },
        logged: [],
      },
    ],
    alsoLogged: [],
    safety: null,
    ...overrides,
  };
}

export function seedSession(view: WorkoutSessionView = buildSessionView()): void {
  state.session = { view, logged: [] };
}

export function loggedSetBodies(): ReadonlyArray<LogSetBody> {
  return state.loggedBodies;
}

export function batchedSets(): ReadonlyArray<LogSetBody[]> {
  return state.batches;
}

export function finishedSessions(): ReadonlyArray<{ status: string; notes: string | null }> {
  return state.finished;
}

export function setSetPostStatus(status: number | null): void {
  state.setPostStatus = status;
}

/** Fold a logged set into the session view, the way the API's read does. */
function applySet(session: SessionState, body: LogSetBody): SetLog {
  const set: SetLog = {
    id: body.clientId,
    clientId: body.clientId,
    exerciseId: body.exerciseId,
    setNumber: body.setNumber,
    weightKg: body.weightKg ?? null,
    reps: body.reps,
    rpe: body.rpe ?? null,
    discomfort: body.discomfort,
    loggedAt: body.loggedAt ?? new Date().toISOString(),
  };

  session.logged.push(set);
  const discomfortFlag = session.view.discomfortFlag || body.discomfort === 'SHARP_PAIN';

  session.view = {
    ...session.view,
    setCount: session.logged.length,
    discomfortFlag,
    // The API returns the copy on the VIEW for the rest of the session, not
    // only in the response to the set that raised it. Mirroring that here is
    // what makes a reload-mid-session test meaningful.
    safety: discomfortFlag
      ? { copy: 'Stop this exercise. Sharp pain is not something to train through.' }
      : session.view.safety,
    exercises: session.view.exercises.map((exercise) =>
      exercise.exerciseId === body.exerciseId
        ? {
            ...exercise,
            logged: [
              ...exercise.logged.filter((row) => row.setNumber !== body.setNumber),
              set,
            ].sort((a, b) => a.setNumber - b.setNumber),
          }
        : exercise,
    ),
  };

  return set;
}

export function setFormCheckResult(stub: MediaCheckStub | null): void {
  state.formCheck = stub;
}

export function setEquipmentCheckResult(stub: MediaCheckStub | null): void {
  state.equipmentCheck = stub;
}

export function setMealCheckResult(stub: MediaCheckStub | null): void {
  state.mealCheck = stub;
}

export function formCheckRequests(): ReadonlyArray<Record<string, unknown>> {
  return state.formCheckRequests;
}

export const workoutHandlers = [
  // The upload the three media flows go through. One object, ready at once —
  // the real pipeline's processing states belong to E03.
  http.post(`${API_BASE}/storage/objects`, () =>
    HttpResponse.json(
      { data: { id: 'object-1', name: 'clip.mp4', mimeType: 'video/mp4', status: 'ready' } },
      { status: 201 },
    ),
  ),

  http.post(`${API_BASE}/workouts/sessions/:id/form-check`, async ({ request }) => {
    state.formCheckRequests.push((await request.json()) as Record<string, unknown>);

    return HttpResponse.json({
      data: state.formCheck ?? {
        ok: true,
        result: {
          observations: ['The bar drifts forward on the way up.'],
          cues: ['Keep it over your mid-foot.'],
          riskFlags: ['none'],
          safetyNote: null,
          confidence: 'medium',
          redirected: false,
        },
        storageObjectId: 'object-1',
        invocationId: 'inv-1',
      },
    });
  }),

  http.post(`${API_BASE}/workouts/equipment-check`, () =>
    HttpResponse.json({
      data: state.equipmentCheck ?? {
        ok: true,
        result: {
          equipmentDetected: ['DUMBBELL', 'BENCH'],
          notes: ['A small room, no rack.'],
          substitutions: [],
          proposalId: null,
        },
        storageObjectId: 'object-1',
        invocationId: 'inv-2',
      },
    }),
  ),

  http.post(`${API_BASE}/nutrition/meal-check`, () =>
    HttpResponse.json({
      data: state.mealCheck ?? {
        ok: true,
        result: {
          observations: ['A protein source and a green vegetable on the plate.'],
          behaviorSuggestions: [
            { key: 'vegetables_with_dinner', text: 'Keep the greens on the plate at dinner.' },
          ],
        },
        storageObjectId: 'object-1',
        invocationId: 'inv-3',
      },
    }),
  ),

  http.post(`${API_BASE}/workouts/sessions`, async ({ request }) => {
    const body = (await request.json()) as { commitmentId?: string; templateId?: string };

    if (!state.session) seedSession();

    state.session!.view = {
      ...state.session!.view,
      commitmentId: body.commitmentId ?? null,
    };

    return HttpResponse.json({ data: state.session!.view }, { status: 201 });
  }),

  http.get(`${API_BASE}/workouts/sessions/:id`, ({ params }) => {
    if (!state.session || state.session.view.id !== String(params.id)) {
      return HttpResponse.json({ message: 'Workout session not found' }, { status: 404 });
    }

    return HttpResponse.json({ data: state.session.view });
  }),

  http.post(`${API_BASE}/workouts/sessions/:id/sets`, async ({ request }) => {
    const body = (await request.json()) as LogSetBody;

    if (state.setPostStatus === 0) return HttpResponse.error();

    if (state.setPostStatus !== null) {
      return HttpResponse.json({ message: 'refused' }, { status: state.setPostStatus });
    }

    state.loggedBodies.push(body);

    if (!state.session) seedSession();

    // Idempotent on clientId, exactly like the API's unique index.
    const existing = state.session!.logged.find((row) => row.clientId === body.clientId);
    const set = existing ?? applySet(state.session!, body);

    return HttpResponse.json(
      {
        data: {
          set,
          safety:
            body.discomfort === 'SHARP_PAIN'
              ? { copy: 'Stop this exercise. Sharp pain is not something to train through.', action: 'stop_exercise' }
              : null,
        },
      },
      { status: 201 },
    );
  }),

  http.post(`${API_BASE}/workouts/sessions/:id/sets/batch`, async ({ request }) => {
    const body = (await request.json()) as { sets: LogSetBody[] };

    if (state.setPostStatus === 0) return HttpResponse.error();

    state.batches.push(body.sets);

    if (!state.session) seedSession();

    const accepted: SetLog[] = [];
    const duplicates: string[] = [];

    for (const set of body.sets) {
      const existing = state.session!.logged.find((row) => row.clientId === set.clientId);

      if (existing) duplicates.push(set.clientId);
      else {
        state.loggedBodies.push(set);
        accepted.push(applySet(state.session!, set));
      }
    }

    return HttpResponse.json({ data: { accepted, duplicates, rejected: [] } });
  }),

  http.post(`${API_BASE}/workouts/sessions/:id/switch-variant`, async ({ request }) => {
    const body = (await request.json()) as { variant: WorkoutVariant };

    if (!state.session) seedSession();

    state.session!.view = {
      ...state.session!.view,
      variant: body.variant,
      template: { ...state.session!.view.template, variant: body.variant, targetMinutes: 10 },
      exercises: state.session!.view.exercises.slice(0, 1),
    };

    return HttpResponse.json({ data: state.session!.view });
  }),

  http.post(`${API_BASE}/workouts/sessions/:id/finish`, async ({ request }) => {
    const body = (await request.json()) as { status: string; notes?: string | null };

    state.finished.push({ status: body.status, notes: body.notes ?? null });

    if (!state.session) seedSession();

    const sets = state.session!.logged.length;

    return HttpResponse.json({
      data: {
        session: { ...state.session!.view, status: body.status },
        summary: {
          sets,
          volumeKg: 480,
          minutes: 42,
          exercisesCompleted: 1,
          exercisesPlanned: 1,
        },
        commitmentStatus: body.status === 'COMPLETED' ? 'COMPLETED' : null,
      },
    });
  }),

  http.get(
    `${API_BASE}/workouts/sessions/:id/exercises/:exerciseId/explain`,
    () =>
      HttpResponse.json({
        data: {
          sentence: 'Two sessions at the top of the range and comfortable — 22.5 kg today.',
          source: 'template',
        },
      }),
  ),

  http.get(`${API_BASE}/workouts/exercises`, () =>
    HttpResponse.json({ data: { items: MOCK_EXERCISES } }),
  ),

  http.post(`${API_BASE}/workouts/programs/generate`, async ({ request }) => {
    if (state.generateStatus !== null) {
      return HttpResponse.json(
        { code: state.generateStatus === 412 ? 'AI_KEY_REQUIRED' : 'ERROR', message: 'nope' },
        { status: state.generateStatus },
      );
    }

    const body = (await request.json()) as GenerateProgramRequest;
    state.generateRequests.push(body);
    state.sequence += 1;

    const program = buildProgram({ id: `program-${state.sequence}` });
    state.programs = [...state.programs, program];

    const outcome = state.nextGenerateResult ?? { source: 'ai' as const, reason: null };

    return HttpResponse.json({
      data: { program, source: outcome.source, reason: outcome.reason, message: null },
    });
  }),

  http.get(`${API_BASE}/workouts/programs`, () =>
    HttpResponse.json({ data: { items: state.programs } }),
  ),

  http.get(`${API_BASE}/workouts/programs/:id`, ({ params }) => {
    const program = state.programs.find((row) => row.id === String(params.id));

    if (!program) {
      return HttpResponse.json({ message: 'Workout program not found' }, { status: 404 });
    }

    return HttpResponse.json({ data: program });
  }),

  http.post(`${API_BASE}/workouts/programs/:id/approve`, async ({ params, request }) => {
    const id = String(params.id);
    const program = state.programs.find((row) => row.id === id);

    if (!program) {
      return HttpResponse.json({ message: 'Workout program not found' }, { status: 404 });
    }

    if (program.status !== 'DRAFT') {
      return HttpResponse.json(
        { code: 'PROGRAM_NOT_DRAFT', message: 'Already decided on.' },
        { status: 409 },
      );
    }

    const body = (await request.json()) as { preferredTime?: string; startDate?: string };
    state.approveRequests.push({ id, body });

    program.status = 'ACTIVE';
    program.planId = 'plan-1';

    return HttpResponse.json({
      data: { program, planVersionId: 'version-1', commitmentIds: ['c1', 'c2', 'c3', 'c4'] },
    });
  }),

  http.post(`${API_BASE}/workouts/programs/:id/archive`, ({ params }) => {
    const program = state.programs.find((row) => row.id === String(params.id));

    if (!program) {
      return HttpResponse.json({ message: 'Workout program not found' }, { status: 404 });
    }

    program.status = 'ARCHIVED';

    return HttpResponse.json({ data: program });
  }),

  http.delete(`${API_BASE}/workouts/programs/:id`, ({ params }) => {
    const id = String(params.id);
    const program = state.programs.find((row) => row.id === id);

    if (program && program.status !== 'DRAFT') {
      return HttpResponse.json(
        { code: 'PROGRAM_NOT_DRAFT', message: 'Archived, not deleted.' },
        { status: 409 },
      );
    }

    state.deleted.push(id);
    state.programs = state.programs.filter((row) => row.id !== id);

    return new HttpResponse(null, { status: 204 });
  }),
];
