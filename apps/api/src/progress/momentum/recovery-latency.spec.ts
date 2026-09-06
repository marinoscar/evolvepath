import { computeRecoveryLatency } from './recovery-latency';
import type { WindowCommitment } from './momentum-engine';

// =============================================================================
// How fast this person comes back (issue #98, epic E11)
// =============================================================================
//
// A median, not a mean, and open misses are excluded rather than counted as a
// very large number: "you take 40 days to recover" would be a guess about a
// future that has not happened.
// =============================================================================

const NOW = new Date('2026-03-02T12:00:00.000Z');
const DAY = 86_400_000;

function at(daysAgo: number): Date {
  return new Date(NOW.getTime() - daysAgo * DAY);
}

function miss(daysAgo: number): WindowCommitment {
  return {
    id: `m${daysAgo}`,
    domain: 'HEALTH',
    scheduledStart: at(daysAgo),
    status: 'MISSED',
    rescheduleCount: 0,
    fallbackUsed: false,
    completedAt: null,
    commitmentType: null,
  };
}

function done(daysAgo: number): WindowCommitment {
  return {
    id: `c${daysAgo}`,
    domain: 'WORK',
    scheduledStart: at(daysAgo),
    status: 'COMPLETED',
    rescheduleCount: 0,
    fallbackUsed: false,
    completedAt: at(daysAgo),
    commitmentType: null,
  };
}

describe('computeRecoveryLatency (#98)', () => {
  it('is the median of the gaps, not the mean', () => {
    // Gaps of 1 and 3 days → 2.
    const rows = [miss(10), done(9), miss(6), done(3)];

    expect(computeRecoveryLatency(rows)).toEqual({ medianDays: 2, samples: 2 });
  });

  it('says nothing at all when there has been no miss', () => {
    expect(computeRecoveryLatency([done(4), done(2)])).toEqual({
      medianDays: null,
      samples: 0,
    });
  });

  it('excludes a miss the user has not returned from yet', () => {
    const rows = [miss(9), done(8), miss(1)];

    expect(computeRecoveryLatency(rows)).toEqual({ medianDays: 1, samples: 1 });
  });

  it('counts a return in any domain — coming back is the behaviour', () => {
    const rows = [miss(5), done(4)];

    expect(computeRecoveryLatency(rows).samples).toBe(1);
  });
});
