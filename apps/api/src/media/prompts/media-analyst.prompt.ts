import { MediaKind, MediaPurpose } from '@prisma/client';

/**
 * Bump on every meaningful change to the instructions below.
 *
 * Nothing can detect that for you, and this string is what makes "did the
 * coach get worse after we changed the prompt?" answerable from
 * `ai_invocations`.
 */
export const MEDIA_ANALYST_PROMPT_VERSION = 'media_analyst.v1';

/**
 * What every purpose is held to, regardless of what was photographed.
 *
 * "Say when the frames are unclear" is here rather than in the per-purpose
 * blocks because it is the one instruction that keeps the whole feature
 * honest: a model asked to coach from a blurry video will coach from a blurry
 * video.
 */
const COMMON_RULES = `
You are looking at what the user photographed or filmed and answering them
directly, in plain language: warm, specific, and grounded in what is visible.

Rules that apply to every answer:
- Describe ONLY what is visible. If the frames are unclear, dark, or cut off,
  say so in the summary rather than guessing.
- One short summary, then observations, then practical advice.
- No medical diagnosis, ever. You are not qualified to make one from an image
  and neither is anybody else.
- Do not invent context the image does not contain — a name, a place, a date, a
  brand you cannot read.
- Keep every line to one idea. The user is often reading this on a phone,
  standing up.
`.trim();

const PURPOSE_RULES: Record<MediaPurpose, string> = {
  WORKOUT_FORM: `
This is a workout form check.

- Describe the setup, the range of motion, the bar or limb path, and the tempo,
  to the extent the frames show them.
- Give one to three practical cues the user can act on next set.
- NEVER diagnose an injury.
- Set safetyFlag.level to "seek_professional" if you see or are told about
  sharp pain, a joint giving way, or numbness or tingling. Say why, briefly,
  and give no coaching cues on that path — cues alongside "get this looked at"
  read as permission to keep going.
- Use "caution" for a technique problem that is likely to hurt somebody if it
  is repeated under load, and "none" otherwise.
`.trim(),

  EQUIPMENT: `
This is a photo of the equipment the user has available.

- List what you can actually recognise. A shape you are not sure about is a
  shape you say you are not sure about.
- Note what is usable for strength training and roughly what it is good for.
- Do not claim a weight, a brand or a model number you cannot read.
- safetyFlag is almost always "none" here; use "caution" only for something
  visibly damaged or unsafe.
`.trim(),

  MEAL: `
This is a photo of food.

- BEHAVIOUR LEVEL ONLY. Observe things like: is there a protein source, are
  there vegetables, what does the portion pattern look like, is this a meal or
  a snack.
- NEVER estimate or mention calories, macronutrients, grams, or any number
  describing the food's energy or composition. Not as a range, not as a guess,
  not with a caveat.
- NEVER judge the user's weight or their body, and never call a meal good or
  bad. Describe the pattern; suggest one small change if there is an obvious
  one.
- safetyFlag is "none" unless the food is visibly unsafe to eat.
`.trim(),

  GENERAL: `
The user has not said what this is for.

- Describe what you see, then answer their question if they asked one.
- If there is no question and no obvious subject, say what you see and ask what
  they wanted to know.
`.trim(),
};

/** The instructions for one purpose: the common rules plus its own. */
export function buildMediaAnalystInstructions(purpose: MediaPurpose): string {
  return `${COMMON_RULES}\n\n${PURPOSE_RULES[purpose]}`;
}

export interface MediaAnalystInputContext {
  purpose: MediaPurpose;
  kind: MediaKind;
  question?: string | null;
  frameTimestampsMs?: number[];
  durationMs?: number | null;
}

/**
 * The text part of the user turn.
 *
 * It names WHAT THE MODEL IS LOOKING AT — "6 frames at 0.2 s, 0.6 s, …" — for a
 * reason that is not decoration: without it, a model handed six images of a
 * squat has no way to know whether it is seeing one rep from six angles or six
 * reps, and it will confidently pick one.
 */
export function buildMediaAnalystInput(
  context: MediaAnalystInputContext,
): string {
  const lines: string[] = [];

  if (context.kind === 'VIDEO') {
    const seconds = context.durationMs
      ? `${Math.round(context.durationMs / 1000)} s`
      : 'unknown length';
    const stamps = (context.frameTimestampsMs ?? [])
      .map((ms) => `${(ms / 1000).toFixed(1)} s`)
      .join(', ');

    lines.push(
      stamps
        ? `Video, ${seconds}, ${context.frameTimestampsMs!.length} frames sampled evenly at ${stamps}. They are one continuous clip, in order.`
        : `Video, ${seconds}.`,
    );
  } else {
    lines.push('Photo.');
  }

  lines.push(
    context.question?.trim()
      ? `The user asks: ${context.question.trim()}`
      : 'The user did not ask anything specific.',
  );

  return lines.join('\n');
}
