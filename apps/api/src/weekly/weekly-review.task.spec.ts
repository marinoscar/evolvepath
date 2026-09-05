import { WeeklyReviewTask } from './weekly-review.task';

// =============================================================================
// The hourly sweep (issue #73)
// =============================================================================
//
// Everything here is about a fixed instant seen from three timezones. The bug
// this spec exists to prevent is the obvious implementation: comparing the
// SERVER's weekday and hour against the user's preference, which works
// perfectly for whoever deployed it and for nobody else.
// =============================================================================

// Friday 2026-09-04 16:00 in Costa Rica (UTC-6) is 22:00 UTC and Saturday
// 07:00 in Tokyo.
const NOW = new Date('2026-09-04T22:00:00.000Z');

function build(
  profiles: Array<{
    userId: string;
    timezone: string;
    weeklyReviewWeekday: number;
    weeklyReviewTime: string;
  }>,
  options: { disabled?: boolean; existing?: Record<string, string> } = {},
) {
  const prisma: any = {
    userProfile: { findMany: jest.fn(async () => profiles) },
    weeklyReview: {
      findUnique: jest.fn(async ({ where }: any) => {
        const status = options.existing?.[where.userId_weekStart.userId];
        return status ? { status } : null;
      }),
    },
  };
  const reviews = { generate: jest.fn(async () => ({})) };
  const config = { get: jest.fn(() => options.disabled ?? false) };

  return {
    task: new WeeklyReviewTask(prisma, reviews as any, config as any),
    prisma,
    reviews,
  };
}

describe('the weekly review sweep', () => {
  it('generates only for the user whose LOCAL weekday and hour match', async () => {
    const harness = build([
      // Friday 16:00 in Costa Rica — a match.
      {
        userId: 'costa-rica',
        timezone: 'America/Costa_Rica',
        weeklyReviewWeekday: 5,
        weeklyReviewTime: '16:00',
      },
      // Same instant, but Saturday 07:00 in Tokyo — not their Friday 16:00.
      {
        userId: 'tokyo',
        timezone: 'Asia/Tokyo',
        weeklyReviewWeekday: 5,
        weeklyReviewTime: '16:00',
      },
      // Friday in UTC, but 22:00 rather than 16:00.
      { userId: 'utc', timezone: 'UTC', weeklyReviewWeekday: 5, weeklyReviewTime: '16:00' },
    ]);

    jest.useFakeTimers().setSystemTime(NOW);
    await harness.task.handleCron();
    jest.useRealTimers();

    expect(harness.reviews.generate).toHaveBeenCalledTimes(1);
    expect(harness.reviews.generate).toHaveBeenCalledWith(
      'costa-rica',
      expect.objectContaining({ trigger: 'cron' }),
    );
  });

  it('matches a user whose review time is on the half hour, in that hour', async () => {
    // Documented behaviour, not an accident: the sweep is hourly, so 16:30 is
    // prepared in the 16:00 pass.
    const harness = build([
      {
        userId: 'half-past',
        timezone: 'America/Costa_Rica',
        weeklyReviewWeekday: 5,
        weeklyReviewTime: '16:30',
      },
    ]);

    jest.useFakeTimers().setSystemTime(NOW);
    await harness.task.handleCron();
    jest.useRealTimers();

    expect(harness.reviews.generate).toHaveBeenCalledTimes(1);
  });

  it('reviews the week in progress on a Friday', async () => {
    const harness = build([
      {
        userId: 'costa-rica',
        timezone: 'America/Costa_Rica',
        weeklyReviewWeekday: 5,
        weeklyReviewTime: '16:00',
      },
    ]);

    jest.useFakeTimers().setSystemTime(NOW);
    await harness.task.handleCron();
    jest.useRealTimers();

    expect(harness.reviews.generate).toHaveBeenCalledWith('costa-rica', {
      weekStart: '2026-08-31',
      trigger: 'cron',
    });
  });

  it('skips a user whose review for that week is already READY', async () => {
    const harness = build(
      [
        {
          userId: 'costa-rica',
          timezone: 'America/Costa_Rica',
          weeklyReviewWeekday: 5,
          weeklyReviewTime: '16:00',
        },
      ],
      { existing: { 'costa-rica': 'READY' } },
    );

    jest.useFakeTimers().setSystemTime(NOW);
    await harness.task.handleCron();
    jest.useRealTimers();

    expect(harness.reviews.generate).not.toHaveBeenCalled();
  });

  it('retries a row left GENERATING by a crashed run', async () => {
    const harness = build(
      [
        {
          userId: 'costa-rica',
          timezone: 'America/Costa_Rica',
          weeklyReviewWeekday: 5,
          weeklyReviewTime: '16:00',
        },
      ],
      { existing: { 'costa-rica': 'GENERATING' } },
    );

    jest.useFakeTimers().setSystemTime(NOW);
    await harness.task.handleCron();
    jest.useRealTimers();

    expect(harness.reviews.generate).toHaveBeenCalledTimes(1);
  });

  it('continues past a user whose generation throws', async () => {
    const harness = build([
      {
        userId: 'broken',
        timezone: 'America/Costa_Rica',
        weeklyReviewWeekday: 5,
        weeklyReviewTime: '16:00',
      },
      {
        userId: 'fine',
        timezone: 'America/Costa_Rica',
        weeklyReviewWeekday: 5,
        weeklyReviewTime: '16:00',
      },
    ]);
    harness.reviews.generate = jest.fn(async (userId: string) => {
      if (userId === 'broken') throw new Error('expired key');
      return {};
    }) as any;

    jest.useFakeTimers().setSystemTime(NOW);
    await expect(harness.task.handleCron()).resolves.toBeUndefined();
    jest.useRealTimers();

    expect(harness.reviews.generate).toHaveBeenCalledWith('fine', expect.anything());
  });

  it('does not even query when the sweep is switched off', async () => {
    const harness = build(
      [
        {
          userId: 'costa-rica',
          timezone: 'America/Costa_Rica',
          weeklyReviewWeekday: 5,
          weeklyReviewTime: '16:00',
        },
      ],
      { disabled: true },
    );

    await harness.task.handleCron();

    expect(harness.prisma.userProfile.findMany).not.toHaveBeenCalled();
  });

  it('only looks at users who finished onboarding', async () => {
    const harness = build([]);

    await harness.task.handleCron();

    expect(harness.prisma.userProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { onboardingCompletedAt: { not: null } },
      }),
    );
  });
});
