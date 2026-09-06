import type { CoachingStyle, Domain, ObstacleKey } from '../../types';

// =============================================================================
// The words (issue #102 / #104, epic E04)
// =============================================================================
//
// ONE SOURCE. The e2e spec asserts against these strings and `docs/specs/
// onboarding.md` quotes them; a copy edit that only happened in a component
// would break the first and silently outdate the second.
//
// PRD §20 fixes the nine screens and most of this wording. Where it does not,
// the rule is the product's: second person, no exclamation marks, and never a
// sentence that congratulates somebody for answering a question.
// =============================================================================

export const PROMISE_TITLE = 'Become who you want to be.';

export const PROMISE_BODY =
  'Not a habit tracker. A plan built around the person you are trying to become — ' +
  'small enough to survive a bad week, and yours to change whenever it stops fitting.';

export const PROMISE_CTA = 'Build my Path';

export const VISION_TITLE = 'Six months from now';

export const VISION_QUESTION =
  'If the next six months went well, what would be different about your life?';

export const VISION_HELPER =
  'Write it the way you would say it out loud. A few sentences is plenty.';

/** Below this the answer is not enough for a planner to work from. */
export const VISION_MIN_LENGTH = 20;

export const DOMAINS_TITLE = 'Where does that start?';

export const DOMAINS_QUESTION =
  'Pick the areas you want to work on first. You can add the others later.';

export const DOMAIN_LABELS: Record<Domain, string> = {
  WORK: 'Work',
  FAMILY: 'Family',
  HEALTH: 'Health',
};

export const DOMAIN_PROMPTS: Record<Domain, string> = {
  WORK: 'What would a good week at work look like?',
  FAMILY: 'What would the people close to you notice?',
  HEALTH: 'What does your body need from you right now?',
};

export const REALITY_TITLE = 'What usually gets in the way?';

export const REALITY_QUESTION =
  'Be honest — this is what the plan has to survive. Pick as many as fit.';

export const OBSTACLE_LABELS: Record<ObstacleKey, string> = {
  PROCRASTINATE: 'I procrastinate',
  TOO_AMBITIOUS: 'I make plans that are too ambitious',
  FORGET: 'I forget',
  SCHEDULE_CHANGES: 'My schedule keeps changing',
  LOSE_MOTIVATION: 'I lose motivation after a week',
  OVERWHELMED: 'I get overwhelmed',
  DONT_KNOW_WHAT: 'I do not know what to do first',
  OTHER: 'Something else',
};

export const OBSTACLE_ORDER: ObstacleKey[] = [
  'PROCRASTINATE',
  'TOO_AMBITIOUS',
  'FORGET',
  'SCHEDULE_CHANGES',
  'LOSE_MOTIVATION',
  'OVERWHELMED',
  'DONT_KNOW_WHAT',
  'OTHER',
];

export const TIME_TITLE = 'How much time do you actually have?';

export const TIME_QUESTION =
  'On a normal weekday, how many minutes can you protect for this? Answer for a ' +
  'busy week, not your best one.';

export const HEALTH_TITLE = 'Where are you starting from?';

export const HEALTH_QUESTION =
  'Enough to build something safe. Nothing here is a judgement.';

export const HEALTH_LIMITATIONS_HINT =
  'Anything I should plan around — no medical detail needed.';

export const HEALTH_EQUIPMENT_OPTIONS = [
  'None',
  'Dumbbells',
  'Barbell',
  'Bands',
  'Gym',
  'Bike/Treadmill',
];

export const COACHING_TITLE = 'How should I talk to you?';

export const COACHING_QUESTION = 'You can change this at any time.';

export const COACHING_STYLE_LABELS: Record<CoachingStyle, string> = {
  GENTLE: 'Gentle',
  BALANCED: 'Balanced',
  DIRECT: 'Direct',
};

export const COACHING_STYLE_DESCRIPTIONS: Record<CoachingStyle, string> = {
  GENTLE: 'Encouraging. I will assume you had a reason and start from there.',
  BALANCED: 'Straight with you, without the edge. Most people start here.',
  DIRECT: 'Blunt. I will name the pattern I am seeing and ask about it.',
};

export const NOTIFICATIONS_TITLE = 'One notification a day, at most';

export const NOTIFICATIONS_BODY =
  'I will use notifications to remind you of the one thing you decided to do — ' +
  'never to pull you back into the app. The goal is to need fewer of them over ' +
  'time, and you can turn them off in Settings whenever you like.';

export const NOTIFICATIONS_ALLOW = 'Allow notifications';
export const NOTIFICATIONS_DECLINE = 'Not now';
export const NOTIFICATIONS_FINISH = 'Finish';

// -----------------------------------------------------------------------------
// The proposal screen (issue #104)
// -----------------------------------------------------------------------------

export const PROPOSAL_TITLE = 'Your first Path';

export const PROPOSAL_LOADING = 'Building your first Path…';

/** PRD §20 step 8, verbatim. Shown when the plan came back reduced. */
export const PROPOSAL_REDUCED_SENTENCE =
  'I intentionally kept this smaller than what you asked for. I want the first ' +
  'plan to survive a bad week.';

export const PROPOSAL_TEMPLATE_CHIP =
  'Starting template — the coach will refine this once it is back';

export const PROPOSAL_AI_UNAVAILABLE = 'The coach is unavailable right now';

export const PROPOSAL_RETRY = 'Try again';
export const PROPOSAL_SKIP_AI = 'Continue without AI';
export const PROPOSAL_ADJUST = 'Adjust';
export const PROPOSAL_DONE_ADJUSTING = 'Done adjusting';
export const PROPOSAL_APPROVE = 'Start this Path';

export const CONFIDENCE_QUESTION =
  'How confident are you that you can do this in a difficult week?';

export const CONFIDENCE_LOW_LABEL = 'Not at all';
export const CONFIDENCE_HIGH_LABEL = 'Very';

export const CONFIDENCE_REDUCED_SNACKBAR = 'I made it smaller — take another look';
