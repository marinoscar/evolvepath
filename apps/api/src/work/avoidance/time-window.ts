import { greetingFor } from '../../today/local-date';

// =============================================================================
// Time windows (issue #116, epic E07)
// =============================================================================
//
// ONE DEFINITION, TWO READERS: the avoidance detector's "keeps failing at 4 PM"
// signal (#116) and the weekly summary's per-window success rates (#120). PRD
// §29 asks the review to say "4 of 5 before 9 AM and only 1 of 4 after 4 PM",
// and that sentence is only true if the buckets it counts are the same ones the
// ladder reasoned about.
//
// The boundaries are NOT restated here. `greetingFor` (E05-01) already owns
// them — 05:00–11:59 morning, 12:00–17:59 afternoon, else evening — and a
// second copy would drift the day somebody decided mornings end at 10.
// =============================================================================

export const TIME_WINDOWS = ['morning', 'afternoon', 'evening'] as const;

export type TimeWindow = (typeof TIME_WINDOWS)[number];

/** Which part of the user's own day this instant falls in. */
export function timeWindowOf(at: Date, timeZone: string): TimeWindow {
  return greetingFor(at, timeZone);
}
