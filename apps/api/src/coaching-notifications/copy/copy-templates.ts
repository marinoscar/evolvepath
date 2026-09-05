// =============================================================================
// Deterministic coaching copy (issue #54, epic E12)
// =============================================================================
//
// The words a user sees when the copywriter is not available — no key, provider
// down, a response that fails validation. PRD §120 again: the deterministic path
// keeps working, and here that means the notification still says something
// specific and useful rather than "Upcoming commitment".
//
// THESE ARE THE BASELINE, NOT A DEGRADED MODE. E12-03's copywriter is handed
// these as the thing to improve on, and `copy-templates.spec.ts` holds them to
// the same rules the AI output is held to: within the length caps, and free of
// the PRD §129 vocabulary. A template that shamed the user would be worse than
// no notification, and it would ship every time the provider blinked.
//
// TONE, IN ONE RULE: state the fact and offer the smaller thing. Never invoke a
// promise the user made, never count what they have missed, never imply a
// relationship with the app.

import {
  COPY_BODY_MAX,
  COPY_TITLE_MAX,
  type CoachingCopy,
  type CoachingEvidencePayload,
  type CoachingEventKey,
  type CoachingFallbackPayload,
  type CoachingFamilyPresencePayload,
  type CoachingPlanIssuePayload,
  type CoachingRecoveryPayload,
  type CoachingRescuePayload,
  type CoachingStartCuePayload,
  type CoachingUpcomingPayload,
  type CoachingWeeklyReviewPayload,
} from '../coaching-events';

const DOMAIN_LABEL: Record<string, string> = {
  WORK: 'Work',
  FAMILY: 'Family',
  HEALTH: 'Health',
};

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function fit(copy: CoachingCopy): CoachingCopy {
  return {
    title: truncate(copy.title, COPY_TITLE_MAX),
    body: truncate(copy.body, COPY_BODY_MAX),
    actionLabel: copy.actionLabel,
  };
}

/**
 * "3rd", "5th", "21st". Written out rather than pulled in, because the only
 * consumer is one line of one template and an Intl.PluralRules dance costs more
 * to read than the four cases it replaces.
 */
export function ordinal(value: number): string {
  const rem100 = value % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${value}th`;
  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

export type CopyTemplate = (payload: never) => CoachingCopy;

export const DEFAULT_COPY: Record<CoachingEventKey, CopyTemplate> = {
  'coach.commitment_upcoming': (data: never): CoachingCopy => {
    const p = data as CoachingUpcomingPayload;
    return fit({
      title: `${p.commitmentTitle} starts in ${p.minutesUntil} minutes`,
      body: `${p.startMinutes} min · ${DOMAIN_LABEL[p.domain] ?? p.domain}. Everything is ready when you are.`,
      actionLabel: p.domain === 'HEALTH' ? 'Start workout' : `Start ${p.startMinutes} min`,
    });
  },

  'coach.start_cue': (data: never): CoachingCopy => {
    const p = data as CoachingStartCuePayload;
    return fit({
      title: `${p.commitmentTitle} is ready to start`,
      // The first step, when the coach has one, beats the duration every time:
      // the barrier at the moment of starting is not "how long" but "what do I
      // actually do first".
      body: p.firstStep
        ? `First step: ${p.firstStep}`
        : `${p.startMinutes} minutes. Tap to begin.`,
      actionLabel: p.domain === 'HEALTH' ? 'Start workout' : `Start ${p.startMinutes} min`,
    });
  },

  'coach.rescue': (data: never): CoachingCopy => {
    const p = data as CoachingRescuePayload;
    return fit({
      // States the count as a fact about the commitment, not about the person.
      // "You have moved this 3 times" is the same number and a different message.
      title: `This has moved ${p.rescheduleCount} times`,
      body: `Forget finishing it — give it ${p.minimumMinutes} minutes to start.`,
      actionLabel: `Start ${p.minimumMinutes} min`,
    });
  },

  'coach.fallback_offer': (data: never): CoachingCopy => {
    const p = data as CoachingFallbackPayload;
    return fit({
      title: `${p.fullMinutes} minutes won't fit today`,
      body: `The ${p.shortMinutes}-minute version will. Keep the promise?`,
      actionLabel: 'Use short version',
    });
  },

  'coach.family_presence': (data: never): CoachingCopy => {
    const p = data as CoachingFamilyPresencePayload;
    return fit({
      title: `${p.commitmentTitle} starts in ${p.minutesUntil} minutes`,
      // The user's own words about why it matters, quoted back. Nothing the app
      // could write about somebody's family is better than what they wrote.
      body: p.purpose ? `You said this matters: ${p.purpose}` : 'Phone down, people first.',
      actionLabel: "I'm in",
    });
  },

  'coach.recovery': (data: never): CoachingCopy => {
    void (data as CoachingRecoveryPayload);
    return fit({
      // PRD §108: comeback copy without shame. The days away are deliberately
      // NOT in the copy even though the payload carries them — a number is a
      // tally, and a tally is the thing that makes people close the app.
      title: 'No catching up',
      body: 'One useful action today is enough to restart.',
      actionLabel: 'Open',
    });
  },

  'coach.evidence': (data: never): CoachingCopy => {
    const p = data as CoachingEvidencePayload;
    return fit({
      title: `${ordinal(p.count)} ${p.outcomeTitle} session in ${p.windowDays} days`,
      body: 'This is becoming a pattern.',
      actionLabel: 'See progress',
    });
  },

  'coach.weekly_review_ready': (data: never): CoachingCopy => {
    void (data as CoachingWeeklyReviewPayload);
    return fit({
      title: 'Your week is ready to review',
      body: 'Planned versus actual, and what to change next week.',
      actionLabel: 'Review the week',
    });
  },

  'coach.plan_issue': (data: never): CoachingCopy => {
    const p = data as CoachingPlanIssuePayload;
    return fit({
      title: truncate(p.summary, COPY_TITLE_MAX),
      body: 'The current schedule keeps failing. Review the proposal.',
      actionLabel: 'Review',
    });
  },
};

export function defaultCopyFor(key: CoachingEventKey, payload: unknown): CoachingCopy {
  return DEFAULT_COPY[key](payload as never);
}
