import { localDate } from '../today/local-date';
import { addDays, localTimeToInstant, weekdayOf } from '../weekly/week-bounds';
import type { HealthBaseline } from '../user-profile/user-profile.schema';
import type { OnboardingProposal, ProposalDomain } from './onboarding-proposal.schema';

// =============================================================================
// The first Path with no model in it (issue #101, epic E04)
// =============================================================================
//
// PRD §120: the flow completes with the provider down. "Completes" means an
// approved, persisted Path — not an apology and a retry button — so this file
// produces the same `OnboardingProposal` the planner does, from the only things
// the server knows without a model: which domains the user picked, how many
// minutes they said they have, and what day it is where they are.
//
// It is HONEST ABOUT BEING A TEMPLATE. `rationale` says so, and the review
// screen shows a chip saying so, because a generic plan presented as a bespoke
// one is worse than an outage: the user follows it believing a coach wrote it.
//
// PURE. `now` and `timezone` come in; nothing here reads a clock or a database,
// which is what lets its spec run the same function across zones.
// =============================================================================

/** Where a template puts each domain's behaviour, local wall clock. */
export const TEMPLATE_TIMES: Record<ProposalDomain, string> = {
  WORK: '07:30',
  FAMILY: '18:30',
  HEALTH: '07:00',
};

/** 0 = Sunday … 6 = Saturday. Three sessions, spread rather than stacked. */
export const TEMPLATE_WEEKDAYS: Record<ProposalDomain, number[]> = {
  WORK: [1, 3, 5],
  FAMILY: [2, 4, 0],
  HEALTH: [1, 3, 6],
};

/** The identity sentence each selected domain contributes (PRD §20 step 8). */
export const TEMPLATE_IDENTITY: Record<ProposalDomain, string> = {
  WORK: 'I start important work before I become reactive.',
  FAMILY: 'I give my family protected attention.',
  HEALTH: 'I train consistently.',
};

export const TEMPLATE_RATIONALE =
  'This is a starting template, not a plan written for you. It is deliberately small: ' +
  'three behaviours at most, each with a version you can still do on your worst day. ' +
  'The coach will refine it once it is back.';

interface TemplateRoutineSpec {
  identity: string;
  outcomeTitle: string;
  whyItMatters: string;
  successDefinition: string;
  routineTitle: string;
  triggerValue: string;
  idealMinutes: number;
  minimumMinutes: number;
  fallbackBehavior: string;
  fullVersion: string;
  shortVersion: string;
  minimumVersion: string;
}

const TEMPLATES: Record<ProposalDomain, TemplateRoutineSpec> = {
  WORK: {
    identity: 'Someone who protects the work that matters',
    outcomeTitle: 'Protect my most important work',
    whyItMatters: 'The day fills with other people’s priorities unless the first hour is mine.',
    successDefinition: 'Three mornings a week begin with the most important task, not the inbox.',
    routineTitle: 'Start the most important task before email',
    triggerValue: 'Mon,Wed,Fri',
    idealMinutes: 25,
    minimumMinutes: 10,
    fallbackBehavior: 'Open the task and write the first sentence',
    fullVersion: '25 focused minutes on the most important task',
    shortVersion: '15 minutes on the most important task',
    minimumVersion: 'Open the task and write the first sentence',
  },
  FAMILY: {
    identity: 'Someone who is present with the people at the table',
    outcomeTitle: 'Be present with the people I care about',
    whyItMatters: 'Attention is the thing they will remember, and it is the first thing work takes.',
    successDefinition: 'Three evenings a week are phone-free from the first plate to the last.',
    routineTitle: 'Phone-free dinner',
    triggerValue: 'Tue,Thu,Sun',
    idealMinutes: 30,
    minimumMinutes: 10,
    fallbackBehavior: 'Ten minutes of undivided attention',
    fullVersion: 'Phone-free dinner together',
    shortVersion: 'Phone-free for the first fifteen minutes',
    minimumVersion: 'Ten minutes of undivided attention',
  },
  HEALTH: {
    identity: 'Someone who trains whether or not the week cooperates',
    outcomeTitle: 'Train consistently',
    whyItMatters: 'Consistency is what changes, and it is what stops first when the week gets hard.',
    successDefinition: 'Three sessions a week happen, even the short ones.',
    routineTitle: 'Three 30-minute strength sessions',
    triggerValue: 'Mon,Wed,Sat',
    idealMinutes: 30,
    minimumMinutes: 10,
    fallbackBehavior: 'A 10-minute walk',
    fullVersion: 'A 30-minute strength session',
    shortVersion: 'A 15-minute strength session',
    minimumVersion: 'A 10-minute walk',
  },
};

