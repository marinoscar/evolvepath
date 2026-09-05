import { Injectable } from '@nestjs/common';
import type {
  Commitment,
  CommitmentStatus,
  Domain,
  Evidence,
  Reflection,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { safeTimeZone } from '../today/local-date';
import { localTimeParts, weekBounds } from './week-bounds';
import {
  weekAggregatesSchema,
  type DomainCounts,
  type TimeWindow,
  type WeekAggregates,
} from './weekly.schema';

// =============================================================================
// Planned versus actual, computed and never guessed (issue #73, epic E10)
// =============================================================================
//
// VISION §29 asks the product to compare what was planned with what happened,
// every week, as a product ritual rather than a chat. This file is the
// comparison. It is deterministic, pure below `load()`, and it never calls a
// model — PRD §120, and more than that: the numbers on the review screen are
// the one thing a user must be able to trust absolutely, and a number that came
// out of a language model is not a number, it is a claim.
//
// -----------------------------------------------------------------------------
// THREE COUNTING RULES THAT ARE NOT OBVIOUS AND ARE EASY TO GET WRONG
// -----------------------------------------------------------------------------
//
// 1. A RESCHEDULED INTENTION IS COUNTED ONCE. E02-04's reschedule closes the
//    original row as RESCHEDULED and opens a new one carrying the count. Both
//    rows are in the week, so counting `planned` naively would report two
//    workouts where the user intended one — and then report a 50% completion
//    rate for doing the only thing they meant to do. `planned` therefore
//    excludes RESCHEDULED (and CANCELLED) rows; `rescheduled` counts those
//    closed originals separately, because "you moved this twice" is real
//    information the reviewer needs.
//
// 2. A ROW STILL IN THE FUTURE IS NOT A MISS. `coverage.to` is
//    `min(weekEnd, now)`, and anything scheduled after it is excluded outright.
//    A Wednesday review that reported Friday's workout as unresolved would be
//    the product inventing a failure the user has not had yet.
//
// 3. `unresolved` IS NOT `missed`. Nothing marks a stale PLANNED row MISSED
//    until E11-02's comeback loop. Until then a past PLANNED/READY row is
//    reported as unresolved — the user may have done it and not said so, and
//    calling that a miss is an accusation dressed as a measurement (VISION §30).
// =============================================================================

/** Half a completion. A partial week is not a failed one, and not a full one. */
const PARTIAL_WEIGHT = 0.5;

/** Statuses that mean the intention no longer lives on this row. */
const NOT_PLANNED: CommitmentStatus[] = ['CANCELLED', 'RESCHEDULED'];

/** The three domains, in the order the review screen renders them. */
const DOMAINS: Domain[] = ['WORK', 'FAMILY', 'HEALTH'];

/**
 * Local-hour buckets. Coarse on purpose: PRD §29's example is "before 9 AM"
 * versus "after 4 PM", and a per-hour histogram of eleven commitments is noise
 * a reviewer would read patterns into that are not there.
 */
const TIME_WINDOWS: Array<{ window: TimeWindow; from: number; to: number }> = [
  { window: 'early_morning', from: 0, to: 6 },
  { window: 'morning', from: 7, to: 11 },
  { window: 'midday', from: 12, to: 13 },
  { window: 'afternoon', from: 14, to: 17 },
  { window: 'evening', from: 18, to: 21 },
  { window: 'night', from: 22, to: 23 },
];

export type CommitmentForWeek = Pick<
  Commitment,
  | 'id'
  | 'domain'
  | 'title'
  | 'status'
  | 'scheduledStart'
  | 'scheduledEnd'
  | 'rescheduleCount'
  | 'routineId'
  | 'versionUsed'
  | 'startedAt'
  | 'minutesSpent'
> & { estimatedMinutes: number | null };

export interface AggregationInput {
  /** Rows whose `scheduledStart` falls inside the week's bounds. */
  commitments: CommitmentForWeek[];
  evidence: Array<
    Pick<Evidence, 'commitmentId' | 'source' | 'evidenceType' | 'occurredAt' | 'quantitativeValue'>
  >;
  reflections: Array<Pick<Reflection, 'relatedType' | 'frictionTags' | 'createdAt'>>;
  /** E07-02's `focus_sessions`. Empty until that epic lands. */
  focusSessions: Array<{
    commitmentId: string | null;
    startedAt: Date;
    endedAt: Date | null;
    plannedMinutes: number;
  }>;
  /** E09-01's `workout_sessions`. Empty until that epic lands. */
  workoutSessions: Array<{
    commitmentId: string | null;
    startedAt: Date;
    finishedAt: Date | null;
    variant: 'FULL' | 'SHORT' | 'MINIMUM' | null;
  }>;
}

export interface AggregateOptions {
  now: Date;
  timeZone: string;
  weekStart: string;
}

function emptyCounts(): DomainCounts {
  return {
    planned: 0,
    completed: 0,
    partial: 0,
    missed: 0,
    unresolved: 0,
    skipped: 0,
    rescheduled: 0,
    started: 0,
    fallbackUsed: 0,
    minutesPlanned: 0,
    minutesSpent: 0,
    completionRate: 0,
  };
}

/**
 * The pure function. Same input, same output, no clock of its own, no I/O, and
 * it never mutates what it is given.
 *
 * Kept pure because three other things read it: E10-03's load summary, E11's
 * momentum inputs, and the unit fixtures that are the only cheap way to assert
 * a counting rule. A version of this that queried Prisma would be testable only
 * against a seeded database, which is how counting rules stop being tested.
 */
export function aggregateWeek(
  input: AggregationInput,
  { now, timeZone, weekStart }: AggregateOptions,
): WeekAggregates {
  const zone = safeTimeZone(timeZone);
  const { start, end } = weekBounds(weekStart, zone);

  // Rule 2: the week is only aggregated as far as it has actually happened.
  const to = now < end ? now : end;
  const partial = now < end;

  const inScope = input.commitments.filter(
    (row) => row.scheduledStart >= start && row.scheduledStart <= to,
  );

  const domains = {
    WORK: emptyCounts(),
    FAMILY: emptyCounts(),
    HEALTH: emptyCounts(),
  } as Record<Domain, DomainCounts>;
  const totals = emptyCounts();

  const windowCounts = new Map<TimeWindow, { planned: number; completed: number }>(
    TIME_WINDOWS.map((w) => [w.window, { planned: 0, completed: 0 }]),
  );
  const weekdayCounts = Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    planned: 0,
    completed: 0,
  }));

  for (const row of inScope) {
    const counts = domains[row.domain];
    const isPlanned = !NOT_PLANNED.includes(row.status);
    const isCompleted = row.status === 'COMPLETED';
    const isPartial = row.status === 'PARTIALLY_COMPLETED';

    for (const bucket of [counts, totals]) {
      if (isPlanned) {
        bucket.planned += 1;
        bucket.minutesPlanned += row.estimatedMinutes ?? 0;
      }
      if (isCompleted) bucket.completed += 1;
      if (isPartial) bucket.partial += 1;
      if (row.status === 'MISSED') bucket.missed += 1;
      if (row.status === 'SKIPPED') bucket.skipped += 1;
      // Rule 1: the closed originals, counted on their own line.
      if (row.status === 'RESCHEDULED') bucket.rescheduled += 1;
      // Rule 3: a past intention nobody resolved, named as such.
      if (
        (row.status === 'PLANNED' || row.status === 'READY') &&
        row.scheduledStart < now
      ) {
        bucket.unresolved += 1;
      }
      if (row.startedAt !== null) bucket.started += 1;
      if ((isCompleted || isPartial) && (row.versionUsed === 'SHORT' || row.versionUsed === 'MINIMUM')) {
        bucket.fallbackUsed += 1;
      }
      bucket.minutesSpent += row.minutesSpent ?? 0;
    }

    if (isPlanned) {
      const { weekday, hour } = localTimeParts(row.scheduledStart, zone);
      const window = windowFor(hour);
      const bucket = windowCounts.get(window);
      if (bucket) {
        bucket.planned += 1;
        if (isCompleted || isPartial) bucket.completed += 1;
      }
      weekdayCounts[weekday].planned += 1;
      if (isCompleted) weekdayCounts[weekday].completed += 1;
    }
  }

  for (const counts of [...Object.values(domains), totals]) {
    counts.completionRate = rate(counts.completed + PARTIAL_WEIGHT * counts.partial, counts.planned);
  }

  const rescheduleLeaders = inScope
    // The live rows only: a closed original and its replacement both carry the
    // count, and listing both would report one move as two.
    .filter((row) => row.rescheduleCount >= 1 && row.status !== 'RESCHEDULED')
    .sort(
      (a, b) => b.rescheduleCount - a.rescheduleCount || a.title.localeCompare(b.title),
    )
    .slice(0, 5)
    .map((row) => ({
      commitmentId: row.id,
      title: row.title,
      domain: row.domain,
      rescheduleCount: row.rescheduleCount,
    }));

  const startedCommitmentIds = new Set(
    input.focusSessions.map((s) => s.commitmentId).filter((id): id is string => id !== null),
  );

  const workRows = inScope.filter(
    (row) => row.domain === 'WORK' && !NOT_PLANNED.includes(row.status),
  );
  const healthRows = inScope.filter(
    (row) => row.domain === 'HEALTH' && !NOT_PLANNED.includes(row.status),
  );

  const frictionCounts = new Map<string, number>();
  for (const reflection of input.reflections) {
    for (const tag of reflection.frictionTags) {
      frictionCounts.set(tag, (frictionCounts.get(tag) ?? 0) + 1);
    }
  }

  const aggregates: WeekAggregates = {
    weekStart,
    timezone: zone,
    coverage: { from: start.toISOString(), to: to.toISOString(), partial },
    domains: { WORK: domains.WORK, FAMILY: domains.FAMILY, HEALTH: domains.HEALTH },
    totals,
    timeWindows: TIME_WINDOWS.map(({ window }) => {
      const bucket = windowCounts.get(window)!;
      return {
        window,
        planned: bucket.planned,
        completed: bucket.completed,
        successRate: rate(bucket.completed, bucket.planned),
      };
    }),
    weekdays: weekdayCounts,
    rescheduleLeaders,
    focusStarts: {
      planned: workRows.length,
      started: workRows.filter(
        (row) => row.startedAt !== null || startedCommitmentIds.has(row.id),
      ).length,
      completed: workRows.filter((row) => row.status === 'COMPLETED').length,
    },
    workouts: {
      planned: healthRows.length,
      completed: healthRows.filter((row) => row.status === 'COMPLETED').length,
      fallbackUsed: healthRows.filter(
        (row) =>
          (row.status === 'COMPLETED' || row.status === 'PARTIALLY_COMPLETED') &&
          (row.versionUsed === 'SHORT' || row.versionUsed === 'MINIMUM'),
      ).length,
      sessionsLogged: input.workoutSessions.length,
    },
    frictionTags: [...frictionCounts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
  };

  // A violation here is a programming error, not user input: the schema is the
  // contract every consumer of `aggregates` reads, and a silently malformed
  // column would surface as `undefined / undefined` on the review screen days
  // later. Fail where the mistake is.
  return weekAggregatesSchema.parse(aggregates);
}

