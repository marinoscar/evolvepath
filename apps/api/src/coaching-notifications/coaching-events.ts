// =============================================================================
// The nine coaching categories, N1–N9 (issue #54, epic E12)
// =============================================================================
//
// PRD §60 fixes nine categories. This file does NOT declare them a second time:
// `notification-events.ts` remains the one registry, and everything here is
// DERIVED from it — the key tuple, the category letters, and the payload each
// event's templates and actions read.
//
// The two-file split exists because the registry answers a question every event
// in the application shares ("what exists, over what channels, on by default?")
// while payload shapes are specific to coaching and would be dead weight in the
// registry for `user.welcome`. `coaching-events.spec.ts` asserts the two agree
// in BOTH directions, so neither can grow an entry the other has not heard of.
//
// WHY EVERY PAYLOAD CARRIES `sentInteractionId`.
//
// The SENT row (E12-01) is minted BEFORE dispatch, and its id travels through
// the payload into the deep link as `?n=`. That is the whole attribution chain:
// without it, a click on a notification is a page view with no way back to the
// decision that produced it, and PRD §64's "which messages are acted on" is
// unanswerable. It is deliberately not optional.
//
// WHY `copy` IS OPTIONAL AND SEPARATE.
//
// PRD §14.7 and §62: the copywriter personalises WORDING, after the policy has
// already said yes, and never decides whether to send. Modelling AI copy as an
// optional overlay on a payload that is complete without it is what makes that
// structural — a provider outage produces template copy, not a missing message.

import { z } from 'zod';

import { findEvent } from '../notifications/notification-events';

export const COACHING_EVENT_KEYS = [
  'coach.commitment_upcoming',
  'coach.start_cue',
  'coach.rescue',
  'coach.fallback_offer',
  'coach.family_presence',
  'coach.recovery',
  'coach.evidence',
  'coach.weekly_review_ready',
  'coach.plan_issue',
] as const;

export type CoachingEventKey = (typeof COACHING_EVENT_KEYS)[number];

export type CoachingCategory =
  | 'N1'
  | 'N2'
  | 'N3'
  | 'N4'
  | 'N5'
  | 'N6'
  | 'N7'
  | 'N8'
  | 'N9';

/**
 * The PRD's own numbering, kept as data rather than as a comment. It lands in
 * `notification_interactions.meta.category`, which is how E12-06 groups the
 * metrics by the categories the PRD talks about rather than by key strings.
 */
export const COACHING_CATEGORY: Record<CoachingEventKey, CoachingCategory> = {
  'coach.commitment_upcoming': 'N1',
  'coach.start_cue': 'N2',
  'coach.rescue': 'N3',
  'coach.fallback_offer': 'N4',
  'coach.family_presence': 'N5',
  'coach.recovery': 'N6',
  'coach.evidence': 'N7',
  'coach.weekly_review_ready': 'N8',
  'coach.plan_issue': 'N9',
};

const KEY_SET: ReadonlySet<string> = new Set(COACHING_EVENT_KEYS);

export function isCoachingEvent(key: string): key is CoachingEventKey {
  return KEY_SET.has(key);
}

export function categoryFor(key: string): CoachingCategory | null {
  return isCoachingEvent(key) ? COACHING_CATEGORY[key] : null;
}

export function coachingEventDefs() {
  return COACHING_EVENT_KEYS.map((key) => findEvent(key)).filter(
    (event): event is NonNullable<typeof event> => event !== undefined,
  );
}

// -----------------------------------------------------------------------------
// Copy overlay
// -----------------------------------------------------------------------------

/**
 * The caps are not stylistic. A browser notification title is elided by the OS
 * at roughly this length and a body at roughly that one, so copy longer than
 * this is not "a bit verbose" — it is copy the user never reads the end of. The
 * caps are enforced here so an AI response that overruns fails validation and
 * the deterministic template is used, rather than shipping a truncated sentence.
 */
export const COPY_TITLE_MAX = 60;
export const COPY_BODY_MAX = 140;
export const COPY_ACTION_LABEL_MAX = 20;

export const coachingCopySchema = z.object({
  title: z.string().min(1).max(COPY_TITLE_MAX),
  body: z.string().min(1).max(COPY_BODY_MAX),
  actionLabel: z.string().min(1).max(COPY_ACTION_LABEL_MAX),
});

export type CoachingCopy = z.infer<typeof coachingCopySchema>;

const base = z.object({
  sentInteractionId: z.uuid(),
  copy: coachingCopySchema.optional(),
});

const domain = z.enum(['WORK', 'FAMILY', 'HEALTH']);

// -----------------------------------------------------------------------------
// Payloads, one per category
// -----------------------------------------------------------------------------

