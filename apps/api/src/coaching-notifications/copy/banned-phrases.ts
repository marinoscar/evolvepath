// =============================================================================
// Vocabulary the coach never uses (PRD §129, issues #54 and #59, epic E12)
// =============================================================================
//
// PRD §129 and VISION §12: this product does not motivate through guilt. That
// is not a style preference — a reminder that invokes a broken promise makes
// the app something to avoid, and an avoided app coaches nobody.
//
// The list is enforced in TWO places for two different reasons, which is why it
// is a module rather than a line in a prompt:
//
//   1. Against the DETERMINISTIC templates, at build time. A template that
//      shamed the user would ship on every provider outage, silently and
//      forever.
//   2. Against the COPYWRITER's output, at run time. Prompting a model not to
//      say something is a request; checking is the guarantee, and the failure
//      mode is simply falling back to the template — no error, no lost message.
//
// -----------------------------------------------------------------------------
// WHY PATTERNS, AND WHY THESE PATTERNS
// -----------------------------------------------------------------------------
//
// A plain substring list cannot express the distinction that matters. PRD §60's
// own example copy is:
//
//     "Two evening workouts failed. I think the schedule needs changing."
//
// which the product WANTS to be able to say. "Failed" describes what happened to
// a plan; "you failed" describes a person. A substring list containing `failed`
// bans the sentence the PRD asks for, so the patterns below target the shapes
// that address the reader — `let you down`, `you promised`, `if you really
// cared` — and leave factual language about schedules alone.
//
// The bar for adding one: it must be a phrase that assigns BLAME, MANUFACTURES
// URGENCY, or implies the app has FEELINGS about being ignored. Anything that
// merely reports a fact stays.

export interface BannedPattern {
  /** What the phrase is, for a log line and for the tests. */
  label: string;
  pattern: RegExp;
}

export const BANNED_PATTERNS: readonly BannedPattern[] = [
  // Blame.
  { label: 'disappoint', pattern: /disappoint/i },
  { label: 'let down', pattern: /let\s+(me|us|them|yourself|everyone|him|her)\s+down/i },
  { label: 'promised', pattern: /you\s+promised|broke\s+your\s+promise/i },
  { label: 'shame', pattern: /\bshame\b|\bashamed\b/i },
  { label: 'guilt', pattern: /\bguilt\b|\bguilty\b/i },
  { label: 'no excuses', pattern: /no\s+excuses/i },
  { label: 'lazy', pattern: /\blazy\b/i },
  // Emotional leverage — the loved-ones variant PRD §129 calls out by name.
  { label: 'what would they think', pattern: /what\s+would\s+.{1,30}\s+think/i },
  { label: 'if you really cared', pattern: /if\s+you\s+(really\s+)?cared/i },
  // Manufactured urgency.
  { label: 'last chance', pattern: /last\s+chance/i },
  { label: "don't miss", pattern: /don'?t\s+miss/i },
  { label: 'hurry', pattern: /\bhurry\b/i },
  { label: 'running out of time', pattern: /running\s+out\s+of\s+time/i },
  // The app implying it has feelings about being ignored.
  { label: 'miss you', pattern: /\bmiss(ed|ing)?\s+you\b/i },
  { label: 'where have you been', pattern: /where\s+have\s+you\s+been/i },
  // Tone, not vocabulary: stacked exclamation marks are shouting.
  { label: 'shouting', pattern: /!{2,}/ },
] as const;

/** The labels, for tests and for anything that wants to enumerate the rules. */
export const BANNED_PHRASES: readonly string[] = BANNED_PATTERNS.map((p) => p.label);

/**
 * The FIRST banned phrase in `text`, or `null`.
 *
 * Singular by design: the caller's decision is binary (use the template
 * instead), and one label is enough for the log line that explains why.
 */
export function findBannedPhrase(text: string): string | null {
  for (const { label, pattern } of BANNED_PATTERNS) {
    if (pattern.test(text)) return label;
  }
  return null;
}

/** Every banned phrase in `text`. Used by the template tests, which want them all. */
export function findBannedPhrases(text: string): string[] {
  return BANNED_PATTERNS.filter(({ pattern }) => pattern.test(text)).map((p) => p.label);
}

export function hasBannedPhrase(text: string): boolean {
  return findBannedPhrase(text) !== null;
}

/** Checks a whole rendered notification. Returns the first offending label. */
export function screenCopy(copy: {
  title: string;
  body: string;
  actionLabel: string;
}): string | null {
  return (
    findBannedPhrase(copy.title) ??
    findBannedPhrase(copy.body) ??
    findBannedPhrase(copy.actionLabel)
  );
}
