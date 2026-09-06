import { localDayBounds } from '../../today/local-date';
import { TIME_WINDOWS, timeWindowOf, type TimeWindow } from '../avoidance/time-window';
import type { AvoidanceAssessment } from '../avoidance/avoidance-detector';

// =============================================================================
// The work week, as numbers (issue #120, epic E07)
// =============================================================================
//
// PRD §29 wants the review to be able to say "you completed 4 of 5 focus
// sessions scheduled before 9 AM and only 1 of 4 after 4 PM". This file is the
// arithmetic behind that sentence, and E10's reviewer is its first reader — a
// provider outage must change the WORDS and never the COUNTS, which is only
// true if the counts are computed here and not by a model.
//
// PURE, and free of Prisma types. Narrow row interfaces are declared below
// rather than importing the generated client, so the fixtures a spec builds are
// small enough to read and the aggregator cannot quietly start depending on a
// column nobody passed it.
//
// -----------------------------------------------------------------------------
// RATES ARE NULL, NOT ZERO, WHEN THE DENOMINATOR IS ZERO
// -----------------------------------------------------------------------------
//
// "Nothing was planned" and "nothing got done" are different weeks and the
// reviewer has to be able to tell them apart. A 0 for both would produce
// "you completed 0% of your morning sessions" for a week with no morning
// sessions in it, which is a sentence about nothing that reads like a failure.
// =============================================================================

export interface CommitmentRow {
  id: string;
  domain: string;
  title: string;
  outcomeId: string | null;
  commitmentType: string | null;
  status: string;
  scheduledStart: Date;
  startedAt: Date | null;
  rescheduleCount: number;
  fullMinutes: number | null;
  scheduledEnd: Date | null;
}

export interface FocusSessionRow {
  id: string;
  commitmentId: string;
  startedAt: Date;
  endedAt: Date | null;
  outcome: 'DONE' | 'PARTIAL' | 'ABANDONED' | null;
  actualMinutes: number | null;
  distractionNotes: string[];
}

export interface EvidenceRow {
  commitmentId: string | null;
  evidenceType: string;
  source: string;
}

export interface OutcomeRow {
  id: string;
  title: string;
  domain: string;
  state: string;
  updatedAt: Date;
}

export interface WorkWeeklySummary {
  weekStart: string;
  weekEnd: string;
  timezone: string;
  focusSessions: {
    planned: number;
    started: number;
    done: number;
    partial: number;
    abandoned: number;
    plannedMinutes: number;
    actualMinutes: number;
  };
  starts: {
    commitmentsDue: number;
    started: number;
    completed: number;
    startRate: number | null;
    completionRate: number | null;
  };
  outcomesCompleted: Array<{ outcomeId: string; title: string; completedAt: string }>;
  repeatedlyPostponed: Array<{
    commitmentId: string;
    title: string;
    outcomeId: string | null;
    rescheduleCount: number;
    level: number;
  }>;
  timeWindows: Record<
    TimeWindow,
    { planned: number; started: number; completed: number; successRate: number | null }
  >;
  bestWindow: TimeWindow | null;
  worstWindow: TimeWindow | null;
  distractionNoteCount: number;
}

export interface AggregateInput {
  /** The user's local Monday as `YYYY-MM-DD`. */
  weekStart: string;
  timezone: string;
  commitments: CommitmentRow[];
  focusSessions: FocusSessionRow[];
  evidence: EvidenceRow[];
  outcomes: OutcomeRow[];
  assessments: Map<string, AvoidanceAssessment>;
}

/** `commitments.commitment_type` for a planned work session (E07-01). */
export const FOCUS_SESSION_TYPE = 'FOCUS_SESSION';

/** Below this, a window's rate is noise rather than a pattern. */
export const MIN_PLANNED_FOR_WINDOW_VERDICT = 2;

/** A commitment moved this many times is what PRD §29 calls repeatedly postponed. */
export const REPEATEDLY_POSTPONED_RESCHEDULES = 2;

