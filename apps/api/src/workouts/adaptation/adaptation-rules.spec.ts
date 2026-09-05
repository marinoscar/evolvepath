import { planChangeSchema } from '../../coach/proposals/plan-change.schema';
import {
  detect,
  detectForTemplate,
  reducedMinutes,
  substitutionCandidate,
  type TemplateSignals,
} from './adaptation-rules';

// =============================================================================
// PRD §43's signals, one per test (issue #88, epic E09)
//
// Every emitted change is also parsed by E06's own `planChangeSchema` — the
// detector produces proposals for a protocol it does not own, and a change that
// only this file accepts would fail at `createFromSource` in production.
// =============================================================================

const ROUTINE = '11111111-1111-4111-8111-111111111111';
const TEMPLATE = '22222222-2222-4222-8222-222222222222';
const BENCH = '33333333-3333-4333-8333-333333333333';
const ROW_ID = '44444444-4444-4444-8444-444444444444';
const ALTERNATIVE = '55555555-5555-4555-8555-555555555555';
const TE_BENCH = '66666666-6666-4666-8666-666666666666';

function signals(over: Partial<TemplateSignals> = {}): TemplateSignals {
  return {
    templateId: TEMPLATE,
    templateName: 'Upper A',
    routineId: ROUTINE,
    targetMinutes: 40,
    exercises: [
      {
        templateExerciseId: TE_BENCH,
        exerciseId: BENCH,
        name: 'Dumbbell Bench Press',
        dislikedAt: null,
        alternativeExerciseIds: [ALTERNATIVE],
      },
    ],
    skippedCount: 0,
    sessionMinutes: [],
    recentSessionExerciseIds: [],
    ...over,
  };
}

function expectValidChanges(candidate: ReturnType<typeof detectForTemplate>) {
  expect(candidate).not.toBeNull();

  for (const change of candidate!.changes) {
    expect(planChangeSchema.safeParse(change).success).toBe(true);
  }
}

describe('reducedMinutes', () => {
  it('takes 65 % to the nearest five', () => {
    expect(reducedMinutes(40)).toBe(25);
    expect(reducedMinutes(55)).toBe(35);
    expect(reducedMinutes(60)).toBe(40);
  });

  it('never proposes a session shorter than fifteen minutes', () => {
    expect(reducedMinutes(20)).toBe(15);
    expect(reducedMinutes(15)).toBe(15);
  });
});

