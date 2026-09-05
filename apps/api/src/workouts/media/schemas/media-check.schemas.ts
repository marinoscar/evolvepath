import { z } from 'zod';

import { NUTRITION_BEHAVIOR_KEYS } from '../../../health-domain/nutrition/nutrition-behaviors';

// =============================================================================
// What the media analyst may say (issue #92, epic E09)
// =============================================================================
//
// Three narrow contracts rather than one "describe this image". A typed output
// is what lets the safety post-processing act on it: `riskFlags` is a closed
// list precisely so "the model mentioned pain somewhere in a paragraph" is not
// something anybody has to detect with a regex over prose.
//
// AND WHAT IS ABSENT IS THE POINT. There is no score, no rep count, no tempo
// and no "form grade" on the form check (PRD §106 excludes biomechanical
// scoring); there is no calorie, macro or portion weight on the meal check
// (PRD §46, VISION §16). A field the model cannot fill is a field it cannot
// invent.
// =============================================================================

export const FORM_CHECK_PROMPT_VERSION = 'form_check.v1';
export const EQUIPMENT_CHECK_PROMPT_VERSION = 'equipment_check.v1';
export const MEAL_CHECK_PROMPT_VERSION = 'meal_check.v1';

export const RISK_FLAGS = [
  'pain_reported',
  'joint_instability',
  'spinal_rounding_under_load',
  'loss_of_control',
  'unclear_footage',
  'none',
] as const;

export type RiskFlag = (typeof RISK_FLAGS)[number];

/** The two flags that stop the coaching and start the professional-care copy. */
export const REDIRECTING_FLAGS: RiskFlag[] = ['pain_reported', 'joint_instability'];

export const formCheckSchema = z.object({
  observations: z.array(z.string().max(200)).max(6),
  cues: z.array(z.string().max(160)).max(3),
  riskFlags: z.array(z.enum(RISK_FLAGS)).min(1),
  safetyNote: z.string().max(300).nullable(),
  confidence: z.enum(['low', 'medium', 'high']),
});

export type FormCheckOutput = z.infer<typeof formCheckSchema>;

export const EQUIPMENT_VALUES = [
  'BODYWEIGHT',
  'DUMBBELL',
  'BARBELL',
  'MACHINE',
  'CABLE',
  'KETTLEBELL',
  'BAND',
  'BENCH',
] as const;

export const equipmentCheckSchema = z.object({
  equipmentDetected: z.array(z.enum(EQUIPMENT_VALUES)),
  notes: z.array(z.string().max(200)).max(5),
});

export type EquipmentCheckOutput = z.infer<typeof equipmentCheckSchema>;

export const mealCheckSchema = z.object({
  observations: z.array(z.string().max(200)).max(5),
  behaviorSuggestions: z
    .array(
      z.object({
        key: z.enum(NUTRITION_BEHAVIOR_KEYS),
        text: z.string().max(200),
      }),
    )
    .max(3),
});

export type MealCheckOutput = z.infer<typeof mealCheckSchema>;

/**
 * Anything that would turn a meal photograph into accounting.
 *
 * PRD §46 and VISION §16 are unambiguous that V1 nutrition is behaviours, and
 * the prompt says so — but a model that has read the whole internet will
 * volunteer "roughly 600 kcal" unprompted, and the sentence is plausible,
 * specific and wrong. The guard rejects the whole output rather than editing
 * it: a stripped sentence reads as an omission, and we would be publishing the
 * rest of a reply that had already ignored its instructions.
 */
export const CALORIE_PATTERN =
  /\b(kcal|calorie|calories|carbs?|macros?|grams? of|protein content|\d+\s?g\b)\b/i;

export function mentionsAccounting(output: MealCheckOutput): boolean {
  const text = [
    ...output.observations,
    ...output.behaviorSuggestions.map((suggestion) => suggestion.text),
  ].join(' ');

  return CALORIE_PATTERN.test(text);
}
