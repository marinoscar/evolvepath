// =============================================================================
// The family review's one sentence (issue #45, epic E08)
// =============================================================================
//
// PRD §35 writes it out, and this file keeps it verbatim:
//
//     "Work displaced two evening family commitments this month. Do you want to
//      protect those times more aggressively, or is the current trade-off
//      intentional?"
//
// Two properties of that sentence are the reason it is a template rather than a
// prompt. It ASKS rather than tells — "is the current trade-off intentional?"
// leaves room for the answer "yes", which a user who chose to work late deserves
// — and its number is a FACT, computed here, not something a model produced.
//
// The AI may rephrase this. It may not compute it: the digits are checked
// against the template's before a rephrase is accepted, because a coach that
// quietly says "three" when the answer is two is worse than no coach.
// =============================================================================

/**
 * Below two, there is no pattern to point at — one displaced dinner in a week
 * is a Tuesday, not a trend, and naming it would be exactly the nagging PRD §35
 * says to avoid.
 */
export const DISPLACEMENT_THRESHOLD = 2;

export const DISPLACEMENT_TEMPLATE =
  'Work displaced {count} {evening}family commitment{s} {period}. ' +
  'Do you want to protect those times more aggressively, or is the current trade-off intentional?';

export interface DisplacementInput {
  count: number;
  eveningCount: number;
  weeks: number;
}

/**
 * The sentence, with the real numbers in it.
 *
 * "evening" is only used when EVERY displaced commitment was one. Saying
 * "two evening family commitments" when one of them was a Saturday lunch is a
 * small lie, and the whole point of this sentence is that the user can check it
 * against their own memory of the week.
 */
export function renderDisplacementNote(input: DisplacementInput): string {
  const { count, eveningCount, weeks } = input;

  return DISPLACEMENT_TEMPLATE.replace('{count}', String(count))
    .replace('{evening}', count > 0 && eveningCount === count ? 'evening ' : '')
    .replace('{s}', count === 1 ? '' : 's')
    .replace('{period}', weeks <= 1 ? 'this week' : `over the last ${weeks} weeks`);
}
