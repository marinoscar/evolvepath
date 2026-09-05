import type { WeekAggregates, WeeklyDomain, WeeklyReviewOutput } from './weekly.schema';

// =============================================================================
// The review that ships when the provider is down (issue #73, epic E10)
// =============================================================================
//
// PRD §120: the deterministic path keeps working. A weekly review is the one
// screen in this product a user opens on a schedule, and "the coach is
// unavailable, come back later" on a Sunday evening is the week's ritual
// simply not happening.
//
// SO THIS FALLBACK SAYS ONLY WHAT THE NUMBERS SAY. Every sentence below is a
// count read back. It draws no inferences, and `proposedChanges` is ALWAYS
// empty: a template cannot judge whether a plan should change, and a plan
// change proposed by a string builder would arrive in the mutation protocol
// indistinguishable from one a coach reasoned about.
//
// The wording is also the wording that ships during every outage, forever. A
// shaming sentence here would reach users silently and permanently — which is
// why there is no "you only managed" anywhere in this file.
// =============================================================================

/** Domains in review-screen order. */
const DOMAINS: WeeklyDomain[] = ['WORK', 'FAMILY', 'HEALTH'];

const DOMAIN_LABEL: Record<WeeklyDomain, string> = {
  WORK: 'Work',
  FAMILY: 'Family',
  HEALTH: 'Health',
};

const WINDOW_LABEL: Record<string, string> = {
  early_morning: 'before 07:00',
  morning: 'in the morning',
  midday: 'around midday',
  afternoon: 'in the afternoon',
  evening: 'in the evening',
  night: 'late at night',
};

/** A domain is "holding" at three quarters. Not a grade — a threshold for a sentence. */
const WORKING_RATE = 0.75;
/** Below half, with at least two intentions, is worth naming as friction. */
const STRUGGLING_RATE = 0.5;
/** Fewer than three data points is an anecdote, not a time-of-day pattern. */
const MIN_WINDOW_SAMPLE = 3;
/** How far two windows must diverge before the difference is worth reporting. */
const WINDOW_GAP = 0.4;

export interface TemplateOptions {
  softCap: number;
}

export function buildTemplateSummary(
  aggregates: WeekAggregates,
  { softCap }: TemplateOptions,
): WeeklyReviewOutput {
  const working = DOMAINS.filter(
    (domain) =>
      aggregates.domains[domain].planned >= 1 &&
      aggregates.domains[domain].completionRate >= WORKING_RATE,
  );

  const whatWorked = working.map(
    (domain) =>
      `${DOMAIN_LABEL[domain]}: ${aggregates.domains[domain].completed} of ` +
      `${aggregates.domains[domain].planned} done.`,
  );

  const windows = aggregates.timeWindows.filter((w) => w.planned >= MIN_WINDOW_SAMPLE);
  const best = maxBy(windows, (w) => w.successRate);
  const worst = minBy(windows, (w) => w.successRate);

  if (best && best.successRate >= WORKING_RATE) {
    whatWorked.push(
      `Commitments ${WINDOW_LABEL[best.window]}: ${best.completed} of ${best.planned} done.`,
    );
  }

  const whatDidNot = DOMAINS.filter(
    (domain) =>
      aggregates.domains[domain].planned >= 2 &&
      aggregates.domains[domain].completionRate < STRUGGLING_RATE,
  ).map(
    (domain) =>
      `${DOMAIN_LABEL[domain]}: ${aggregates.domains[domain].completed} of ` +
      `${aggregates.domains[domain].planned} done.`,
  );

  const leader = aggregates.rescheduleLeaders[0];
  if (leader) {
    whatDidNot.push(
      `“${leader.title}” was moved ${leader.rescheduleCount} ` +
        `${leader.rescheduleCount === 1 ? 'time' : 'times'}.`,
    );
  }

  const friction = aggregates.frictionTags[0];
  if (friction) {
    whatDidNot.push(
      `“${friction.tag}” came up ${friction.count} ` +
        `${friction.count === 1 ? 'time' : 'times'} in your notes.`,
    );
  }

  // ONE observation, and only when the gap is large enough to be a fact rather
  // than noise. `inference` and `recommendation` stay null on purpose: this
  // function is not allowed to guess, and a null field renders as an absent row
  // rather than as a hedge.
  const patterns: WeeklyReviewOutput['patterns'] =
    best && worst && best.window !== worst.window && best.successRate - worst.successRate >= WINDOW_GAP
      ? [
          {
            observation:
              `${best.completed} of ${best.planned} commitments ${WINDOW_LABEL[best.window]} were done; ` +
              `${worst.completed} of ${worst.planned} ${WINDOW_LABEL[worst.window]}.`,
            inference: null,
            recommendation: null,
            confidence: 0.5,
            domain: null,
          },
        ]
      : [];

  return {
    whatWorked: whatWorked.slice(0, 5),
    whatDidNot: whatDidNot.slice(0, 5),
    patterns,
    // Never. See the header.
    proposedChanges: [],
    keepUnchanged: working.map((domain) => `${DOMAIN_LABEL[domain]} is holding — leave it as it is.`),
    doNotAddYet:
      aggregates.totals.planned >= softCap
        ? [
            `Nothing new this week — you already have ${aggregates.totals.planned} commitments.`,
          ]
        : [],
  };
}

function maxBy<T>(items: T[], score: (item: T) => number): T | undefined {
  return items.reduce<T | undefined>(
    (best, item) => (best === undefined || score(item) > score(best) ? item : best),
    undefined,
  );
}

function minBy<T>(items: T[], score: (item: T) => number): T | undefined {
  return items.reduce<T | undefined>(
    (worst, item) => (worst === undefined || score(item) < score(worst) ? item : worst),
    undefined,
  );
}
