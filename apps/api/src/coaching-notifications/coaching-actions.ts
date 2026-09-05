// =============================================================================
// Deep links and notification action buttons (issue #54, epic E12)
// =============================================================================
//
// VISION §37: a coaching notification lands ON THE ACTION, not on a screen from
// which the action can be found. PRD §63 fixes the vocabulary — "Start", "I'm
// in", "Move", "Skip today", "Use short version" — and this file is the single
// place that turns an event plus its payload into those buttons.
//
// Pure, and deliberately so: the engine (E12-03), the push channel (E12-04) and
// the inbox (E12-05) all need the same answer, and a service would mean three
// injections and one more thing to mock in every test that touches a message.
//
// TWO LINK SHAPES, AND WHY BOTH EXIST.
//
//   `/start/<id>?n=…`                       — the execution screen (E05-05)
//   `/today?commitment=<id>&action=…&n=…`   — Today's deep-link contract (E05-04)
//
// Sending everything through `/today` would be simpler and wrong: `?action=start`
// asks Today to perform an action and then navigate, which is right for MOVE and
// SKIP (they resolve on Today) but adds a redirect hop to a timer the user is
// waiting on. `/start/<id>` opens the timer directly. Where a start needs a
// server-side action first — N1 offers a specific version, N4 offers the short
// one — the `/today` form is used precisely because the action has to happen
// before the screen makes sense.
//
// EVERY LINK IS ROOT-RELATIVE. `sanitizeLink` in the browser channel is the
// enforcement; this file is written so it never has anything to reject.

import {
  isCoachingEvent,
  type CoachingEventKey,
  type CoachingFallbackPayload,
  type CoachingFamilyPresencePayload,
  type CoachingPlanIssuePayload,
  type CoachingRecoveryPayload,
  type CoachingRescuePayload,
  type CoachingStartCuePayload,
  type CoachingUpcomingPayload,
} from './coaching-events';

export const NOTIFICATION_ACTION_KEYS = ['start', 'in', 'move', 'short', 'skip'] as const;
export type NotificationActionKey = (typeof NOTIFICATION_ACTION_KEYS)[number];

export interface NotificationActionDef {
  action: NotificationActionKey;
  label: string;
  link: string;
}

/** `Domain`, but this module must not depend on Prisma to render a label. */
export type ActionDomain = 'WORK' | 'FAMILY' | 'HEALTH';

export function todayLink(
  commitmentId: string,
  action: NotificationActionKey,
  sentInteractionId: string,
): string {
  const params = new URLSearchParams({
    commitment: commitmentId,
    action,
    n: sentInteractionId,
  });
  return `/today?${params.toString()}`;
}

export function startLink(commitmentId: string, sentInteractionId: string): string {
  return `/start/${encodeURIComponent(commitmentId)}?n=${encodeURIComponent(
    sentInteractionId,
  )}`;
}

