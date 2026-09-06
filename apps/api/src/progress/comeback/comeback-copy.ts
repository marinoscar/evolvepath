// =============================================================================
// Everything the comeback loop says out loud (issue #112, epic E11)
// =============================================================================
//
// ONE FILE, so the ban is checkable. PRD §56-§57 and §129 rule out a whole
// vocabulary here — "overdue", "behind", "failed", "streak", "catch up" — and
// the way to keep it out is not a review convention but a test that reads every
// exported string in this module and fails the build on a match.
//
// The AI wording path is held to the same list (`restart-wording.service.ts`),
// which matters more than it looks: the deterministic copy below ships on every
// provider outage, so a shaming template would reach users silently and forever.
// =============================================================================

/** The words this feature exists to not say. */
export const BANNED_COMEBACK_WORDS =
  /\b(overdue|behind|failed|failing|streak|lazy|guilt|guilty)\b/i;

/**
 * "Catching up" is banned as a PROPOSAL and required as a DENIAL.
 *
 * VISION §33's whole point is the sentence "No catching up", so the phrase
 * cannot simply be on the banned list — it would fail the product's own copy.
 * What must never appear is the phrase without its negation, which is what this
 * pattern looks for and `comeback-copy.spec.ts` asserts about every string here
 * and about every model-written title.
 */
export const UNNEGATED_CATCH_UP = /(?<!\bno\s)\bcatch(ing)?\s?-?\s?up\b/i;

export function isKindEnough(text: string): boolean {
  return !BANNED_COMEBACK_WORDS.test(text) && !UNNEGATED_CATCH_UP.test(text);
}

/** Shown under the offer. VISION §33: no catch-up debt. */
export const OFFER_NOTE = 'No catching up. We start from today.';

export const CELEBRATION_TITLE = 'Back on Path.';

/** VISION §32 — the sentence the whole loop is built to be able to say. */
export const CELEBRATION_BODY =
  'The important part was not that you missed. It was that you returned.';

/** The restart when the user has no active routine to rebuild from. */
export const DEFAULT_RESTART_TITLE = 'A 10-minute walk';
export const DEFAULT_RESTART_REASON =
  'A small physical restart is the safest first step.';

/**
 * Why THIS one, in the user's own terms.
 *
 * Each template names the rule that chose the domain, because "we picked
 * something for you" is not a reason and the screen has to survive the
 * question "why this?" without a model.
 */
export const REASON_TEMPLATES = {
  mostImportant: (domain: string, outcome: string) =>
    `${titleCase(domain)} matters most to you right now — ${outcome}.`,
  mostRecent: (domain: string) =>
    `You were keeping ${domain.toLowerCase()} going before the pause, so it is the easiest to rebuild.`,
  fallbackDomain: (domain: string) =>
    `${titleCase(domain)} is the smallest place to start again.`,
} as const;

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}
