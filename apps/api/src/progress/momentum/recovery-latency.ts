import type { WindowCommitment } from './momentum-engine';

// =============================================================================
// How fast this person comes back (issue #98, epic E11)
// =============================================================================
//
// PRD §55's recovery measure, and VISION §30's reason for it: the useful fact
// about a miss is not that it happened but how long it lasted. A median rather
// than a mean, because one three-week holiday would otherwise define a user who
// normally returns the next day.
//
// Cross-domain on purpose: returning at all is the behaviour being measured,
// and a person who misses a workout and comes back by writing the proposal has
// come back.
// =============================================================================

/** Days of history the median is read from. */
export const RECOVERY_LOOKBACK_DAYS = 90;

const DAY_MS = 24 * 3_600_000;

export interface RecoveryLatency {
  medianDays: number | null;
  samples: number;
}

export function computeRecoveryLatency(
  commitments: WindowCommitment[],
): RecoveryLatency {
  const misses = commitments
    .filter((row) => row.status === 'MISSED')
    .sort((a, b) => a.scheduledStart.getTime() - b.scheduledStart.getTime());

  const successes = commitments
    .filter(
      (row) =>
        (row.status === 'COMPLETED' || row.status === 'PARTIALLY_COMPLETED') &&
        row.completedAt,
    )
    .sort((a, b) => a.completedAt!.getTime() - b.completedAt!.getTime());

  const gaps: number[] = [];

  for (const miss of misses) {
    const next = successes.find((row) => row.completedAt! > miss.scheduledStart);
    // A miss with no return yet is not a slow recovery — it is an open one, and
    // counting it as a very large number would be a guess about the future.
    if (!next) continue;

    gaps.push(
      Math.max(0, (next.completedAt!.getTime() - miss.scheduledStart.getTime()) / DAY_MS),
    );
  }

  if (gaps.length === 0) return { medianDays: null, samples: 0 };

  return { medianDays: median(gaps), samples: gaps.length };
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  const raw =
    sorted.length % 2 === 1
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;

  // One decimal: "Returned in 1.5 days" is a sentence; 1.4999999 is not.
  return Math.round(raw * 10) / 10;
}
