import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { CommitmentActionsService } from '../../commitments/actions/commitment-actions.service';
import { findOwnedOrThrow } from '../../path/owned-resource';
import { PrismaService } from '../../prisma/prisma.service';
import { Trace } from '../../common/decorators/trace.decorator';
import { PAIN_SAFETY_ACTION, PAIN_SAFETY_COPY } from '../safety/workout-safety-copy';
import {
  suggestProgression,
  type ProgressionSuggestion,
} from '../progression/double-progression';
import { ProgressionExplainerService } from '../progression/progression-explainer.service';
import { weeklyStructureSchema } from '../programs/workout-program.schema';
import type {
  FinishSessionDto,
  FinishSessionResponseDto,
  LogSetBatchResponseDto,
  LogSetDto,
  LogSetResponseDto,
  SessionQueryDto,
  StartSessionDto,
  SwitchVariantDto,
  WorkoutSessionSummaryDto,
  WorkoutSessionViewDto,
} from '../dto/workout-session.dtos';
import {
  buildSessionView,
  toSetLogDto,
  type SetLogRow,
  type TemplateExerciseRow,
} from './session-view.builder';

// =============================================================================
// Running a workout (issue #81, epic E09)
// =============================================================================
//
// THE SESSION IS NOT THE COMMITMENT, and every awkward-looking thing in here
// follows from that. A session records what happened in the gym; the commitment
// records what the user intended and what they made of it. So:
//
//   • Every commitment status change goes through `CommitmentActionsService`
//     (E05-02). Never `prisma.commitment.update({ status })` — the transition
//     matrix, the timer and the APP_FLOW evidence all live there, and a second
//     writer would be a second matrix.
//   • This service writes its own `WORKOUT_LOG` evidence on finish. Both rows
//     exist on purpose: one is the outcome of an intention, the other is the
//     record of a workout, and a reader asking "what did they lift?" should not
//     have to infer it from a completion.
//
// IDEMPOTENCY IS THE UNIQUE INDEX, NOT A PRE-CHECK. PRD §121 has the phone
// replaying a queue it is not sure was accepted, possibly twice at once. We
// attempt the insert and catch P2002, because a `findFirst` followed by a
// `create` is a race with a window exactly as wide as the round trip.
//
// SHARP PAIN CALLS NOTHING. No model, no template, no reasoning — one constant
// string and a flag (PRD §45). A spec asserts the gateway is never reached.
// =============================================================================

/** How far in the future a client-supplied `loggedAt` may sit. */
const CLOCK_SKEW_MS = 5 * 60_000;

/** How many past sessions per movement the runner reads. Two: see E09-04. */
const HISTORY_SESSIONS = 2;

const SESSION_INCLUDE = {
  template: {
    include: {
      program: true,
      exercises: {
        include: { exercise: { select: { name: true, equipment: true, instructions: true } } },
        orderBy: { order: 'asc' as const },
      },
    },
  },
  setLogs: true,
} satisfies Prisma.WorkoutSessionInclude;

type SessionRow = Prisma.WorkoutSessionGetPayload<{ include: typeof SESSION_INCLUDE }>;

@Injectable()
export class WorkoutSessionsService {
  private readonly logger = new Logger(WorkoutSessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly actions: CommitmentActionsService,
    private readonly explainer: ProgressionExplainerService,
  ) {}

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------

