import { z } from 'zod';

import { domainSchema } from '../path/domain.schema';
import { COMMITMENT_ACTIONS } from './commitment-actions';
import { commitmentStatusSchema } from './dto/commitment-query.dto';

// =============================================================================
// The commitment card (issues #40 and #38, epic E05)
// =============================================================================
//
// ONE SHAPE FOR EVERY SURFACE that shows a commitment as something to act on:
// `GET /today`'s domain cards and next-best-action, and the body every
// `/commitments/:id/actions/*` route returns. Two shapes would mean the card a
// screen renders after an action could differ from the one it rendered before
// it, which is exactly the class of bug that makes a UI flicker into a wrong
// state.
//
// It is NOT `CommitmentResponseDto`. That is the record — every column,
// including provenance a screen has no use for. This is the view an actionable
// surface needs: what to show, how long it takes, and what the server will
// accept next.
// =============================================================================

/** One of the three sizes of an intention (PRD §57), with its cost in minutes. */
export const commitmentVersionSchema = z.object({
  title: z.string(),
  minutes: z.number().int().min(1),
});

export type CommitmentVersionView = z.infer<typeof commitmentVersionSchema>;

export const commitmentActionSchema = z.enum(COMMITMENT_ACTIONS);

/**
 * Server-derived timer state. Null for a commitment that was never started.
 *
 * `activeSeconds` is what was banked at the last pause, NOT the total: the
 * client adds `now − activeSince` itself while the timer runs, so a screen that
 * re-renders every second does not need a request per second. `elapsedSeconds`
 * is the same arithmetic done on the server at read time, which is what makes a
 * reloaded page resume from the right number.
 */
export const commitmentTimerSchema = z.object({
  activeSince: z.string().datetime().nullable(),
  activeSeconds: z.number().int().min(0),
  elapsedSeconds: z.number().int().min(0),
  timerMinutes: z.number().int().nullable(),
  remainingSeconds: z.number().int().min(0).nullable(),
});

export const commitmentCardSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  domain: domainSchema,
  status: commitmentStatusSchema,
  scheduledStart: z.string().datetime(),
  scheduledEnd: z.string().datetime().nullable(),
  /** The full version's cost — what "this takes 25 minutes" means on a card. */
  durationMinutes: z.number().int().min(1),
  versions: z.object({
    full: commitmentVersionSchema,
    short: commitmentVersionSchema.nullable(),
    minimum: commitmentVersionSchema.nullable(),
  }),
  importance: z.number().int().min(1).max(5),
  rescheduleCount: z.number().int().min(0),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  versionUsed: z.enum(['FULL', 'SHORT', 'MINIMUM']).nullable(),
  minutesSpent: z.number().int().nullable(),
  outcomeId: z.string().uuid().nullable(),
  /**
   * The family ritual this occurrence came from, and who it is with (epic E08).
   *
   * On the CARD rather than only on the full commitment because the client
   * decides its action LABELS from them — a materialized ritual occurrence
   * offers "I'm in", "Move it" and "Skip today" where a work commitment offers
   * "Ready", "Reschedule" and "Skip". Same endpoints, same matrix, family words.
   */
  ritualId: z.string().uuid().nullable(),
  familyMemberId: z.string().uuid().nullable(),
  /** Set when this commitment is the small version of a bigger one. */
  decomposedFromId: z.string().uuid().nullable(),
  steps: z.array(commitmentVersionSchema).nullable(),
  timer: commitmentTimerSchema.nullable(),
  /**
   * What the server will accept next. THE CLIENT RENDERS THIS LIST — it does
   * not compute one. A client running yesterday's bundle would otherwise offer
   * a move this API refuses.
   */
  availableActions: z.array(commitmentActionSchema),
});

export type CommitmentCard = z.infer<typeof commitmentCardSchema>;

/**
 * The card plus the one thing an execution screen needs that is not on it: WHY.
 *
 * PRD §27 puts "why it matters" on the Start screen deliberately — a timer with
 * no reason attached is a stopwatch. The motivation lives on the outcome, so it
 * is joined here rather than denormalised onto every commitment.
 */
export const startContextSchema = commitmentCardSchema.extend({
  whyItMatters: z.string().nullable(),
});

export type StartContext = z.infer<typeof startContextSchema>;
