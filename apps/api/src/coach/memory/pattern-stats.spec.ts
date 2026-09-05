import { aggregateStats, type StatsCommitment } from './pattern-stats';

// =============================================================================
// aggregateStats (issue #78)
// =============================================================================
//
// The timezone case is the one worth the fixture. A 23:30 UTC completion by
// someone in America/Costa_Rica happened at 17:30 — filing it under "evening"
// would produce a durable statement about that person which is simply false,
// and the whole point of Tier 3 memory is that it is durable.
// =============================================================================

const CR = 'America/Costa_Rica'; // UTC-6, no DST.

const commitment = (over: Partial<StatsCommitment> = {}): StatsCommitment => ({
  status: 'COMPLETED',
  domain: 'HEALTH',
  scheduledStart: new Date('2026-09-02T14:00:00.000Z'),
  rescheduleCount: 0,
  versionUsed: 'FULL',
  minutesSpent: null,
  fullMinutes: null,
  skipReason: null,
  ...over,
});

describe('aggregateStats (#78)', () => {
  it('reports an empty sample for no input', () => {
    expect(aggregateStats([], 'UTC').sampleSize).toBe(0);
  });

  it('counts only decided commitments', () => {
    const stats = aggregateStats(
      [
        commitment({ status: 'COMPLETED' }),
        commitment({ status: 'PARTIALLY_COMPLETED' }),
        commitment({ status: 'MISSED' }),
        commitment({ status: 'SKIPPED' }),
        commitment({ status: 'PLANNED' }),
        commitment({ status: 'STARTED' }),
        // Cancelled is a commitment that stopped being asked, not one the user
        // answered — so it is not evidence of anything about them.
        commitment({ status: 'CANCELLED' }),
      ],
      'UTC',
    );

    expect(stats.sampleSize).toBe(4);
    expect(stats.byDomain.HEALTH).toEqual({ decided: 4, kept: 2 });
  });

  it('buckets by the user’s wall clock, not the server’s', () => {
    const late = commitment({
      scheduledStart: new Date('2026-09-02T23:30:00.000Z'), // 17:30 in CR.
    });

    expect(aggregateStats([late], CR).byTimeOfDay).toMatchObject({
      afternoon: { decided: 1, kept: 1 },
      evening: { decided: 0, kept: 0 },
    });
    // The same instant is an evening one in UTC. Same row, different truth.
    expect(aggregateStats([late], 'UTC').byTimeOfDay).toMatchObject({
      evening: { decided: 1, kept: 1 },
    });
  });

  it('separates morning reliability from evening reliability', () => {
    const morning = Array.from({ length: 10 }, (_, i) =>
      commitment({
        scheduledStart: new Date('2026-09-02T08:00:00.000Z'),
        status: i < 8 ? 'COMPLETED' : 'MISSED',
      }),
    );
    const evening = Array.from({ length: 10 }, (_, i) =>
      commitment({
        scheduledStart: new Date('2026-09-02T19:00:00.000Z'),
        status: i < 3 ? 'COMPLETED' : 'MISSED',
      }),
    );

    const stats = aggregateStats([...morning, ...evening], 'UTC');

    expect(stats.byTimeOfDay.morning).toEqual({ decided: 10, kept: 8 });
    expect(stats.byTimeOfDay.evening).toEqual({ decided: 10, kept: 3 });
  });

  it('names weekdays in the user’s zone', () => {
    // 03:00 UTC Thursday is still Wednesday evening in Costa Rica.
    const stats = aggregateStats(
      [commitment({ scheduledStart: new Date('2026-09-03T03:00:00.000Z') })],
      CR,
    );

    expect(stats.byWeekday.wednesday).toEqual({ decided: 1, kept: 1 });
    expect(stats.byWeekday.thursday).toBeUndefined();
  });

  it('buckets reschedules and caps the histogram at three', () => {
    const stats = aggregateStats(
      [
        commitment({ rescheduleCount: 0 }),
        commitment({ rescheduleCount: 1 }),
        commitment({ rescheduleCount: 7 }),
      ],
      'UTC',
    );

    expect(stats.rescheduleHistogram).toEqual({ '0': 1, '1': 1, '3': 1 });
  });

  it('counts which size was actually done', () => {
    const stats = aggregateStats(
      [
        commitment({ versionUsed: 'FULL' }),
        commitment({ versionUsed: 'SHORT' }),
        commitment({ versionUsed: 'MINIMUM' }),
        commitment({ versionUsed: null }),
      ],
      'UTC',
    );

    expect(stats.fallbackUsage).toEqual({ full: 1, short: 1, minimum: 1 });
  });

  it('averages the planned-versus-logged gap over rows that have both', () => {
    const stats = aggregateStats(
      [
        commitment({ fullMinutes: 40, minutesSpent: 30 }),
        commitment({ fullMinutes: 40, minutesSpent: 20 }),
        commitment({ fullMinutes: 40, minutesSpent: null }),
      ],
      'UTC',
    );

    expect(stats.averageDurationGapMinutes).toBe(15);
  });

  it('reports no gap when nothing recorded both numbers', () => {
    expect(aggregateStats([commitment()], 'UTC').averageDurationGapMinutes).toBeNull();
  });

  it('histograms skip reasons', () => {
    const stats = aggregateStats(
      [
        commitment({ status: 'SKIPPED', skipReason: 'no_time' }),
        commitment({ status: 'SKIPPED', skipReason: 'no_time' }),
        commitment({ status: 'SKIPPED', skipReason: 'low_energy' }),
      ],
      'UTC',
    );

    expect(stats.skipReasons).toEqual({ no_time: 2, low_energy: 1 });
  });

  it('carries no titles, notes or names — only counts', () => {
    const stats = aggregateStats([commitment()], 'UTC');

    // The privacy guarantee, asserted on the OUTPUT rather than trusted from
    // the input type: this object is what reaches the pattern_analyst persona.
    expect(JSON.stringify(stats)).not.toMatch(/[a-z]{4,} [a-z]{4,}/i);
  });
});
