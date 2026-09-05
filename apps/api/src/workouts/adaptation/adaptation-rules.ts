import type { PlanChange } from '../../coach/proposals/plan-change.schema';

// =============================================================================
// When a workout program is not working (issue #88, epic E09)
// =============================================================================
//
// PRD §43 lists the signals; VISION §14 supplies the sentence: "You've skipped
// this 55-minute session three times… The plan is too long. Let's rebuild it as
// a 30-minute session."
//
// PURE, AND DELIBERATELY NOT A MODEL. "Has this been skipped twice in a
// fortnight?" is counting. A model asked the same question would answer
// differently on different days, and the answer decides whether the user is
// shown a proposal about their own failure — the one place in this product
// where a false positive is actively unkind.
//
// EVERY DETECTOR EMITS `reduce` OR `replace`, NEVER `move`, `add`, `remove` OR
// `pause`. A workout proposal is always "this is too long" or "swap this
// movement"; the other ops would need a reason this data cannot supply.
//
// AND NOTHING HERE WRITES. The rules return candidates; the service turns them
// into `plan_change_proposals` rows, and the plan changes only when the user
// accepts (PRD §15).
// =============================================================================

export type DetectorCode = 'SKIPPED_TWICE' | 'TOO_LONG' | 'EXERCISE_SKIPPED' | 'DISLIKED';

/** How many skips or over-runs in the window before we say anything. */
export const SIGNAL_THRESHOLD = 2;

/** The window, in days. Two weeks: long enough for a pattern, short enough to be about now. */
export const WINDOW_DAYS = 14;

/** How much over target a session has to run to count as too long, in minutes. */
export const OVER_RUN_MINUTES = 15;

/** How many recent sessions an exercise has to be absent from to count as skipped. */
export const EXERCISE_SKIP_SESSIONS = 3;

/** What a reduction keeps. 0.65 of 40 minutes is 26 — a real change, not a nudge. */
export const REDUCE_FACTOR = 0.65;

/** No proposal ever suggests a session shorter than this. */
export const MINIMUM_MINUTES = 15;

/** Templates with at least this many movements get the "move the accessories" line. */
export const ACCESSORY_HINT_EXERCISES = 5;

export interface TemplateSignals {
  templateId: string;
  templateName: string;
  /** The FULL template's routine on the ACTIVE version. Null means unlinked. */
  routineId: string | null;
  targetMinutes: number;
  exercises: Array<{
    templateExerciseId: string;
    exerciseId: string;
    name: string;
    dislikedAt: Date | null;
    /** The catalog alternatives this movement can be swapped for, in order. */
    alternativeExerciseIds: string[];
  }>;
  /** SKIPPED or MISSED commitments of this template inside the window. */
  skippedCount: number;
  /** Minutes of each COMPLETED session inside the window, newest first. */
  sessionMinutes: number[];
  /** Exercise ids with at least one logged set, per recent session, newest first. */
  recentSessionExerciseIds: string[][];
}

export interface AdaptationCandidate {
  detector: DetectorCode;
  templateId: string;
  templateName: string;
  summary: string;
  changes: PlanChange[];
}

/** The duration a reduction lands on: 65 %, to the nearest 5, floored at 15. */
export function reducedMinutes(targetMinutes: number): number {
  return Math.max(MINIMUM_MINUTES, Math.round((targetMinutes * REDUCE_FACTOR) / 5) * 5);
}

function reduceChange(
  signals: TemplateSignals,
  reason: string,
): PlanChange | null {
  if (!signals.routineId) return null;

  const after = reducedMinutes(signals.targetMinutes);

  // A "reduce" that does not reduce is rejected by `planChangeSchema`, and
  // rightly: it is the one wrong answer a user would accept without reading.
  if (after >= signals.targetMinutes) return null;

  return {
    op: 'reduce',
    target: { type: 'routine', id: signals.routineId },
    before: { estimatedDurationMin: signals.targetMinutes },
    after: { estimatedDurationMin: after },
    reason: reason.slice(0, 200),
    workout: { templateId: signals.templateId },
  };
}

function replaceChange(
  signals: TemplateSignals,
  exercise: TemplateSignals['exercises'][number],
  reason: string,
): PlanChange | null {
  const alternative = exercise.alternativeExerciseIds[0];

  // No alternative is a real answer: proposing "replace this with nothing"
  // would be worse than saying nothing at all.
  if (!signals.routineId || !alternative) return null;

  return {
    op: 'replace',
    target: { type: 'routine', id: signals.routineId },
    before: { title: signals.templateName },
    after: { title: signals.templateName },
    reason: reason.slice(0, 200),
    workout: {
      templateId: signals.templateId,
      replaceExercise: {
        templateExerciseId: exercise.templateExerciseId,
        alternativeExerciseId: alternative,
      },
    },
  };
}

