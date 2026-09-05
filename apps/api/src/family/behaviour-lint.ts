// =============================================================================
// The behaviour lint (issue #41, epic E08)
// =============================================================================
//
// PRD §32: a family commitment must describe the USER'S OWN BEHAVIOUR.
//
//   Good:  "Put phone away during dinner."
//          "Spend 20 minutes helping child with project."
//          "Plan Saturday outing by Thursday."
//   Avoid: "Make spouse happier."
//          "Improve daughter's attitude."
//
// "The system cannot control another person's behavior", and a product that
// records a commitment pretending otherwise sets the user up to fail at
// something that was never theirs to do. The refusal is the feature.
//
// DETERMINISTIC AND PURE, and that ordering matters: the VERDICT never depends
// on a model being reachable. The optional AI rewrite (`behaviour-lint.service`)
// runs after this has already decided, and its suggestion is re-linted before
// the user ever sees it. PRD §120 — the deterministic path keeps working when
// the provider is down.
//
// -----------------------------------------------------------------------------
// WHY THREE NARROW RULES RATHER THAN ONE CLEVER ONE
// -----------------------------------------------------------------------------
//
// A FALSE POSITIVE IS THE EXPENSIVE ERROR. Being told "that is not a real
// commitment" about a perfectly good intention is a reason to stop using the
// feature; a missed "Make spouse happier" is a title the user can still fix
// later. So each rule needs a verb, a person AND a state word to fire — the
// three parts of the sentence pattern PRD §32 objects to — rather than
// triggering on any of them alone. "Make pancakes with the kids" has a verb and
// a person and passes, because nobody's inner state is being legislated.
// =============================================================================

/** Verbs that act ON someone. `read`, `call` and `help` are deliberately absent. */
export const OTHER_PERSON_VERBS = [
  'make',
  'get',
  'force',
  'convince',
  'persuade',
  'have',
  'let',
  'teach',
  'train',
  'fix',
  'improve',
  'change',
  'correct',
  'stop',
  'keep',
];

/** Ways a user names somebody else without using their name. */
export const OTHER_PERSON_TARGETS = [
  'spouse',
  'wife',
  'husband',
  'partner',
  'kid',
  'kids',
  'child',
  'children',
  'son',
  'daughter',
  'mom',
  'mum',
  'dad',
  'mother',
  'father',
  'parents',
  'brother',
  'sister',
  'family',
  'everyone',
];

/**
 * Words describing somebody else's inner state or conduct.
 *
 * This is the list that makes the lint narrow: without one of these present, a
 * verb and a person are just a plan involving another human, which is the whole
 * point of the Family domain.
 */
export const OTHER_STATE_WORDS = [
  'happier',
  'happy',
  'calmer',
  'calm',
  'nicer',
  'behave',
  'listen',
  'obey',
  'understand',
  'appreciate',
  'respect',
  'attitude',
  'mood',
  'behaviou?rs?',
  'habits',
  'manners',
  'grades',
];

/** Modals that turn a person into the subject of a demand. */
const DEMAND_MODALS = ['should', 'must', 'needs? to', 'has to', 'have to', 'ought to'];

/**
 * Capitalised tokens that are never people.
 *
 * "Plan Saturday outing by Thursday" is a PRD §32 "Good" example, and without
 * this list `Saturday` would be a name and "Keep Saturday calm" a violation.
 */
const NOT_NAMES = new Set([
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
  'i',
]);

export type LintRule = 'A' | 'B' | 'C';

export type LintResult =
  | { ok: true }
  | { ok: false; code: 'TARGETS_OTHER_PERSON'; match: string; rule: LintRule };

/** The user-facing sentence. One string, used by the API and by the web app. */
export const BEHAVIOUR_LINT_MESSAGE =
  'Describe what you will do, not how someone else should feel or behave.';

export const BEHAVIOUR_LINT_CODE = 'BEHAVIOUR_TARGETS_OTHER_PERSON';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Capitalised words that are probably somebody's name.
 *
 * The FIRST word is excluded, because a title is normally an imperative and its
 * verb is capitalised: "Make", "Read", "Call". Treating that as a name would
 * make every properly-written title look like it was about a person.
 */
function nameCandidates(title: string): string[] {
  return title
    .trim()
    .split(/\s+/)
    .slice(1)
    .map((word) => word.replace(/[^\p{L}\p{N}'’-]/gu, ''))
    .filter((word) => /^\p{Lu}[\p{L}'’-]*$/u.test(word))
    .filter((word) => !NOT_NAMES.has(word.toLowerCase()));
}

/** An alternation matching either a known target word or one of these names. */
function personPattern(names: string[]): string {
  return [...OTHER_PERSON_TARGETS, ...names.map(escapeRegExp)].join('|');
}

const DETERMINERS = '(?:my|the|our|his|her|their|your)\\s+';

/**
 * Does this title describe the user's own behaviour?
 *
 * Case-insensitive throughout: "MAKE MY WIFE CALMER" is the same sentence as
 * "make my wife calmer", and a lint that only reads sentence case is a lint a
 * caps-lock key defeats.
 */
export function lintBehaviourTitle(title: string): LintResult {
  const text = title.trim();
  if (text.length === 0) return { ok: true };

  const names = nameCandidates(text);
  const person = personPattern(names);
  const verbs = OTHER_PERSON_VERBS.join('|');
  const states = OTHER_STATE_WORDS.join('|');

  // RULE A — "<verb> [the] <person> … <state>": "Make spouse happier",
  // "get the kids to listen". The person and the state word must BOTH be there.
  const ruleA = new RegExp(
    `\\b(?:${verbs})\\s+(?:${DETERMINERS})?(?:${person})\\b.{0,40}?\\b(?:${states})\\b`,
    'iu',
  );

  // RULE B — "<fix|improve|change|correct> [my] <person>'s <state>":
  // "Improve daughter's attitude". The possessive is what makes the state
  // somebody else's, so this fires without needing the word order of rule A.
  const ruleB = new RegExp(
    `\\b(?:fix|improve|change|correct)\\s+(?:${DETERMINERS})?(?:${person})(?:'s|’s|s')\\s+(?:\\w+\\s+){0,2}?(?:${states})\\b`,
    'iu',
  );

  // RULE C — "<person> should/must/needs to …": "Mia should read more". Here a
  // capitalised FIRST word does count as a name: a word followed by a modal is
  // the subject of a demand, never the imperative verb rule A's exclusion
  // exists for.
  const firstWord = text.split(/\s+/)[0]?.replace(/[^\p{L}\p{N}'’-]/gu, '') ?? '';
  const subjects = /^\p{Lu}[\p{L}'’-]*$/u.test(firstWord) && !NOT_NAMES.has(firstWord.toLowerCase())
    ? personPattern([...names, firstWord])
    : person;
  const ruleC = new RegExp(
    `\\b(?:${DETERMINERS})?(?:${subjects})\\s+(?:${DEMAND_MODALS.join('|')})\\b`,
    'iu',
  );

  // MOST SPECIFIC FIRST. "Improve daughter's attitude" satisfies both A and B;
  // reporting it as B is the more useful answer, because B names the exact
  // construction — a possessive over somebody else's state — while A only says
  // "a verb, a person and a state word appeared near each other".
  for (const [rule, pattern] of [
    ['B', ruleB],
    ['A', ruleA],
    ['C', ruleC],
  ] as const) {
    const found = pattern.exec(text);

    if (found) {
      return { ok: false, code: 'TARGETS_OTHER_PERSON', match: found[0], rule };
    }
  }

  return { ok: true };
}