  async start(userId: string, dto: StartSessionDto): Promise<WorkoutSessionViewDto> {
    const open = await this.prisma.workoutSession.findFirst({
      where: { userId, status: 'IN_PROGRESS' },
      select: { id: true },
    });

    if (open) {
      throw new ConflictException({
        code: 'SESSION_IN_PROGRESS',
        message: 'You already have a workout open. Finish or abandon it first.',
        details: { sessionId: open.id },
      });
    }

    const variant = dto.variant ?? 'FULL';
    let commitmentId: string | null = null;
    let fullTemplateId: string;

    if (dto.commitmentId) {
      const commitment = await findOwnedOrThrow(
        () =>
          this.prisma.commitment.findFirst({
            where: { id: dto.commitmentId, userId },
            select: { id: true, workoutTemplateId: true },
          }),
        'Commitment',
      );

      if (!commitment.workoutTemplateId) {
        throw new BadRequestException({
          code: 'NOT_A_WORKOUT_COMMITMENT',
          message: 'This commitment is not a workout. Use the ordinary start action.',
        });
      }

      commitmentId = commitment.id;
      fullTemplateId = commitment.workoutTemplateId;
    } else {
      const template = await findOwnedOrThrow(
        () =>
          this.prisma.workoutTemplate.findFirst({
            where: { id: dto.templateId, program: { userId } },
            select: { id: true, variant: true, fallbackOfTemplateId: true },
          }),
        'Workout template',
      );

      // A caller may hand us any variant; the session is always anchored on the
      // FULL sibling so switching variants mid-session has somewhere to go.
      fullTemplateId = template.variant === 'FULL' ? template.id : template.fallbackOfTemplateId!;
    }

    const template = await this.resolveVariant(userId, fullTemplateId, variant);

    const session = await this.prisma.workoutSession.create({
      data: {
        userId,
        commitmentId,
        templateId: template.id,
        variant,
        startedAt: new Date(),
      },
      select: { id: true },
    });

    if (commitmentId) {
      // E05-02 owns the transition, the timer and the `started` evidence.
      await this.actions.start(userId, commitmentId, { minutes: template.targetMinutes });

      if (variant !== 'FULL') {
        await this.actions.fallback(userId, commitmentId, {
          version: variant === 'SHORT' ? 'short' : 'minimum',
        });
      }
    }

    await this.audit(userId, 'workout_session:start', session.id, {
      templateId: template.id,
      variant,
      commitmentId,
    });

    return this.get(userId, session.id);
  }

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  async get(userId: string, id: string): Promise<WorkoutSessionViewDto> {
    return this.view(await this.findOwned(userId, id));
  }