describe('detectForTemplate', () => {
  it('says nothing about a template that is going fine', () => {
    expect(detectForTemplate(signals())).toBeNull();
  });

  it('proposes a shorter session after two skips in a fortnight', () => {
    const candidate = detectForTemplate(signals({ skippedCount: 2 }));

    expect(candidate).toMatchObject({
      detector: 'SKIPPED_TWICE',
      changes: [
        {
          op: 'reduce',
          target: { type: 'routine', id: ROUTINE },
          before: { estimatedDurationMin: 40 },
          after: { estimatedDurationMin: 25 },
        },
      ],
    });
    expect(candidate!.summary).toContain('25 minutes');
    expectValidChanges(candidate);
  });

  it('says nothing after a single skip — one missed day is a day', () => {
    expect(detectForTemplate(signals({ skippedCount: 1 }))).toBeNull();
  });

  it('offers to move the accessories when the session is long on movements', () => {
    const many = signals({
      skippedCount: 2,
      exercises: Array.from({ length: 5 }, (_, index) => ({
        templateExerciseId: `${TE_BENCH.slice(0, -1)}${index}`,
        exerciseId: `${BENCH.slice(0, -1)}${index}`,
        name: `Movement ${index}`,
        dislikedAt: null,
        alternativeExerciseIds: [ALTERNATIVE],
      })),
    });

    expect(detectForTemplate(many)!.changes[0].reason).toContain('accessory work');
  });

  it('proposes a shorter session when two sessions overran by a quarter of an hour', () => {
    const candidate = detectForTemplate(signals({ sessionMinutes: [58, 61, 40] }));

    expect(candidate).toMatchObject({ detector: 'TOO_LONG' });
    expect(candidate!.changes[0].reason).toContain('60 min');
    expectValidChanges(candidate);
  });

  it('leaves a session that ran slightly over alone', () => {
    expect(detectForTemplate(signals({ sessionMinutes: [48, 50] }))).toBeNull();
  });

  it('offers to swap a movement the user said they dislike', () => {
    const candidate = detectForTemplate(
      signals({
        exercises: [
          {
            templateExerciseId: TE_BENCH,
            exerciseId: BENCH,
            name: 'Dumbbell Bench Press',
            dislikedAt: new Date('2026-09-01T00:00:00.000Z'),
            alternativeExerciseIds: [ALTERNATIVE],
          },
        ],
      }),
    );

    expect(candidate).toMatchObject({
      detector: 'DISLIKED',
      changes: [
        {
          op: 'replace',
          workout: {
            templateId: TEMPLATE,
            replaceExercise: {
              templateExerciseId: TE_BENCH,
              alternativeExerciseId: ALTERNATIVE,
            },
          },
        },
      ],
    });
    expectValidChanges(candidate);
  });

  it('offers to swap a movement absent from the last three sessions', () => {
    const candidate = detectForTemplate(
      signals({ recentSessionExerciseIds: [[ROW_ID], [ROW_ID], [ROW_ID]] }),
    );

    expect(candidate).toMatchObject({ detector: 'EXERCISE_SKIPPED' });
    expect(candidate!.changes[0].workout?.replaceExercise?.templateExerciseId).toBe(TE_BENCH);
    expectValidChanges(candidate);
  });

  it('waits for three sessions before calling it avoidance', () => {
    expect(
      detectForTemplate(signals({ recentSessionExerciseIds: [[ROW_ID], [ROW_ID]] })),
    ).toBeNull();
  });

  it('says nothing when there is no alternative to offer', () => {
    // "Replace this with nothing" is worse than saying nothing at all.
    expect(
      detectForTemplate(
        signals({
          exercises: [
            {
              templateExerciseId: TE_BENCH,
              exerciseId: BENCH,
              name: 'Dumbbell Bench Press',
              dislikedAt: new Date(),
              alternativeExerciseIds: [],
            },
          ],
        }),
      ),
    ).toBeNull();
  });

  it('says nothing about a template with no routine to target', () => {
    expect(detectForTemplate(signals({ skippedCount: 3, routineId: null }))).toBeNull();
  });

  it('raises at most one candidate per template', () => {
    const noisy = signals({
      skippedCount: 3,
      sessionMinutes: [70, 70],
      exercises: [
        {
          templateExerciseId: TE_BENCH,
          exerciseId: BENCH,
          name: 'Dumbbell Bench Press',
          dislikedAt: new Date(),
          alternativeExerciseIds: [ALTERNATIVE],
        },
      ],
    });

    expect(detect([noisy])).toHaveLength(1);
    expect(detect([noisy])[0].detector).toBe('SKIPPED_TWICE');
  });

  it('never emits move, add, remove or pause', () => {
    const candidates = detect([
      signals({ skippedCount: 2 }),
      signals({ templateId: ROW_ID, sessionMinutes: [70, 70] }),
    ]);

    for (const candidate of candidates) {
      for (const change of candidate.changes) {
        expect(['reduce', 'replace']).toContain(change.op);
      }
    }
  });
});

describe('substitutionCandidate', () => {
  it('names the missing equipment in the reason', () => {
    const candidate = substitutionCandidate(
      signals(),
      [{ templateExerciseId: TE_BENCH, alternativeExerciseId: ALTERNATIVE }],
      'a bench',
    );

    expect(candidate!.changes[0].reason).toBe('No a bench available.');
    expectValidChanges(candidate);
  });

  it('says nothing when none of the substitutions match a prescribed movement', () => {
    expect(
      substitutionCandidate(
        signals(),
        [{ templateExerciseId: ROW_ID, alternativeExerciseId: ALTERNATIVE }],
        'a bench',
      ),
    ).toBeNull();
  });
});
