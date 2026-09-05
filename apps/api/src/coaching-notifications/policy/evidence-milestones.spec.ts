import { evidenceMilestone, milestoneCount } from './evidence-milestones';

const now = new Date('2026-09-08T18:00:00.000Z');
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 3600_000);

const input = (over: Partial<Parameters<typeof evidenceMilestone>[0]> = {}) => ({
  completions: [] as Date[],
  now,
  totalCompletions: 0,
  ...over,
});

describe('evidenceMilestone (#59)', () => {
  it('says nothing about an ordinary completion', () => {
    expect(
      evidenceMilestone(
        input({ completions: [daysAgo(0), daysAgo(6)], totalCompletions: 2 }),
      ),
    ).toBeNull();
  });

  describe('THIRD_IN_8_DAYS', () => {
    it('fires on the third completion inside the window', () => {
      expect(
        evidenceMilestone(
          input({
            completions: [daysAgo(0), daysAgo(3), daysAgo(7)],
            totalCompletions: 3,
          }),
        ),
      ).toBe('THIRD_IN_8_DAYS');
    });

    it('does not fire when the third is just outside the window', () => {
      expect(
        evidenceMilestone(
          input({
            completions: [daysAgo(0), daysAgo(3), daysAgo(9)],
            totalCompletions: 3,
          }),
        ),
      ).toBeNull();
    });

    // Exact equality, never `>=`: a `>=` would re-fire on the fourth, fifth and
    // sixth session in eight days, which is the noise this file exists to avoid.
    it('does not fire again on the fourth', () => {
      expect(
        evidenceMilestone(
          input({
            completions: [daysAgo(0), daysAgo(1), daysAgo(3), daysAgo(7)],
            totalCompletions: 4,
          }),
        ),
      ).toBeNull();
    });
  });

  describe('FIFTH_IN_14_DAYS', () => {
    it('fires on the fifth inside two weeks', () => {
      const completions = [0, 2, 5, 9, 13].map(daysAgo);
      expect(evidenceMilestone(input({ completions, totalCompletions: 5 }))).toBe(
        'FIFTH_IN_14_DAYS',
      );
    });
  });

  describe('TENTH_TOTAL', () => {
    it('fires on the tenth, whenever they happened', () => {
      expect(
        evidenceMilestone(
          input({ completions: [daysAgo(0)], totalCompletions: 10 }),
        ),
      ).toBe('TENTH_TOTAL');
    });

    it('outranks a milestone the same session also reaches', () => {
      const completions = [daysAgo(0), daysAgo(2), daysAgo(5)];
      expect(
        evidenceMilestone(input({ completions, totalCompletions: 10 })),
      ).toBe('TENTH_TOTAL');
    });

    it('does not fire on the eleventh', () => {
      expect(
        evidenceMilestone(
          input({ completions: [daysAgo(0)], totalCompletions: 11 }),
        ),
      ).toBeNull();
    });
  });

  describe('FIRST_FULL_WEEK', () => {
    it('fires when every planned commitment of the week is done', () => {
      expect(
        evidenceMilestone(
          input({
            completions: [daysAgo(0), daysAgo(2)],
            totalCompletions: 2,
            weekPlanned: 2,
            weekCompleted: 2,
          }),
        ),
      ).toBe('FIRST_FULL_WEEK');
    });

    it('does not fire when one was skipped', () => {
      expect(
        evidenceMilestone(
          input({
            completions: [daysAgo(0), daysAgo(2)],
            totalCompletions: 2,
            weekPlanned: 3,
            weekCompleted: 2,
          }),
        ),
      ).toBeNull();
    });

    it('does not fire on a week with nothing planned', () => {
      expect(
        evidenceMilestone(
          input({ totalCompletions: 1, weekPlanned: 0, weekCompleted: 0 }),
        ),
      ).toBeNull();
    });
  });
});

describe('milestoneCount (#59)', () => {
  it('quotes the count the copy talks about', () => {
    const three = input({
      completions: [daysAgo(0), daysAgo(3), daysAgo(7)],
      totalCompletions: 3,
    });

    expect(milestoneCount('THIRD_IN_8_DAYS', three)).toBe(3);
    expect(milestoneCount('TENTH_TOTAL', input({ totalCompletions: 10 }))).toBe(10);
    expect(
      milestoneCount('FIRST_FULL_WEEK', input({ weekPlanned: 4, weekCompleted: 4 })),
    ).toBe(4);
  });
});
