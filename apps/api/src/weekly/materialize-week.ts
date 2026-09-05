import { addDays, weekdayOf } from './week-bounds';
import type {
  ExtraCommitment,
  ProposedCommitment,
  WeeklyDomain,
  WeeklyDomainModes,
  WeeklyPlanConstraints,
} from './weekly.schema';

// =============================================================================
// Turning routines into next week's commitments (issue #80, epic E10)
// =============================================================================
//
// PURE. No Prisma, no Nest, no clock. E08's ritual generator solves the same
// occurrence problem for family rituals and this function is deliberately
// reusable by it; more immediately, the wizard renders exactly the summary the
// API computed rather than recomputing it, because two implementations of
// "how many commitments is this week" is two answers, and the wrong one is on
// the screen.
//
// AN EXCLUDED OCCURRENCE IS STILL AN ITEM. PRD §50 step 5 shows the user what
// their week WOULD be, so a Wednesday dropped for a travel day is rendered
// greyed with its reason rather than silently absent — a missing row is
// indistinguishable from one the product forgot about, and the user has no way
// to tell which happened.
//
// THE SAME INPUT PRODUCES THE SAME OUTPUT, byte for byte. The wizard calls
// `/propose` again on every edit, and a list that reordered itself between two
// calls would move the checkbox the user was reaching for.
// =============================================================================

/** Where a domain's commitments land when its routine names no time. */
export const DEFAULT_TIME: Record<WeeklyDomain, string> = {
  WORK: '09:00',
  FAMILY: '18:30',
  HEALTH: '07:00',
};

export type RoutineForWeek = {
  id: string;
  title: string;
  domain: WeeklyDomain;
  frequency: 'DAILY' | 'WEEKDAYS' | 'WEEKENDS' | 'WEEKLY' | 'CUSTOM';
  daysOfWeek: number[];
  preferredTime: string | null;
  estimatedDurationMin: number;
  minimumDurationMin: number;
  fallbackBehavior: string | null;
  planVersionId: string;
  outcomeId: string | null;
};

export interface MaterializeInput {
  weekStart: string;
  routines: RoutineForWeek[];
  domainModes: WeeklyDomainModes;
  constraints: WeeklyPlanConstraints;
  extras: ExtraCommitment[];
  /** Occurrences that already exist, so approving twice creates nothing twice. */
  existing: Array<{ routineId: string | null; date: string }>;
}

export function materializeWeek(input: MaterializeInput): ProposedCommitment[] {
  const { weekStart, routines, domainModes, constraints, extras, existing } = input;

  const alreadyThere = new Set(
    existing
      .filter((row) => row.routineId !== null)
      .map((row) => `${row.routineId}:${row.date}`),
  );

  const items: ProposedCommitment[] = [];

  for (const routine of routines) {
    for (const date of occurrenceDates(weekStart, routine)) {
      const key = `${routine.id}:${date}`;

      // Idempotency: this occurrence was materialised by an earlier approve.
      // Not "excluded" — it is not a proposal at all any more.
      if (alreadyThere.has(key)) continue;

      const startTime = routine.preferredTime ?? DEFAULT_TIME[routine.domain];

      items.push({
        key,
        source: 'routine',
        include: true,
        domain: routine.domain,
        title: routine.title,
        date,
        startTime,
        estimatedMinutes: routine.estimatedDurationMin,
        minimumMinutes: routine.minimumDurationMin,
        routineId: routine.id,
        planVersionId: routine.planVersionId,
        outcomeId: routine.outcomeId,
        fullVersion: routine.title,
        // A routine has two sizes, not three. Inventing a middle one would put
        // a version on the Start screen the plan never described.
        shortVersion: null,
        minimumVersion:
          routine.fallbackBehavior ?? `${routine.minimumDurationMin}-minute version`,
        recurring: true,
        excludedBy: exclusionFor(
          { domain: routine.domain, date, startTime, minutes: routine.estimatedDurationMin },
          domainModes,
          constraints,
        ),
      });
    }
  }

  for (const [index, extra] of extras.entries()) {
    items.push({
      key: `extra:${index}`,
      source: 'extra',
      include: true,
      domain: extra.domain,
      title: extra.title,
      date: extra.date,
      startTime: extra.startTime,
      estimatedMinutes: extra.estimatedMinutes,
      minimumMinutes: null,
      routineId: null,
      planVersionId: null,
      outcomeId: null,
      fullVersion: extra.title,
      shortVersion: null,
      minimumVersion: extra.minimumVersion,
      recurring: extra.recurring,
      // An extra the user typed while looking at the week is not second-guessed:
      // they can see the travel day on the same screen.
      excludedBy: null,
    });
  }

  return items
    .map((item) => (item.excludedBy ? { ...item, include: false } : item))
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.startTime.localeCompare(b.startTime) ||
        a.domain.localeCompare(b.domain) ||
        a.title.localeCompare(b.title),
    );
}

/** The local dates in this week on which a routine happens. */
function occurrenceDates(weekStart: string, routine: RoutineForWeek): string[] {
  const week = Array.from({ length: 7 }, (_, offset) => addDays(weekStart, offset));
  const on = (weekdays: number[]) => week.filter((date) => weekdays.includes(weekdayOf(date)));

  switch (routine.frequency) {
    case 'DAILY':
      return week;
    case 'WEEKDAYS':
      return on([1, 2, 3, 4, 5]);
    case 'WEEKENDS':
      return on([0, 6]);
    case 'WEEKLY':
      // The first named day, else Monday. A weekly routine with no day is a
      // rule with a hole in it, and the start of the week is the least
      // surprising place to put it.
      return routine.daysOfWeek.length > 0
        ? on([[...routine.daysOfWeek].sort((a, b) => a - b)[0]])
        : [weekStart];
    case 'CUSTOM':
      return on(routine.daysOfWeek);
  }
}

/** Why this occurrence should not happen, if it should not. */
function exclusionFor(
  occurrence: { domain: WeeklyDomain; date: string; startTime: string; minutes: number },
  domainModes: WeeklyDomainModes,
  constraints: WeeklyPlanConstraints,
): ProposedCommitment['excludedBy'] {
  if (domainModes[occurrence.domain] === 'PAUSE') return 'paused_domain';
  if (constraints.travelDays.includes(occurrence.date)) return 'travel_day';

  const start = minutesOf(occurrence.startTime);
  const end = start + occurrence.minutes;

  const collides = constraints.fixedEvents.some((event) => {
    if (event.date !== occurrence.date) return false;
    // An event with no times blocks the whole day: the user typed it without a
    // clock because they do not know, and guessing "probably an hour" would
    // let the product schedule into it.
    if (!event.startTime || !event.endTime) return true;

    return start < minutesOf(event.endTime) && minutesOf(event.startTime) < end;
  });

  return collides ? 'fixed_event' : null;
}

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);

  return hours * 60 + minutes;
}
