import {
  detectMilestones,
  REDUCED_REMINDERS_MIN_SAMPLE,
  REDUCED_REMINDERS_RATIO,
  type MilestoneInput,
} from './milestone-detector';

// =============================================================================
// What has this person reached? (issue #115, epic E11)
// =============================================================================
//
// The two properties worth pinning are both about NOT awarding: a milestone is
// never given twice (PRD §77's "avoid constant confetti"), and
// `REDUCED_REMINDERS` cannot fire at all while E12 has not measured anything.
// =============================================================================

const NOW = new Date('2026-03-06T12:00:00.000Z');

const input = (over: Partial<MilestoneInput> = {}): MilestoneInput => ({
  now: NOW,
  existing: [],
  consistencyRunWeeks: 0,
  successfulWeeksEver: 0,
  workoutCompletions: 0,
  comebackCompletions: 0,
  startedAfterPostpone: null,
  independence: { ratio: null, sampleSize: 0 },
  ...over,
});

const kinds = (result: ReturnType<typeof detectMilestones>) =>
  result.map((row) => `${row.kind}:${row.sequence}`);

describe('detectMilestones (#115)', () => {
  it('awards nothing to a user who has done nothing', () => {
    expect(detectMilestones(input())).toEqual([]);
  });

  it('awards the first full week once', () => {
    expect(kinds(detectMilestones(input({ successfulWeeksEver: 1 })))).toEqual([
      'FIRST_FULL_WEEK:1',
    ]);
    expect(
      detectMilestones(
        input({ successfulWeeksEver: 6, existing: [{ kind: 'FIRST_FULL_WEEK', sequence: 1 }] }),
      ),
    ).toEqual([]);
  });

  it('counts four-week stretches, and only the ones not yet awarded', () => {
    expect(kinds(detectMilestones(input({ consistencyRunWeeks: 3 })))).toEqual([]);
    expect(kinds(detectMilestones(input({ consistencyRunWeeks: 4 })))).toEqual([
      'FOUR_WEEKS:1',
    ]);

    const atEight = detectMilestones(
      input({ consistencyRunWeeks: 8, existing: [{ kind: 'FOUR_WEEKS', sequence: 1 }] }),
    );
    expect(kinds(atEight)).toEqual(['FOUR_WEEKS:2']);
    expect(atEight[0].meta).toEqual({ weeks: 8 });
  });

  it('catches up every step a late first run skipped', () => {
    // Nine weeks and no sweep until now: both the fourth and the eighth week
    // happened, and neither should be quietly dropped.
    expect(kinds(detectMilestones(input({ consistencyRunWeeks: 9 })))).toEqual([
      'FOUR_WEEKS:1',
      'FOUR_WEEKS:2',
    ]);
  });

  it('counts workouts in tens, tagged to HEALTH', () => {
    expect(kinds(detectMilestones(input({ workoutCompletions: 9 })))).toEqual([]);

    const ten = detectMilestones(input({ workoutCompletions: 10 }));
    expect(kinds(ten)).toEqual(['TEN_WORKOUTS:1']);
    expect(ten[0]).toMatchObject({ domain: 'HEALTH', meta: { count: 10 } });

    const twenty = detectMilestones(
      input({ workoutCompletions: 20, existing: [{ kind: 'TEN_WORKOUTS', sequence: 1 }] }),
    );
    expect(kinds(twenty)).toEqual(['TEN_WORKOUTS:2']);
  });

  it('marks the first comeback', () => {
    expect(kinds(detectMilestones(input({ comebackCompletions: 1 })))).toEqual([
      'FIRST_COMEBACK:1',
    ]);
    expect(
      detectMilestones(
        input({ comebackCompletions: 4, existing: [{ kind: 'FIRST_COMEBACK', sequence: 1 }] }),
      ),
    ).toEqual([]);
  });

  it('dates the postponed start to when it happened, not to the sweep', () => {
    const at = new Date('2026-03-04T08:15:00.000Z');

    const result = detectMilestones(
      input({ startedAfterPostpone: { commitmentId: 'c1', at } }),
    );

    expect(result[0]).toMatchObject({
      kind: 'FIRST_START_AFTER_POSTPONE',
      achievedAt: at,
      meta: { commitmentId: 'c1' },
    });
  });

  describe('REDUCED_REMINDERS, which E12 has not measured yet', () => {
    it('is never awarded while the ratio is null', () => {
      expect(
        detectMilestones(input({ independence: { ratio: null, sampleSize: 500 } })),
      ).toEqual([]);
    });

    it('is awarded once the reader supplies a real reading', () => {
      expect(
        kinds(
          detectMilestones(
            input({
              independence: {
                ratio: REDUCED_REMINDERS_RATIO,
                sampleSize: REDUCED_REMINDERS_MIN_SAMPLE,
              },
            }),
          ),
        ),
      ).toEqual(['REDUCED_REMINDERS:1']);
    });

    it('needs a sample worth believing', () => {
      expect(
        detectMilestones(input({ independence: { ratio: 1, sampleSize: 3 } })),
      ).toEqual([]);
    });
  });

  it('is deterministic: the same input twice is deep-equal', () => {
    const busy = input({
      successfulWeeksEver: 5,
      consistencyRunWeeks: 9,
      workoutCompletions: 23,
      comebackCompletions: 2,
      startedAfterPostpone: { commitmentId: 'c1', at: NOW },
    });

    expect(detectMilestones(busy)).toEqual(detectMilestones(busy));
  });
});
