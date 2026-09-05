// =============================================================================
// The decision: may the coach interrupt, right now? (issue #59, epic E12)
// =============================================================================
//
// VISION §35, stated as a function: "A deterministic policy layer should
// determine whether sending is appropriate. The AI may personalize the wording."
//
// THIS FILE IS THE POLICY LAYER, AND IT IS PURE. No Nest, no Prisma, no
// `Date.now()`, no I/O — `now` is an argument. Three things follow from that,
// and all three are the reason it is written this way:
//
//   1. It is exhaustively testable. Every `NotificationSuppressReason` has a
//      case that produces it and one that does not, which is the only way to
//      have any confidence in a rule that is invisible when it works.
//   2. It is reproducible. Two calls with the same inputs give the same answer,
//      so "why did I get this at 6am?" has an answer that can be reconstructed
//      from the interaction row.
//   3. THE MODEL CANNOT REACH IT. PRD §14.7: the copywriter "does not decide
//      whether notification limits may be violated". Keeping the decision in a
//      pure function that the copywriter is called AFTER — and never before —
//      makes that structural rather than a prompt instruction.
//
// -----------------------------------------------------------------------------
// WHY THE CHECKS ARE ORDERED, AND WHY THIS ORDER
// -----------------------------------------------------------------------------
//
// The first failing check is the recorded reason, so the order decides what the
// metrics say. It runs from "this user does not want this" through "this
// message is pointless" to "this message is one too many":
//
//   MUTED               the user said no. Nothing below can override consent.
//   DOMAIN_PAUSED       the user said no to a whole area of their life.
//   ALREADY_DONE        the thing already happened; the message is stale.
//   SKIPPED             they answered this exact question today already.
//   PER_COMMITMENT_MAX  this one thing has had enough of our attention.
//   QUIET_HOURS         right moment, wrong hour.
//   WEEKLY_CAP          budget, over a week.
//   FATIGUE/DAILY_CAP   budget, today.
//
// The alternative — report every reason that applies — was rejected: a metric
// that says "we suppressed 400 messages for quiet hours" is only useful if
// those 400 would otherwise have been sent, and a muted user's messages would
// not have been. One reason per decision keeps the numbers meaningful.

import type {
  CommitmentStatus,
  DomainModeKind,
  NotificationSuppressReason,
} from '@prisma/client';

import type { NotificationChannel } from '../../notifications/notification-events';
import type { CoachingCategory, CoachingEventKey } from '../coaching-events';
import { assessFatigue, type FatigueAssessment } from './fatigue';
import type { ResolvedNotificationPolicy } from './notification-policy.schema';
import { isQuietNow } from './quiet-hours';

/** The commitment facts the decision needs — not the row, just these. */
export interface PolicyCommitment {
  id: string;
  domain: 'WORK' | 'FAMILY' | 'HEALTH';
  status: CommitmentStatus;
  scheduledStart: Date;
  /** Skipped, and skipped TODAY. PRD §61's "no repeat after an explicit skip". */
  skippedToday: boolean;
}

export interface PolicyCandidate {
  eventKey: CoachingEventKey;
  category: CoachingCategory;
  dueAt: Date;
  commitment?: PolicyCommitment;
}

export interface PolicyHistory {
  sentToday: number;
  sentThisWeek: number;
  sentForCommitment: number;
  consecutiveIgnored: number;
  lastActionedAt: Date | null;
}

export interface PolicyInput {
  now: Date;
  candidate: PolicyCandidate;
  policy: ResolvedNotificationPolicy;
  /**
   * Channels that are BOTH enabled by the user and able to reach them. The
   * orchestrator subtracts push without a subscription and email without a
   * configured transport, so an empty array means "there is nowhere to send
   * this", and `MUTED` is accurate rather than "sent to nowhere".
   */
  enabledChannels: NotificationChannel[];
  domainMode: DomainModeKind | null;
}

export type PolicyDecision =
  | { send: true; category: CoachingCategory; scheduledFor: Date; effectiveDailyCap: number }
  | {
      send: false;
      category: CoachingCategory;
      scheduledFor: Date;
      reason: NotificationSuppressReason;
      effectiveDailyCap: number;
    };

/** Statuses in which the thing the message is about has already happened. */
const TERMINAL_DONE: readonly CommitmentStatus[] = [
  'COMPLETED',
  'PARTIALLY_COMPLETED',
  'CANCELLED',
  'MISSED',
];

/**
 * The two categories that must survive a paused domain.
 *
 * N6 (recovery) IS the path out of a pause — suppressing it would mean a user
 * who paused everything can never be offered a way back. N8 (weekly review) is
 * a whole-life artefact with no domain to pause.
 */
const DOMAIN_EXEMPT: readonly CoachingEventKey[] = [
  'coach.recovery',
  'coach.weekly_review_ready',
];

export function decide(input: PolicyInput & { history: PolicyHistory }): PolicyDecision {
  const { now, candidate, policy, enabledChannels, domainMode, history } = input;
  const fatigue = assessFatigue(history.consecutiveIgnored, policy.dailyCap);

  const no = (reason: NotificationSuppressReason): PolicyDecision => ({
    send: false,
    category: candidate.category,
    scheduledFor: candidate.dueAt,
    reason,
    effectiveDailyCap: fatigue.effectiveDailyCap,
  });

  // 1. Consent. Nothing below may override it.
  if (enabledChannels.length === 0) return no('MUTED');
  if (policy.mutedCategories.includes(candidate.eventKey)) return no('MUTED');

  // 2. A paused domain is consent at a coarser grain (PRD §61).
  if (
    candidate.commitment &&
    domainMode === 'PAUSE' &&
    !DOMAIN_EXEMPT.includes(candidate.eventKey)
  ) {
    return no('DOMAIN_PAUSED');
  }

  if (candidate.commitment) {
    // 3. The thing already happened, or is never going to. A reminder about it
    //    is not merely unnecessary, it is wrong.
    if (TERMINAL_DONE.includes(candidate.commitment.status)) return no('ALREADY_DONE');

    // 4. They already answered this question today. PRD §61 is explicit that a
    //    skip is an answer, not a postponement — asking again is the single
    //    most reliable way to make somebody mute an app.
    if (candidate.commitment.skippedToday) return no('SKIPPED');

    // 5. One commitment may not monopolise the day's budget.
    if (history.sentForCommitment >= policy.perCommitmentMax) {
      return no('PER_COMMITMENT_MAX');
    }
  }

  // 6. Right moment, wrong hour — evaluated in the USER'S zone.
  if (isQuietNow(now, policy.timezone, policy.quietHours)) return no('QUIET_HOURS');

  // 7-8. Budget. The week first, because a user who is over for the week is
  //      over regardless of what today looks like.
  if (history.sentThisWeek >= policy.weeklyCap) return no('WEEKLY_CAP');

  if (history.sentToday >= fatigue.effectiveDailyCap) {
    // Which reason gets recorded matters for the metrics: FATIGUE means "the
    // user's own cap would have allowed this, our reduction did not", which is
    // the number E12-06 needs to answer "is the reduction working or is it just
    // hiding the coach?". A configured cap of 0 is always DAILY_CAP — the user
    // asked for silence, and attributing that to fatigue would be a lie.
    const reducedBelowConfigured =
      fatigue.active && history.sentToday < policy.dailyCap;
    return no(reducedBelowConfigured ? 'FATIGUE' : 'DAILY_CAP');
  }

  return {
    send: true,
    category: candidate.category,
    scheduledFor: candidate.dueAt,
    effectiveDailyCap: fatigue.effectiveDailyCap,
  };
}

export { assessFatigue, type FatigueAssessment };
