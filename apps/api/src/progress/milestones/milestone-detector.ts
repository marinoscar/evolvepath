import type { Domain, MilestoneKind } from '@prisma/client';

// =============================================================================
// What has this person reached? (issue #115, epic E11)
// =============================================================================
//
// PRD §55's list, as a pure function over counts. No Prisma, no clock of its
// own — the caller loads the numbers and the rules live here where a fixture
// can pin each one.
//
// TWO KINDS REPEAT AND FOUR DO NOT, and `sequence` is how the difference is
// expressed. The fourth four-week stretch is a genuinely different fact from
// the first; "ten workouts" said a second time is the confetti PRD §77 rules
// out. Everything already in `existing` is filtered here, and the unique
// database index is the second guard — a detector that ran twice concurrently
// must not be able to award twice.
// =============================================================================

/** How many counted weeks make one FOUR_WEEKS milestone. */
export const WEEKS_PER_MILESTONE = 4;
/** How many workouts make one TEN_WORKOUTS milestone. */
export const WORKOUTS_PER_MILESTONE = 10;
/** What "reduced reminders" means, once E12 can measure it. */
export const REDUCED_REMINDERS_RATIO = 0.7;
export const REDUCED_REMINDERS_MIN_SAMPLE = 10;

export interface MilestoneInput {
  now: Date;
  existing: Array<{ kind: MilestoneKind; sequence: number }>;
  /** The current run, from E11-01's `computeConsistencyRun`. */
  consistencyRunWeeks: number;
  /** Successful weeks over the whole history, not only the current run. */
  successfulWeeksEver: number;
  /** Distinct HEALTH workout completions, ever. */
  workoutCompletions: number;
  /** `recovery` evidence rows, ever. */
  comebackCompletions: number;
  /** The earliest start on something moved twice or more. */
  startedAfterPostpone: { commitmentId: string; at: Date } | null;
  /** E11-01's reader. `ratio` is null until E12-06 lands. */
  independence: { ratio: number | null; sampleSize: number };
}

export interface MilestoneCandidate {
  kind: MilestoneKind;
  sequence: number;
  domain: Domain | null;
  achievedAt: Date;
  meta: Record<string, unknown>;
}

export function detectMilestones(input: MilestoneInput): MilestoneCandidate[] {
  const has = (kind: MilestoneKind, sequence: number) =>
    input.existing.some((row) => row.kind === kind && row.sequence === sequence);

  const candidates: MilestoneCandidate[] = [];

  const once = (
    kind: MilestoneKind,
    when: boolean,
    over: Partial<MilestoneCandidate> = {},
  ) => {
    if (!when || has(kind, 1)) return;
    candidates.push({
      kind,
      sequence: 1,
      domain: null,
      achievedAt: input.now,
      meta: {},
      ...over,
    });
  };

  once('FIRST_FULL_WEEK', input.successfulWeeksEver >= 1);
  once('FIRST_COMEBACK', input.comebackCompletions >= 1);
  once('FIRST_START_AFTER_POSTPONE', input.startedAfterPostpone !== null, {
    achievedAt: input.startedAfterPostpone?.at ?? input.now,
    meta: { commitmentId: input.startedAfterPostpone?.commitmentId },
  });

  // Dormant by construction, not by a feature flag: no ratio, no award. E12-06
  // supplies the reader and this rule starts firing with no code change.
  once(
    'REDUCED_REMINDERS',
    input.independence.ratio !== null &&
      input.independence.ratio >= REDUCED_REMINDERS_RATIO &&
      input.independence.sampleSize >= REDUCED_REMINDERS_MIN_SAMPLE,
  );

  // Every unawarded step, not only the latest: a user whose first sweep runs
  // after nine weeks has earned both the fourth and the eighth.
  const steps = (total: number, per: number) => Math.floor(total / per);

  for (let n = 1; n <= steps(input.consistencyRunWeeks, WEEKS_PER_MILESTONE); n += 1) {
    if (has('FOUR_WEEKS', n)) continue;
    candidates.push({
      kind: 'FOUR_WEEKS',
      sequence: n,
      domain: null,
      achievedAt: input.now,
      meta: { weeks: n * WEEKS_PER_MILESTONE },
    });
  }

  for (let n = 1; n <= steps(input.workoutCompletions, WORKOUTS_PER_MILESTONE); n += 1) {
    if (has('TEN_WORKOUTS', n)) continue;
    candidates.push({
      kind: 'TEN_WORKOUTS',
      sequence: n,
      domain: 'HEALTH',
      achievedAt: input.now,
      meta: { count: n * WORKOUTS_PER_MILESTONE },
    });
  }

  return candidates;
}
