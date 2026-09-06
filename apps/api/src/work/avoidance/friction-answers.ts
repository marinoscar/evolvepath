import type { ObstacleType } from '@prisma/client';

import type { InterventionType } from '../../coach/contracts/coach-reply.contract';

// =============================================================================
// VISION §9's eight answers (issue #116, epic E07)
// =============================================================================
//
// "You've moved this twice. What is making it hard to start?" is only worth
// asking if the eight answers go somewhere DIFFERENT. This table is that
// routing, and it is the reason the question is a diagnosis rather than a
// survey: each answer names a different obstacle and produces a different first
// action.
//
// THE ORDER IS THE DIALOG ORDER. The web app copies these keys into
// `components/work/frictionAnswers.ts` and a Vitest asserts the two agree.
//
// -----------------------------------------------------------------------------
// ONE DECISION WORTH RECORDING
// -----------------------------------------------------------------------------
// The epic's plan text had "too big" and "don't know where to begin" the other
// way round. VISION §9's own worked example settles it: "build the strategy
// presentation" felt TOO BIG and was answered by breaking it into a twelve
// minute storyline slice — that is DECOMPOSITION. Not knowing where to begin is
// an activation problem, answered by making the first move trivially small.
// =============================================================================

export const FRICTION_ANSWER_KEYS = [
  'DONT_KNOW_WHERE_TO_BEGIN',
  'TOO_BIG',
  'TIRED',
  'DONT_WANT_TO',
  'SOMETHING_URGENT',
  'WORRIED_ABOUT_QUALITY',
  'NEED_MORE_INFO',
  'OTHER',
] as const;

export type FrictionAnswer = (typeof FRICTION_ANSWER_KEYS)[number];

export interface FrictionAnswerRule {
  key: FrictionAnswer;
  /** The radio label, in the user's words. */
  label: string;
  interventionType: InterventionType;
  obstacleType: ObstacleType;
}

export const FRICTION_ANSWERS: readonly FrictionAnswerRule[] = [
  {
    key: 'DONT_KNOW_WHERE_TO_BEGIN',
    label: "I don't know where to begin",
    interventionType: 'ACTIVATION_REDUCTION',
    obstacleType: 'AMBIGUOUS_WORK_TASK',
  },
  {
    key: 'TOO_BIG',
    label: 'It feels too big',
    interventionType: 'DECOMPOSITION',
    obstacleType: 'TASK_TOO_LARGE',
  },
  {
    key: 'TIRED',
    label: "I'm tired",
    interventionType: 'REDUCE_SCOPE',
    obstacleType: 'LOW_ENERGY_WINDOW',
  },
  {
    key: 'DONT_WANT_TO',
    label: "I don't want to do it",
    interventionType: 'RECONNECT_REASON',
    obstacleType: 'LOW_MOTIVATION',
  },
  {
    key: 'SOMETHING_URGENT',
    label: 'Something more urgent came up',
    interventionType: 'PROTECTED_RESCHEDULE',
    obstacleType: 'URGENCY_DISPLACEMENT',
  },
  {
    key: 'WORRIED_ABOUT_QUALITY',
    label: "I'm worried I won't do it well",
    interventionType: 'PERFECTIONISM_REFRAME',
    obstacleType: 'PERFECTIONISM',
  },
  {
    key: 'NEED_MORE_INFO',
    label: 'I need more information',
    interventionType: 'CLARIFY',
    obstacleType: 'AMBIGUOUS_WORK_TASK',
  },
  {
    key: 'OTHER',
    label: 'Other',
    interventionType: 'FRICTION_DIAGNOSIS',
    obstacleType: 'OTHER',
  },
] as const;

const BY_KEY = new Map(FRICTION_ANSWERS.map((rule) => [rule.key, rule]));

export function frictionRuleFor(answer: FrictionAnswer): FrictionAnswerRule {
  // Typed as a total map; the DTO's enum is the same list.
  return BY_KEY.get(answer) as FrictionAnswerRule;
}
