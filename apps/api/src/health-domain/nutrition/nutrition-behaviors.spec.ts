import {
  BEHAVIOUR_TIMES,
  findBehaviour,
  NUTRITION_BEHAVIOR_KEYS,
  NUTRITION_BEHAVIORS,
} from './nutrition-behaviors';

describe('NUTRITION_BEHAVIORS', () => {
  it('covers PRD §46\'s V1 list', () => {
    expect(NUTRITION_BEHAVIORS).toHaveLength(11);
    expect(NUTRITION_BEHAVIOR_KEYS).toEqual(
      expect.arrayContaining([
        'planned_breakfast',
        'meal_prep',
        'protein_with_meals',
        'vegetables_with_dinner',
        'water_with_meals',
        'no_late_night_eating',
        'weekday_meal_plan',
        'restaurant_strategy',
        'planned_snacks',
      ]),
    );
  });

  it('has unique keys', () => {
    expect(new Set(NUTRITION_BEHAVIOR_KEYS).size).toBe(NUTRITION_BEHAVIOR_KEYS.length);
  });

  it('gives every behaviour a minimum version that is genuinely smaller', () => {
    for (const behaviour of NUTRITION_BEHAVIORS) {
      expect(behaviour.minimumVersion.minutes).toBeLessThanOrEqual(
        behaviour.fullVersion.minutes,
      );
      expect(behaviour.minimumVersion.minutes).toBeGreaterThan(0);
      expect(behaviour.minimumVersion.title).not.toBe(behaviour.fullVersion.title);
    }
  });

  it('resolves every default time to a real wall-clock time', () => {
    for (const behaviour of NUTRITION_BEHAVIORS) {
      expect(BEHAVIOUR_TIMES[behaviour.defaultTime]).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
    }
  });

  it('mentions no calories, macros or grams anywhere', () => {
    // PRD §46 and VISION §16: behaviours only. A registry entry that started
    // counting would take the whole product with it.
    const copy = NUTRITION_BEHAVIORS.map((b) => `${b.title} ${b.description}`).join(' ');

    expect(copy).not.toMatch(/calorie|kcal|macro|grams? of|protein target of|\bBMI\b/i);
  });

  it('finds a behaviour by key and nothing by a made-up one', () => {
    expect(findBehaviour('meal_prep')?.title).toBe('Cook once, eat twice');
    expect(findBehaviour('not_a_behaviour')).toBeUndefined();
  });
});
