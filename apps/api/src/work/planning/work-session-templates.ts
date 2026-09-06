import { localDate } from '../../today/local-date';
import { addDays, localTimeToInstant, weekdayOf } from '../../weekly/week-bounds';
import type { WorkSessionPlan } from './work-session-plan.schema';

// =============================================================================
// The deterministic session plan (issue #108, epic E07)
// =============================================================================
//
// PRD §120: the product works with the provider down. This is what "works"
// means for planning — not an error page with a retry button, but a plan the
// user can actually apply, made of the only two things the server knows without
// a model: which days are weekdays, and how many minutes the user said they
// have.
//
// It is deliberately GENERIC, and says so in its own rationale. A template
// pretending to be a bespoke plan would be worse than an outage: the user would
// follow it believing a coach wrote it.
//
// PURE. `now` and `timezone` come in; nothing here reads a clock or a database,
// which is what lets its spec run the same function over a dozen zones.
// =============================================================================

/** Past ten sessions a "standard plan" is a schedule the user did not ask for. */
export const TEMPLATE_MAX_SESSIONS = 10;

/** With no target date: one working week. */
export const TEMPLATE_DEFAULT_SESSIONS = 5;

/** A focused block that fits inside a normal morning. */
export const TEMPLATE_MAX_SESSION_MINUTES = 45;

/** The hour a "standard plan" puts work at, local. */
export const TEMPLATE_SESSION_TIME = '09:00';

/**
 * The three-act shape of finishing almost anything. Deliberately not tailored:
 * inventing outcome-specific deliverables is exactly the judgement the model
 * was going to supply, and guessing it badly reads worse than being honest.
 */
export const TEMPLATE_MILESTONES = [
  'Clarify what done looks like',
  'Produce a rough first version',
  'Refine and finish',
] as const;

export const TEMPLATE_MINIMUM_START_TITLE =
  'Open the work and write the next three bullets';

export interface TemplateInput {
  outcome: { title: string };
  now: Date;
  timezone: string;
  /** `YYYY-MM-DD`, or null for the default one-week horizon. */
  targetDate: string | null;
  availableMinutesPerDay: number;
}

/** True for Saturday and Sunday. `weekdayOf` is 0 = Sunday … 6 = Saturday. */
function isWeekend(dateLocal: string): boolean {
  const weekday = weekdayOf(dateLocal);
  return weekday === 0 || weekday === 6;
}

/**
 * The days a standard plan uses: weekdays from tomorrow to the target date.
 *
 * Falls back to every day in the range when the range contains no weekday at
 * all — a target date on Sunday with today being Saturday is a real request,
 * and answering it with an empty plan would be a refusal dressed as a feature.
 */
export function templateDays(
  todayLocal: string,
  targetDate: string | null,
  max: number = TEMPLATE_MAX_SESSIONS,
): string[] {
  if (!targetDate) {
    const days: string[] = [];
    let cursor = addDays(todayLocal, 1);

    while (days.length < TEMPLATE_DEFAULT_SESSIONS) {
      if (!isWeekend(cursor)) days.push(cursor);
      cursor = addDays(cursor, 1);
    }

    return days;
  }

  const all: string[] = [];
  let cursor = addDays(todayLocal, 1);

  // Bounded by the range itself; `TARGET_DATE_PAST` already guarantees the
  // range is non-empty, and the guard caps a pathological target date.
  for (let guard = 0; cursor <= targetDate && guard < 366; guard += 1) {
    all.push(cursor);
    cursor = addDays(cursor, 1);
  }

  const weekdays = all.filter((day) => !isWeekend(day));
  const candidates = weekdays.length > 0 ? weekdays : all;

  return spreadEvenly(candidates, Math.min(max, candidates.length));
}

/**
 * `count` days taken evenly from `days`, always including the first and last.
 *
 * Evenly rather than "the first N": a plan for a deadline six weeks out that
 * front-loads every session into next week is not a plan for that deadline.
 */
function spreadEvenly(days: string[], count: number): string[] {
  if (count >= days.length) return days;
  if (count <= 1) return days.slice(0, count);

  const step = (days.length - 1) / (count - 1);

  return Array.from({ length: count }, (_, i) => days[Math.round(i * step)]);
}

/** A standard schedule the user can adjust. Always passes the guardrails. */
export function buildTemplateSessionPlan(input: TemplateInput): WorkSessionPlan {
  const todayLocal = localDate(input.now, input.timezone);
  const days = templateDays(todayLocal, input.targetDate, TEMPLATE_MAX_SESSIONS);

  const durationMinutes = Math.max(
    10,
    Math.min(input.availableMinutesPerDay, TEMPLATE_MAX_SESSION_MINUTES),
  );

  // Strictly smaller than the session, and never below the schema's floor of 2.
  const minimumMinutes = Math.max(2, Math.min(10, durationMinutes - 5));

  const milestones = TEMPLATE_MILESTONES.map((title, order) => ({ title, order }));

  const sessions = days.map((day, index) => ({
    title: `${durationMinutes} min on ${input.outcome.title}`.slice(0, 120),
    scheduledStart: localTimeToInstant(
      day,
      TEMPLATE_SESSION_TIME,
      input.timezone,
    ).toISOString(),
    durationMinutes,
    // Thirds, so the three acts each get a share of however many days there are.
    milestoneIndex: Math.min(
      TEMPLATE_MILESTONES.length - 1,
      Math.floor((index * TEMPLATE_MILESTONES.length) / days.length),
    ),
    minimumStart: { title: TEMPLATE_MINIMUM_START_TITLE, minutes: minimumMinutes },
  }));

  return {
    milestones,
    sessions,
    implementationIntention: {
      when: 'After I sit down at my desk in the morning',
      then: `I open "${input.outcome.title}" and start the next planned session`.slice(0, 160),
    },
    reviewCadence: 'WEEKLY',
    rationale:
      'This is a standard schedule, not a tailored one: one block a day on weekdays at ' +
      '09:00, spread evenly up to your target date. Change the days, the times and the ' +
      'durations to fit your week before you apply it.',
  };
}
