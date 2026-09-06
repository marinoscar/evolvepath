import { localDate } from '../today/local-date';
import { addDays } from '../weekly/week-bounds';
import type { OnboardingProposal, ProposalDomain } from './onboarding-proposal.schema';

// =============================================================================
// What a first Path may look like (issue #101, epic E04)
// =============================================================================
//
// PURE, AND APPLIED TO ALL THREE SOURCES: the model's output, the template, and
// the copy the user edited before pressing `Start this Path`. A rule enforced
// only on the model is a rule a client can walk around, and a rule enforced
// only at approve is one the review screen shows the user before rejecting.
//
// A VIOLATION IS NEVER CORRECTED HERE. A plan this file quietly fixed would be
// a plan the user did not agree to (PRD §15), so the model's output is
// discarded whole and the user's edit comes back as a 400 naming the rule.
// =============================================================================

/** PRD §70. Three behaviours is the first-week ceiling, not a suggestion. */
export const MAX_FIRST_PATH_ROUTINES = 3;

/**
 * How far out a "first week" commitment may be scheduled.
 *
 * A day behind, because a user onboarding at 23:50 should still be offered
 * this morning's routine; eight days ahead, because "the next 7 days" counted
 * from a local date needs a day of slack for the zone the instant lands in.
 */
export const FIRST_WEEK_PAST_DAYS = 1;
export const FIRST_WEEK_FUTURE_DAYS = 8;

export interface GuardrailContext {
  now: Date;
  timezone: string;
  /** The domains the user selected on step 3. */
  domains: ProposalDomain[];
  /** Stated weekday availability, or null when the user has not answered. */
  weekdayMinutes: number | null;
}

/**
 * Every rule this proposal breaks, as readable sentences.
 *
 * An empty array is the only pass. The strings are user-facing: they are
 * returned in `details.rules[]` on a 400 and rendered under the offending
 * section of the review screen.
 */
export function validateOnboardingProposal(
  proposal: OnboardingProposal,
  ctx: GuardrailContext,
): string[] {
  const rules: string[] = [];
  const selected = new Set(ctx.domains);

  // ---- outcomes: one per selected domain, and only selected domains --------

  const seen = new Set<ProposalDomain>();

  for (const outcome of proposal.outcomes) {
    if (!selected.has(outcome.domain)) {
      rules.push(`Outcome "${outcome.title}" is in ${outcome.domain}, which you did not select.`);
    }

    if (seen.has(outcome.domain)) {
      rules.push(`There is more than one ${outcome.domain} outcome; a first Path has one per area.`);
    }

    seen.add(outcome.domain);
  }

  // ---- routines: the PRD §70 cap, and minimums that are actually smaller ---

  if (proposal.routines.length > MAX_FIRST_PATH_ROUTINES) {
    rules.push(
      `A first Path has at most ${MAX_FIRST_PATH_ROUTINES} behaviours; this one has ${proposal.routines.length}.`,
    );
  }

  for (const routine of proposal.routines) {
    if (!selected.has(routine.domain)) {
      rules.push(`Routine "${routine.title}" is in ${routine.domain}, which you did not select.`);
    }

    if (routine.minimumMinutes > routine.idealMinutes) {
      rules.push(
        `Routine "${routine.title}" has a minimum longer than its full version (${routine.minimumMinutes} > ${routine.idealMinutes}).`,
      );
    }
  }

  // ---- commitments: inside the first week, inside the stated minutes -------

  const today = localDate(ctx.now, ctx.timezone);
  const earliest = addDays(today, -FIRST_WEEK_PAST_DAYS);
  const latest = addDays(today, FIRST_WEEK_FUTURE_DAYS);

  /** Local weekday date → minutes committed on it. */
  const perDay = new Map<string, number>();

  for (const commitment of proposal.firstWeekCommitments) {
    if (!selected.has(commitment.domain)) {
      rules.push(
        `Commitment "${commitment.title}" is in ${commitment.domain}, which you did not select.`,
      );
    }

    const start = new Date(commitment.scheduledStart);

    if (Number.isNaN(start.getTime())) {
      rules.push(`Commitment "${commitment.title}" has an unreadable date.`);
      continue;
    }

    const day = localDate(start, ctx.timezone);

    if (day < earliest || day > latest) {
      rules.push(
        `Commitment "${commitment.title}" is scheduled for ${day}, outside your first week.`,
      );
      continue;
    }

    perDay.set(day, (perDay.get(day) ?? 0) + commitment.durationMinutes);
  }

  if (ctx.weekdayMinutes != null) {
    for (const [day, minutes] of [...perDay].sort(([a], [b]) => a.localeCompare(b))) {
      if (minutes > ctx.weekdayMinutes) {
        rules.push(
          `${day} asks for ${minutes} minutes; you said you have about ${ctx.weekdayMinutes}.`,
        );
      }
    }
  }

  return rules;
}
