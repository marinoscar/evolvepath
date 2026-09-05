import type { InterventionMode } from './intervention-mode';

// =============================================================================
// The sentence under the recommendation (issue #38, epic E05)
// =============================================================================
//
// DETERMINISTIC TEMPLATES, not AI. PRD §120 requires Today to work with the
// provider down, and the rationale is the part that makes a recommendation a
// recommendation rather than a bare title — a card that says "Draft the
// storyline · 25 min" and nothing else is a to-do list.
//
// The coach's own voice arrives separately through `GET /today/insight`, which
// is allowed to be absent. This is not.
//
// Each template says WHY THIS ONE, in the second person, in one sentence, and
// never invents a fact: every substitution below is a value the caller read off
// the candidate.
// =============================================================================

export interface RationaleFacts {
  title: string;
  minutes: number;
  domain: 'WORK' | 'FAMILY' | 'HEALTH';
  rescheduleCount: number;
  /** The outcome's motivation, in the user's own words. Often null. */
  whyItMatters: string | null;
  availableMinutesRemaining: number;
}

const DOMAIN_LABEL: Record<RationaleFacts['domain'], string> = {
  WORK: 'work',
  FAMILY: 'family',
  HEALTH: 'health',
};

/**
 * Quote the user back to themselves when they gave us something to quote, and
 * fall back to the plain sentence when they did not — a template with an empty
 * quotation reads as a bug.
 */
function motiveClause(facts: RationaleFacts, fallback: string): string {
  return facts.whyItMatters
    ? `You said: “${facts.whyItMatters}”. The ${facts.minutes}-minute version keeps that alive today.`
    : fallback;
}

const TEMPLATES: Record<InterventionMode, (facts: RationaleFacts) => string> = {
  ACT: (facts) =>
    `This is the most useful ${facts.minutes} minutes you have right now.`,

  CLARIFY: (facts) =>
    `Worth ${facts.minutes} minutes — though it would help to say what “done” looks like for this ${DOMAIN_LABEL[facts.domain]} outcome.`,

  REDUCE: (facts) =>
    facts.availableMinutesRemaining > 0
      ? `Today is tight, so this is the ${facts.minutes}-minute version rather than the whole thing.`
      : `Today is full. ${facts.minutes} minutes is still a real move.`,

  DIAGNOSE: (facts) =>
    `You have moved this ${facts.rescheduleCount} times. Starting matters more than finishing right now.`,

  RECONNECT: (facts) =>
    motiveClause(
      facts,
      `Low energy today, so this is the ${facts.minutes}-minute version — small counts.`,
    ),

  CHALLENGE_PLAN: () =>
    `This keeps not happening. That is information about the plan, not about you — start small and we will revisit it.`,

  RECOVER: (facts) =>
    `Welcome back. ${facts.minutes} minutes on this is enough to be back in it.`,

  REINFORCE: (facts) =>
    `You have kept this going all week. ${facts.minutes} more minutes here.`,
};

/** The one-sentence rationale for this mode and candidate. */
export function rationaleFor(mode: InterventionMode, facts: RationaleFacts): string {
  return TEMPLATES[mode](facts);
}

/**
 * The line under the greeting: what today holds, and anything unusual about it.
 *
 * Says the count plainly. "3 commitments today." is information; "You've got
 * this!" is not, and a screen that opens with encouragement before it has told
 * you anything is the tone PRD §5 warns against.
 */
export function stateLineFor(input: {
  commitmentCount: number;
  pausedDomains: Array<'WORK' | 'FAMILY' | 'HEALTH'>;
  maintainDomains: Array<'WORK' | 'FAMILY' | 'HEALTH'>;
}): string {
  const { commitmentCount, pausedDomains, maintainDomains } = input;

  const count =
    commitmentCount === 0
      ? 'Nothing scheduled today.'
      : commitmentCount === 1
        ? '1 commitment today.'
        : `${commitmentCount} commitments today.`;

  const notes: string[] = [];

  if (pausedDomains.length > 0) {
    notes.push(`${joinDomains(pausedDomains)} ${pausedDomains.length === 1 ? 'is' : 'are'} paused.`);
  }

  if (maintainDomains.length > 0) {
    notes.push(
      `${joinDomains(maintainDomains)} ${maintainDomains.length === 1 ? 'is' : 'are'} in maintenance mode this week.`,
    );
  }

  return [count, ...notes].join(' ');
}

function joinDomains(domains: Array<'WORK' | 'FAMILY' | 'HEALTH'>): string {
  const labels = domains.map((domain) => DOMAIN_LABEL[domain]);
  const capitalised = labels.map((label) => label[0].toUpperCase() + label.slice(1));

  if (capitalised.length === 1) return capitalised[0];
  if (capitalised.length === 2) return `${capitalised[0]} and ${capitalised[1]}`;

  return `${capitalised.slice(0, -1).join(', ')} and ${capitalised.at(-1)}`;
}
