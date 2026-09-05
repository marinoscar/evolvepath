import type { Equipment } from '@prisma/client';

import type { WorkoutProgramProposal } from './workout-program.schema';

// =============================================================================
// The safety and budget rules a proposed program must survive (issue #77)
// =============================================================================
//
// PRD §14.5: the Workout Programming Reasoner "must operate inside safety
// rules". This file IS those rules, and it is pure — no Prisma, no Nest, no
// clock — for the same reason `materialize-week.ts` is: the generator applies
// them, the starter template is asserted against them, and a table-driven spec
// reads them. Three callers, one definition.
//
// THE RULES RUN AFTER THE MODEL, NOT INSTEAD OF IT. The prompt asks for a
// beginner-appropriate week; this checks. A model that has been asked nicely
// and a model that has been checked look identical until the day one of them
// prescribes five days of overhead pressing to somebody who wrote "bad
// shoulder" in the limitations box — and by then the program is on their Today
// screen.
//
// A violation is never a 500 and never an exception: the caller falls back to
// the deterministic starter program (PRD §120), which is a worse program and a
// working product.
// =============================================================================

export type RuleCode =
  | 'BEGINNER_MAX_DAYS'
  | 'CONTRAINDICATED'
  | 'OVER_TIME_BUDGET'
  | 'DAYS_MISMATCH';

export interface RuleViolation {
  code: RuleCode;
  message: string;
  /** The template or exercise the rule fired on, when there is one. */
  subject?: string;
}

/** Beginners get at most four training days, whatever they asked for. */
export const BEGINNER_MAX_DAYS = 4;

/** How far over the requested session length a FULL template may land. */
export const MINUTES_TOLERANCE_PCT = 10;

/** Seconds of work assumed per rep when estimating a session's length. */
export const SECONDS_PER_REP = 3;

/** Warm-up and transitions, in minutes, added to every estimate. */
export const SESSION_OVERHEAD_MINUTES = 5;

/**
 * Free text in, contraindication tags out.
 *
 * A KEYWORD MAP RATHER THAN A MODEL CALL, deliberately. This runs on the
 * fallback path too — the starter program is checked by the same rules — and a
 * safety filter that needs the provider to be up is not a safety filter.
 *
 * It is generous on purpose: "my shoulder is fine now" matches `shoulder` and
 * costs the user an overhead press they could have done. The other kind of
 * mistake costs them a shoulder.
 */
export const LIMITATION_KEYWORDS: Array<{ pattern: RegExp; tag: string }> = [
  { pattern: /shoulder/i, tag: 'shoulder' },
  { pattern: /knee/i, tag: 'knee' },
  { pattern: /\b(low(er)?\s*back|lumbar|back)\b/i, tag: 'lower_back' },
  { pattern: /wrist/i, tag: 'wrist' },
  { pattern: /\bhips?\b/i, tag: 'hip' },
  { pattern: /elbow/i, tag: 'elbow' },
  { pattern: /neck/i, tag: 'neck' },
  { pattern: /overhead/i, tag: 'overhead' },
];

export function contraindicationTagsFor(limitations: string | null | undefined): string[] {
  if (!limitations) return [];

  const tags = new Set<string>();

  for (const { pattern, tag } of LIMITATION_KEYWORDS) {
    if (pattern.test(limitations)) tags.add(tag);
  }

  return [...tags];
}

/**
 * How long a template will actually take, in minutes.
 *
 * Rest dominates: three sets of eight with 120 s rest is six minutes of rest and
 * twenty-four seconds of work. Estimating from sets alone is why "40 minute"
 * programs run an hour.
 */
export function estimateMinutes(template: {
  exercises: Array<{ sets: number; repMin: number; repMax: number; restSeconds: number }>;
}): number {
  const seconds = template.exercises.reduce((total, exercise) => {
    const avgReps = (exercise.repMin + exercise.repMax) / 2;
    return total + exercise.sets * (avgReps * SECONDS_PER_REP + exercise.restSeconds);
  }, 0);

  return Math.round(seconds / 60) + SESSION_OVERHEAD_MINUTES;
}

export interface RuleContext {
  experience: 'BEGINNER' | 'INTERMEDIATE';
  daysPerWeek: number;
  minutesPerSession: number;
  limitations?: string | null;
  /** `nameKey` → the tags that movement carries. Resolved from the catalog. */
  contraindicationsByName: Map<string, string[]>;
}

export function normalizeExerciseName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Every rule, in one pass. Returns an empty array for a proposal we will keep.
 *
 * Order matters only for readability — the caller rejects on any violation, and
 * reporting all of them at once is what makes the audit row worth reading.
 */
export function checkProgram(
  proposal: WorkoutProgramProposal,
  context: RuleContext,
): RuleViolation[] {
  const violations: RuleViolation[] = [];
  const days = proposal.weeklyStructure.length;

  if (context.experience === 'BEGINNER' && days > BEGINNER_MAX_DAYS) {
    violations.push({
      code: 'BEGINNER_MAX_DAYS',
      message: `${days} training days for a beginner; the ceiling is ${BEGINNER_MAX_DAYS}`,
    });
  }

  if (days !== context.daysPerWeek) {
    violations.push({
      code: 'DAYS_MISMATCH',
      message: `${days} training days for a request of ${context.daysPerWeek}`,
    });
  }

  const forbidden = new Set(contraindicationTagsFor(context.limitations));

  if (forbidden.size > 0) {
    for (const template of proposal.templates) {
      for (const exercise of template.exercises) {
        const tags = context.contraindicationsByName.get(
          normalizeExerciseName(exercise.exerciseName),
        );

        const hit = tags?.find((tag) => forbidden.has(tag));

        if (hit) {
          violations.push({
            code: 'CONTRAINDICATED',
            message: `${exercise.exerciseName} is tagged "${hit}" and the user reported a limitation there`,
            subject: exercise.exerciseName,
          });
        }
      }
    }
  }

  const budget = context.minutesPerSession * (1 + MINUTES_TOLERANCE_PCT / 100);

  for (const template of proposal.templates) {
    if (template.variant !== 'FULL') continue;

    const estimate = estimateMinutes(template);

    if (estimate > budget) {
      violations.push({
        code: 'OVER_TIME_BUDGET',
        message: `${template.name} runs about ${estimate} min against a ${context.minutesPerSession} min session`,
        subject: template.name,
      });
    }
  }

  return violations;
}

/** One sentence for the user when a proposal is rejected. Never the rule codes. */
export function violationMessage(violations: RuleViolation[]): string {
  if (violations.some((v) => v.code === 'CONTRAINDICATED')) {
    return 'The draft included movements that clash with what you told us about your body, so here is a conservative starter program instead.';
  }

  if (violations.some((v) => v.code === 'OVER_TIME_BUDGET')) {
    return 'The draft would have run longer than the time you have, so here is a starter program that fits.';
  }

  return 'The draft did not pass our safety checks, so here is a conservative starter program instead.';
}

/** Equipment the catalog treats as always available. */
export const ALWAYS_AVAILABLE: Equipment[] = ['BODYWEIGHT'];