export const upcomingPayloadSchema = base.extend({
  commitmentId: z.uuid(),
  domain,
  commitmentTitle: z.string().min(1),
  scheduledStart: z.iso.datetime(),
  minutesUntil: z.number().int().min(0),
  /** Minutes of the version the Start button offers — not always the full one. */
  startMinutes: z.number().int().min(1),
});
export type CoachingUpcomingPayload = z.infer<typeof upcomingPayloadSchema>;

export const startCuePayloadSchema = base.extend({
  commitmentId: z.uuid(),
  domain,
  commitmentTitle: z.string().min(1),
  startMinutes: z.number().int().min(1),
  /** E05-02's `steps[0].title`, when the coach has decomposed the commitment. */
  firstStep: z.string().min(1).optional(),
});
export type CoachingStartCuePayload = z.infer<typeof startCuePayloadSchema>;

export const rescuePayloadSchema = base.extend({
  commitmentId: z.uuid(),
  domain,
  commitmentTitle: z.string().min(1),
  rescheduleCount: z.number().int().min(0),
  /** E07-03's avoidance level, 0–6. Carried for the metrics, not for the copy. */
  level: z.number().int().min(0).max(6),
  minimumMinutes: z.number().int().min(1),
});
export type CoachingRescuePayload = z.infer<typeof rescuePayloadSchema>;

export const fallbackPayloadSchema = base.extend({
  commitmentId: z.uuid(),
  domain,
  commitmentTitle: z.string().min(1),
  fullMinutes: z.number().int().min(1),
  shortMinutes: z.number().int().min(1),
  remainingMinutes: z.number().int().min(0),
});
export type CoachingFallbackPayload = z.infer<typeof fallbackPayloadSchema>;

export const familyPresencePayloadSchema = base.extend({
  commitmentId: z.uuid(),
  commitmentTitle: z.string().min(1),
  minutesUntil: z.number().int().min(0),
  /** The ritual's own words about why it matters (E08-01). */
  purpose: z.string().min(1).optional(),
  /**
   * The nickname, and NOTHING else about the person. PRD §33 fixes the family
   * record at five fields and VISION §50 says why; a notification payload is
   * exactly the kind of place a sixth would quietly appear.
   */
  familyNickname: z.string().min(1).optional(),
});
export type CoachingFamilyPresencePayload = z.infer<
  typeof familyPresencePayloadSchema
>;

export const recoveryPayloadSchema = base.extend({
  comebackId: z.uuid(),
  daysAway: z.number().int().min(1),
  restartCommitmentId: z.uuid().optional(),
});
export type CoachingRecoveryPayload = z.infer<typeof recoveryPayloadSchema>;

export const EVIDENCE_MILESTONES = [
  'THIRD_IN_8_DAYS',
  'FIFTH_IN_14_DAYS',
  'TENTH_TOTAL',
  'FIRST_FULL_WEEK',
] as const;
export type EvidenceMilestone = (typeof EVIDENCE_MILESTONES)[number];

export const evidencePayloadSchema = base.extend({
  commitmentId: z.uuid(),
  domain,
  outcomeTitle: z.string().min(1),
  count: z.number().int().min(1),
  windowDays: z.number().int().min(1),
  milestone: z.enum(EVIDENCE_MILESTONES),
});
export type CoachingEvidencePayload = z.infer<typeof evidencePayloadSchema>;

export const weeklyReviewPayloadSchema = base.extend({
  reviewId: z.uuid(),
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Absolute application URL, for the email CTA only. */
  appUrl: z.string().optional(),
});
export type CoachingWeeklyReviewPayload = z.infer<
  typeof weeklyReviewPayloadSchema
>;

export const planIssuePayloadSchema = base.extend({
  proposalId: z.uuid(),
  planId: z.uuid(),
  summary: z.string().min(1),
  sourceKind: z.enum(['COACH', 'WEEKLY_REVIEW', 'WORKOUT', 'PATTERN']),
});
export type CoachingPlanIssuePayload = z.infer<typeof planIssuePayloadSchema>;

export const COACHING_PAYLOAD_SCHEMAS = {
  'coach.commitment_upcoming': upcomingPayloadSchema,
  'coach.start_cue': startCuePayloadSchema,
  'coach.rescue': rescuePayloadSchema,
  'coach.fallback_offer': fallbackPayloadSchema,
  'coach.family_presence': familyPresencePayloadSchema,
  'coach.recovery': recoveryPayloadSchema,
  'coach.evidence': evidencePayloadSchema,
  'coach.weekly_review_ready': weeklyReviewPayloadSchema,
  'coach.plan_issue': planIssuePayloadSchema,
} as const satisfies Record<CoachingEventKey, z.ZodTypeAny>;

export type CoachingPayloadFor<K extends CoachingEventKey> = z.infer<
  (typeof COACHING_PAYLOAD_SCHEMAS)[K]
>;

export type CoachingPayload = {
  [K in CoachingEventKey]: CoachingPayloadFor<K>;
}[CoachingEventKey];
