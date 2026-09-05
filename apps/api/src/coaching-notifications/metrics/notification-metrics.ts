// =============================================================================
// What the coach learns about itself (issue #69, epic E12)
// =============================================================================
//
// PRD §64 asks the system to learn which messages are acted on, which timing
// works and which categories are ignored. PRD §65 defines the independence
// metric. VISION §38 says what it is all FOR: "You needed nine workout reminders
// in your first month. This month you needed two."
//
// That sentence is the point of this file, and it is a strange thing for a
// product to want — every other metric in a notification system measures
// engagement, and this one measures its own decline. A coach that is working
// needs to say less over time, so the numbers here are read in the direction of
// "can we stop?", not "how do we get more clicks?".
//
// PURE, with no Prisma types anywhere in it. The service maps rows in; this file
// does arithmetic. That is what makes every rule below a unit test with a
// fixture rather than a database and a clock.

import { NOTIFICATION_EVENTS } from '../../notifications/notification-events';
import {
  categoryFor,
  COACHING_EVENT_KEYS,
  type CoachingCategory,
  type CoachingEventKey,
} from '../coaching-events';

export type SuppressReason =
  | 'QUIET_HOURS'
  | 'DAILY_CAP'
  | 'WEEKLY_CAP'
  | 'PER_COMMITMENT_MAX'
  | 'SKIPPED'
  | 'MUTED'
  | 'DOMAIN_PAUSED'
  | 'FATIGUE'
  | 'ALREADY_DONE';

export interface InteractionRow {
  id: string;
  eventKey: string;
  kind: 'SENT' | 'OPENED' | 'ACTIONED' | 'DISMISSED' | 'SUPPRESSED';
  commitmentId: string | null;
  sentInteractionId: string | null;
  action: string | null;
  suppressReason: SuppressReason | null;
  createdAt: Date;
  meta: { leadMinutes?: number; category?: string } | null;
}

export interface CompletionRow {
  commitmentId: string;
  domain: 'WORK' | 'FAMILY' | 'HEALTH';
  completedAt: Date;
}

/**
 * The lead times the engine actually produces, as buckets.
 *
 * Bucketed rather than averaged because the question is "which lead time works
 * best?", and a mean over a bimodal distribution answers a question nobody
 * asked. The boundaries match the candidate windows in the scanner.
 */
export const LEAD_BUCKETS = [5, 10, 20, 30] as const;

/** How many sends a bucket needs before its action rate means anything. */
export const MIN_BUCKET_SENDS = 3;

export interface PerEventMetrics {
  eventKey: string;
  category: CoachingCategory | null;
  sent: number;
  opened: number;
  actioned: number;
  dismissed: number;
  /** Sent, and answered by nothing. Never negative. */
  ignored: number;
  suppressed: Record<SuppressReason, number>;
  /** `actioned / sent`, or `null` when nothing was sent. */
  actionRate: number | null;
  /** The lead bucket with the best action rate, or `null`. */
  bestLeadMinutes: number | null;
}

export interface IndependenceMetrics {
  completions: number;
  unprompted: number;
  /** `unprompted / completions`, or `null` when there were no completions. */
  ratio: number | null;
}

export interface ReminderTrendPoint {
  /** `YYYY-MM`, in the user's own timezone. */
  month: string;
  domain: 'WORK' | 'FAMILY' | 'HEALTH';
  sent: number;
  completions: number;
}

export interface NotificationMetrics {
  window: { from: string; to: string; days: number };
  perEvent: PerEventMetrics[];
  independence: IndependenceMetrics;
  reminderTrend: ReminderTrendPoint[];
  insights: string[];
}

const SUPPRESS_REASONS: SuppressReason[] = [
  'QUIET_HOURS',
  'DAILY_CAP',
  'WEEKLY_CAP',
  'PER_COMMITMENT_MAX',
  'SKIPPED',
  'MUTED',
  'DOMAIN_PAUSED',
  'FATIGUE',
  'ALREADY_DONE',
];

const DOMAIN_LABEL: Record<string, string> = {
  WORK: 'Work',
  FAMILY: 'Family',
  HEALTH: 'Health',
};

function emptySuppressed(): Record<SuppressReason, number> {
  return Object.fromEntries(SUPPRESS_REASONS.map((r) => [r, 0])) as Record<
    SuppressReason,
    number
  >;
}

