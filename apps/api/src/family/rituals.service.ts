import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma, type Ritual } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { findOwnedOrThrow } from '../path/owned-resource';
import { CommitmentsService } from '../commitments/commitments.service';
import { RoutinesService } from '../path/routines/routines.service';
import { toCommitmentCard } from '../commitments/commitment-card.mapper';
import type { CommitmentCard } from '../commitments/commitment-card.schema';
import { localDayBounds, safeTimeZone } from '../today/local-date';
import { BEHAVIOUR_LINT_CODE, BEHAVIOUR_LINT_MESSAGE } from './behaviour-lint';
import { BehaviourLintService } from './behaviour-lint.service';
import { RITUAL_ORDER, toRitualDto } from './family.mapper';
import type { RitualResponse } from './family.schema';
import { MATERIALIZE_HORIZON_DAYS, RitualMaterializerService } from './ritual-materializer.service';
import { addDays, localDateOf } from './recurrence';
import { CreateRitualDto, RitualQueryDto, UpdateRitualDto } from './dto/ritual.dto';
import type { CreateRoutineDto } from '../path/routines/dto/create-routine.dto';
import type { UpdateRoutineDto } from '../path/routines/dto/update-routine.dto';

/**
 * The fields whose change invalidates every future occurrence.
 *
 * `purpose` and `familyMemberId` are NOT here on purpose: they are context on
 * the ritual, not part of what the user agreed to do at a particular time, and
 * cancelling tonight's dinner because somebody fixed a typo in "Be present at
 * the table" would be absurd.
 */
const MATERIAL_FIELDS = [
  'title',
  'recurrence',
  'idealMinutes',
  'minimumMinutes',
  'fallbackBehavior',
] as const;

/** The statuses a future occurrence may still be withdrawn from. */
const CANCELLABLE = ['PLANNED', 'READY'] as const;

export interface RitualWithUpcoming extends RitualResponse {
  upcoming: CommitmentCard[];
}

@Injectable()
export class RitualsService {
  private readonly logger = new Logger(RitualsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lint: BehaviourLintService,
    private readonly materializer: RitualMaterializerService,
    private readonly commitments: CommitmentsService,
    private readonly routines: RoutinesService,
  ) {}

  async list(userId: string, query: RitualQueryDto): Promise<RitualResponse[]> {
    const where: Prisma.RitualWhereInput = { userId };
    if (query.active !== undefined) where.active = query.active;

    const rows = await this.prisma.ritual.findMany({ where, orderBy: RITUAL_ORDER });

    return rows.map(toRitualDto);
  }

  async get(userId: string, id: string, now: Date = new Date()): Promise<RitualWithUpcoming> {
    const ritual = await this.findOwned(userId, id);
    const zone = await this.timezoneOf(userId);

    const todayLocal = localDateOf(now, zone);
    const horizon = localDayBounds(addDays(todayLocal, MATERIALIZE_HORIZON_DAYS), zone).end;

    const upcoming = await this.prisma.commitment.findMany({
      where: { userId, ritualId: ritual.id, scheduledStart: { gte: now, lte: horizon } },
      orderBy: { scheduledStart: 'asc' },
    });

    return {
      ...toRitualDto(ritual),
      upcoming: upcoming.map((row) => toCommitmentCard(row, now)),
    };
  }

