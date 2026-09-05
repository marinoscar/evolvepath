import {
  BEGINNER_MAX_DAYS,
  MINUTES_TOLERANCE_PCT,
} from './workout-program-rules';

// =============================================================================
// What we ask the workout programmer for (issue #77, epic E09)
// =============================================================================
//
// The prompt ASKS and `workout-program-rules.ts` ENFORCES, and that is not
// redundant — it is the same division the coach output guard makes. A model
// that has been asked for four days and returns five is a normal Tuesday; the
// difference between asking and checking is whether the user finds out.
//
// Bump `PROGRAM_PROMPT_VERSION` in `workout-program.schema.ts` whenever this
// text changes meaningfully. Nothing can detect that for you, and it is what
// makes "did programs get worse after we changed the prompt?" answerable.
// =============================================================================

export interface ProgramInstructionOptions {
  /** Appended verbatim when the safety pre-check returned `conservative`. */
  safetyInstructions?: string | null;
}

export function buildProgramInstructions(options: ProgramInstructionOptions = {}): string {
  const base = [
    'You are a strength coach writing a structured training program for one person.',
    '',
    'RULES — a program that breaks any of these is discarded:',
    `- Use exercise names from the supplied catalog wherever one fits. Invent a name only when nothing in the catalog is close.`,
    `- Every training day names a FULL template. Every FULL template must also appear twice more with the same name: once as SHORT (the major movements only, about 60% of the minutes) and once as MINIMUM (two or three movements, 12 minutes or less).`,
    `- A beginner trains at most ${BEGINNER_MAX_DAYS} days a week, whatever they asked for.`,
    `- Schedule exactly the number of training days the request asks for.`,
    `- A FULL session must fit the requested minutes per session, within ${MINUTES_TOLERANCE_PCT}%. Rest time dominates a session — count it.`,
    '- Rest 60 to 120 seconds after compound movements, 45 to 90 after accessories.',
    "- Respect the stated limitations. If someone reports a problem with a body part, do not prescribe movements that load it, and do not explain the injury back to them.",
    '- Progression is double progression: reps to the top of the range, then a small weight increase. Say so once; do not invent a periodization scheme.',
    '',
    'RATIONALE: two or three short paragraphs in plain language, addressed to the person, explaining why this program suits what they told you. No jargon they did not use. No promises about results or timelines.',
    '',
    'SUBSTITUTIONS: for the movements most likely to be unavailable, list one to three alternatives by name.',
    '',
    'You are not a doctor or a physiotherapist. Do not diagnose, do not name conditions, and do not give rehabilitation advice.',
  ].join('\n');

  return options.safetyInstructions
    ? `${base}\n\n${options.safetyInstructions}\n- Prefer machine and bodyweight variants, and lower the total volume by about a third.`
    : base;
}
