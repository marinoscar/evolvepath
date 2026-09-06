import type { MilestoneKind } from '@prisma/client';

// =============================================================================
// What a milestone says (issue #115, epic E11)
// =============================================================================
//
// PRD §77: "celebrations must match significance" and "avoid constant
// confetti". Six sentences, no exclamation marks, and every one of them names
// the EVIDENCE rather than praising the person — "First full week, your plan
// held for seven days" is a fact; "Amazing work!" is a slot machine.
//
// VISION §57's thirty-day payoff is the same idea at a different scale:
// "Thirty days ago those were intentions. Now there is evidence."
// =============================================================================

export interface MilestoneCopy {
  title: string;
  body: string;
}

export function milestoneCopy(
  kind: MilestoneKind,
  meta: Record<string, unknown> | null | undefined,
): MilestoneCopy {
  const weeks = Number(meta?.weeks ?? 0);
  const count = Number(meta?.count ?? 0);

  switch (kind) {
    case 'FIRST_FULL_WEEK':
      return {
        title: 'First full week',
        body: 'Your plan held for seven days.',
      };
    case 'FOUR_WEEKS':
      return {
        title: `${weeks} weeks of momentum`,
        body: 'Long enough that it is no longer a good week.',
      };
    case 'TEN_WORKOUTS':
      return {
        title: `${count} workouts completed`,
        body: 'Thirty days ago those were intentions.',
      };
    case 'FIRST_COMEBACK':
      return {
        title: 'First comeback',
        body: 'You returned.',
      };
    case 'FIRST_START_AFTER_POSTPONE':
      return {
        title: 'You started something you had moved twice',
        body: 'The hardest one to begin is the one that has waited.',
      };
    case 'REDUCED_REMINDERS':
      return {
        title: 'A month with fewer reminders',
        body: 'More of this was you.',
      };
    default:
      return { title: 'Milestone', body: '' };
  }
}