  async create(userId: string, dto: CreateRitualDto, now: Date = new Date()): Promise<RitualResponse> {
    // THE LINT RUNS BEFORE ANY WRITE. A refused title must leave nothing
    // behind — not a ritual, not a routine, not an audit row saying one was
    // attempted.
    this.assertBehaviour(dto.title);

    await this.assertMemberOwned(userId, dto.familyMemberId);
    const routineId = await this.linkRoutine(userId, dto);

    const ritual = await this.prisma.ritual.create({
      data: {
        userId,
        title: dto.title,
        purpose: dto.purpose ?? null,
        familyMemberId: dto.familyMemberId ?? null,
        recurrence: dto.recurrence as unknown as Prisma.InputJsonValue,
        idealMinutes: dto.idealMinutes,
        minimumMinutes: dto.minimumMinutes,
        fallbackBehavior: dto.fallbackBehavior ?? null,
        routineId,
      },
    });

    await this.audit(userId, 'ritual:create', ritual.id, {
      recurrence: dto.recurrence as unknown as Prisma.InputJsonValue,
      idealMinutes: ritual.idealMinutes,
      minimumMinutes: ritual.minimumMinutes,
      hasMember: ritual.familyMemberId !== null,
      routineId,
    });

    // AFTER the insert commits and outside any transaction: the unique index is
    // the idempotency guarantee, so there is nothing for a transaction to add.
    await this.materializer.materialize(userId, ritual, now);

    return toRitualDto(await this.findOwned(userId, ritual.id));
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateRitualDto,
    now: Date = new Date(),
  ): Promise<RitualResponse> {
    const existing = await this.findOwned(userId, id);

    if (dto.title !== undefined) this.assertBehaviour(dto.title);
    if (dto.familyMemberId !== undefined) {
      await this.assertMemberOwned(userId, dto.familyMemberId);
    }

    const merged = {
      idealMinutes: dto.idealMinutes ?? existing.idealMinutes,
      minimumMinutes: dto.minimumMinutes ?? existing.minimumMinutes,
    };

    // Re-checked against the MERGED ritual, so a patch that raises only the
    // minimum above the stored ideal is still rejected.
    if (merged.minimumMinutes > merged.idealMinutes) {
      throw new BadRequestException({
        message: 'The minimum version cannot be longer than the ideal one',
        details: { reason: 'MINIMUM_EXCEEDS_IDEAL' },
      });
    }

    const data: Prisma.RitualUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.purpose !== undefined) data.purpose = dto.purpose ?? null;
    if (dto.familyMemberId !== undefined) {
      data.familyMember = dto.familyMemberId
        ? { connect: { id: dto.familyMemberId } }
        : { disconnect: true };
    }
    if (dto.recurrence !== undefined) {
      data.recurrence = dto.recurrence as unknown as Prisma.InputJsonValue;
    }
    if (dto.idealMinutes !== undefined) data.idealMinutes = dto.idealMinutes;
    if (dto.minimumMinutes !== undefined) data.minimumMinutes = dto.minimumMinutes;
    if (dto.fallbackBehavior !== undefined) data.fallbackBehavior = dto.fallbackBehavior ?? null;
    if (dto.active !== undefined) data.active = dto.active;

    const changed = this.changedFields(existing, dto);
    const paused = dto.active === false && existing.active;
    const resumed = dto.active === true && !existing.active;
    const rebuild = changed.length > 0 || paused || resumed;

    if (rebuild) {
      // Reset the horizon so the re-materialization starts from now rather than
      // from the end of a window whose contents were just withdrawn.
      data.lastMaterializedThrough = null;
    }

    let ritual = await this.prisma.ritual.update({ where: { id: existing.id }, data });

    const cancelled = rebuild ? await this.cancelFuture(userId, ritual.id, now) : 0;

    let created = 0;
    if (rebuild && ritual.active) {
      created = (await this.materializer.materialize(userId, ritual, now)).created;
      ritual = await this.findOwned(userId, ritual.id);
    }

    await this.syncRoutine(userId, ritual);

    await this.audit(userId, 'ritual:update', ritual.id, {
      changed: dto.active !== undefined ? [...changed, 'active'] : changed,
      cancelled,
      created,
    });

