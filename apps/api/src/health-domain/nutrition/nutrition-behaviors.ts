// =============================================================================
// The nutrition behaviour registry (issue #113, epic E09)
// =============================================================================
//
// PRD §46 fixes V1 nutrition as BEHAVIOURS and nothing else: "planned
// breakfast, meal preparation, protein target behavior, vegetables, water,
// reducing late-night eating, weekday meal planning, restaurant strategy,
// planned snacks". VISION §16 gives the same list as examples. There is no
// calorie count, no macro, no food database and no goal weight anywhere in this
// epic, and that is a product decision rather than a missing feature.
//
// A STATIC REGISTRY, modelled on `notification-events.ts`, for the same reason
// that file is one: adding a behaviour should be one entry, not a migration and
// a seed. Nothing here is per-user — a behaviour becomes personal when the user
// commits to it, and that produces an ordinary HEALTH commitment through the
// same service quick add uses.
//
// EVERY BEHAVIOUR HAS A MINIMUM VERSION, and it is never zero. PRD §57's three
// sizes are what keep a habit alive on a bad day, and "protein with one meal"
// is a real thing somebody can do on the worst Tuesday of the month.
// =============================================================================

/** When the behaviour naturally lands, if the user does not say otherwise. */
export type BehaviourTime = 'MORNING' | 'MIDDAY' | 'EVENING';

/** The wall-clock hour each slot resolves to in the user's own timezone. */
export const BEHAVIOUR_TIMES: Record<BehaviourTime, string> = {
  MORNING: '07:30',
  MIDDAY: '12:30',
  EVENING: '18:30',
};

export interface BehaviourVersion {
  title: string;
  minutes: number;
}

export interface NutritionBehaviour {
  key: string;
  title: string;
  description: string;
  defaultTime: BehaviourTime;
  fullVersion: BehaviourVersion;
  minimumVersion: BehaviourVersion;
}

export const NUTRITION_BEHAVIORS: NutritionBehaviour[] = [
  {
    key: 'planned_breakfast',
    title: 'Planned breakfast',
    description:
      'Decide the night before what breakfast is, so the morning is not a decision you make hungry.',
    defaultTime: 'MORNING',
    fullVersion: { title: 'Planned breakfast', minutes: 15 },
    minimumVersion: { title: 'Decide breakfast now', minutes: 2 },
  },
  {
    key: 'meal_prep',
    title: 'Cook once, eat twice',
    description:
      'Make enough of one meal that tomorrow is already handled. The point is the second meal, not the cooking.',
    defaultTime: 'EVENING',
    fullVersion: { title: 'Cook once, eat twice', minutes: 45 },
    minimumVersion: { title: 'Double one thing you are already cooking', minutes: 5 },
  },
  {
    key: 'protein_with_meals',
    title: 'Protein with every meal',
    description:
      'A protein source at each meal, whatever it is. No counting — the behaviour is putting it on the plate.',
    defaultTime: 'MIDDAY',
    fullVersion: { title: 'Protein with every meal', minutes: 5 },
    minimumVersion: { title: 'Protein with one meal', minutes: 2 },
  },
  {
    key: 'vegetables_with_dinner',
    title: 'Vegetables with dinner',
    description: 'Something green on the plate at dinner. Frozen counts.',
    defaultTime: 'EVENING',
    fullVersion: { title: 'Vegetables with dinner', minutes: 10 },
    minimumVersion: { title: 'One vegetable, however easy', minutes: 3 },
  },
  {
    key: 'water_with_meals',
    title: 'Water with meals',
    description: 'A glass of water at each meal, before anything else.',
    defaultTime: 'MIDDAY',
    fullVersion: { title: 'Water with meals', minutes: 3 },
    minimumVersion: { title: 'Water with one meal', minutes: 1 },
  },
  {
    key: 'no_late_night_eating',
    title: 'Kitchen closes after dinner',
    description:
      'A time after which the kitchen is shut. Decide the time, not the willpower.',
    defaultTime: 'EVENING',
    fullVersion: { title: 'Kitchen closes after dinner', minutes: 5 },
    minimumVersion: { title: 'Name tonight’s closing time', minutes: 1 },
  },
  {
    key: 'weekday_meal_plan',
    title: 'Plan the week’s meals',
    description:
      'Fifteen minutes on Sunday deciding what the weekdays eat, so no weekday has to decide.',
    defaultTime: 'MIDDAY',
    fullVersion: { title: 'Plan the week’s meals', minutes: 20 },
    minimumVersion: { title: 'Plan two dinners', minutes: 5 },
  },
  {
    key: 'restaurant_strategy',
    title: 'Decide before you arrive',
    description:
      'Look at the menu before you walk in and pick then. Ordering is easier when it is already done.',
    defaultTime: 'EVENING',
    fullVersion: { title: 'Decide before you arrive', minutes: 5 },
    minimumVersion: { title: 'Pick one thing you will order', minutes: 2 },
  },
  {
    key: 'planned_snacks',
    title: 'Snacks you chose in advance',
    description:
      'Have something on hand you decided on when you were not hungry. The choice is the behaviour.',
    defaultTime: 'MIDDAY',
    fullVersion: { title: 'Snacks you chose in advance', minutes: 10 },
    minimumVersion: { title: 'Put one snack where you will be', minutes: 2 },
  },
  {
    key: 'eat_at_table',
    title: 'Eat at the table',
    description:
      'One meal at a table, away from a screen. It changes how much you notice you have eaten.',
    defaultTime: 'EVENING',
    fullVersion: { title: 'Eat at the table', minutes: 25 },
    minimumVersion: { title: 'One course at the table', minutes: 10 },
  },
  {
    key: 'limit_alcohol_work_nights',
    title: 'Work nights stay dry',
    description:
      'A rule about the nights rather than the amount, so there is nothing to decide on a Tuesday.',
    defaultTime: 'EVENING',
    fullVersion: { title: 'Work nights stay dry', minutes: 5 },
    minimumVersion: { title: 'Decide tonight’s answer now', minutes: 1 },
  },
];

export const NUTRITION_BEHAVIOR_KEYS = NUTRITION_BEHAVIORS.map(
  (behaviour) => behaviour.key,
) as [string, ...string[]];

const BY_KEY = new Map(NUTRITION_BEHAVIORS.map((behaviour) => [behaviour.key, behaviour]));

export function findBehaviour(key: string): NutritionBehaviour | undefined {
  return BY_KEY.get(key);
}