/** `YYYY-MM` in the user's zone. A UTC month would be wrong at both edges. */
export function localMonth(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}`;
}

export interface AggregateInput {
  interactions: InteractionRow[];
  completions: CompletionRow[];
  timeZone: string;
  window: { from: Date; to: Date };
}

export function aggregateNotificationMetrics(input: AggregateInput): NotificationMetrics {
  const { interactions, completions, timeZone, window } = input;

  const days = Math.max(
    1,
    Math.round((window.to.getTime() - window.from.getTime()) / (24 * 3600_000)),
  );

  const perEvent = aggregatePerEvent(interactions);
  const independenceMetrics = independenceFrom(interactions, completions);
  const reminderTrend = trendFrom(interactions, completions, timeZone);

  return {
    window: { from: window.from.toISOString(), to: window.to.toISOString(), days },
    perEvent,
    independence: independenceMetrics,
    reminderTrend,
    insights: insightsFrom(perEvent, reminderTrend),
  };
}

// -----------------------------------------------------------------------------
// Per event
// -----------------------------------------------------------------------------

function aggregatePerEvent(interactions: InteractionRow[]): PerEventMetrics[] {
  // Registry order, and every coaching event present even at zero. A metrics
  // response whose shape depends on what happened is one a client has to guard
  // every field of, and a category that vanished because nothing fired is
  // indistinguishable from one that was removed.
  const order = NOTIFICATION_EVENTS.map((event) => event.key).filter((key) =>
    (COACHING_EVENT_KEYS as readonly string[]).includes(key),
  ) as CoachingEventKey[];

  const sentById = new Map<string, InteractionRow>();
  for (const row of interactions) {
    if (row.kind === 'SENT') sentById.set(row.id, row);
  }

  return order.map((eventKey) => {
    const rows = interactions.filter((row) => row.eventKey === eventKey);
    const sent = rows.filter((row) => row.kind === 'SENT');
    const opened = rows.filter((row) => row.kind === 'OPENED');
    const actioned = rows.filter((row) => row.kind === 'ACTIONED');
    const dismissed = rows.filter((row) => row.kind === 'DISMISSED');

    const suppressed = emptySuppressed();
    for (const row of rows) {
      if (row.kind === 'SUPPRESSED' && row.suppressReason) {
        suppressed[row.suppressReason] += 1;
      }
    }

    return {
      eventKey,
      category: categoryFor(eventKey),
      sent: sent.length,
      opened: opened.length,
      actioned: actioned.length,
      dismissed: dismissed.length,
      // Floored at zero: a response can outlive the window its send fell
      // outside of, and a negative "ignored" would be a nonsense number rather
      // than a signal.
      ignored: Math.max(0, sent.length - opened.length - actioned.length - dismissed.length),
      suppressed,
      actionRate: sent.length === 0 ? null : actioned.length / sent.length,
      bestLeadMinutes: bestLead(sent, actioned, sentById),
    };
  });
}

/**
 * The lead bucket with the best action rate, among those with enough sends.
 *
 * The threshold is what makes this a finding rather than a coincidence: one
 * send that happened to be acted on is a 100% action rate, and reporting it as
 * "reminders 30 minutes ahead work best" would be worse than saying nothing.
 */
function bestLead(
  sent: InteractionRow[],
  actioned: InteractionRow[],
  sentById: Map<string, InteractionRow>,
): number | null {
  const actionedSendIds = new Set(
    actioned
      .map((row) => row.sentInteractionId)
      .filter((id): id is string => typeof id === 'string'),
  );

  let best: { bucket: number; rate: number } | null = null;

  for (const bucket of LEAD_BUCKETS) {
    const inBucket = sent.filter((row) => bucketFor(row.meta?.leadMinutes) === bucket);
    if (inBucket.length < MIN_BUCKET_SENDS) continue;

    const hits = inBucket.filter(
      (row) => actionedSendIds.has(row.id) && sentById.has(row.id),
    ).length;
    const rate = hits / inBucket.length;

    if (!best || rate > best.rate) best = { bucket, rate };
  }

  // A bucket everyone ignored is not a recommendation.
  return best && best.rate > 0 ? best.bucket : null;
}

/** The nearest bucket at or below the lead time, or `null` for an absent one. */
export function bucketFor(leadMinutes: number | undefined): number | null {
  if (typeof leadMinutes !== 'number' || !Number.isFinite(leadMinutes)) return null;

  let chosen: number | null = null;
  for (const bucket of LEAD_BUCKETS) {
    if (leadMinutes >= bucket) chosen = bucket;
  }
  return chosen;
}

// -----------------------------------------------------------------------------
// Independence — PRD §65
// -----------------------------------------------------------------------------

/**
 * "Completed before any reminder was required."
 *
 * The definition turns on ONE comparison: was there a `SENT` for this commitment
 * BEFORE it was completed? A send afterwards does not count — a celebration
 * (N7) fires after a completion by construction, and counting it would make
 * every celebrated success look prompted, driving the metric down exactly when
 * the user is doing best.
 *
 * A commitment with no interactions at all is unprompted, which is the common
 * and desirable case.
 */
export function independenceFrom(
  interactions: InteractionRow[],
  completions: CompletionRow[],
): IndependenceMetrics {
  const sendsByCommitment = new Map<string, Date[]>();
  for (const row of interactions) {
    if (row.kind !== 'SENT' || !row.commitmentId) continue;
    const list = sendsByCommitment.get(row.commitmentId) ?? [];
    list.push(row.createdAt);
    sendsByCommitment.set(row.commitmentId, list);
  }

  const unprompted = completions.filter((completion) => {
    const sends = sendsByCommitment.get(completion.commitmentId) ?? [];
    return !sends.some((at) => at.getTime() < completion.completedAt.getTime());
  }).length;

  return {
    completions: completions.length,
    unprompted,
    ratio: completions.length === 0 ? null : unprompted / completions.length,
  };
}

// -----------------------------------------------------------------------------
// The trend, and the sentences drawn from it
// -----------------------------------------------------------------------------

function trendFrom(
  interactions: InteractionRow[],
  completions: CompletionRow[],
  timeZone: string,
): ReminderTrendPoint[] {
  const domainOf = new Map<string, CompletionRow['domain']>();
  for (const completion of completions) domainOf.set(completion.commitmentId, completion.domain);

  const points = new Map<string, ReminderTrendPoint>();
  const touch = (month: string, domain: CompletionRow['domain']) => {
    const key = `${month}|${domain}`;
    let point = points.get(key);
    if (!point) {
      point = { month, domain, sent: 0, completions: 0 };
      points.set(key, point);
    }
    return point;
  };

  for (const row of interactions) {
    if (row.kind !== 'SENT' || !row.commitmentId) continue;
    const domain = domainOf.get(row.commitmentId);
    // A send for a commitment that was never completed has no domain to file it
    // under, and guessing one would put reminders in a column the user's own
    // history does not support.
    if (!domain) continue;
    touch(localMonth(row.createdAt, timeZone), domain).sent += 1;
  }

  for (const completion of completions) {
    touch(localMonth(completion.completedAt, timeZone), completion.domain).completions += 1;
  }

  return [...points.values()].sort(
    (a, b) => a.month.localeCompare(b.month) || a.domain.localeCompare(b.domain),
  );
}

/**
 * At most three sentences, all deterministic, none about the person.
 *
 * TEMPLATE-ONLY on purpose: these are read on a progress screen, where a model
 * that occasionally editorialised about somebody's month would be far worse than
 * a flat sentence. They are held to the same banned-phrase rule as the
 * notification copy, by a test.
 */
export function insightsFrom(
  perEvent: PerEventMetrics[],
  trend: ReminderTrendPoint[],
): string[] {
  const insights: string[] = [];

  // VISION §38's sentence, and the reason this whole file exists.
  const decline = findDecline(trend);
  if (decline) {
    insights.push(
      `You needed ${decline.before} ${DOMAIN_LABEL[decline.domain] ?? decline.domain} ` +
        `reminders in ${monthName(decline.earlier)}. In ${monthName(decline.later)} you ` +
        `needed ${decline.after}.`,
    );
  }

  const upcoming = perEvent.find((event) => event.eventKey === 'coach.commitment_upcoming');
  if (upcoming?.bestLeadMinutes) {
    insights.push(
      `Reminders ${upcoming.bestLeadMinutes} minutes ahead lead to the most starts.`,
    );
  }

  const ignored = perEvent.find(
    (event) => event.sent >= 5 && event.actionRate !== null && event.actionRate <= 0.1,
  );
  if (ignored) {
    const label =
      NOTIFICATION_EVENTS.find((event) => event.key === ignored.eventKey)?.label ??
      ignored.eventKey;
    // Names the CATEGORY and offers the setting. Not "you ignore these" — the
    // message being unhelpful is a fact about the message.
    insights.push(`${label} messages are mostly going unused — you can turn them off in Notifications.`);
  }

  return insights.slice(0, 3);
}

interface Decline {
  domain: string;
  earlier: string;
  later: string;
  before: number;
  after: number;
}

/**
 * Two consecutive months in which a domain needed fewer reminders and still
 * showed up.
 *
 * The "still showed up" half is what makes it good news: fewer reminders with no
 * completions is somebody who stopped, and congratulating them for it would be
 * the single worst thing this screen could say.
 */
function findDecline(trend: ReminderTrendPoint[]): Decline | null {
  const byDomain = new Map<string, ReminderTrendPoint[]>();
  for (const point of trend) {
    const list = byDomain.get(point.domain) ?? [];
    list.push(point);
    byDomain.set(point.domain, list);
  }

  for (const [domain, points] of byDomain) {
    const sorted = [...points].sort((a, b) => a.month.localeCompare(b.month));
    for (let i = 1; i < sorted.length; i += 1) {
      const earlier = sorted[i - 1];
      const later = sorted[i];
      if (later.sent >= earlier.sent) continue;
      if (earlier.completions < 1 || later.completions < 1) continue;

      return {
        domain,
        earlier: earlier.month,
        later: later.month,
        before: earlier.sent,
        after: later.sent,
      };
    }
  }

  return null;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function monthName(month: string): string {
  const index = Number(month.slice(5, 7)) - 1;
  return MONTH_NAMES[index] ?? month;
}