export function aggregateWorkWeek(input: AggregateInput): WorkWeeklySummary {
  const { start, end } = weekBoundsFor(input.weekStart, input.timezone);

  const work = input.commitments.filter((row) => row.domain === 'WORK');
  const due = work.filter(
    (row) => row.scheduledStart >= start && row.scheduledStart < end,
  );

  // ---- focus sessions -------------------------------------------------------

  const sessionsByCommitment = new Map<string, FocusSessionRow[]>();

  for (const session of input.focusSessions) {
    const list = sessionsByCommitment.get(session.commitmentId) ?? [];
    list.push(session);
    sessionsByCommitment.set(session.commitmentId, list);
  }

  const plannedSessions = due.filter((row) => row.commitmentType === FOCUS_SESSION_TYPE);

  let started = 0;
  let done = 0;
  let partial = 0;
  let abandoned = 0;
  let plannedMinutes = 0;
  let actualMinutes = 0;

  for (const commitment of plannedSessions) {
    plannedMinutes += minutesOf(commitment);

    const sessions = sessionsByCommitment.get(commitment.id) ?? [];
    if (sessions.length === 0) continue;

    started += 1;

    for (const session of sessions) actualMinutes += session.actualMinutes ?? 0;

    // The LATEST session decides how it ended: somebody who abandoned at
    // lunchtime and finished in the evening finished.
    const latest = [...sessions].sort(
      (a, b) => b.startedAt.getTime() - a.startedAt.getTime(),
    )[0];

    if (latest.outcome === 'DONE') done += 1;
    else if (latest.outcome === 'PARTIAL') partial += 1;
    else if (latest.outcome === 'ABANDONED') abandoned += 1;
  }

  // ---- starts, which are not completions (PRD §104) --------------------------

  const startEvidence = new Set(
    input.evidence
      .filter(
        (row) =>
          row.commitmentId !== null &&
          ((row.source === 'APP_FLOW' && row.evidenceType === 'started') ||
            row.source === 'TIMER'),
      )
      .map((row) => row.commitmentId as string),
  );

  const wasStarted = (row: CommitmentRow): boolean =>
    row.startedAt !== null || startEvidence.has(row.id);

  const startedCount = due.filter(wasStarted).length;
  const completedCount = due.filter((row) => row.status === 'COMPLETED').length;

  // ---- time windows ---------------------------------------------------------

  const timeWindows = Object.fromEntries(
    TIME_WINDOWS.map((window) => {
      const inWindow = due.filter(
        (row) => timeWindowOf(row.scheduledStart, input.timezone) === window,
      );
      const completed = inWindow.filter((row) => row.status === 'COMPLETED').length;

      return [
        window,
        {
          planned: inWindow.length,
          started: inWindow.filter(wasStarted).length,
          completed,
          successRate: inWindow.length === 0 ? null : completed / inWindow.length,
        },
      ];
    }),
  ) as WorkWeeklySummary['timeWindows'];

  // Only windows with enough planned to mean anything, in canonical order so a
  // tie resolves to the earlier part of the day rather than to map order.
  const ranked = TIME_WINDOWS.filter(
    (window) => timeWindows[window].planned >= MIN_PLANNED_FOR_WINDOW_VERDICT,
  );

  const bestWindow =
    ranked.length === 0
      ? null
      : ranked.reduce((best, window) =>
          (timeWindows[window].successRate as number) > (timeWindows[best].successRate as number)
            ? window
            : best,
        );

  const worstWindow =
    ranked.length === 0
      ? null
      : ranked.reduce((worst, window) =>
          (timeWindows[window].successRate as number) < (timeWindows[worst].successRate as number)
            ? window
            : worst,
        );

  // ---- postponed, completed outcomes, distractions ---------------------------

  // Due in the week OR moved out of it: a commitment somebody pushed to next
  // Monday is exactly the one PRD §29 wants named, and it is no longer "due".
  const postponed = work
    .filter((row) => row.rescheduleCount >= REPEATEDLY_POSTPONED_RESCHEDULES)
    .filter(
      (row) =>
        (row.scheduledStart >= start && row.scheduledStart < end) ||
        row.status === 'RESCHEDULED',
    )
    .sort((a, b) => b.rescheduleCount - a.rescheduleCount || a.id.localeCompare(b.id))
    .map((row) => ({
      commitmentId: row.id,
      title: row.title,
      outcomeId: row.outcomeId,
      rescheduleCount: row.rescheduleCount,
      level: input.assessments.get(row.id)?.level ?? 0,
    }));

  const outcomesCompleted = input.outcomes
    .filter(
      (outcome) =>
        outcome.domain === 'WORK' &&
        outcome.state === 'COMPLETED' &&
        outcome.updatedAt >= start &&
        outcome.updatedAt < end,
    )
    .map((outcome) => ({
      outcomeId: outcome.id,
      title: outcome.title,
      completedAt: outcome.updatedAt.toISOString(),
    }));

  const distractionNoteCount = input.focusSessions
    .filter((session) => session.startedAt >= start && session.startedAt < end)
    .reduce((sum, session) => sum + session.distractionNotes.length, 0);

  return {
    weekStart: input.weekStart,
    weekEnd: endDateOf(input.weekStart),
    timezone: input.timezone,
    focusSessions: {
      planned: plannedSessions.length,
      started,
      done,
      partial,
      abandoned,
      plannedMinutes,
      actualMinutes,
    },
    starts: {
      commitmentsDue: due.length,
      started: startedCount,
      completed: completedCount,
      startRate: due.length === 0 ? null : startedCount / due.length,
      completionRate: due.length === 0 ? null : completedCount / due.length,
    },
    outcomesCompleted,
    repeatedlyPostponed: postponed,
    timeWindows,
    bestWindow,
    worstWindow,
    distractionNoteCount,
  };
}

/** How long a commitment was meant to take. */
function minutesOf(row: CommitmentRow): number {
  if (row.fullMinutes !== null) return row.fullMinutes;

  if (row.scheduledEnd) {
    return Math.max(
      0,
      Math.round((row.scheduledEnd.getTime() - row.scheduledStart.getTime()) / 60_000),
    );
  }

  return 0;
}

/**
 * `[Monday 00:00, next Monday 00:00)` in the user's zone.
 *
 * Built from `localDayBounds` at BOTH ends rather than `start + 7 * 24h`, so a
 * week containing a DST change is 167 or 169 hours long — which is what the
 * user's calendar actually did.
 */
function weekBoundsFor(weekStart: string, timezone: string): { start: Date; end: Date } {
  return {
    start: localDayBounds(weekStart, timezone).start,
    end: localDayBounds(addDaysTo(weekStart, 7), timezone).start,
  };
}

/** The Sunday that closes the week, as `YYYY-MM-DD`. */
function endDateOf(weekStart: string): string {
  return addDaysTo(weekStart, 6);
}

function addDaysTo(dateLocal: string, days: number): string {
  const [year, month, day] = dateLocal.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));

  return shifted.toISOString().slice(0, 10);
}
