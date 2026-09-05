import {
  CALORIE_PATTERN,
  equipmentCheckSchema,
  formCheckSchema,
  mealCheckSchema,
  mentionsAccounting,
  REDIRECTING_FLAGS,
} from './media-check.schemas';
import {
  EQUIPMENT_CHECK_INSTRUCTIONS,
  FORM_CHECK_INSTRUCTIONS,
  MEAL_CHECK_INSTRUCTIONS,
} from '../prompts/media-check.prompts';

// =============================================================================
// The contracts, and the two guards they exist to make possible (issue #92)
// =============================================================================

describe('formCheckSchema', () => {
  const valid = {
    observations: ['The bar drifts forward on the way up.'],
    cues: ['Try keeping the bar over your mid-foot.'],
    riskFlags: ['none' as const],
    safetyNote: null,
    confidence: 'medium' as const,
  };

  it('accepts a well-formed check', () => {
    expect(formCheckSchema.safeParse(valid).success).toBe(true);
  });

  it('refuses more than three cues', () => {
    expect(
      formCheckSchema.safeParse({ ...valid, cues: ['a', 'b', 'c', 'd'] }).success,
    ).toBe(false);
  });

  it('refuses a risk flag outside the closed list', () => {
    expect(
      formCheckSchema.safeParse({ ...valid, riskFlags: ['looks_like_tendinitis'] }).success,
    ).toBe(false);
  });

  it('requires at least one flag, so "nothing said" is impossible', () => {
    expect(formCheckSchema.safeParse({ ...valid, riskFlags: [] }).success).toBe(false);
  });

  it('has no score, grade or rep count to fill in', () => {
    // PRD §106 excludes biomechanical scoring. A field the model cannot fill is
    // a field it cannot invent.
    expect(Object.keys(formCheckSchema.shape).sort()).toEqual([
      'confidence',
      'cues',
      'observations',
      'riskFlags',
      'safetyNote',
    ]);
  });

  it('names the two flags that stop the coaching', () => {
    expect(REDIRECTING_FLAGS).toEqual(['pain_reported', 'joint_instability']);
  });
});

describe('equipmentCheckSchema', () => {
  it('accepts only the equipment enum', () => {
    expect(
      equipmentCheckSchema.safeParse({ equipmentDetected: ['DUMBBELL'], notes: [] }).success,
    ).toBe(true);
    expect(
      equipmentCheckSchema.safeParse({ equipmentDetected: ['SLED'], notes: [] }).success,
    ).toBe(false);
  });
});

describe('mealCheckSchema', () => {
  it('accepts only behaviours from the registry', () => {
    expect(
      mealCheckSchema.safeParse({
        observations: ['A protein source and a green vegetable.'],
        behaviorSuggestions: [
          { key: 'vegetables_with_dinner', text: 'Keep doing this at dinner.' },
        ],
      }).success,
    ).toBe(true);

    expect(
      mealCheckSchema.safeParse({
        observations: [],
        behaviorSuggestions: [{ key: 'count_your_macros', text: 'no' }],
      }).success,
    ).toBe(false);
  });

  it('has no calorie, macro or portion field', () => {
    expect(Object.keys(mealCheckSchema.shape).sort()).toEqual([
      'behaviorSuggestions',
      'observations',
    ]);
  });
});

describe('the no-accounting guard', () => {
  it.each([
    'Roughly 600 kcal on that plate.',
    'About 40 grams of protein.',
    'A calorie-dense meal.',
    'Watch the carbs here.',
    'Around 30g of fat.',
    'Balance your macros.',
  ])('catches %s', (sentence) => {
    expect(CALORIE_PATTERN.test(sentence)).toBe(true);
  });

  it.each([
    'There is a protein source and a green vegetable on the plate.',
    'The portion looks like something you would finish comfortably.',
    'Eaten at a table rather than at a desk.',
  ])('leaves behaviour-level observation alone: %s', (sentence) => {
    expect(CALORIE_PATTERN.test(sentence)).toBe(false);
  });

  it('reads the suggestions as well as the observations', () => {
    expect(
      mentionsAccounting({
        observations: ['A protein source is present.'],
        behaviorSuggestions: [
          { key: 'protein_with_meals', text: 'Aim for 30 grams of protein here.' },
        ],
      }),
    ).toBe(true);
  });

  it('passes a clean answer', () => {
    expect(
      mentionsAccounting({
        observations: ['A protein source and vegetables.'],
        behaviorSuggestions: [
          { key: 'vegetables_with_dinner', text: 'Keep the greens on the plate.' },
        ],
      }),
    ).toBe(false);
  });
});

describe('the prompts', () => {
  it('tells the form check to describe only what it can see, and never diagnose', () => {
    expect(FORM_CHECK_INSTRUCTIONS).toContain('ONLY WHAT IS VISIBLE');
    expect(FORM_CHECK_INSTRUCTIONS).toContain('NEVER DIAGNOSE');
    expect(FORM_CHECK_INSTRUCTIONS).toContain('There is no score here');
  });

  it('tells the equipment check not to assume what a gym usually has', () => {
    expect(EQUIPMENT_CHECK_INSTRUCTIONS).toContain('If it is not in the picture, it is not there');
  });

  it('tells the meal check never to count', () => {
    expect(MEAL_CHECK_INSTRUCTIONS).toContain('NEVER estimate calories');
    expect(MEAL_CHECK_INSTRUCTIONS).toContain('never call a meal good or bad');
  });
});