export interface TemplateAnswers {
  sixMonthVision: string | null;
  domains: ProposalDomain[];
  weekdayMinutes: number | null;
  healthBaseline: HealthBaseline | null;
}

/**
 * Turn the answers into a proposal.
 *
 * The order of the domains follows the user's selection, and every selected
 * domain contributes exactly one outcome and one routine — which is what makes
 * the guardrails pass for every subset rather than for the three-domain case
 * the author happened to try.
 */
export function buildTemplateProposal(
  answers: TemplateAnswers,
  now: Date,
  timezone: string,
): OnboardingProposal {
  const domains = dedupe(answers.domains);
  const today = localDate(now, timezone);

  // ---- when each domain's behaviour falls, before deciding how long it is ---
  //
  // The days come FIRST because the minutes depend on them. Two domains landing
  // on the same Monday have to share that Monday's budget, and a per-routine
  // clamp cannot see that — which is exactly the guardrail this template would
  // otherwise fail on a three-domain user with 45 minutes a day.

  const sessionsFor = (domain: ProposalDomain): number =>
    domain === 'HEALTH' && answers.healthBaseline
      ? Math.min(answers.healthBaseline.daysPerWeek, 3)
      : 3;

  const daysByDomain = new Map<ProposalDomain, string[]>(
    domains.map((domain) => [
      domain,
      nextOccurrences(today, TEMPLATE_WEEKDAYS[domain], sessionsFor(domain)),
    ]),
  );

  /** local date → how many domains want something on it. */
  const load = new Map<string, number>();

  for (const days of daysByDomain.values()) {
    for (const day of days) load.set(day, (load.get(day) ?? 0) + 1);
  }

  const outcomes: OnboardingProposal['outcomes'] = [];
  const routines: OnboardingProposal['routines'] = [];
  const commitments: OnboardingProposal['firstWeekCommitments'] = [];

  for (const domain of domains) {
    const spec = TEMPLATES[domain];
    const days = daysByDomain.get(domain) ?? [];

    // The share of the day this domain may take on its BUSIEST day, so the
    // total on every day stays inside what the user said they have.
    const share =
      answers.weekdayMinutes == null
        ? null
        : Math.floor(answers.weekdayMinutes / Math.max(...days.map((d) => load.get(d) ?? 1), 1));

    // The health baseline is the one answer that changes a template.
    const requested =
      domain === 'HEALTH' && answers.healthBaseline
        ? answers.healthBaseline.minutesPerSession
        : spec.idealMinutes;

    const idealMinutes = clampMinutes(requested, share, spec.minimumMinutes);

    outcomes.push({
      domain,
      title: spec.outcomeTitle,
      whyItMatters: spec.whyItMatters,
      successDefinition: spec.successDefinition,
    });

    routines.push({
      domain,
      title: spec.routineTitle,
      triggerType: 'WEEKDAYS',
      triggerValue: spec.triggerValue,
      frequency: `${days.length}x per week`,
      idealMinutes,
      minimumMinutes: Math.min(spec.minimumMinutes, idealMinutes),
      fallbackBehavior: spec.fallbackBehavior,
    });

    for (const day of days) {
      commitments.push({
        domain,
        title: spec.routineTitle,
        scheduledStart: localTimeToInstant(day, TEMPLATE_TIMES[domain], timezone).toISOString(),
        durationMinutes: idealMinutes,
        fullVersion: spec.fullVersion,
        shortVersion: spec.shortVersion,
        minimumVersion: spec.minimumVersion,
      });
    }
  }

  return {
    bestSelf: {
      identityStatement: domains.map((d) => TEMPLATE_IDENTITY[d]).join(' '),
      workIdentity: domains.includes('WORK') ? TEMPLATES.WORK.identity : null,
      familyIdentity: domains.includes('FAMILY') ? TEMPLATES.FAMILY.identity : null,
      healthIdentity: domains.includes('HEALTH') ? TEMPLATES.HEALTH.identity : null,
      sixMonthVision: (answers.sixMonthVision ?? '').slice(0, 1000),
    },
    outcomes,
    routines,
    firstWeekCommitments: commitments,
    rationale: TEMPLATE_RATIONALE,
    reducedFromRequest: false,
  };
}

