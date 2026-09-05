import { http, HttpResponse } from 'msw';

import type {
  Exercise,
  GenerateProgramRequest,
  WorkoutProgram,
  WorkoutTemplate,
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

interface WorkoutState {
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
  programs: [],
  generateRequests: [],
  approveRequests: [],
  deleted: [],
  nextGenerateResult: null,
  generateStatus: null,
  sequence: 0,
};

export function resetWorkoutState(): void {
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

export const workoutHandlers = [
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
