import type { CandidateCommitment, CheckInFeel } from './nba-scorer';

// =============================================================================
// Which size to offer (issue #38, epic E05)
// =============================================================================
//
// PURE, and separate from the scorer because it runs BEFORE it: the chosen size
// is an input to `effortMismatch` and `fatigue`, so sizing cannot depend on the
// score without a cycle.
//
// The rule underneath every branch here: NEVER OFFER A SIZE THE USER DID NOT
// DECLARE. A short version invented by the product is a smaller commitment the
// user never agreed to, which is the opposite of what PRD §57's three sizes are
// for. When a size is missing the sizer falls back to one that exists rather
// than manufacturing one.
// =============================================================================

export type VersionName = 'full' | 'short' | 'minimum';

export interface SizingInput {
  versions: CandidateCommitment['versions'];
  checkIn: CheckInFeel | null;
  availableMinutesRemaining: number;
}

export interface ChosenVersion {
  version: VersionName;
  title: string;
  durationMinutes: number;
}

export interface FallbackOffer {
  title: string;
  durationMinutes: number;
}

/** PRD §28: a daily win must be possible in minutes. */
export const DEFAULT_FALLBACK: FallbackOffer = {
  title: '5-minute start',
  durationMinutes: 5,
};

/** Largest to smallest — the order every preference list below is a slice of. */
const ORDER: VersionName[] = ['full', 'short', 'minimum'];

function pick(
  versions: SizingInput['versions'],
  preference: VersionName[],
): ChosenVersion | null {
  for (const name of preference) {
    const version = versions[name];
    if (version) {
      return { version: name, title: version.title, durationMinutes: version.minutes };
    }
  }

  return null;
}

/**
 * The version to put in front of the user.
 *
 * - `LOW_ENERGY` → the smallest declared size. Someone who just said they are
 *   depleted should not be shown a 45-minute block; PRD §73 is explicit that
 *   the check-in "can alter suggested action size".
 * - `PACKED` / `UNEXPECTED_PROBLEM` → the short version. The constraint is TIME,
 *   not capacity, so the minimum would undersell what they can actually do.
 * - otherwise → the full version, stepped down only when it does not fit the
 *   remaining budget, and never below the minimum. A budget is an estimate; it
 *   should shrink an offer, not veto one.
 */
export function chooseVersion(input: SizingInput): ChosenVersion {
  const { versions, checkIn, availableMinutesRemaining } = input;

  if (checkIn === 'LOW_ENERGY') {
    return pick(versions, ['minimum', 'short', 'full']) ?? fullOf(versions);
  }

  if (checkIn === 'PACKED' || checkIn === 'UNEXPECTED_PROBLEM') {
    return pick(versions, ['short', 'minimum', 'full']) ?? fullOf(versions);
  }

  const full = fullOf(versions);
  if (full.durationMinutes <= availableMinutesRemaining) return full;

  // Largest declared version that fits, floored at the minimum.
  const fitting = ORDER.map((name) => ({ name, version: versions[name] }))
    .filter(
      (entry): entry is { name: VersionName; version: { title: string; minutes: number } } =>
        entry.version !== null && entry.version !== undefined,
    )
    .find((entry) => entry.version.minutes <= availableMinutesRemaining);

  if (fitting) {
    return {
      version: fitting.name,
      title: fitting.version.title,
      durationMinutes: fitting.version.minutes,
    };
  }

  return pick(versions, ['minimum', 'short', 'full']) ?? full;
}

/**
 * The smaller thing to offer beside the chosen version — the "or just do this"
 * escape hatch that keeps a bad day from being a zero.
 *
 * The next smaller DECLARED size, or the five-minute default when there is none.
 */
export function fallbackFor(
  input: Pick<SizingInput, 'versions'>,
  chosen: ChosenVersion,
): FallbackOffer {
  const smaller = ORDER.slice(ORDER.indexOf(chosen.version) + 1);
  const next = pick(input.versions, smaller);

  return next ? { title: next.title, durationMinutes: next.durationMinutes } : DEFAULT_FALLBACK;
}

function fullOf(versions: SizingInput['versions']): ChosenVersion {
  return {
    version: 'full',
    title: versions.full.title,
    durationMinutes: versions.full.minutes,
  };
}
