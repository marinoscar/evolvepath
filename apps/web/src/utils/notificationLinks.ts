// =============================================================================
// The attribution parameter (issue #68, epic E12)
// =============================================================================
//
// Every coaching deep link carries `?n=<sentInteractionId>` — the id of the
// decision that produced the notification. It is the whole attribution chain:
// without it, a click on a reminder is a page view with no way back to the
// message that caused it, and PRD §64's "which messages are acted on" has no
// answer at all.
//
// Pure and tiny, and separate from `internalLink.ts` on purpose: that file
// answers "is this safe to navigate to?", which is a security question asked of
// every link in the app. This one answers "which message did this come from?",
// which is a coaching question asked of a few. Merging them would put a product
// concern inside a security check.

/** The three params the coaching links add, and only these. */
export const ATTRIBUTION_PARAMS = ['commitment', 'action', 'n'] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The `n` parameter of a root-relative link, or `null`.
 *
 * VALIDATED AS A UUID rather than passed through: this value is posted straight
 * back to the API as an id, and a link is something a user can edit in their
 * address bar. Rejecting the malformed case here means the client never sends a
 * request that can only be a 400 or a 404.
 */
export function parseSentInteractionId(link: string | null | undefined): string | null {
  if (!link) return null;

  const query = link.indexOf('?');
  if (query === -1) return null;

  const value = new URLSearchParams(link.slice(query + 1)).get('n');
  return value && UUID.test(value) ? value : null;
}

/**
 * The same params, minus the attribution ones.
 *
 * Returned as a NEW object rather than mutated in place: `useSearchParams`
 * hands back a live instance, and editing it would change what a component is
 * currently rendering from.
 */
export function stripAttributionParams(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of ATTRIBUTION_PARAMS) next.delete(key);
  return next;
}
