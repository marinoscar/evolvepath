/**
 * Every word the comeback flow says (issue #119, epic E11).
 *
 * ONE FILE, so the ban is checkable. PRD §56–§57 and §129 rule out a whole
 * vocabulary here — "overdue", "behind", "failed", "streak", "catch up" — and a
 * test reflects over every export and fails the build on a match, exactly as
 * `comeback-copy.spec.ts` does on the API side.
 *
 * The two lists agree on purpose. The screens and the notifications a user
 * receives are the same voice; a phrase that would shame somebody in a push
 * message shames them on a page too.
 */

/** The words this feature exists to not say. */
export const BANNED_COMEBACK_WORDS =
  /\b(overdue|behind|failed|failing|streak|lazy|guilt|guilty)\b/i;

/**
 * "Catching up" is banned as a PROPOSAL and required as a DENIAL.
 *
 * VISION §33's whole point is the sentence "No catching up", so the phrase
 * cannot simply be on the banned list — it would fail the product's own copy.
 */
export const UNNEGATED_CATCH_UP = /(?<!\bno\s)\bcatch(ing)?\s?-?\s?up\b/i;

export function isKindEnough(text: string): boolean {
  return !BANNED_COMEBACK_WORDS.test(text) && !UNNEGATED_CATCH_UP.test(text);
}

export const COMEBACK_COPY = {
  step1: {
    title: "You're still on the Path.",
    body: 'No catching up. We start from today.',
    /** VISION §56. Only shown for an inactivity trigger — a fact, not a verdict. */
    idle: (days: number) =>
      `The last ${days === 1 ? 'day' : `${days} days`} got away from you. Let's restart with one thing today.`,
    continueLabel: 'Continue',
    dismissLabel: 'Not now',
  },
  step2: {
    title: 'Which area feels most important to restart?',
    recommendedChip: 'Recommended',
    takeRecommendation: 'Take the recommendation',
    chooseLabel: 'Choose',
  },
  step3: {
    startLabel: 'Start',
    changeLabel: 'Choose a different area',
    whyItMatters: 'Why it matters',
  },
  done: {
    title: 'Back on Path.',
    body: 'The important part was not that you missed. It was that you returned.',
    nextUp: 'Next up',
    nothingPlanned: 'Nothing planned yet — review your plan.',
    reviewPlan: 'Review my plan',
    backToToday: 'Back to Today',
  },
  banner: {
    title: 'Welcome back. No catching up.',
    body: 'We start from today. One small thing is enough.',
    restartLabel: 'Restart with one thing',
    dismissLabel: 'Dismiss',
  },
  nothingToRestart: "Nothing to restart — you're on today's path.",
  /** The coach prompt "Review my plan" opens with (E06-07's `fell_off` chip). */
  fellOffPrompt: 'I fell off',
} as const;

export const COMEBACK_STEPS = 3;

/** `Step 2 of 3` — text, not only dots, so it is readable and announceable. */
export function stepIndicator(step: number): string {
  return `Step ${step} of ${COMEBACK_STEPS}`;
}
