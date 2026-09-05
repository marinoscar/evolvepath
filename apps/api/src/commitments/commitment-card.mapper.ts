import type { Commitment, CommitmentVersion } from '@prisma/client';

import { availableActionsFor } from './commitment-actions';
import type { CommitmentCard, CommitmentVersionView } from './commitment-card.schema';
import { elapsedSeconds, remainingSeconds } from './actions/commitment-timer';

// =============================================================================
// Row → card (issues #40 and #38, epic E05)
// =============================================================================
//
// The three derivations here are the ones that must not be duplicated in a
// client: how long a version takes, what the timer reads, and which actions the
// server will accept. Each has a reason to live on this side of the wire.
// =============================================================================

/**
 * How long the FULL version takes when nothing says otherwise.
 *
 * A commitment created without a duration still has to render "25 min" on a
 * card and be sizeable against a budget by the next-best-action scorer. 25 is
 * one pomodoro — long enough to be real work, short enough that a user who
 * meant something bigger will say so.
 */
export const DEFAULT_FULL_MINUTES = 25;

/** The floor for a derived short version: below this it is the minimum. */
const MIN_SHORT_MINUTES = 10;

/** PRD §28: a daily win must be possible in minutes. */
export const MINIMUM_VERSION_MINUTES = 5;

/** The scheduled window in whole minutes, or null when the row has no end. */
function scheduledMinutes(row: Pick<Commitment, 'scheduledStart' | 'scheduledEnd'>): number | null {
  if (!row.scheduledEnd) return null;

  const minutes = Math.round(
    (row.scheduledEnd.getTime() - row.scheduledStart.getTime()) / 60_000,
  );

  return minutes > 0 ? minutes : null;
}

/**
 * The three sizes, each as `{title, minutes}`.
 *
 * The FULL version always exists — a commitment with no declared sizes is its
 * own full version, titled with the commitment's title. SHORT and MINIMUM are
 * null unless the user (or a plan) actually declared them: inventing a short
 * version would let the sizer offer the user a smaller commitment they never
 * agreed to, which is the opposite of PRD §57's point.
 *
 * Minutes come from the `*Minutes` column when set, then from the scheduled
 * window for FULL, then from the defaults above.
 */
export function versionsOf(
  row: Pick<
    Commitment,
    | 'title'
    | 'scheduledStart'
    | 'scheduledEnd'
    | 'fullVersion'
    | 'shortVersion'
    | 'minimumVersion'
    | 'fullMinutes'
    | 'shortMinutes'
    | 'minimumMinutes'
  >,
): {
  full: CommitmentVersionView;
  short: CommitmentVersionView | null;
  minimum: CommitmentVersionView | null;
} {
  const fullMinutes =
    row.fullMinutes ?? scheduledMinutes(row) ?? DEFAULT_FULL_MINUTES;

  return {
    full: { title: row.fullVersion ?? row.title, minutes: fullMinutes },
    short: row.shortVersion
      ? {
          title: row.shortVersion,
          minutes:
            row.shortMinutes ?? Math.max(MIN_SHORT_MINUTES, Math.round(fullMinutes / 2)),
        }
      : null,
    minimum: row.minimumVersion
      ? {
          title: row.minimumVersion,
          minutes: row.minimumMinutes ?? MINIMUM_VERSION_MINUTES,
        }
      : null,
  };
}

/**
 * Applied decomposition steps, or null.
 *
 * The column is `Json?` written only by `decompose/apply`, which validates it
 * with `decompositionProposalSchema` first. Anything that fails the shape check
 * here is treated as absent rather than thrown: a card must render for a row
 * whose steps predate a schema change.
 */
export function stepsOf(row: Pick<Commitment, 'steps'>): CommitmentVersionView[] | null {
  if (!Array.isArray(row.steps)) return null;

  const steps = row.steps.filter(
    (step): step is { title: string; minutes: number } =>
      typeof step === 'object' &&
      step !== null &&
      typeof (step as { title?: unknown }).title === 'string' &&
      typeof (step as { minutes?: unknown }).minutes === 'number',
  );

  return steps.length > 0 ? steps.map((s) => ({ title: s.title, minutes: s.minutes })) : null;
}

/**
 * The actionable view of one commitment.
 *
 * `now` is a parameter rather than `new Date()` so the timer's derived values
 * are reproducible in a test and identical across every card in one response.
 */
export function toCommitmentCard(row: Commitment, now: Date = new Date()): CommitmentCard {
  const versions = versionsOf(row);
  const timerState = { activeSince: row.activeSince, activeSeconds: row.activeSeconds };

  // Null for a commitment nobody has started: an all-zero timer would render as
  // a stopped stopwatch, which reads as "you started and did nothing".
  const timer =
    row.startedAt === null && row.activeSince === null && row.activeSeconds === 0
      ? null
      : {
          activeSince: row.activeSince ? row.activeSince.toISOString() : null,
          activeSeconds: row.activeSeconds,
          elapsedSeconds: elapsedSeconds(timerState, now),
          timerMinutes: row.timerMinutes,
          remainingSeconds: remainingSeconds(timerState, row.timerMinutes, now),
        };

  return {
    id: row.id,
    title: row.title,
    domain: row.domain,
    status: row.status,
    scheduledStart: row.scheduledStart.toISOString(),
    scheduledEnd: row.scheduledEnd ? row.scheduledEnd.toISOString() : null,
    durationMinutes: versions.full.minutes,
    versions,
    importance: row.importance,
    rescheduleCount: row.rescheduleCount,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    versionUsed: row.versionUsed as CommitmentVersion | null,
    minutesSpent: row.minutesSpent,
    outcomeId: row.outcomeId,
    workoutTemplateId: row.workoutTemplateId,
    ritualId: row.ritualId,
    familyMemberId: row.familyMemberId,
    decomposedFromId: row.decomposedFromId,
    steps: stepsOf(row),
    timer,
    availableActions: availableActionsFor(row),
  };
}
