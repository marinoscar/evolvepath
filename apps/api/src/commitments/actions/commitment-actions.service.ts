import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma, type Commitment, type CommitmentStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { findOwnedOrThrow } from '../../path/owned-resource';
import { availableActionsFor, type CommitmentAction } from '../commitment-actions';
import type { CommitmentCard, StartContext } from '../commitment-card.schema';
import { toCommitmentCard, versionsOf } from '../commitment-card.mapper';
import { CommitmentsService } from '../commitments.service';
import {
  decompositionProposalSchema,
  type DecompositionProposal,
} from '../decomposition/decomposition.schema';
import { ActivityTrackerService } from '../../progress/comeback/activity-tracker.service';
import { MilestonesService } from '../../progress/milestones/milestones.service';
import { DecompositionService } from '../decomposition/decomposition.service';
import type {
  CompleteActionDto,
  ContinueActionDto,
  FallbackActionDto,
  RescheduleActionDto,
  SkipActionDto,
  StartActionDto,
} from '../dto/commitment-action.dtos';
import { elapsedSeconds } from './commitment-timer';

// =============================================================================
// Intent-named commitment actions (issue #40, epic E05)
// =============================================================================
//
// VISION §10 lists the verbs a user reaches for — start for 5, continue, pause,
// move it, break it down — and PRD P4 says starting is evidence in its own
// right. `POST /commitments/:id/transition` (#47) can express the status
// changes underneath all of that, but it cannot express the INTENT, and the
// intent is what decides which evidence row gets written. "I finished" and "I
// gave up on the full version and did the minimum" are the same status and
// different facts.
//
// So each method here is one user intent, and each one owns three things the
// transition endpoint has no opinion about: the timer columns, the evidence row,
// and the audit action.
//
// OWNERSHIP IS ALWAYS 404. Every load filters by `userId`, and a row that is not
// the caller's answers exactly as one that never existed. A 403 would confirm
// the id is real, which is a disclosure the product has no reason to make.
// =============================================================================

/**
 * How long a "something more urgent came up" answer protects a move (#116).
 *
 * A day, because the answer is about TODAY's collision. A reason from last week
 * would quietly make every move that followed it free.
 */
export const PROTECTED_RESCHEDULE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** `evidence.qualitativeValue` is a text column; structure goes in as JSON. */
function asQualitative(value: Record<string, unknown>): string {
  return JSON.stringify(value);
}

@Injectable()
export class CommitmentActionsService {
  private readonly logger = new Logger(CommitmentActionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly commitments: CommitmentsService,
    private readonly decomposition: DecompositionService,
    private readonly activity: ActivityTrackerService,
    private readonly milestones: MilestonesService,
  ) {}

  // ---------------------------------------------------------------------------
  // Reading
  // ---------------------------------------------------------------------------

  /**
   * The card an execution screen renders, with the outcome's motivation joined.
   *
   * Deliberately NOT `CommitmentsService.get`: that returns the record — every
   * column, plus evidence and reflections — and a Start screen that read one
   * shape and then received another from every action it fires would drift from
   * the API one field at a time.
   */
  async getCard(userId: string, id: string): Promise<StartContext> {
    const row = await findOwnedOrThrow(
      () =>
        this.prisma.commitment.findFirst({
          where: { id, userId },
          include: { outcome: { select: { motivation: true, successDefinition: true } } },
        }),
      'Commitment',
    );

    return {
      ...toCommitmentCard(row),
      // The definition of done is a usable answer to "why" when no motivation
      // was written — it is still the user's own statement of what this is for.
      whyItMatters: row.outcome?.motivation ?? row.outcome?.successDefinition ?? null,
    };
  }

  // ---------------------------------------------------------------------------
  // Timer
  // ---------------------------------------------------------------------------