    return toRitualDto(ritual);
  }

  async remove(userId: string, id: string, now: Date = new Date()): Promise<void> {
    const existing = await this.findOwned(userId, id);

    const cancelled = await this.cancelFuture(userId, existing.id, now);

    // The linked routine stays: the Path is a record of what the user planned,
    // and deleting the ritual is a decision about the future, not the past.
    // `SetNull` on `commitments.ritual_id` keeps the history too.
    await this.prisma.ritual.delete({ where: { id: existing.id } });

    await this.audit(userId, 'ritual:delete', existing.id, { cancelled });
  }

  /** The on-demand materializer behind `POST /family/rituals/:id/materialize`. */
  async materialize(userId: string, id: string, now: Date = new Date()) {
    const ritual = await this.findOwned(userId, id);

    return this.materializer.materialize(userId, ritual, now);
  }

  // ---------------------------------------------------------------------------

  private assertBehaviour(title: string): void {
    const verdict = this.lint.check(title);

    if (!verdict.ok) {
      throw new BadRequestException({
        message: BEHAVIOUR_LINT_MESSAGE,
        details: { reason: BEHAVIOUR_LINT_CODE, match: verdict.match, rule: verdict.rule },
      });
    }
  }

  /**
   * Withdraw the future occurrences THROUGH THE MATRIX, never with a raw
   * `updateMany`.
   *
   * The status filter comes first so the matrix is never asked for a move it
   * would refuse: a `RESCHEDULED`, `STARTED` or terminal row is one the user
   * has touched, and editing the rule must not rewrite what they did. A 409
   * from here would therefore be a programming error, which is why it is logged
   * rather than swallowed.
   */
  private async cancelFuture(userId: string, ritualId: string, now: Date): Promise<number> {
    const rows = await this.prisma.commitment.findMany({
      where: {
        userId,
        ritualId,
        scheduledStart: { gt: now },
        status: { in: [...CANCELLABLE] },
      },
      select: { id: true },
    });

    let cancelled = 0;

    for (const row of rows) {
      try {
        await this.commitments.transition(userId, row.id, { to: 'CANCELLED' });
        cancelled += 1;
      } catch (error) {
        this.logger.warn(
          `ritual.cancelFuture refused commitment=${row.id}: ${(error as Error).message}`,
        );
      }
    }

    return cancelled;
  }

  private changedFields(existing: Ritual, dto: UpdateRitualDto): string[] {
    return MATERIAL_FIELDS.filter((field) => {
      const next = (dto as Record<string, unknown>)[field];
      if (next === undefined) return false;

      if (field === 'recurrence') {
        return JSON.stringify(next) !== JSON.stringify(existing.recurrence);
      }

      return next !== (existing as unknown as Record<string, unknown>)[field];
    });
  }

  /**
   * Create the routine that shows this ritual on the Path, when the user linked
   * it to an outcome.
   *
   * The routine's `frequency` is the E02 enum, not a summary string: `DAILY`
   * when every day matches, `CUSTOM` with `daysOfWeek` otherwise. The summary
   * belongs on the ritual card, which has the recurrence itself to render.
   */
  private async linkRoutine(userId: string, dto: CreateRitualDto): Promise<string | null> {
    if (!dto.outcomeId) return null;

    const planVersionId = await this.activePlanVersionOf(userId, dto.outcomeId);

    const routine = await this.routines.create(userId, {
      planVersionId,
      title: dto.title,
      domain: 'FAMILY',
      triggerType: 'TIME',
      triggerValue: dto.recurrence.time,
      frequency: dto.recurrence.weekdays.length === 7 ? 'DAILY' : 'CUSTOM',
      daysOfWeek: [...dto.recurrence.weekdays].sort((a, b) => a - b),
      preferredTime: dto.recurrence.time,
      estimatedDurationMin: dto.idealMinutes,
      minimumDurationMin: dto.minimumMinutes,
      fallbackBehavior: dto.fallbackBehavior ?? null,
      sortOrder: 0,
      // `CreateRoutineDto` is a Zod DTO whose class type is the PARSED shape;
      // this object is already that shape, so the assertion narrows rather
      // than widens. Passing the service the parsed object is the point — the
      // ritual's fields are validated by `createRitualSchema` before they get
      // here, and re-parsing them would be a second, divergent contract.
    } as CreateRoutineDto);

    return routine.id;
  }

  /** Keep a linked routine's title, minutes and active flag in step. */
  private async syncRoutine(userId: string, ritual: Ritual): Promise<void> {
    if (!ritual.routineId) return;

    try {
      await this.routines.update(userId, ritual.routineId, {
        title: ritual.title,
        estimatedDurationMin: ritual.idealMinutes,
        minimumDurationMin: ritual.minimumMinutes,
        fallbackBehavior: ritual.fallbackBehavior,
        active: ritual.active,
      } as UpdateRoutineDto);
    } catch (error) {
      // A superseded plan version refuses edits (E02-03), and that is fine: the
      // routine is a VIEW of the ritual on the Path, and a read-only version is
      // a record of what the plan used to say. The ritual is still the truth.
      this.logger.warn(
        `ritual.syncRoutine skipped routine=${ritual.routineId}: ${(error as Error).message}`,
      );
    }
  }

  private async activePlanVersionOf(userId: string, outcomeId: string): Promise<string> {
    const outcome = await findOwnedOrThrow(
      () =>
        this.prisma.outcome.findFirst({
          where: { id: outcomeId, userId },
          select: { id: true, plan: { select: { versions: { where: { status: 'ACTIVE' } } } } },
        }),
      'Outcome',
    );

    const version = outcome.plan?.versions[0];

    if (!version) {
      throw new ConflictException({
        message: 'That outcome has no active plan version to hold a routine',
        details: { reason: 'OUTCOME_HAS_NO_ACTIVE_PLAN' },
      });
    }

    return version.id;
  }

  private async assertMemberOwned(userId: string, memberId: string | null | undefined) {
    if (!memberId) return;

    await findOwnedOrThrow(
      () => this.prisma.familyMember.findFirst({ where: { id: memberId, userId } }),
      'Family member',
    );
  }

  private async findOwned(userId: string, id: string): Promise<Ritual> {
    return findOwnedOrThrow(
      () => this.prisma.ritual.findFirst({ where: { id, userId } }),
      'Ritual',
    );
  }

  private async timezoneOf(userId: string): Promise<string> {
    const profile = await this.prisma.userProfile.findUnique({
      where: { userId },
      select: { timezone: true },
    });

    return safeTimeZone(profile?.timezone);
  }

  private async audit(
    userId: string,
    action: string,
    targetId: string,
    meta: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.prisma.auditEvent.create({
      data: { actorUserId: userId, action, targetType: 'ritual', targetId, meta },
    });
  }
}
