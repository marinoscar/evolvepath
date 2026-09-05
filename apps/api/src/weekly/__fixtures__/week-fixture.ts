import type { AggregationInput, CommitmentForWeek } from '../aggregation.service';
import { localTimeToInstant } from '../week-bounds';

// =============================================================================
// The epic-script week, as data (issue #73)
// =============================================================================
//
// The week the E10 manual verification seeds, and the one the acceptance
// criteria quote numbers from:
//
//   WORK    5 planned at 07:30 — 4 completed, 1 skipped
//   HEALTH  3 planned at 18:30 — 1 completed FULL, 1 completed MINIMUM,
//                                1 moved twice and still open
//   FAMILY  3 planned at 19:00 — 2 completed, 1 skipped
//
// Kept as a fixture rather than inline in the spec because E10-03's load
// summary and E11's momentum read the same aggregate, and all three should be
// arguing about the same week.
// =============================================================================

export const FIXTURE_WEEK_START = '2026-08-31';
export const FIXTURE_TIME_ZONE = 'America/Costa_Rica';

/** Sunday 20:00 local — every day has happened, but the week is not closed. */
export const FIXTURE_NOW = new Date('2026-09-07T02:00:00.000Z');

let sequence = 0;

/** Deterministic uuids, so a fixture week is byte-identical between runs. */
function uuid(): string {
  sequence += 1;
  const hex = sequence.toString(16).padStart(12, '0');

  return `00000000-0000-4000-8000-${hex}`;
}

function commitment(
  overrides: Partial<CommitmentForWeek> & {
    date: string;
    time: string;
    domain: CommitmentForWeek['domain'];
    title: string;
  },
): CommitmentForWeek {
  const { date, time, ...rest } = overrides;
  const start = localTimeToInstant(date, time, FIXTURE_TIME_ZONE);

  return {
    id: uuid(),
    status: 'PLANNED',
    scheduledStart: start,
    scheduledEnd: null,
    rescheduleCount: 0,
    routineId: null,
    versionUsed: null,
    startedAt: null,
    minutesSpent: null,
    estimatedMinutes: 30,
    ...rest,
  } as CommitmentForWeek;
}

export function buildFixtureWeek(): AggregationInput {
  sequence = 0;

  const workDates = ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'];

  const work = workDates.map((date, index) =>
    commitment({
      date,
      time: '07:30',
      domain: 'WORK',
      title: 'Morning focus block',
      estimatedMinutes: 50,
      // The fifth is the one that was skipped.
      status: index === 4 ? 'SKIPPED' : 'COMPLETED',
      startedAt: index === 4 ? null : localTimeToInstant(date, '07:30', FIXTURE_TIME_ZONE),
      minutesSpent: index === 4 ? null : 50,
      versionUsed: index === 4 ? null : 'FULL',
    }),
  );

  const health: CommitmentForWeek[] = [
    commitment({
      date: '2026-08-31',
      time: '18:30',
      domain: 'HEALTH',
      title: 'Strength workout',
      estimatedMinutes: 40,
      status: 'COMPLETED',
      versionUsed: 'FULL',
      minutesSpent: 40,
      startedAt: localTimeToInstant('2026-08-31', '18:30', FIXTURE_TIME_ZONE),
    }),
    commitment({
      date: '2026-09-02',
      time: '18:30',
      domain: 'HEALTH',
      title: 'Strength workout',
      estimatedMinutes: 40,
      // Did the minimum version rather than skipping — the fact a thin week
      // needs in order to be read honestly (PRD §44).
      status: 'COMPLETED',
      versionUsed: 'MINIMUM',
      minutesSpent: 15,
      startedAt: localTimeToInstant('2026-09-02', '18:30', FIXTURE_TIME_ZONE),
    }),
    // The intention that was moved twice: two closed originals and one live row
    // carrying the count. `planned` must see ONE workout here, not three.
    commitment({
      date: '2026-09-03',
      time: '18:30',
      domain: 'HEALTH',
      title: 'Strength workout',
      estimatedMinutes: 40,
      status: 'RESCHEDULED',
      rescheduleCount: 0,
    }),
    commitment({
      date: '2026-09-04',
      time: '18:30',
      domain: 'HEALTH',
      title: 'Strength workout',
      estimatedMinutes: 40,
      status: 'RESCHEDULED',
      rescheduleCount: 1,
    }),
    commitment({
      date: '2026-09-05',
      time: '18:30',
      domain: 'HEALTH',
      title: 'Strength workout',
      estimatedMinutes: 40,
      status: 'PLANNED',
      rescheduleCount: 2,
    }),
  ];

  const family = ['2026-08-31', '2026-09-02', '2026-09-04'].map((date, index) =>
    commitment({
      date,
      time: '19:00',
      domain: 'FAMILY',
      title: 'Dinner together',
      estimatedMinutes: 45,
      status: index === 2 ? 'SKIPPED' : 'COMPLETED',
      minutesSpent: index === 2 ? null : 45,
      versionUsed: index === 2 ? null : 'FULL',
    }),
  );

  return {
    commitments: [...work, ...health, ...family],
    evidence: [],
    reflections: [
      {
        relatedType: 'day',
        frictionTags: ['BAD_TIMING'],
        createdAt: new Date('2026-09-03T02:00:00.000Z'),
      },
      {
        relatedType: 'commitment',
        frictionTags: ['BAD_TIMING', 'TOO_MUCH'],
        createdAt: new Date('2026-09-04T02:00:00.000Z'),
      },
    ],
    focusSessions: [],
    workoutSessions: [],
  };
}
