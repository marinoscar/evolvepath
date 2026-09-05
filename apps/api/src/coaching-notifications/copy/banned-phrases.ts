// =============================================================================
// Vocabulary the coach never uses (PRD §129, issue #54, epic E12)
// =============================================================================
//
// PRD §129 and VISION §12: this product does not motivate through guilt. That
// is not a style preference — a reminder that invokes a broken promise makes
// the app something to avoid, and an avoided app coaches nobody.
//
// The list is enforced in TWO places for two different reasons, which is why it
// is a module rather than a comment in a prompt:
//
//   1. Against the DETERMINISTIC templates, at build time. A template that shamed
//      the user would ship on every provider outage, silently and forever.
//   2. Against the COPYWRITER's output, at run time (E12-03). Prompting a model
//      not to say something is a request; checking is the guarantee, and the
//      failure mode is simply falling back to the template.
//
// Substring matching on a lowercased haystack. Deliberately crude: the cost of a
// false positive is one sentence rephrased, the cost of a false negative is a
// user being told they let someone down.

export const BANNED_PHRASES = [
  'disappoint',
  'promised',
  'let down',
  'last chance',
  'shame',
  'guilt',
  'miss you',
  'failed',
  'failure',
  'excuse',
  'lazy',
  'again?',
  'still not',
  'you said you would',
] as const;

export type BannedPhrase = (typeof BANNED_PHRASES)[number];

/**
 * The phrases present in a piece of copy, in the order the list declares them.
 * Returns `[]` for clean copy — callers branch on the length rather than on a
 * boolean so a log line can say WHICH phrase tripped.
 */
export function findBannedPhrases(text: string): BannedPhrase[] {
  const haystack = text.toLowerCase();
  return BANNED_PHRASES.filter((phrase) => haystack.includes(phrase));
}

export function hasBannedPhrase(text: string): boolean {
  return findBannedPhrases(text).length > 0;
}
