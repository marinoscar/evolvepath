import { Prisma } from '@prisma/client';

import { PAIN_SAFETY_COPY } from '../safety/workout-safety-copy';
import {
  buildSessionView,
  type SessionViewInput,
  type SetLogRow,
  type TemplateExerciseRow,
} from './session-view.builder';

const BENCH = 'exercise-bench';
const ROW = 'exercise-row';

function setLog(over: Partial<SetLogRow> = {}): SetLogRow {
  return {
    id: `set-${Math.random()}`,
    clientId: `client-${Math.random()}`,
    exerciseId: BENCH,
    setNumber: 1,
    weightKg: new Prisma.Decimal('20.00'),
    reps: 12,
    rpe: 7,
    discomfort: 'NONE',
    loggedAt: new Date('2026-09-07T13:10:00.000Z'),
    ...over,
  };
}

function templateExercise(over: Partial<TemplateExerciseRow> = {}): TemplateExerciseRow {
  return {
    order: 1,
    exerciseId: BENCH,
    sets: 3,
    repMin: 8,
    repMax: 12,
    restSeconds: 90,
    notes: null,
    exercise: { name: 'Dumbbell Bench Press', equipment: ['DUMBBELL'], instructions: 'Lie down.' },
    ...over,
  };
}

function input(over: Partial<SessionViewInput> = {}): SessionViewInput {
  return {
    session: {
      id: 'session-1',
      status: 'IN_PROGRESS',
      variant: 'FULL',
      startedAt: new Date('2026-09-07T13:00:00.000Z'),
      finishedAt: null,
      discomfortFlag: false,
      commitmentId: 'commitment-1',
    },
    program: { id: 'program-1', name: 'Upper/Lower', durationWeeks: 6, trainingDays: 3 },
    template: { id: 'template-1', name: 'Upper A', variant: 'FULL', targetMinutes: 40 },
    availableVariants: ['FULL', 'MINIMUM', 'SHORT'],
    exercises: [templateExercise()],
    logs: [],
    history: new Map(),
    sessionIndex: 3,
    ...over,
  };
}

describe('buildSessionView', () => {
  it('renders PRD §41\'s header — "Upper A · Workout 3 of 18"', () => {
    const view = buildSessionView(input());

    expect(view.header).toEqual({ title: 'Upper A', sessionIndex: 3, sessionTotal: 18 });
  });

  it('turns Decimal weights into numbers a client can do arithmetic with', () => {
    const view = buildSessionView(input({ logs: [setLog()] }));

    expect(view.exercises[0].logged[0].weightKg).toBe(20);
    expect(typeof view.exercises[0].logged[0].weightKg).toBe('number');
  });

  it('reports a null weight as null rather than zero', () => {
    const view = buildSessionView(input({ logs: [setLog({ weightKg: null })] }));

    expect(view.exercises[0].logged[0].weightKg).toBeNull();
  });

  it('shows last time in set order', () => {
    const history = new Map([
      [
        BENCH,
        {
          sessionDate: new Date('2026-09-03T13:00:00.000Z'),
          sets: [
            setLog({ setNumber: 3, reps: 10 }),
            setLog({ setNumber: 1, reps: 12 }),
            setLog({ setNumber: 2, reps: 11 }),
          ],
        },
      ],
    ]);

    const view = buildSessionView(input({ history }));

    expect(view.exercises[0].lastTime?.sets.map((s) => s.reps)).toEqual([12, 11, 10]);
    expect(view.exercises[0].lastTime?.sessionDate).toBe('2026-09-03T13:00:00.000Z');
  });

  it('says nothing about a movement with no history rather than inventing a zero', () => {
    expect(buildSessionView(input()).exercises[0].lastTime).toBeNull();
  });

  it('keeps sets for movements the current variant dropped', () => {
    // The user logged a row, then switched to the SHORT version, which is bench
    // press only. The rowing sets really happened.
    const view = buildSessionView(
      input({
        template: { id: 'template-2', name: 'Upper A', variant: 'SHORT', targetMinutes: 24 },
        logs: [setLog(), setLog({ exerciseId: ROW, setNumber: 2 })],
      }),
    );

    expect(view.exercises[0].logged).toHaveLength(1);
    expect(view.alsoLogged.map((s) => s.exerciseId)).toEqual([ROW]);
  });

  it('keeps the pain notice visible for the rest of the session', () => {
    const view = buildSessionView(
      input({ session: { ...input().session, discomfortFlag: true } }),
    );

    expect(view.safety).toEqual({ copy: PAIN_SAFETY_COPY });
  });

  it('carries no safety copy for an ordinary session', () => {
    expect(buildSessionView(input()).safety).toBeNull();
  });

  it('orders the exercise list by its prescribed order, not by insertion', () => {
    const view = buildSessionView(
      input({
        exercises: [
          templateExercise({ order: 2, exerciseId: ROW }),
          templateExercise({ order: 1, exerciseId: BENCH }),
        ],
      }),
    );

    expect(view.exercises.map((e) => e.exerciseId)).toEqual([BENCH, ROW]);
  });

  it('reports no progression until E09-04 supplies one', () => {
    expect(buildSessionView(input()).exercises[0].progression).toBeNull();
  });

  it('carries a progression suggestion through when there is one', () => {
    const view = buildSessionView(
      input({ progression: new Map([[BENCH, { action: 'increase' }]]) }),
    );

    expect(view.exercises[0].progression).toEqual({ action: 'increase' });
  });
});
