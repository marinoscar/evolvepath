import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import type { Commitment, FocusSession, FocusSessionOutcome } from '@prisma/client';

import { CommitmentActionsService } from '../../commitments/actions/commitment-actions.service';
import { elapsedSeconds } from '../../commitments/actions/commitment-timer';
import { toCommitmentCard } from '../../commitments/commitment-card.mapper';
import type { CommitmentTimer } from './focus-session.types';
import { findOwnedOrThrow } from '../../path/owned-resource';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  ExtendFocusSessionDto,
  FocusSessionQueryDto,
  StartFocusSessionDto,
  StopFocusSessionDto,
} from './dto/focus-session.dtos';

// =============================================================================
// Focus sessions (issue #110, epic E07)
// =============================================================================
//
// THIS SERVICE OWNS NO STATE MACHINE AND NO CLOCK. Every status change and
// every timer column belongs to E05-02's `CommitmentActionsService`, and this
// calls it — `start` on start, `continue` on extend, `complete`/`partial`/
// `pause` on stop. Re-implementing any of them would produce a second set of
// `APP_FLOW` evidence rows for the same moment, and then two different answers
// to "how long did this take".
//
// What this service adds is the thing E05 has no column for: the session as a
// unit. How long the user MEANT to focus, how many times they continued, what
// distracted them, and how it ended.
//
// -----------------------------------------------------------------------------
// THE ORDER OF WRITES ON `start`, AND WHY IT IS COMPENSATED RATHER THAN NESTED
// -----------------------------------------------------------------------------
//
// `CommitmentActionsService.start` opens its own `$transaction`. Nesting one
// inside another interactive transaction is not something Prisma supports, so
// the row is written first and DELETED if the action then throws. The failure
// this protects against is real: `start` raises 409 `INVALID_TRANSITION` from
// the matrix, and a focus session pointing at a commitment that never started
// would show up on `GET /focus-sessions/active` forever.
//
// -----------------------------------------------------------------------------
// `abandoned` IS NOT A FAILURE
// -----------------------------------------------------------------------------
//
// It pauses rather than closing the commitment, so the next-best-action
// engine's "STARTED is the NBA" pre-rule keeps offering it — and it still
// writes the `TIMER` evidence row. VISION §10: ten minutes on something avoided
// for three days is progress, and the record has to be able to say so.
// =============================================================================

const tracer = trace.getTracer('evolvepath-api');

/** PRD §28 asks for a note, not a notebook. */
export const MAX_DISTRACTION_NOTES = 20;

/** The window `GET /focus-sessions` will span, matching E02-04's evidence query. */
export const MAX_LIST_DAYS = 93;

/** Newest first, and never an unbounded scan. */
export const MAX_LIST_ROWS = 100;

export interface FocusSessionView {
  id: string;
  commitmentId: string;
  plannedMinutes: number;
  instruction: string | null;
  startedAt: string;
  endedAt: string | null;
  outcome: FocusSessionOutcome | null;
  actualMinutes: number | null;
  continuedCount: number;
  distractionNotes: string[];
  commitment: {
    title: string;
    status: string;
    /** E05-01's `commitmentCardSchema.timer`, so the client derives the
     *  countdown with the maths it already has and nothing is duplicated. */
    timer: CommitmentTimer | null;
  };
}

export interface StopFocusSessionResult {
  session: FocusSessionView;
  evidenceId: string;
  commitmentStatus: string;
  actualMinutes: number;
}