/** Two decimal places. Enough to compare windows; not enough to look like precision. */
function rate(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;

  return Math.round((numerator / denominator) * 100) / 100;
}

function windowFor(hour: number): TimeWindow {
  return (
    TIME_WINDOWS.find(({ from, to }) => hour >= from && hour <= to)?.window ?? 'night'
  );
}

/**
 * The I/O half. Every Prisma read for a week lives here and nowhere else, so
 * `aggregateWeek` above stays a function of its arguments.
 */
@Injectable()
export class AggregationService {
  constructor(private readonly prisma: PrismaService) {}

  async load(
    userId: string,
    weekStart: string,
    timeZone: string,
  ): Promise<AggregationInput> {
    const { start, end } = weekBounds(weekStart, timeZone);
    const window = { gte: start, lt: end };

    const [commitments, evidence, reflections] = await Promise.all([
      this.prisma.commitment.findMany({
        where: { userId, scheduledStart: window },
        select: {
          id: true,
          domain: true,
          title: true,
          status: true,
          scheduledStart: true,
          scheduledEnd: true,
          rescheduleCount: true,
          routineId: true,
          versionUsed: true,
          startedAt: true,
          minutesSpent: true,
          fullMinutes: true,
          routine: { select: { estimatedDurationMin: true } },
        },
        orderBy: { scheduledStart: 'asc' },
      }),
      this.prisma.evidence.findMany({
        where: { userId, occurredAt: window },
        select: {
          commitmentId: true,
          source: true,
          evidenceType: true,
          occurredAt: true,
          quantitativeValue: true,
        },
      }),
      this.prisma.reflection.findMany({
        where: { userId, createdAt: window },
        select: { relatedType: true, frictionTags: true, createdAt: true },
      }),
    ]);

    return {
      commitments: commitments.map((row) => ({
        id: row.id,
        domain: row.domain,
        title: row.title,
        status: row.status,
        scheduledStart: row.scheduledStart,
        scheduledEnd: row.scheduledEnd,
        rescheduleCount: row.rescheduleCount,
        routineId: row.routineId,
        versionUsed: row.versionUsed,
        startedAt: row.startedAt,
        minutesSpent: row.minutesSpent,
        estimatedMinutes: estimatedMinutes(row),
      })),
      evidence,
      reflections,
      // E07-02 and E09-01 own these tables. Reading them before they exist
      // would be a boot-time failure for a feature nobody has yet; the shape
      // is already in `AggregationInput` so landing them is a loader change
      // and not an aggregate change.
      focusSessions: [],
      workoutSessions: [],
    };
  }
}

/**
 * How long the user meant this to take.
 *
 * The scheduled span first (it is what the user actually put in the calendar),
 * then the commitment's own `fullMinutes`, then the routine's estimate. Zero
 * when nothing says — a fabricated duration would inflate `minutesPlanned`,
 * which is one half of the capacity warning E10-03 raises.
 */
function estimatedMinutes(row: {
  scheduledStart: Date;
  scheduledEnd: Date | null;
  fullMinutes: number | null;
  routine: { estimatedDurationMin: number } | null;
}): number | null {
  if (row.scheduledEnd) {
    return Math.round((row.scheduledEnd.getTime() - row.scheduledStart.getTime()) / 60_000);
  }

  return row.fullMinutes ?? row.routine?.estimatedDurationMin ?? 0;
}