  async list(userId: string, query: SessionQueryDto): Promise<WorkoutSessionSummaryDto[]> {
    const rows = await this.prisma.workoutSession.findMany({
      where: {
        userId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.templateId ? { templateId: query.templateId } : {}),
      },
      orderBy: { startedAt: 'desc' },
      take: query.limit,
      include: {
        template: { select: { name: true } },
        _count: { select: { setLogs: true } },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      variant: row.variant,
      templateId: row.templateId,
      templateName: row.template.name,
      startedAt: row.startedAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
      discomfortFlag: row.discomfortFlag,
      commitmentId: row.commitmentId,
      setCount: row._count.setLogs,
    }));
  }

  // ---------------------------------------------------------------------------
  // Logging sets
  // ---------------------------------------------------------------------------

  async logSet(userId: string, id: string, dto: LogSetDto): Promise<LogSetResponseDto> {
    const session = await this.findOwned(userId, id);

    this.assertOpen(session);

    const outcome = await this.writeSet(userId, session, dto);

    if (outcome.kind === 'rejected') {
      throw new BadRequestException({ code: outcome.reason, message: outcome.message });
    }

    return {
      set: outcome.set,
      safety:
        dto.discomfort === 'SHARP_PAIN'
          ? { copy: PAIN_SAFETY_COPY, action: PAIN_SAFETY_ACTION }
          : null,
    };
  }

  /**
   * The offline queue's replay entry point.
   *
   * NEVER ALL-OR-NOTHING. One bad item in a queue of thirty must not cost the
   * user the other twenty-nine — they performed those sets, and a 400 for the
   * batch would be the app losing work it watched them do.
   */
  async logSets(
    userId: string,
    id: string,
    sets: LogSetDto[],
  ): Promise<LogSetBatchResponseDto> {
    const session = await this.findOwned(userId, id);

    this.assertOpen(session);

    const accepted: LogSetBatchResponseDto['accepted'] = [];
    const duplicates: string[] = [];
    const rejected: LogSetBatchResponseDto['rejected'] = [];

    for (const dto of sets) {
      const outcome = await this.writeSet(userId, session, dto);

      if (outcome.kind === 'rejected') rejected.push({ clientId: dto.clientId, reason: outcome.reason });
      else if (outcome.kind === 'duplicate') duplicates.push(dto.clientId);
      else accepted.push(outcome.set);
    }

    return { accepted, duplicates, rejected };
  }

  // ---------------------------------------------------------------------------
  // Variant
  // ---------------------------------------------------------------------------

  async switchVariant(
    userId: string,
    id: string,
    dto: SwitchVariantDto,
  ): Promise<WorkoutSessionViewDto> {
    const session = await this.findOwned(userId, id);

    this.assertOpen(session);

    const fullId =
      session.template.variant === 'FULL'
        ? session.templateId
        : session.template.fallbackOfTemplateId!;

    const template = await this.resolveVariant(userId, fullId, dto.variant);

    await this.prisma.workoutSession.update({
      where: { id: session.id },
      data: { templateId: template.id, variant: dto.variant },
    });

    if (session.commitmentId && dto.variant !== 'FULL') {
      await this.actions.fallback(userId, session.commitmentId, {
        version: dto.variant === 'SHORT' ? 'short' : 'minimum',
      });
    }

    return this.get(userId, session.id);
  }

  // ---------------------------------------------------------------------------
  // Finish
  // ---------------------------------------------------------------------------

  @Trace('workouts.session.finish')
  async finish(
    userId: string,
    id: string,
    dto: FinishSessionDto,
  ): Promise<FinishSessionResponseDto> {
    const session = await this.findOwned(userId, id);

    this.assertOpen(session);

    const finishedAt = new Date();
    const logs = session.setLogs;
    const volumeKg = logs.reduce(
      (total, log) => total + (log.weightKg ? Number(log.weightKg) * log.reps : 0),
      0,
    );
    const minutes = Math.max(
      0,
      Math.round((finishedAt.getTime() - session.startedAt.getTime()) / 60_000),
    );

    const plannedIds = session.template.exercises.map((row) => row.exerciseId);
    const loggedIds = new Set(logs.map((log) => log.exerciseId));
    const exercisesCompleted = plannedIds.filter((exerciseId) => loggedIds.has(exerciseId)).length;

    const updated = await this.prisma.workoutSession.update({
      where: { id: session.id },
      data: { status: dto.status, finishedAt },
      include: { template: { select: { name: true } } },
    });

    await this.prisma.evidence.create({
      data: {
        userId,
        commitmentId: session.commitmentId,
        evidenceType: dto.status === 'COMPLETED' ? 'workout_completed' : 'workout_abandoned',
        // WORKOUT_LOG, not USER_LOG: this is the gym record, and E05's own
        // completion evidence is a separate USER_LOG row about the intention.
        source: 'WORKOUT_LOG',
        occurredAt: finishedAt,
        quantitativeValue: Math.round(volumeKg * 100) / 100,
        quantitativeUnit: 'kg',
        qualitativeValue: JSON.stringify({
          sets: logs.length,
          volumeKg: Math.round(volumeKg * 100) / 100,
          minutes,
          variant: session.variant,
          discomfortFlag: session.discomfortFlag,
          notes: dto.notes ?? null,
        }),
        confidence: 1,
      },
    });

    const commitmentStatus = await this.settleCommitment(userId, session, dto, {
      exercisesCompleted,
      exercisesPlanned: plannedIds.length,
      setCount: logs.length,
      minutes,
    });

    await this.audit(userId, 'workout_session:finish', session.id, {
      status: dto.status,
      sets: logs.length,
      volumeKg: Math.round(volumeKg * 100) / 100,
      minutes,
      variant: session.variant,
      commitmentStatus,
    });

    // The notes are the user's own words about their body. Never logged.
    this.logger.log(
      `workout_session.finish session=${session.id} status=${dto.status} ` +
        `sets=${logs.length} minutes=${minutes} user=${userId}`,
    );

    return {
      session: {
        id: updated.id,
        status: updated.status,
        variant: updated.variant,
        templateId: updated.templateId,
        templateName: updated.template.name,
        startedAt: updated.startedAt.toISOString(),
        finishedAt: updated.finishedAt?.toISOString() ?? null,
        discomfortFlag: updated.discomfortFlag,
        commitmentId: updated.commitmentId,
        setCount: logs.length,
      },
      summary: {
        sets: logs.length,
        volumeKg: Math.round(volumeKg * 100) / 100,
        minutes,
        exercisesCompleted,
        exercisesPlanned: plannedIds.length,
      },
      commitmentStatus,
    };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * One sentence about the suggestion for one movement (PRD §42).
   *
   * Separate from `GET /sessions/:id` on purpose. The runner has to render with
   * the provider down and without spending the user's key on every movement on
   * the screen; the explanation is fetched when a chip is tapped, and a failure
   * there costs a sentence rather than the workout.
   */
  async explain(
    userId: string,
    sessionId: string,
    exerciseId: string,
  ): Promise<{ sentence: string; source: string }> {
    const session = await this.findOwned(userId, sessionId);

    const prescription = session.template.exercises.find(
      (row) => row.exerciseId === exerciseId,
    );

    if (!prescription) {
      throw new BadRequestException({
        code: 'EXERCISE_NOT_IN_SESSION',
        message: 'That movement is not part of this workout.',
      });
    }

    const recent = await this.recentSessionsFor(userId, session.id, [exerciseId]);

    const suggestion = suggestProgression(
      (recent.get(exerciseId) ?? []).map((entry) => ({
        sessionId: entry.sessionId,
        date: entry.startedAt.toISOString(),
        sets: entry.sets.map((log) => ({
          weightKg: log.weightKg === null ? null : Number(log.weightKg),
          reps: log.reps,
          rpe: log.rpe,
          discomfort: log.discomfort as 'NONE' | 'MILD' | 'SHARP_PAIN',
        })),
      })),
      {
        sets: prescription.sets,
        repMin: prescription.repMin,
        repMax: prescription.repMax,
        equipment: prescription.exercise.equipment,
      },
    );

    return this.explainer.explain(
      userId,
      { sessionId: session.id, exerciseId },
      prescription.exercise.name,
      suggestion,
    );
  }

  private async findOwned(userId: string, id: string): Promise<SessionRow> {
    return findOwnedOrThrow(
      () =>
        this.prisma.workoutSession.findFirst({
          where: { id, userId },
          include: SESSION_INCLUDE,
        }),
      'Workout session',
    );
  }

  private assertOpen(session: { status: string }): void {
    if (session.status !== 'IN_PROGRESS') {
      throw new ConflictException({
        code: 'SESSION_NOT_OPEN',
        message: 'This workout is already finished.',
      });
    }
  }

  private async resolveVariant(
    userId: string,
    fullTemplateId: string,
    variant: string,
  ): Promise<{ id: string; targetMinutes: number }> {
    if (variant === 'FULL') {
      return findOwnedOrThrow(
        () =>
          this.prisma.workoutTemplate.findFirst({
            where: { id: fullTemplateId, program: { userId } },
            select: { id: true, targetMinutes: true },
          }),
        'Workout template',
      );
    }

    const sibling = await this.prisma.workoutTemplate.findFirst({
      where: {
        fallbackOfTemplateId: fullTemplateId,
        variant: variant as 'SHORT' | 'MINIMUM',
        program: { userId },
      },
      select: { id: true, targetMinutes: true },
    });

    if (!sibling) {
      throw new BadRequestException({
        code: 'VARIANT_NOT_DEFINED',
        message: `This workout has no ${variant.toLowerCase()} version.`,
      });
    }

    return sibling;
  }

  /**
   * One set, written idempotently.
   *
   * Three outcomes, and the interesting one is the middle: the same `clientId`
   * arriving twice is a REPLAY, not a second set, and the answer is the row we
   * already have. The same `(exercise, setNumber)` under a NEW `clientId` is a
   * correction — the user retyped 20 kg as 22.5 — and the answer is an update.
   */
  private async writeSet(
    userId: string,
    session: SessionRow,
    dto: LogSetDto,
  ): Promise<
    | { kind: 'created' | 'updated'; set: LogSetResponseDto['set'] }
    | { kind: 'duplicate'; set: LogSetResponseDto['set'] }
    | { kind: 'rejected'; reason: string; message: string }
  > {
    const programExerciseIds = await this.programExerciseIds(session.template.programId);

    if (!programExerciseIds.has(dto.exerciseId)) {
      return {
        kind: 'rejected',
        reason: 'EXERCISE_NOT_IN_PROGRAM',
        message: 'That movement is not part of this program.',
      };
    }

    const loggedAt = dto.loggedAt ? new Date(dto.loggedAt) : new Date();

    // A client clock is not evidence. Accept what it says only inside the window
    // the session could plausibly cover.
    if (
      loggedAt.getTime() < session.startedAt.getTime() ||
      loggedAt.getTime() > Date.now() + CLOCK_SKEW_MS
    ) {
      return {
        kind: 'rejected',
        reason: 'LOGGED_AT_OUT_OF_RANGE',
        message: 'That set is timestamped outside this workout.',
      };
    }

    const data = {
      sessionId: session.id,
      exerciseId: dto.exerciseId,
      setNumber: dto.setNumber,
      weightKg: dto.weightKg ?? null,
      reps: dto.reps,
      rpe: dto.rpe ?? null,
      discomfort: dto.discomfort ?? 'NONE',
      loggedAt,
      clientId: dto.clientId,
    };

    let row: SetLogRow;
    let kind: 'created' | 'updated' | 'duplicate' = 'created';

    try {
      row = await this.prisma.setLog.create({ data });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      ) {
        throw error;
      }

      // Which unique index fired decides what this was.
      const replay = await this.prisma.setLog.findFirst({
        where: { clientId: dto.clientId, session: { userId } },
      });

      if (replay) {
        row = replay;
        kind = 'duplicate';
      } else {
        row = await this.prisma.setLog.update({
          where: {
            sessionId_exerciseId_setNumber: {
              sessionId: session.id,
              exerciseId: dto.exerciseId,
              setNumber: dto.setNumber,
            },
          },
          data,
        });
        kind = 'updated';
      }
    }

    if (kind !== 'duplicate' && dto.discomfort === 'SHARP_PAIN' && !session.discomfortFlag) {
      await this.prisma.workoutSession.update({
        where: { id: session.id },
        data: { discomfortFlag: true },
      });
      session.discomfortFlag = true;

      await this.audit(userId, 'workout_session:discomfort', session.id, {
        exerciseId: dto.exerciseId,
        setNumber: dto.setNumber,
      });
    }

    return { kind, set: toSetLogDto(row) };
  }

  private async programExerciseIds(programId: string): Promise<Set<string>> {
    const rows = await this.prisma.workoutTemplateExercise.findMany({
      where: { template: { programId } },
      select: { exerciseId: true },
      distinct: ['exerciseId'],
    });

    return new Set(rows.map((row) => row.exerciseId));
  }

  /**
   * What the attached commitment becomes.
   *
   * ABANDONED WITH NOTHING LOGGED LEAVES IT ALONE, deliberately: the user opened
   * the app, changed their mind, and still has the whole of Today's vocabulary
   * available — skip with a reason, reschedule, or come back later. Marking it
   * partial would be the product deciding they failed at something they never
   * started.
   */
  private async settleCommitment(
    userId: string,
    session: SessionRow,
    dto: FinishSessionDto,
    facts: {
      exercisesCompleted: number;
      exercisesPlanned: number;
      setCount: number;
      minutes: number;
    },
  ): Promise<string | null> {
    if (!session.commitmentId) return null;

    const fullyDone =
      dto.status === 'COMPLETED' &&
      session.variant === 'FULL' &&
      facts.exercisesPlanned > 0 &&
      facts.exercisesCompleted === facts.exercisesPlanned;

    if (fullyDone) {
      await this.actions.complete(userId, session.commitmentId, {
        minutesSpent: facts.minutes,
        notes: dto.notes ?? null,
      });
      return 'COMPLETED';
    }

    if (dto.status === 'COMPLETED' || facts.setCount > 0) {
      await this.actions.partial(userId, session.commitmentId, {
        minutesSpent: facts.minutes,
        notes: dto.notes ?? null,
      });
      return 'PARTIALLY_COMPLETED';
    }

    return null;
  }

  /** The runner view for one session, with history and the session counter. */
  private async view(session: SessionRow): Promise<WorkoutSessionViewDto> {
    const program = session.template.program;
    const structure = weeklyStructureSchema.safeParse(program.weeklyStructure);

    const siblings = await this.prisma.workoutTemplate.findMany({
      where: {
        program: { id: program.id },
        OR: [
          { id: session.template.fallbackOfTemplateId ?? session.templateId },
          { fallbackOfTemplateId: session.template.fallbackOfTemplateId ?? session.templateId },
        ],
      },
      select: { variant: true },
    });

    const sessionIndex = await this.prisma.workoutSession.count({
      where: {
        userId: session.userId,
        template: { programId: program.id },
        status: { not: 'ABANDONED' },
        startedAt: { lte: session.startedAt },
      },
    });

    const recent = await this.recentSessionsFor(
      session.userId,
      session.id,
      session.template.exercises.map((row) => row.exerciseId),
    );

    const history = new Map(
      [...recent].flatMap(([exerciseId, sessions]) =>
        sessions.length > 0
          ? [[exerciseId, { sessionDate: sessions[0].startedAt, sets: sessions[0].sets }] as const]
          : [],
      ),
    );

    const progression = new Map(
      session.template.exercises.map((row) => [
        row.exerciseId,
        suggestProgression(
          (recent.get(row.exerciseId) ?? []).map((entry) => ({
            sessionId: entry.sessionId,
            date: entry.startedAt.toISOString(),
            sets: entry.sets.map((log) => ({
              weightKg: log.weightKg === null ? null : Number(log.weightKg),
              reps: log.reps,
              rpe: log.rpe,
              discomfort: log.discomfort as 'NONE' | 'MILD' | 'SHARP_PAIN',
            })),
          })),
          {
            sets: row.sets,
            repMin: row.repMin,
            repMax: row.repMax,
            equipment: row.exercise.equipment,
          },
        ) as unknown,
      ]),
    );

    return buildSessionView({
      session,
      program: {
        id: program.id,
        name: program.name,
        durationWeeks: program.durationWeeks,
        trainingDays: structure.success ? structure.data.length : 0,
      },
      template: {
        id: session.template.id,
        name: session.template.name,
        variant: session.template.variant,
        targetMinutes: session.template.targetMinutes,
      },
      availableVariants: [...new Set(siblings.map((row) => row.variant))].sort(),
      exercises: session.template.exercises as unknown as TemplateExerciseRow[],
      logs: session.setLogs,
      history,
      progression,
      sessionIndex,
    });
  }

  /**
   * The last two COMPLETED sessions per movement, newest first.
   *
   * COMPLETED only, and ANY template. A user's bench press history is their
   * bench press history — scoping it to one workout would reset it every time
   * the program changed, which is precisely when the number matters most. And
   * two rather than one because double progression (E09-04) needs a trend: one
   * good day is a good day.
   *
   * One query for every movement on the screen. Per-exercise queries would be
   * an N+1 on the request that renders while somebody is standing at a rack.
   */
  private async recentSessionsFor(
    userId: string,
    excludeSessionId: string,
    exerciseIds: string[],
  ): Promise<Map<string, Array<{ sessionId: string; startedAt: Date; sets: SetLogRow[] }>>> {
    const recent = new Map<
      string,
      Array<{ sessionId: string; startedAt: Date; sets: SetLogRow[] }>
    >();

    if (exerciseIds.length === 0) return recent;

    const rows = await this.prisma.setLog.findMany({
      where: {
        exerciseId: { in: exerciseIds },
        sessionId: { not: excludeSessionId },
        session: { userId, status: 'COMPLETED' },
      },
      include: { session: { select: { id: true, startedAt: true } } },
      orderBy: [{ session: { startedAt: 'desc' } }, { setNumber: 'asc' }],
    });

    for (const row of rows) {
      const sessions = recent.get(row.exerciseId) ?? [];
      const current = sessions[sessions.length - 1];

      if (current?.sessionId === row.session.id) {
        current.sets.push(row);
        continue;
      }

      // Rows arrive newest session first, so a new session id starts the next
      // entry — and anything past the second is history we do not read.
      if (sessions.length >= HISTORY_SESSIONS) continue;

      sessions.push({ sessionId: row.session.id, startedAt: row.session.startedAt, sets: [row] });
      recent.set(row.exerciseId, sessions);
    }

    return recent;
  }

  private async audit(
    userId: string,
    action: string,
    targetId: string,
    meta: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        actorUserId: userId,
        action,
        targetType: 'workout_session',
        targetId,
        meta: meta as Prisma.InputJsonValue,
      },
    });
  }
}