  /**
   * Start, or resume a paused session.
   *
   * A second `start` on a paused row is deliberately NOT an error. To a user
   * there is one button; which operation it is depends on a column they cannot
   * see, and erroring would punish them for the distinction.
   *
   * At most one timer runs per user. Anything else the user left running is
   * paused first, with its own `paused` evidence — the alternative is two
   * commitments both claiming the same wall-clock minutes, which would make
   * every later "how long did this take" answer a lie.
   */
  async start(userId: string, id: string, dto: StartActionDto): Promise<CommitmentCard> {
    const existing = await this.findOwned(userId, id);
    const now = new Date();

    if (existing.status === 'STARTED') {
      return existing.activeSince
        ? toCommitmentCard(existing, now) // already running: nothing to do
        : this.resume(userId, existing, null, now, 'commitment:start');
    }

    this.assertAction(existing, 'start');

    const row = await this.prisma.$transaction(async (tx) => {
      await this.pauseOthers(tx, userId, id, now);

      const updated = await tx.commitment.update({
        where: { id },
        data: {
          status: 'STARTED',
          // First time only: a second start must not rewrite when the user began.
          startedAt: existing.startedAt ?? now,
          activeSince: now,
          activeSeconds: 0,
          timerMinutes: dto.minutes ?? null,
        },
      });

      await tx.evidence.create({
        data: {
          userId,
          commitmentId: id,
          evidenceType: 'started',
          // APP_FLOW: the system observed this, the user did not report it.
          source: 'APP_FLOW',
          occurredAt: now,
          quantitativeValue: dto.minutes ?? null,
          quantitativeUnit: dto.minutes ? 'minutes' : null,
          confidence: 1,
        },
      });

      return updated;
    });

    await this.audit(userId, 'commitment:start', id, { timerMinutes: row.timerMinutes });

    return toCommitmentCard(row, now);
  }

