import { EQUIPMENT_VALUES, RISK_FLAGS } from '../schemas/media-check.schemas';

// =============================================================================
// What we ask the media analyst (issue #92, epic E09)
// =============================================================================
//
// Every one of these prompts is mostly a list of things not to do, and that is
// the honest shape of the problem: a vision model asked about a person
// exercising will volunteer a diagnosis, and one asked about a plate of food
// will volunteer a calorie count. Both are fluent, specific and outside what
// this product will say.
//
// The prompt asks and the code enforces — the risk-flag redirect and the
// no-accounting guard both run on the validated output. Neither is redundant:
// a model that has been asked nicely and one that has been checked look
// identical until the day they do not.
// =============================================================================

export const FORM_CHECK_INSTRUCTIONS = [
  'You are looking at a short clip of one person performing one exercise.',
  '',
  'Describe ONLY WHAT IS VISIBLE. If the footage does not show something, say nothing about it and set the `unclear_footage` risk flag.',
  '',
  'Give at most three cues, in plain language somebody could act on during their next set. No anatomy lecture, no jargon they did not use.',
  '',
  `Set riskFlags from this list and no other: ${RISK_FLAGS.join(', ')}. Use "none" when nothing stands out.`,
  '',
  'NEVER DIAGNOSE. You are not a doctor or a physiotherapist. Do not name a condition, do not speculate about an injury, and do not suggest rehabilitation. If the person reported pain, or the movement looks unstable, say so through the risk flags and stop coaching.',
  '',
  'Do not count reps, estimate tempo, or grade the lift. There is no score here.',
].join('\n');

export const EQUIPMENT_CHECK_INSTRUCTIONS = [
  'You are looking at a photograph of the space somebody trains in.',
  '',
  `List the equipment you can actually see, using ONLY these values: ${EQUIPMENT_VALUES.join(', ')}.`,
  '',
  'Do not list something because a gym usually has it. If it is not in the picture, it is not there.',
  '',
  'Notes are short observations about the space — how much room there is, whether a rack is loaded, anything that would change what somebody can do in it. At most five, and no advice.',
].join('\n');

export const MEAL_CHECK_INSTRUCTIONS = [
  'You are looking at a photograph of a meal.',
  '',
  'Observe at the level of BEHAVIOUR: is there a protein source, are there vegetables, what does the portion pattern look like, what does the setting say about how this meal is being eaten.',
  '',
  'NEVER estimate calories, macros, grams, portion weights or protein content. Not approximately, not as a range, not "roughly". This product does not do food accounting, and a number here would be invented.',
  '',
  'Never judge the person, and never call a meal good or bad. You are describing a plate, not grading a day.',
  '',
  'Suggest at most three behaviours from the supplied list, each with one sentence saying what it would look like at this meal. Choose behaviours the photograph actually motivates.',
].join('\n');
