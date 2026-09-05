import { WeeklySettingsService } from './weekly-settings.service';

// =============================================================================
// The weekly rhythm (issue #73)
// =============================================================================
//
// `nextReviewAt` is the one derived value on this surface, and the two cases it
// has to get right are "today, but the hour has gone" and a DST week.
// =============================================================================

function build(profile: Record<string, unknown> = {}) {
  const row = {
    id: 'profile-1',
    userId: 'user-1',
    timezone: 'America/Costa_Rica',
    weeklyReviewWeekday: 0,
    weeklyReviewTime: '17:00',
    ...profile,
  };

  const prisma: any = { auditEvent: { create: jest.fn(async () => ({})) } };
  const profiles = {
    // A copy, as Prisma returns — an aliased row would hide a write-then-read bug.
    getOrCreate: jest.fn(async () => ({ ...row })),
    update: jest.fn(async (_id: string, patch: Record<string, unknown>) => {
      Object.assign(row, patch);
      return row;
    }),
  };

  return { service: new WeeklySettingsService(prisma, profiles as any), prisma, profiles, row };
}

describe('nextReviewAt', () => {
  const { service } = build();

  it('finds the next Friday 16:00 in the user’s zone', () => {
    // Wednesday 2026-09-02 10:00 local in Costa Rica.
    const at = service.nextReviewAt(
      new Date('2026-09-02T16:00:00.000Z'),
      'America/Costa_Rica',
      5,
      '16:00',
    );

    expect(at.toISOString()).toBe('2026-09-04T22:00:00.000Z');
  });

  it('rolls to next week when today’s hour has already passed', () => {
    // Friday 18:00 local; the 16:00 review has been and gone.
    const at = service.nextReviewAt(
      new Date('2026-09-05T00:00:00.000Z'),
      'America/Costa_Rica',
      5,
      '16:00',
    );

    expect(at.toISOString()).toBe('2026-09-11T22:00:00.000Z');
  });

  it('stays on today when the hour is still ahead', () => {
    // Friday 09:00 local.
    const at = service.nextReviewAt(
      new Date('2026-09-04T15:00:00.000Z'),
      'America/Costa_Rica',
      5,
      '16:00',
    );

    expect(at.toISOString()).toBe('2026-09-04T22:00:00.000Z');
  });

  it('holds the wall clock across a DST change rather than adding 168 hours', () => {
    // Friday 2026-03-27 in Madrid (UTC+1); the clocks go forward on the 29th.
    const at = service.nextReviewAt(
      new Date('2026-03-27T12:00:00.000Z'),
      'Europe/Madrid',
      5,
      '16:00',
    );

    expect(at.toISOString()).toBe('2026-03-27T15:00:00.000Z');

    // The following Friday is 16:00 local again — 14:00Z, not 15:00Z.
    const next = service.nextReviewAt(
      new Date('2026-03-30T12:00:00.000Z'),
      'Europe/Madrid',
      5,
      '16:00',
    );

    expect(next.toISOString()).toBe('2026-04-03T14:00:00.000Z');
  });
});

describe('get and update', () => {
  it('returns the stored day and time with a resolved next occurrence', async () => {
    const harness = build({ weeklyReviewWeekday: 5, weeklyReviewTime: '16:00' });

    const settings = await harness.service.get('user-1');

    expect(settings).toMatchObject({
      weeklyReviewWeekday: 5,
      weeklyReviewTime: '16:00',
      timezone: 'America/Costa_Rica',
    });
    expect(new Date(settings.nextReviewAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('falls back to UTC for an unusable stored timezone', async () => {
    const harness = build({ timezone: 'Mars/Olympus' });

    await expect(harness.service.get('user-1')).resolves.toMatchObject({ timezone: 'UTC' });
  });

  it('persists the change and audits what moved', async () => {
    const harness = build();

    await harness.service.update('user-1', {
      weeklyReviewWeekday: 5,
      weeklyReviewTime: '16:00',
    });

    expect(harness.profiles.update).toHaveBeenCalledWith('user-1', {
      weeklyReviewWeekday: 5,
      weeklyReviewTime: '16:00',
    });

    const audit = harness.prisma.auditEvent.create.mock.calls[0][0].data;
    expect(audit.action).toBe('weekly_settings:update');
    expect(audit.meta).toEqual({
      from: { weeklyReviewWeekday: 0, weeklyReviewTime: '17:00' },
      to: { weeklyReviewWeekday: 5, weeklyReviewTime: '16:00' },
    });
  });
});