function withN(path: string, sentInteractionId: string): string {
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}n=${encodeURIComponent(sentInteractionId)}`;
}

/**
 * "Start workout" for HEALTH, "Start 38 min" elsewhere, "Start" when the domain
 * is not known.
 *
 * The third case is not a fallback nobody hits: the inbox derives its buttons
 * from `(eventKey, link)` because the `notifications` table stores rendered text
 * and no payload (see the header of `model Notification` — that is a deliberate
 * decision, not an omission). So a row read back from the inbox genuinely does
 * not know its domain, and a generic label is the honest answer. The push
 * channel, which still has the payload in hand, gets the precise one.
 */
export function startLabel(domain: ActionDomain | null, minutes: number | null): string {
  if (domain === 'HEALTH') return 'Start workout';
  if (minutes && minutes > 0) return `Start ${minutes} min`;
  return 'Start';
}

/** Where the notification itself goes when the user taps the body, not a button. */
export function primaryLink(eventKey: string, payload: unknown): string | undefined {
  if (!isCoachingEvent(eventKey)) return undefined;
  const actions = actionsFor(eventKey, payload);
  if (actions.length > 0) return actions[0].link;
  return bodyLink(eventKey, payload);
}

function bodyLink(key: CoachingEventKey, payload: unknown): string | undefined {
  const p = payload as Record<string, unknown> | null | undefined;
  const n = typeof p?.sentInteractionId === 'string' ? p.sentInteractionId : undefined;
  if (!n) return undefined;

  switch (key) {
    case 'coach.recovery':
      return withN('/comeback', n);
    case 'coach.evidence':
      return withN('/progress', n);
    case 'coach.weekly_review_ready':
      return withN('/progress/week', n);
    case 'coach.plan_issue': {
      const proposalId = (payload as CoachingPlanIssuePayload).proposalId;
      return withN(`/coach?proposal=${encodeURIComponent(proposalId)}`, n);
    }
    default:
      return undefined;
  }
}

/**
 * The buttons for one event.
 *
 * Returns `[]` for a non-coaching event and for a payload it cannot read —
 * never throws. A missing button degrades a notification to a tap-through; a
 * thrown error inside a template would fail the whole delivery, and this
 * function is called from three places that each have a different idea of how
 * complete their payload is.
 */
export function actionsFor(eventKey: string, payload: unknown): NotificationActionDef[] {
  if (!isCoachingEvent(eventKey)) return [];
  const p = payload as Record<string, unknown> | null | undefined;
  const commitmentId = typeof p?.commitmentId === 'string' ? p.commitmentId : null;
  const n = typeof p?.sentInteractionId === 'string' ? p.sentInteractionId : null;
  if (!n) return [];

  const domain = readDomain(p?.domain);
  const minutes = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;

  switch (eventKey) {
    case 'coach.commitment_upcoming': {
      if (!commitmentId) return [];
      const { startMinutes } = payload as CoachingUpcomingPayload;
      return [
        {
          action: 'start',
          label: startLabel(domain, minutes(startMinutes)),
          link: todayLink(commitmentId, 'start', n),
        },
        { action: 'move', label: 'Move', link: todayLink(commitmentId, 'move', n) },
        { action: 'skip', label: 'Skip today', link: todayLink(commitmentId, 'skip', n) },
      ];
    }

    case 'coach.start_cue': {
      if (!commitmentId) return [];
      const { startMinutes } = payload as CoachingStartCuePayload;
      return [
        // The one case that links straight at the timer: the commitment is due
        // now, nothing has to happen on the server first, and a hop through
        // Today would be a redirect the user watches.
        {
          action: 'start',
          label: startLabel(domain, minutes(startMinutes)),
          link: startLink(commitmentId, n),
        },
        {
          action: 'short',
          label: 'Use short version',
          link: todayLink(commitmentId, 'short', n),
        },
        { action: 'move', label: 'Move', link: todayLink(commitmentId, 'move', n) },
      ];
    }

    case 'coach.rescue': {
      if (!commitmentId) return [];
      const { minimumMinutes } = payload as CoachingRescuePayload;
      return [
        // Always the MINIMUM version's minutes, never the domain's phrasing:
        // the whole point of a rescue is that the number is small enough to
        // argue with, and "Start workout" hides it.
        {
          action: 'start',
          label: minutes(minimumMinutes) ? `Start ${minimumMinutes} min` : 'Start',
          link: todayLink(commitmentId, 'start', n),
        },
        { action: 'skip', label: 'Skip today', link: todayLink(commitmentId, 'skip', n) },
      ];
    }

    case 'coach.fallback_offer': {
      if (!commitmentId) return [];
      const { fullMinutes } = payload as CoachingFallbackPayload;
      return [
        {
          action: 'short',
          label: 'Use short version',
          link: todayLink(commitmentId, 'short', n),
        },
        {
          action: 'start',
          label: minutes(fullMinutes) ? 'Start full' : 'Start',
          link: todayLink(commitmentId, 'start', n),
        },
        { action: 'skip', label: 'Skip today', link: todayLink(commitmentId, 'skip', n) },
      ];
    }

    case 'coach.family_presence': {
      if (!commitmentId) return [];
      void (payload as CoachingFamilyPresencePayload);
      return [
        // "I'm in" is a transition to READY, not a start (E08-04). A family
        // ritual is something you show up to, not something you execute, and
        // the vocabulary is PRD §63's, verbatim.
        { action: 'in', label: "I'm in", link: todayLink(commitmentId, 'in', n) },
        { action: 'move', label: 'Move it', link: todayLink(commitmentId, 'move', n) },
        { action: 'skip', label: 'Skip today', link: todayLink(commitmentId, 'skip', n) },
      ];
    }

    // N6–N9 have no buttons on purpose: none of them asks for a decision that
    // can be made without seeing the thing. A "Restart" button on a comeback
    // message would commit the user to an action they have not read yet.
    case 'coach.recovery':
      void (payload as CoachingRecoveryPayload);
      return [];
    case 'coach.evidence':
    case 'coach.weekly_review_ready':
    case 'coach.plan_issue':
      return [];

    default:
      return [];
  }
}

function readDomain(value: unknown): ActionDomain | null {
  return value === 'WORK' || value === 'FAMILY' || value === 'HEALTH' ? value : null;
}

export interface ParsedCoachingLink {
  commitmentId: string | null;
  sentInteractionId: string | null;
}

/**
 * Recover from a stored link what the inbox needs to rebuild its buttons.
 *
 * The `notifications` table holds rendered text and a link, no payload — so this
 * is the ONLY way a row read back a week later can still offer "Move" and "Skip
 * today". It reads the link the writer produced, which is why every emitter
 * above goes through `todayLink`/`startLink` rather than string concatenation.
 */
export function parseCoachingLink(link: string | null | undefined): ParsedCoachingLink {
  const empty: ParsedCoachingLink = { commitmentId: null, sentInteractionId: null };
  if (!link || !link.startsWith('/')) return empty;

  // `URL` needs an origin; the base is discarded and never leaves this function.
  let url: URL;
  try {
    url = new URL(link, 'https://local.invalid');
  } catch {
    return empty;
  }

  const fromQuery = url.searchParams.get('commitment');
  const startMatch = /^\/start\/([^/?#]+)/.exec(url.pathname);

  return {
    commitmentId: fromQuery ?? (startMatch ? decodeURIComponent(startMatch[1]) : null),
    sentInteractionId: url.searchParams.get('n'),
  };
}

/**
 * The inbox's version of `actionsFor`, built from what a stored row actually
 * knows. Deliberately a different entry point rather than a lenient
 * `actionsFor`: a caller holding a full payload should never silently get the
 * degraded labels.
 */
export function actionsForStoredRow(
  eventKey: string,
  link: string | null | undefined,
): NotificationActionDef[] {
  if (!isCoachingEvent(eventKey)) return [];
  const { commitmentId, sentInteractionId } = parseCoachingLink(link);
  if (!sentInteractionId) return [];

  return actionsFor(eventKey, {
    sentInteractionId,
    commitmentId: commitmentId ?? undefined,
    // Domain and minutes are unknowable from a stored link, so the labels fall
    // back to the generic forms `startLabel` documents.
  });
}