/**
 * The smaller version of a proposal, for a confidence answer of 1 or 2
 * (PRD §72).
 *
 * DROP THE HEAVIEST ROUTINE, then halve what is left with a floor of ten
 * minutes. Dropping the heaviest rather than the last one is the difference
 * between "smaller" and "shorter": the user said the week is hard, and the
 * honest answer is one fewer thing, not the same three things rushed.
 *
 * The last routine is never dropped — a plan with nothing in it is not a
 * reduced plan, and the schema requires at least one commitment.
 */
export function reduceTemplate(proposal: OnboardingProposal): OnboardingProposal {
  const dropped = proposal.routines.length > 1 ? heaviestRoutine(proposal) : null;

  const routines = proposal.routines.filter((r) => r.title !== dropped);

  const commitments = proposal.firstWeekCommitments
    .filter((c) => dropped == null || c.title !== dropped)
    .map((c) => ({ ...c, durationMinutes: Math.max(10, Math.floor(c.durationMinutes / 2)) }));

  return {
    ...proposal,
    routines: routines.map((r) => ({
      ...r,
      idealMinutes: Math.max(r.minimumMinutes, Math.max(10, Math.floor(r.idealMinutes / 2))),
    })),
    // A proposal whose every commitment belonged to the dropped routine would
    // fail the schema's `min(1)`; keeping the originals halved is the honest
    // fallback and cannot happen for a template, which always pairs them.
    firstWeekCommitments: commitments.length > 0 ? commitments : proposal.firstWeekCommitments,
    // OUTCOMES SURVIVE. The user still wants to be present at dinner; what
    // shrank is what they committed to doing about it this week. Dropping the
    // outcome as well would read as "we decided that area does not matter".
    reducedFromRequest: true,
  };
}

/** The routine costing the most minutes a week. Ties go to the first. */
function heaviestRoutine(proposal: OnboardingProposal): string {
  let title = proposal.routines[0].title;
  let worst = -1;

  for (const routine of proposal.routines) {
    const sessions = proposal.firstWeekCommitments.filter((c) => c.title === routine.title).length;
    const cost = routine.idealMinutes * Math.max(sessions, 1);

    if (cost > worst) {
      worst = cost;
      title = routine.title;
    }
  }

  return title;
}

/**
 * The next `count` local dates falling on one of `weekdays`, starting today.
 *
 * BOUNDED BY THE FIRST-WEEK WINDOW. Filling a shortfall from the following week
 * would produce a commitment the guardrails then reject as outside the first
 * week — an offer of three sessions the user cannot approve is worse than an
 * honest two.
 */
function nextOccurrences(today: string, weekdays: number[], count: number): string[] {
  const wanted = new Set(weekdays);
  const days: string[] = [];

  // Seven days, starting today: "the next week" includes this evening's dinner.
  for (let offset = 0; offset < 7 && days.length < count; offset += 1) {
    const day = addDays(today, offset);
    if (wanted.has(weekdayOf(day))) days.push(day);
  }

  return days;
}

/**
 * Never longer than this domain's share of a day, never under the floor.
 *
 * The floor wins a conflict: a user with fifteen minutes and three areas gets a
 * plan that slightly overruns rather than a five-minute strength session, and
 * the guardrails then tell them so in words they can act on.
 */
function clampMinutes(minutes: number, share: number | null, floor: number): number {
  if (share == null) return minutes;
  return Math.max(floor, Math.min(minutes, share));
}

function dedupe(domains: ProposalDomain[]): ProposalDomain[] {
  return [...new Set(domains)];
}