/**
 * Everything worth telling the user about one template.
 *
 * At most ONE candidate per template. Two proposals about the same workout in
 * the same week is a product nagging somebody about a plan they already know
 * is not working — and the duration signal subsumes the exercise one anyway:
 * a session that keeps getting skipped for being long does not also need a
 * movement swapped this fortnight.
 */
export function detectForTemplate(signals: TemplateSignals): AdaptationCandidate | null {
  const accessoryHint =
    signals.exercises.length >= ACCESSORY_HINT_EXERCISES
      ? ' The accessory work can move to another day.'
      : '';

  if (signals.skippedCount >= SIGNAL_THRESHOLD) {
    const after = reducedMinutes(signals.targetMinutes);
    const change = reduceChange(
      signals,
      `Skipped ${signals.skippedCount} times in two weeks — the plan is probably too long.` +
        accessoryHint,
    );

    if (change) {
      return {
        detector: 'SKIPPED_TWICE',
        templateId: signals.templateId,
        templateName: signals.templateName,
        summary:
          `You've skipped ${signals.templateName} ${signals.skippedCount} times in two weeks. ` +
          `A ${signals.targetMinutes}-minute session is a lot to find. ` +
          `Shall we rebuild it as ${after} minutes?`,
        changes: [change],
      };
    }
  }

  const overRuns = signals.sessionMinutes.filter(
    (minutes) => minutes > signals.targetMinutes + OVER_RUN_MINUTES,
  );

  if (overRuns.length >= SIGNAL_THRESHOLD) {
    const average = Math.round(overRuns.reduce((a, b) => a + b, 0) / overRuns.length);
    const after = reducedMinutes(signals.targetMinutes);
    const change = reduceChange(
      signals,
      `Sessions ran ${average} min against a ${signals.targetMinutes} min plan.` + accessoryHint,
    );

    if (change) {
      return {
        detector: 'TOO_LONG',
        templateId: signals.templateId,
        templateName: signals.templateName,
        summary:
          `${signals.templateName} keeps running about ${average} minutes against a ` +
          `${signals.targetMinutes}-minute plan. Shall we make the plan honest at ${after}?`,
        changes: [change],
      };
    }
  }

  const disliked = signals.exercises.find((exercise) => exercise.dislikedAt !== null);

  if (disliked) {
    const change = replaceChange(signals, disliked, 'You marked this exercise as disliked.');

    if (change) {
      return {
        detector: 'DISLIKED',
        templateId: signals.templateId,
        templateName: signals.templateName,
        summary: `You said you'd rather not do ${disliked.name}. Shall we swap it?`,
        changes: [change],
      };
    }
  }

  // Absent from every one of the last three sessions the user actually did.
  // Fewer than three sessions is not enough to call it avoidance.
  if (signals.recentSessionExerciseIds.length >= EXERCISE_SKIP_SESSIONS) {
    const recent = signals.recentSessionExerciseIds.slice(0, EXERCISE_SKIP_SESSIONS);

    const skipped = signals.exercises.find((exercise) =>
      recent.every((ids) => !ids.includes(exercise.exerciseId)),
    );

    if (skipped) {
      const change = replaceChange(
        signals,
        skipped,
        `Skipped in the last ${EXERCISE_SKIP_SESSIONS} sessions.`,
      );

      if (change) {
        return {
          detector: 'EXERCISE_SKIPPED',
          templateId: signals.templateId,
          templateName: signals.templateName,
          summary:
            `${skipped.name} hasn't been done in your last ${EXERCISE_SKIP_SESSIONS} ` +
            `${signals.templateName} sessions. Shall we swap it for something you'll do?`,
          changes: [change],
        };
      }
    }
  }

  return null;
}

export function detect(templates: TemplateSignals[]): AdaptationCandidate[] {
  return templates
    .map(detectForTemplate)
    .filter((candidate): candidate is AdaptationCandidate => candidate !== null);
}

/**
 * The equipment-driven swap E09-06's equipment check asks for.
 *
 * Separate from the detectors because its trigger is a photograph rather than a
 * fortnight of behaviour, and it names the missing equipment in the reason.
 */
export function substitutionCandidate(
  signals: TemplateSignals,
  substitutions: Array<{ templateExerciseId: string; alternativeExerciseId: string }>,
  missingEquipment: string,
): AdaptationCandidate | null {
  const changes = substitutions
    .map((substitution) => {
      const exercise = signals.exercises.find(
        (row) => row.templateExerciseId === substitution.templateExerciseId,
      );

      return exercise
        ? replaceChange(
            signals,
            { ...exercise, alternativeExerciseIds: [substitution.alternativeExerciseId] },
            `No ${missingEquipment} available.`,
          )
        : null;
    })
    .filter((change): change is PlanChange => change !== null);

  if (changes.length === 0) return null;

  return {
    detector: 'EXERCISE_SKIPPED',
    templateId: signals.templateId,
    templateName: signals.templateName,
    summary: `${signals.templateName} needs ${missingEquipment}, which you don't have. Shall we swap those movements?`,
    changes,
  };
}