  /**
   * Bank the running time and stop the clock.
   *
   * The status stays `STARTED`. Paused is `STARTED` with `activeSince: null`;
   * PRD §10.7 owns the status enum and there is no PAUSED member in it.
   */
  async pause(userId: string, id: string): Promise<CommitmentCard> {
    const existing = await this.findOwned(userId, id);
    this.assertAction(existing, 'pause');

    const now = new Date();
    const banked = elapsedSeconds(
      { activeSince: existing.activeSince, activeSeconds: existing.activeSeconds },
      now,
    );

    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.commitment.update({
        where: { id },
        data: { activeSince: null, activeSeconds: banked },
      });

      await tx.evidence.create({
        data: {
          userId,
          commitmentId: id,
          evidenceType: 'paused',
          source: 'APP_FLOW',
          occurredAt: now,
          quantitativeValue: banked,
          quantitativeUnit: 'seconds',
          confidence: 1,
        },
      });

      return updated;
    });

    await this.audit(userId, 'commitment:pause', id, { activeSeconds: banked });

    return toCommitmentCard(row, now);
  }

  /**
   * Restart the clock, optionally extending the target ("Continue another 15?").
   *
   * ACCEPTED WHILE THE TIMER IS STILL RUNNING, which is the one place this
   * deviates from `availableActionsFor`. A session that has passed its target is
   * still `STARTED` with `activeSince` set, and that is exactly when the Start
   * screen offers "another 15" — refusing it would leave the user's only way to
   * keep going a pause followed by a continue, which writes a `paused` evidence
   * row for a pause that never happened (PRD §10.9).
   *
   * When it is already running, `activeSince` is left alone so no accumulated
   * time is lost; only the target moves.
   */
  async continue(
    userId: string,
    id: string,
    dto: ContinueActionDto,
  ): Promise<CommitmentCard> {
    const existing = await this.findOwned(userId, id);

    if (existing.status !== 'STARTED') {
      throw new ConflictException({
        message: `Cannot continue a ${existing.status} commitment`,
        details: { reason: 'INVALID_TRANSITION', status: existing.status, action: 'continue' },
      });
    }

    return this.resume(userId, existing, dto.extraMinutes ?? null, new Date(), 'commitment:continue');
  }

  // ---------------------------------------------------------------------------
  // Finishing
  // ---------------------------------------------------------------------------

  /** "I did it." */
  async complete(
    userId: string,
    id: string,
    dto: CompleteActionDto,
  ): Promise<CommitmentCard> {
    return this.finish(userId, id, 'COMPLETED', dto, 'completed', 'commitment:complete');
  }

  /** "I did some of it." A different fact, and PRD §101 wants it recorded as one. */
  async partial(
    userId: string,
    id: string,
    dto: CompleteActionDto,
  ): Promise<CommitmentCard> {
    return this.finish(
      userId,
      id,
      'PARTIALLY_COMPLETED',
      dto,
      'partially_completed',
      'commitment:partial',
    );
  }

  /**
   * "I am doing the smaller version."
   *
   * No status change: the commitment is still open, the user has just told the
   * product which size they are attempting. Recorded now rather than inferred at
   * completion, because the choice is the interesting moment — PRD §101's Day 2
   * reads "Evidence: fallback completed", and that sentence needs the decision.
   */
  async fallback(
    userId: string,
    id: string,
    dto: FallbackActionDto,
  ): Promise<CommitmentCard> {
    const existing = await this.findOwned(userId, id);
    this.assertAction(existing, 'fallback');

    const versions = versionsOf(existing);
    const chosen = dto.version === 'short' ? versions.short : versions.minimum;

    if (!chosen) {
      throw new BadRequestException({
        message: `This commitment has no ${dto.version} version`,
        details: { reason: 'VERSION_NOT_DEFINED', version: dto.version },
      });
    }

    const now = new Date();
    const versionUsed = dto.version === 'short' ? 'SHORT' : 'MINIMUM';

    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.commitment.update({
        where: { id },
        data: { versionUsed },
      });

      await tx.evidence.create({
        data: {
          userId,
          commitmentId: id,
          evidenceType: 'fallback_selected',
          source: 'APP_FLOW',
          occurredAt: now,
          quantitativeValue: chosen.minutes,
          quantitativeUnit: 'minutes',
          qualitativeValue: asQualitative({ version: versionUsed, fallbackUsed: true }),
          confidence: 1,
        },
      });

      return updated;
    });

    await this.audit(userId, 'commitment:fallback', id, { versionUsed });

    return toCommitmentCard(row, now);
  }

  // ---------------------------------------------------------------------------
  // Moving and abandoning
  // ---------------------------------------------------------------------------

  /**
   * Move it.
   *
   * DELEGATES to `CommitmentsService.transition`, which owns the matrix and the
   * new-row model: `RESCHEDULED` is terminal, so the original closes and a fresh
   * `PLANNED` row carries the intention forward with `rescheduleCount + 1`. The
   * count travels with the intention rather than the row, which is what makes
   * "moved twice" readable on the live commitment.
   *
   * The evidence row goes on the NEW commitment: the live intention carries its
   * own move history, and the closed row keeps only what happened before it moved.
   */
  async reschedule(
    userId: string,
    id: string,
    dto: RescheduleActionDto,
  ): Promise<CommitmentCard> {
    const existing = await this.findOwned(userId, id);

    // A PROTECTED move (E07-03, #116) is a move the user has explained. It
    // still creates the new row and still writes evidence — the ONE thing it
    // changes is that the count does not grow, because "something more urgent
    // came up" is not avoidance and counting it as such would push an honest
    // user up the intervention ladder for having a job.
    const isProtected = dto.protected === true;

    if (isProtected && !(await this.hasRecentUrgencyReflection(userId, id))) {
      throw new BadRequestException({
        message:
          'A protected move needs a recent "something more urgent came up" answer on this commitment.',
        details: { reason: 'PROTECTED_RESCHEDULE_NOT_ALLOWED' },
      });
    }

    // Checked before the matrix so the message names the real reason: STARTED →
    // RESCHEDULED is matrix-legal, but moving a commitment whose timer has been
    // running would carry today's evidence into tomorrow.
    if (existing.status === 'STARTED') {
      throw new ConflictException({
        message: 'A started commitment cannot be rescheduled — complete it or skip it',
        details: { reason: 'ALREADY_STARTED' },
      });
    }

    this.assertAction(existing, 'reschedule');

    const result = await this.commitments.transition(userId, id, {
      to: 'RESCHEDULED',
      rescheduleTo: dto.scheduledStart,
    } as never);

    const replacementId = result.rescheduledTo?.id;

    if (!replacementId) {
      // Unreachable through the matrix; a loud failure beats returning the
      // closed row and letting a client act on a terminal id.
      throw new ConflictException('Reschedule did not produce a replacement commitment');
    }

    const now = new Date();

    // `scheduledEnd` from the body wins over the duration the transition derived
    // from the original window — the user is moving it AND resizing it.
    const row = await this.prisma.$transaction(async (tx) => {
      // `scheduledEnd` from the body and the protected count are the same
      // write: the transition already created the row with `count + 1`, and a
      // protected move puts it back where it was.
      const patch: Prisma.CommitmentUpdateInput = {};

      if (dto.scheduledEnd !== undefined && dto.scheduledEnd !== null) {
        patch.scheduledEnd = new Date(dto.scheduledEnd);
      }

      if (isProtected) patch.rescheduleCount = existing.rescheduleCount;

      const updated =
        Object.keys(patch).length > 0
          ? await tx.commitment.update({ where: { id: replacementId }, data: patch })
          : await tx.commitment.findUniqueOrThrow({ where: { id: replacementId } });

      await tx.evidence.create({
        data: {
          userId,
          commitmentId: replacementId,
          evidenceType: 'rescheduled',
          source: 'APP_FLOW',
          occurredAt: now,
          qualitativeValue: asQualitative({
            from: existing.scheduledStart.toISOString(),
            to: updated.scheduledStart.toISOString(),
            count: updated.rescheduleCount,
            protected: isProtected,
          }),
          confidence: 1,
        },
      });

      return updated;
    });

    await this.audit(userId, 'commitment:reschedule', id, {
      from: existing.scheduledStart.toISOString(),
      to: row.scheduledStart.toISOString(),
      rescheduleCount: row.rescheduleCount,
      rescheduledToId: row.id,
      protected: isProtected,
    });

    return toCommitmentCard(row, now);
  }

  /**
   * "Not today."
   *
   * Writes a `Reflection`, not evidence. A skip is not execution — recording it
   * as evidence would make "what did you do this week" include the things you
   * did not do. But PRD P5 says a failed plan is information, so the reason is
   * captured as a friction tag the coach and E07 can group on.
   */
  async skip(userId: string, id: string, dto: SkipActionDto): Promise<CommitmentCard> {
    const existing = await this.findOwned(userId, id);
    this.assertAction(existing, 'skip');

    const now = new Date();

    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.commitment.update({
        where: { id },
        data: { status: 'SKIPPED', skipReason: dto.reason, skipNote: dto.text ?? null },
      });

      await tx.reflection.create({
        data: {
          userId,
          relatedType: 'commitment',
          relatedId: id,
          commitmentId: id,
          userText: dto.text ?? null,
          frictionTags: [dto.reason],
        },
      });

      return updated;
    });

    // The enum, never the text: a skip note is the user talking to their coach.
    await this.audit(userId, 'commitment:skip', id, { reason: dto.reason });

    return toCommitmentCard(row, now);
  }

  // ---------------------------------------------------------------------------
  // Decomposition
  // ---------------------------------------------------------------------------

  /** Ask the coach for smaller steps. Writes nothing. */
  async propose(
    userId: string,
    id: string,
    hint?: string | null,
  ): Promise<DecompositionProposal> {
    const existing = await findOwnedOrThrow(
      () =>
        this.prisma.commitment.findFirst({
          where: { id, userId },
          include: { outcome: { select: { motivation: true } } },
        }),
      'Commitment',
    );

    return this.decomposition.propose(userId, existing, hint);
  }

  /**
   * Accept a proposal, possibly edited.
   *
   * Creates a NEW commitment from `firstStep` and leaves the original alone: the
   * big one is still in the plan, and the small one is today's move. Replacing
   * the original would quietly delete a commitment the user never abandoned.
   */
  async applyDecomposition(
    userId: string,
    id: string,
    proposal: DecompositionProposal,
  ): Promise<CommitmentCard> {
    const existing = await this.findOwned(userId, id);

    // Re-validated even though the DTO already parsed it: this is the boundary
    // where model output becomes a database row, and it is worth being explicit
    // that an edited proposal is held to the same contract the model was.
    const parsed = decompositionProposalSchema.parse(proposal);
    const now = new Date();

    const row = await this.prisma.commitment.create({
      data: {
        userId,
        domain: existing.domain,
        title: parsed.firstStep.title,
        outcomeId: existing.outcomeId,
        planVersionId: existing.planVersionId,
        routineId: existing.routineId,
        scheduledStart: now,
        importance: existing.importance,
        commitmentType: existing.commitmentType,
        fullVersion: parsed.firstStep.title,
        fullMinutes: parsed.firstStep.minutes,
        minimumVersion: parsed.firstStep.title,
        minimumMinutes: Math.min(5, parsed.firstStep.minutes),
        steps: parsed.steps as unknown as Prisma.InputJsonValue,
        decomposedFromId: existing.id,
        status: 'PLANNED',
      },
    });

    // No evidence: creating a smaller commitment is still a plan, and PRD §10.9
    // forbids treating a planned item as evidence that anything happened.
    await this.audit(userId, 'commitment:decompose_apply', row.id, {
      sourceCommitmentId: existing.id,
      stepCount: parsed.steps.length,
    });

    return toCommitmentCard(row, now);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * Whether the user has answered "something more urgent came up" here, lately.
   *
   * The reflection E07-03 writes is the whole authorisation for a protected
   * move. Twenty-four hours because the answer is about TODAY's collision; a
   * reason from last week does not protect this week's move.
   */
  private async hasRecentUrgencyReflection(userId: string, id: string): Promise<boolean> {
    const since = new Date(Date.now() - PROTECTED_RESCHEDULE_WINDOW_MS);

    const reflection = await this.prisma.reflection.findFirst({
      where: {
        userId,
        commitmentId: id,
        createdAt: { gte: since },
        frictionTags: { has: 'SOMETHING_URGENT' },
      },
      select: { id: true },
    });

    return reflection !== null;
  }

  private async findOwned(userId: string, id: string): Promise<Commitment> {
    return findOwnedOrThrow(
      () => this.prisma.commitment.findFirst({ where: { id, userId } }),
      'Commitment',
    );
  }

  /**
   * 409 with `details.reason: 'INVALID_TRANSITION'` — the same discriminator
   * `POST /commitments/:id/transition` uses, because a client should not have to
   * learn two ways to recognise the same refusal.
   */
  private assertAction(commitment: Commitment, action: CommitmentAction): void {
    if (availableActionsFor(commitment).includes(action)) return;

    throw new ConflictException({
      message: `Cannot ${action} a ${commitment.status} commitment`,
      details: { reason: 'INVALID_TRANSITION', status: commitment.status, action },
    });
  }

  /** Shared by `start` (on a paused row) and `continue`. */
  private async resume(
    userId: string,
    existing: Commitment,
    extraMinutes: number | null,
    now: Date,
    auditAction: string,
  ): Promise<CommitmentCard> {
    const timerMinutes =
      extraMinutes === null ? existing.timerMinutes : (existing.timerMinutes ?? 0) + extraMinutes;

    const row = await this.prisma.$transaction(async (tx) => {
      await this.pauseOthers(tx, userId, existing.id, now);

      const updated = await tx.commitment.update({
        where: { id: existing.id },
        // Already running: move the target, keep the clock. Re-anchoring
        // `activeSince` would silently discard the seconds since it was set.
        data: existing.activeSince
          ? { timerMinutes }
          : { activeSince: now, timerMinutes },
      });

      await tx.evidence.create({
        data: {
          userId,
          commitmentId: existing.id,
          evidenceType: 'continued',
          source: 'APP_FLOW',
          occurredAt: now,
          quantitativeValue: extraMinutes,
          quantitativeUnit: extraMinutes === null ? null : 'minutes',
          confidence: 1,
        },
      });

      return updated;
    });

    await this.audit(userId, auditAction, existing.id, { timerMinutes: row.timerMinutes });

    return toCommitmentCard(row, now);
  }

  /** One running timer per user. See `start`. */
  private async pauseOthers(
    tx: Prisma.TransactionClient,
    userId: string,
    keepId: string,
    now: Date,
  ): Promise<void> {
    const running = await tx.commitment.findMany({
      where: { userId, status: 'STARTED', activeSince: { not: null }, id: { not: keepId } },
    });

    for (const other of running) {
      const banked = elapsedSeconds(
        { activeSince: other.activeSince, activeSeconds: other.activeSeconds },
        now,
      );

      await tx.commitment.update({
        where: { id: other.id },
        data: { activeSince: null, activeSeconds: banked },
      });

      await tx.evidence.create({
        data: {
          userId,
          commitmentId: other.id,
          evidenceType: 'paused',
          source: 'APP_FLOW',
          occurredAt: now,
          quantitativeValue: banked,
          quantitativeUnit: 'seconds',
          confidence: 1,
        },
      });
    }
  }

  /** `complete` and `partial` differ only in the status and the evidence type. */
  private async finish(
    userId: string,
    id: string,
    to: Extract<CommitmentStatus, 'COMPLETED' | 'PARTIALLY_COMPLETED'>,
    dto: CompleteActionDto,
    evidenceType: string,
    auditAction: string,
  ): Promise<CommitmentCard> {
    const existing = await this.findOwned(userId, id);
    this.assertAction(existing, to === 'COMPLETED' ? 'complete' : 'partial');

    const now = new Date();
    const activeSeconds = elapsedSeconds(
      { activeSince: existing.activeSince, activeSeconds: existing.activeSeconds },
      now,
    );

    // The user's own number wins. The timer knows how long the app was open,
    // which is not the same thing as how long the work took.
    const minutesSpent = dto.minutesSpent ?? Math.round(activeSeconds / 60);

    // FULL unless the user said otherwise. Completing without ever choosing a
    // fallback is completing the thing they committed to.
    const versionUsed = existing.versionUsed ?? 'FULL';

    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.commitment.update({
        where: { id },
        data: {
          status: to,
          completedAt: now,
          // Fold the running time in so the record does not depend on whether
          // the user remembered to press pause before finishing.
          activeSince: null,
          activeSeconds,
          minutesSpent,
          versionUsed,
        },
      });

      await tx.evidence.create({
        data: {
          userId,
          commitmentId: id,
          evidenceType,
          // USER_LOG: the user reported this, unlike the timer's APP_FLOW rows.
          source: 'USER_LOG',
          occurredAt: now,
          quantitativeValue: minutesSpent,
          quantitativeUnit: 'minutes',
          qualitativeValue: asQualitative({
            notes: dto.notes ?? null,
            versionUsed,
            fallbackUsed: versionUsed !== 'FULL',
          }),
          confidence: 1,
        },
      });

      return updated;
    });

    // Never the notes: they are the user's own words about their day.
    await this.audit(userId, auditAction, id, { versionUsed, minutesSpent });

    return toCommitmentCard(row, now);
  }

  /**
   * The audit row, and the activity stamp that rides with it.
   *
   * EVERY mutating action in this class lands here exactly once, after its
   * transaction has committed — which makes this the one honest place to record
   * "the user did something" for E11's comeback loop (#112). Sprinkling
   * `activity.record` through nine methods would eventually miss the tenth.
   *
   * `record` is detached and swallows its own failures: a comeback offer that
   * is a day early is a kind sentence; a completion that 500s because a
   * bookkeeping write failed is the user's lost work.
   *
   * The milestone pass rides here too, and only on the two actions that can
   * complete one instantly (#115): a start on something moved twice earns
   * `FIRST_START_AFTER_POSTPONE` before any cron runs, and the tenth workout
   * should be celebrated on the tenth workout rather than tomorrow at 04:00.
   */
  private async audit(
    userId: string,
    action: string,
    targetId: string,
    meta: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.prisma.auditEvent.create({
      data: { actorUserId: userId, action, targetType: 'commitment', targetId, meta },
    });

    this.activity.record(userId);

    if (MILESTONE_TRIGGERING_ACTIONS.has(action)) {
      this.milestones.afterAction(userId);
    }
  }
}

/**
 * The actions that can complete a milestone the moment they happen.
 *
 * Not every action: a pause cannot earn anything, and evaluating on all nine
 * would be eight wasted passes per session.
 */
const MILESTONE_TRIGGERING_ACTIONS = new Set([
  'commitment:start',
  'commitment:complete',
  'commitment:partial',
]);