@Injectable()
export class FocusSessionService {
  private readonly logger = new Logger(FocusSessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly actions: CommitmentActionsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Starting
  // ---------------------------------------------------------------------------

  async start(
    userId: string,
    dto: StartFocusSessionDto,
    now: Date = new Date(),
  ): Promise<FocusSessionView> {
    const commitment = await this.findWorkCommitment(userId, dto.commitmentId);

    if (commitment.status === 'COMPLETED' || commitment.status === 'CANCELLED') {
      throw new BadRequestException({
        message: `A ${commitment.status.toLowerCase()} commitment cannot be started.`,
        details: { reason: 'COMMITMENT_NOT_STARTABLE', status: commitment.status },
      });
    }

    const active = await this.prisma.focusSession.findFirst({
      where: { userId, endedAt: null },
      orderBy: { startedAt: 'desc' },
    });

    if (active) {
      if (!dto.takeOver) {
        throw new ConflictException({
          message: 'You already have a focus session running.',
          details: {
            reason: 'FOCUS_SESSION_ACTIVE',
            activeSessionId: active.id,
            commitmentId: active.commitmentId,
          },
        });
      }

      await this.stop(userId, active.id, { outcome: 'abandoned' }, now);
    }

    const session = await this.prisma.focusSession.create({
      data: {
        userId,
        commitmentId: dto.commitmentId,
        plannedMinutes: dto.plannedMinutes,
        instruction: dto.instruction ?? null,
        startedAt: now,
      },
    });

    let card;

    try {
      // E05-02 owns the transition, the timer columns and the `APP_FLOW started`
      // evidence. On an already-STARTED row it behaves as a resume and writes no
      // second start row, which is exactly what a reconnecting client needs.
      card = await this.actions.start(userId, dto.commitmentId, {
        minutes: dto.plannedMinutes,
      });
    } catch (error) {
      // Compensate. See the header: a session pointing at a commitment that
      // never started would be permanently "active".
      await this.prisma.focusSession.delete({ where: { id: session.id } });
      throw error;
    }

    // Ids and numbers. Never the instruction: it is the user's own sentence
    // about their work.
    this.logger.log(
      `Focus start user=${userId} commitment=${dto.commitmentId} planned=${dto.plannedMinutes}`,
    );

    return this.view(session, card.title, card.status, card.timer);
  }

  // ---------------------------------------------------------------------------
  // While it runs
  // ---------------------------------------------------------------------------

  async getActive(
    userId: string,
    now: Date = new Date(),
  ): Promise<{ session: FocusSessionView | null; serverNow: string }> {
    const session = await this.prisma.focusSession.findFirst({
      where: { userId, endedAt: null },
      orderBy: { startedAt: 'desc' },
      include: { commitment: true },
    });

    return {
      session: session ? this.viewWithCommitment(session, session.commitment, now) : null,
      // A skewed phone re-anchors from this rather than from its own clock.
      serverNow: now.toISOString(),
    };
  }

  async extend(
    userId: string,
    id: string,
    dto: ExtendFocusSessionDto,
    now: Date = new Date(),
  ): Promise<FocusSessionView> {
    const session = await this.findOpen(userId, id);

    const updated = await this.prisma.focusSession.update({
      where: { id },
      data: {
        plannedMinutes: session.plannedMinutes + dto.minutes,
        continuedCount: { increment: 1 },
      },
    });

    // E05-02's `continue` grows `timerMinutes` and writes the `APP_FLOW
    // continued` evidence — the same call E05-05's "Continue another 15?"
    // prompt makes, so the two paths cannot diverge.
    const card = await this.actions.continue(userId, session.commitmentId, {
      extraMinutes: dto.minutes,
    });

    return this.view(updated, card.title, card.status, card.timer);
  }

  async addNote(
    userId: string,
    id: string,
    text: string,
    now: Date = new Date(),
  ): Promise<FocusSessionView> {
    const session = await this.findOpen(userId, id);

    if (session.distractionNotes.length >= MAX_DISTRACTION_NOTES) {
      throw new BadRequestException({
        message: `A session holds at most ${MAX_DISTRACTION_NOTES} notes.`,
        details: { reason: 'TOO_MANY_NOTES', max: MAX_DISTRACTION_NOTES },
      });
    }

    const updated = await this.prisma.focusSession.update({
      where: { id },
      data: { distractionNotes: { push: text.trim() } },
    });

    const commitment = await this.prisma.commitment.findUnique({
      where: { id: session.commitmentId },
    });

    return this.viewWithCommitment(updated, commitment, now);
  }

  // ---------------------------------------------------------------------------
  // Stopping
  // ---------------------------------------------------------------------------

  async stop(
    userId: string,
    id: string,
    dto: StopFocusSessionDto,
    now: Date = new Date(),
  ): Promise<StopFocusSessionResult> {
    return tracer.startActiveSpan('work.focus.stop', async (span) => {
      try {
        const session = await this.findOpen(userId, id);

        const card = await this.closeCommitment(userId, session.commitmentId, dto, now);

        // Read the banked seconds BACK from the row the action just wrote:
        // `complete` folds the running time in, and `pause` banks it. Falling
        // back to wall-clock covers a session whose commitment was closed by
        // another path entirely.
        const commitment = await this.prisma.commitment.findUnique({
          where: { id: session.commitmentId },
        });

        const seconds = commitment
          ? elapsedSeconds(
              { activeSince: commitment.activeSince, activeSeconds: commitment.activeSeconds },
              now,
            )
          : Math.round((now.getTime() - session.startedAt.getTime()) / 1000);

        // Floored at 1: a session that happened took a minute, and rounding it
        // to zero would erase the very thing PRD §104 asks to be recorded.
        const actualMinutes = Math.max(1, Math.round(seconds / 60));
        const outcome = dto.outcome.toUpperCase() as FocusSessionOutcome;

        const updated = await this.prisma.$transaction(async (tx) => {
          const evidence = await tx.evidence.create({
            data: {
              userId,
              commitmentId: session.commitmentId,
              evidenceType: 'focus_session',
              // TIMER, not USER_LOG: the server measured this. PRD §10.9's
              // source column is what lets E07-05 count focused minutes without
              // double-counting the user's own completion report.
              source: 'TIMER',
              occurredAt: now,
              quantitativeValue: actualMinutes,
              quantitativeUnit: 'minutes',
              qualitativeValue: dto.outcome,
              confidence: 1,
            },
          });

          return tx.focusSession.update({
            where: { id },
            data: { endedAt: now, outcome, actualMinutes, evidenceId: evidence.id },
          });
        });

        span.setAttribute('work.focus.planned_minutes', updated.plannedMinutes);
        span.setAttribute('work.focus.outcome', dto.outcome);

        this.logger.log(
          `Focus stop user=${userId} commitment=${session.commitmentId} outcome=${dto.outcome} actual=${actualMinutes} continued=${updated.continuedCount}`,
        );

        return {
          session: this.view(updated, card.title, card.status, card.timer),
          evidenceId: updated.evidenceId as string,
          commitmentStatus: card.status,
          actualMinutes,
        };
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Listing
  // ---------------------------------------------------------------------------

  async list(
    userId: string,
    query: FocusSessionQueryDto,
    now: Date = new Date(),
  ): Promise<{ sessions: FocusSessionView[] }> {
    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to) : null;

    if (from && to && to.getTime() - from.getTime() > MAX_LIST_DAYS * 86_400_000) {
      throw new BadRequestException({
        message: `The window may span at most ${MAX_LIST_DAYS} days.`,
        details: { reason: 'RANGE_TOO_LARGE', maxDays: MAX_LIST_DAYS },
      });
    }

    const rows = await this.prisma.focusSession.findMany({
      where: {
        userId,
        ...(query.commitmentId ? { commitmentId: query.commitmentId } : {}),
        ...(query.outcomeId ? { commitment: { outcomeId: query.outcomeId } } : {}),
        ...(from || to
          ? { startedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
          : {}),
      },
      orderBy: { startedAt: 'desc' },
      take: MAX_LIST_ROWS,
      include: { commitment: true },
    });

    return {
      sessions: rows.map((row) => this.viewWithCommitment(row, row.commitment, now)),
    };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async findWorkCommitment(userId: string, id: string): Promise<Commitment> {
    const commitment = await findOwnedOrThrow(
      () => this.prisma.commitment.findFirst({ where: { id, userId } }),
      'Commitment',
    );

    if (commitment.domain !== 'WORK') {
      throw new BadRequestException({
        message: 'Focus sessions are for Work commitments. Health has its workout runner.',
        details: { reason: 'COMMITMENT_NOT_WORK', domain: commitment.domain },
      });
    }

    return commitment;
  }

  /** The caller's session, and only while it is still running. */
  private async findOpen(userId: string, id: string): Promise<FocusSession> {
    const session = await findOwnedOrThrow(
      () => this.prisma.focusSession.findFirst({ where: { id, userId } }),
      'Focus session',
    );

    if (session.endedAt) {
      throw new ConflictException({
        message: 'This focus session has already ended.',
        details: { reason: 'FOCUS_SESSION_ENDED', endedAt: session.endedAt.toISOString() },
      });
    }

    return session;
  }

  /**
   * The commitment side of `stop`, routed through E05-02.
   *
   * `abandoned` pauses — and skips the call entirely when the timer is already
   * paused, because `pause` is not an available action then and a 409 would
   * strand a session the user is trying to close.
   */
  private async closeCommitment(
    userId: string,
    commitmentId: string,
    dto: StopFocusSessionDto,
    now: Date,
  ) {
    const notes = dto.notes ?? null;

    if (dto.outcome === 'done') {
      return this.actions.complete(userId, commitmentId, { notes });
    }

    if (dto.outcome === 'partial') {
      return this.actions.partial(userId, commitmentId, { notes });
    }

    const commitment = await this.prisma.commitment.findFirst({
      where: { id: commitmentId, userId },
    });

    if (commitment?.status === 'STARTED' && commitment.activeSince) {
      return this.actions.pause(userId, commitmentId);
    }

    // Already paused, or never started through us. Nothing to bank; the session
    // still ends and still writes its evidence.
    return toCommitmentCard(commitment as Commitment, now);
  }

  private view(
    session: FocusSession,
    title: string,
    status: string,
    timer: CommitmentTimer | null,
  ): FocusSessionView {
    return {
      id: session.id,
      commitmentId: session.commitmentId,
      plannedMinutes: session.plannedMinutes,
      instruction: session.instruction,
      startedAt: session.startedAt.toISOString(),
      endedAt: session.endedAt ? session.endedAt.toISOString() : null,
      outcome: session.outcome,
      actualMinutes: session.actualMinutes,
      continuedCount: session.continuedCount,
      distractionNotes: session.distractionNotes,
      commitment: { title, status, timer },
    };
  }

  private viewWithCommitment(
    session: FocusSession,
    commitment: Commitment | null,
    now: Date,
  ): FocusSessionView {
    const card = commitment ? toCommitmentCard(commitment, now) : null;

    return this.view(session, card?.title ?? '', card?.status ?? 'CANCELLED', card?.timer ?? null);
  }
}
