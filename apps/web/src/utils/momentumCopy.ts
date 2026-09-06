import { DOMAIN_LABELS } from '../types';
import type { Momentum, MomentumState, ProgressResponse } from '../types';

// =============================================================================
// Every sentence the Progress screen says (issue #117, epic E11)
// =============================================================================
//
// PURE, AND IN ONE FILE, so the no-score rule is checkable. PRD P13 and §54
// forbid "Health Score: 77/100"; the way to be sure of that is not a review
// convention but a test that runs these functions over every state and asserts
// no output matches `/\d+\s*%|\/\s*100|score/i`.
//
// PRD §75 asks for "Coach dependency: percent completed without reminder" and
// this file deliberately renders it as a FRACTION — "7 of 10 completed without
// a reminder". A percentage is the shape a score wears, and the whole screen
// is built to not wear it.
// =============================================================================

/** The word the user reads. Never an abbreviation, never a grade. */
export const MOMENTUM_STATE_LABELS: Record<MomentumState, string> = {
  BUILDING: 'Building',
  IMPROVING: 'Improving',
  STEADY: 'Steady',
  SLIPPING: 'Slipping',
  RECOVERING: 'Recovering',
  INSUFFICIENT_DATA: 'Not enough yet',
};

/**
 * `DOMAIN_LABELS` is imported rather than redeclared: a second copy would
 * eventually disagree with the Path screen about what "Health" is called.
 */
export function domainLabel(domain: string | null): string {
  return domain
    ? (DOMAIN_LABELS[domain as keyof typeof DOMAIN_LABELS] ?? domain)
    : 'All';
}

/** "Health momentum: Improving" — what a screen reader hears. */
export function momentumAriaLabel(momentum: Momentum): string {
  return `${domainLabel(momentum.domain)} momentum: ${MOMENTUM_STATE_LABELS[momentum.state]}`;
}

/**
 * The one sentence per domain on "Your evolution".
 *
 * Counts over the window, never a total across domains: adding Work sessions to
 * family dinners produces a number that means nothing and invites a ranking.
 */
export function evolutionSentence(momentum: Momentum): string {
  const successes = momentum.signals.completed + momentum.signals.partial;
  const label = domainLabel(momentum.domain);

  if (momentum.signals.planned === 0) {
    return `${label}: nothing planned in the last four weeks`;
  }

  const noun = successes === 1 ? 'commitment' : 'commitments';
  return `${label}: ${successes} ${noun} kept in the last four weeks`;
}

/** "Health completions per week, last four weeks: 1, 2, 1, 1" */
export function trendAriaLabel(momentum: Momentum): string {
  const values = momentum.trend.map((point) => point.completed).join(', ');
  return `${domainLabel(momentum.domain)} completions per week, last four weeks: ${values}`;
}

export function consistencyCaption(
  run: ProgressResponse['consistencyRun'],
): string {
  if (run.weeks === 0) return 'Your first successful week is ahead';

  const weeks = run.weeks === 1 ? '1 week' : `${run.weeks} weeks`;
  return `${weeks} building momentum`;
}

/** Said out loud, because a forgiven week the user cannot see is not a kindness. */
export function graceCaption(run: ProgressResponse['consistencyRun']): string | null {
  if (run.graceUsed === 0) return null;
  return run.graceUsed === 1 ? '1 grace week used' : `${run.graceUsed} grace weeks used`;
}

export function weekLabel(week: { weekStart: string }): string {
  // `YYYY-MM-DD` read as a calendar date, not an instant: the label is the week
  // the user lived, and a timezone conversion here would move it by a day.
  const [, month, day] = week.weekStart.split('-');
  return `${day}/${month}`;
}

export function recoveryCopy(recovery: ProgressResponse['recovery']): string {
  if (recovery.medianDays === null) return 'No misses to recover from yet';

  const days = recovery.medianDays === 1 ? '1 day' : `${recovery.medianDays} days`;
  return `Returned in ${days} on average`;
}

export function recoverySamplesCopy(
  recovery: ProgressResponse['recovery'],
): string | null {
  if (recovery.samples === 0) return null;
  return recovery.samples === 1 ? '1 recovery' : `${recovery.samples} recoveries`;
}

/**
 * PRD §75's "percent completed without reminder", as a fraction.
 *
 * Null is answered with a sentence about the product rather than a zero: the
 * user has not failed to be independent, nothing has measured it yet.
 */
export function independenceCopy(
  independence: ProgressResponse['independence'],
): string {
  if (independence.ratio === null) {
    return 'Available once notifications learn your rhythm.';
  }

  return `${independence.completedWithoutReminder} of ${independence.sampleSize} completed without a reminder`;
}

/** The screen-reader sentence for the weekly bars. */
export function consistencyAriaLabel(
  run: ProgressResponse['consistencyRun'],
): string {
  const weeks = run.weekly
    .map((week) => `week of ${week.weekStart}, ${week.completed} of ${week.planned}`)
    .join('; ');

  return `Completed against planned, by week: ${weeks || 'no weeks yet'}`;
}
