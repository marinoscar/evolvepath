/**
 * The seven chips on the Coach screen, in PRD §66's order.
 *
 * ORDER IS THE SPEC. They run from planning through friction to re-deciding,
 * and a user scanning them left to right is walking that arc. Sorting them
 * alphabetically, or by popularity, would turn a designed sequence into a menu.
 */
export const SUGGESTED_PROMPTS = [
  { key: 'plan_week', label: 'Plan my week', text: 'Help me plan my week' },
  { key: 'procrastinating', label: "I'm procrastinating", text: "I'm procrastinating" },
  {
    key: 'shorter_workout',
    label: 'Make today shorter',
    text: "Make today's workout shorter",
  },
  { key: 'fell_off', label: 'I fell off', text: 'I fell off' },
  { key: 'review_progress', label: 'Review my progress', text: 'Review my progress' },
  {
    key: 'decide_what_matters',
    label: 'What matters most?',
    text: 'Help me decide what matters',
  },
  { key: 'change_plan', label: 'Change my plan', text: 'Change my plan' },
] as const;

export type SuggestedPrompt = (typeof SUGGESTED_PROMPTS)[number];
