import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type WeeklyPlan } from '@prisma/client';
import { trace } from '@opentelemetry/api';

import { CommitmentsService } from '../commitments/commitments.service';
import { PrismaService } from '../prisma/prisma.service';
import { findOwnedOrThrow } from '../path/owned-resource';
import { DomainModesService } from '../path/domain-modes/domain-modes.service';
import type { DomainValue } from '../path/domain.schema';
import { safeTimeZone } from '../today/local-date';
import { UserProfileService } from '../user-profile/user-profile.service';
import { checkLoad } from './load-check';
import { materializeWeek, type RoutineForWeek } from './materialize-week';
import { addDays, isMonday, localTimeToInstant, weekStartFor } from './week-bounds';
import { WeeklyReviewService } from './weekly-review.service';
import {
  weeklyDomainModesSchema,
  weeklyPlanConstraintsSchema,
  type ExtraCommitment,
  type LoadWarning,
  type ProposedCommitment,
  type WeeklyDomain,
  type WeeklyDomainModes,
  type WeeklyPlanConstraints,
  type WeeklyPlanProposal,
} from './weekly.schema';
import type {
  ApproveWeeklyPlanResultDto,
  UpdateWeeklyPlanDto,
  WeeklyPlanDetailDto,
  WeeklyPlanSummaryDto,
} from './dto/weekly-plan.dtos';

// =============================================================================
// Next week, seven steps at a time (issue #80, epic E10)
// =============================================================================
//
// PRD §50's flow: review last week → fixed constraints → one primary focus →
// domain modes → propose commitments → check the load → approve. The draft row
// is what makes it a flow rather than a form: each step is a PATCH, so closing
// the tab on step three loses nothing.
//
// NO MODEL IS CALLED ANYWHERE IN THIS SERVICE, and `AiGatewayService` is
// deliberately not a constructor argument. Materialisation is arithmetic over
// the user's own routines; asking a model to produce next week's dates would
// make a deterministic thing occasionally wrong and never reproducible.
//
// APPROVE IS THE ONLY WRITE THAT LEAVES THIS EPIC'S TABLES. It creates
// commitments through `CommitmentsService.create` (so every ownership check,
// the family behaviour lint and the `commitment:create` audit row apply), sets
// domain modes through `DomainModesService.set` (so `domain_mode:set` is
// written with its reason), and closes the previous week's review — all in one
// transaction, because a half-approved week is worse than an unapproved one.
// =============================================================================

const tracer = trace.getTracer('evolvepath-api');

const DOMAINS: WeeklyDomain[] = ['WORK', 'FAMILY', 'HEALTH'];

@Injectable()
export class WeeklyPlanService {
  private readonly logger = new Logger(WeeklyPlanService.name);
  private readonly loadSoftCap: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly commitments: CommitmentsService,
    private readonly domainModes: DomainModesService,
    private readonly reviews: WeeklyReviewService,
    private readonly profiles: UserProfileService,
    config: ConfigService,
  ) {
    this.loadSoftCap = config.get<number>('weekly.loadSoftCap') ?? 8;
  }

  // ---------------------------------------------------------------------------
  // The draft
  // ---------------------------------------------------------------------------

  /**
   * Idempotent. A second call returns the existing DRAFT rather than a second
   * one — the wizard calls this on mount, and a refresh must not fork the week.
   */
  async create(
    userId: string,
    dto: { weekStart?: string },
  ): Promise<{ plan: WeeklyPlanDetailDto; created: boolean }> {
    const timeZone = await this.timeZoneFor(userId);
    const thisMonday = weekStartFor(new Date(), timeZone);
    const weekStart = dto.weekStart ?? addDays(thisMonday, 7);

    if (!isMonday(weekStart)) {
      throw new BadRequestException({
        code: 'INVALID_WEEK_START',
        message: 'weekStart must be a Monday in YYYY-MM-DD form.',
      });
    }

    // Planning a week that has already started is legitimate; planning one that
    // has already ended is not — the commitments would be created in the past.
    if (weekStart < thisMonday) {
      throw new BadRequestException({
        code: 'INVALID_WEEK_START',
        message: 'weekStart must be this week or later.',
      });
    }

    const existing = await this.prisma.weeklyPlan.findUnique({
      where: { userId_weekStart: { userId, weekStart } },
    });

    if (existing?.status === 'APPROVED') {
      throw new ConflictException({
        code: 'WEEKLY_PLAN_APPROVED',
        message: 'This week has already been approved.',
      });
    }

    if (existing) return { plan: await this.detail(userId, existing), created: false };

    const review = await this.prisma.weeklyReview.findFirst({
      where: {
        userId,
        weekStart: addDays(weekStart, -7),
        status: { in: ['READY', 'APPROVED'] },
      },
      select: { id: true },
    });

    const current = await this.domainModes.list(userId);
    const domainModes = Object.fromEntries(
      current.map((row) => [row.domain, row.mode]),
    ) as WeeklyDomainModes;

    const row = await this.prisma.weeklyPlan.create({
      data: {
        userId,
        weekStart,
        reviewId: review?.id ?? null,
        // The postures the user is in TODAY, so step 4 opens on the truth and a
        // user who changes nothing keeps what they had.
        domainModes: domainModes as Prisma.InputJsonValue,
        constraints: weeklyPlanConstraintsSchema.parse({}) as Prisma.InputJsonValue,
      },
    });

    await this.audit(userId, 'weekly_plan:create', row.id, {
      weekStart,
      reviewId: review?.id ?? null,
    });

    return { plan: await this.detail(userId, row), created: true };
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateWeeklyPlanDto,
  ): Promise<WeeklyPlanDetailDto> {
    const row = await this.findEditable(userId, id);

    const data: Prisma.WeeklyPlanUpdateInput = {};
    const fields: string[] = [];

    if (dto.constraints !== undefined) {
      // Replaced whole, not merged: removing a travel day has to be expressible,
      // and a merge patch cannot delete an array element.
      data.constraints = weeklyPlanConstraintsSchema.parse(
        dto.constraints,
      ) as Prisma.InputJsonValue;
      fields.push('constraints');
    }

    if (dto.primaryFocus !== undefined) {
      data.primaryFocus = dto.primaryFocus;
      fields.push('primaryFocus');
    }

    if (dto.domainModes !== undefined) {
      // Merged, because naming FAMILY means "leave the other two alone" rather
      // than asserting GROW for domains the user never looked at.
      data.domainModes = {
        ...this.readDomainModes(row),
        ...weeklyDomainModesSchema.parse(dto.domainModes),
      } as Prisma.InputJsonValue;
      fields.push('domainModes');
    }

    if (fields.length === 0) return this.detail(userId, row);

    // Any of these changes what the week would look like, so the previous
    // proposal is now a description of a week nobody asked for.
    data.proposal = Prisma.DbNull;

    const updated = await this.prisma.weeklyPlan.update({ where: { id }, data });

    await this.audit(userId, 'weekly_plan:update', id, { weekStart: row.weekStart, fields });

    return this.detail(userId, updated);
  }

  // ---------------------------------------------------------------------------
  // Proposing the week
  // ---------------------------------------------------------------------------

  async propose(
    userId: string,
    id: string,
    dto: { extras?: ExtraCommitment[] },
  ): Promise<WeeklyPlanDetailDto> {
    const row = await this.findEditable(userId, id);
    const timeZone = await this.timeZoneFor(userId);
    const extras = dto.extras ?? [];

    const items = materializeWeek({
      weekStart: row.weekStart,
      routines: await this.activeRoutines(userId),
      domainModes: this.readDomainModes(row),
      constraints: this.readConstraints(row),
      extras,
      existing: await this.existingOccurrences(userId, row.weekStart, timeZone),
    });

    const profile = await this.profiles.find(userId);
    const { summary, warnings } = checkLoad(items, {
      softCap: this.loadSoftCap,
      weekdayMinutes: profile?.weekdayMinutes ?? null,
    });

    const proposal: WeeklyPlanProposal = {
      items,
      extras,
      summary,
      warnings,
      proposedAt: new Date().toISOString(),
    };

    const updated = await this.prisma.weeklyPlan.update({
      where: { id },
      data: { proposal: proposal as unknown as Prisma.InputJsonValue },
    });

    await this.audit(userId, 'weekly_plan:propose', id, {
      weekStart: row.weekStart,
      items: items.length,
      included: items.filter((item) => item.include).length,
      recurringCount: summary.recurringCount,
      estimatedMinutes: summary.estimatedMinutes,
      warnings: warnings.map((warning) => warning.code),
    });

    return this.detail(userId, updated);
  }

  // ---------------------------------------------------------------------------
  // Approve
  // ---------------------------------------------------------------------------

  async approve(
    userId: string,
    id: string,
    dto: { acknowledgeWarnings?: boolean },
  ): Promise<ApproveWeeklyPlanResultDto> {
    return tracer.startActiveSpan('weekly.plan.approve', async (span) => {
      try {
        return await this.runApprove(userId, id, dto);
      } finally {
        span.end();
      }
    });
  }

  private async runApprove(
    userId: string,
    id: string,
    { acknowledgeWarnings = false }: { acknowledgeWarnings?: boolean },
  ): Promise<ApproveWeeklyPlanResultDto> {
    const row = await this.findEditable(userId, id);
    const proposal = this.readProposal(row);

    if (!proposal) {
      throw new ConflictException({
        code: 'WEEKLY_PLAN_NOT_PROPOSED',
        message: 'Propose the week before approving it.',
      });
    }

    if (proposal.warnings.length > 0 && !acknowledgeWarnings) {
      // 422 rather than 409: the request is well-formed and the state is legal.
      // What is missing is that the user has read the warning — which is all
      // acknowledgement means. The software has not agreed with them.
      throw new UnprocessableEntityException({
        code: 'LOAD_WARNINGS_UNACKNOWLEDGED',
        message: 'Acknowledge the load warnings before approving this week.',
        details: { warnings: proposal.warnings },
      });
    }

    const timeZone = await this.timeZoneFor(userId);
    const included = proposal.items.filter((item) => item.include);
    const domainModes = this.readDomainModes(row);

    const outcome = await this.prisma.$transaction(async (tx) => {
      // Re-read inside the transaction: an approve retried after a partial
      // failure, or a Today screen that quick-added the same slot, must not
      // produce a duplicate.
      const alreadyThere = new Set(
        (await this.existingOccurrences(userId, row.weekStart, timeZone, tx)).map(
          (occurrence) => `${occurrence.routineId}:${occurrence.date}`,
        ),
      );

      const createdCommitmentIds: string[] = [];
      let skippedExisting = 0;

      for (const item of included) {
        if (item.routineId && alreadyThere.has(`${item.routineId}:${item.date}`)) {
          skippedExisting += 1;
          continue;
        }

        const created = await this.commitments.create(
          userId,
          this.toCommitmentDto(item, timeZone),
          tx,
        );
        createdCommitmentIds.push(created.id);
      }

      const domainModeChanges: string[] = [];
      const currentModes = await tx.domainMode.findMany({ where: { userId } });
      const byDomain = new Map(currentModes.map((mode) => [mode.domain, mode.mode]));

      for (const domain of DOMAINS) {
        const wanted = domainModes[domain];
        // A missing row means GROW (E02-02 synthesises it), so "no row and
        // GROW" is not a change and must not write an audit row.
        if (!wanted || (byDomain.get(domain) ?? 'GROW') === wanted) continue;

        await this.domainModes.set(
          userId,
          domain as DomainValue,
          { mode: wanted, reason: `Weekly plan ${row.weekStart}` },
          tx,
        );
        domainModeChanges.push(domain);
      }

      // The week this plan was planned FROM. A no-op when there is no review —
      // approving next week must not require that last week was reviewed.
      await this.reviews.markApproved(userId, addDays(row.weekStart, -7), tx);

      const plan = await tx.weeklyPlan.update({
        where: { id },
        data: { status: 'APPROVED', approvedAt: new Date() },
      });

      return { plan, createdCommitmentIds, skippedExisting, domainModeChanges };
    });

    await this.audit(userId, 'weekly_plan:approve', id, {
      weekStart: row.weekStart,
      created: outcome.createdCommitmentIds.length,
      skippedExisting: outcome.skippedExisting,
      domainModeChanges: outcome.domainModeChanges,
      warnings: proposal.warnings.map((warning) => warning.code),
      acknowledged: acknowledgeWarnings,
      primaryFocusSet: row.primaryFocus !== null,
    });

    this.logger.log(
      `Weekly plan approve user=${userId} week=${row.weekStart} ` +
        `created=${outcome.createdCommitmentIds.length} skipped=${outcome.skippedExisting} ` +
        `warnings=${proposal.warnings.map((w) => w.code).join(',') || 'none'}`,
    );

    return {
      plan: await this.detail(userId, outcome.plan),
      createdCommitmentIds: outcome.createdCommitmentIds,
      skippedExisting: outcome.skippedExisting,
      warnings: proposal.warnings,
    };
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async list(
    userId: string,
    query: { weekStart?: string },
  ): Promise<WeeklyPlanSummaryDto[]> {
    const rows = await this.prisma.weeklyPlan.findMany({
      where: { userId, ...(query.weekStart ? { weekStart: query.weekStart } : {}) },
      orderBy: { weekStart: 'desc' },
      take: 12,
    });

    return rows.map((row) => this.summaryOf(row));
  }

  async get(userId: string, id: string): Promise<WeeklyPlanDetailDto> {
    return this.detail(userId, await this.findOwned(userId, id));
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * Every routine that a live plan currently prescribes.
   *
   * ACTIVE version and ACTIVE outcome, both: a routine on a superseded version
   * is work the user already decided to stop, and one under a paused outcome is
   * work they decided to postpone. Materialising either would put next week's
   * Today screen at odds with their own Path screen.
   */
  private async activeRoutines(userId: string): Promise<RoutineForWeek[]> {
    const rows = await this.prisma.routine.findMany({
      where: {
        userId,
        active: true,
        planVersion: { status: 'ACTIVE', plan: { outcome: { state: 'ACTIVE' } } },
      },
      select: {
        id: true,
        title: true,
        domain: true,
        frequency: true,
        daysOfWeek: true,
        preferredTime: true,
        estimatedDurationMin: true,
        minimumDurationMin: true,
        fallbackBehavior: true,
        planVersionId: true,
        planVersion: { select: { plan: { select: { outcomeId: true } } } },
      },
      orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
    });

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      domain: row.domain,
      frequency: row.frequency,
      daysOfWeek: row.daysOfWeek,
      preferredTime: row.preferredTime,
      estimatedDurationMin: row.estimatedDurationMin,
      minimumDurationMin: row.minimumDurationMin,
      fallbackBehavior: row.fallbackBehavior,
      planVersionId: row.planVersionId,
      outcomeId: row.planVersion.plan.outcomeId,
    }));
  }

  /** The routine occurrences already on the calendar for this week. */
  private async existingOccurrences(
    userId: string,
    weekStart: string,
    timeZone: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Array<{ routineId: string | null; date: string }>> {
    const db = tx ?? this.prisma;
    const start = localTimeToInstant(weekStart, '00:00', timeZone);
    const end = localTimeToInstant(addDays(weekStart, 7), '00:00', timeZone);

    const rows = await db.commitment.findMany({
      where: {
        userId,
        routineId: { not: null },
        scheduledStart: { gte: start, lt: end },
        // A cancelled occurrence is a slot the user emptied on purpose;
        // treating it as "already there" would make it unrecoverable.
        status: { notIn: ['CANCELLED'] },
      },
      select: { routineId: true, scheduledStart: true },
    });

    return rows.map((row) => ({
      routineId: row.routineId,
      date: new Intl.DateTimeFormat('en-CA', {
        timeZone: safeTimeZone(timeZone),
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(row.scheduledStart),
    }));
  }

  private toCommitmentDto(item: ProposedCommitment, timeZone: string) {
    const start = localTimeToInstant(item.date, item.startTime, timeZone);
    const end = new Date(start.getTime() + item.estimatedMinutes * 60_000);

    return {
      domain: item.domain,
      title: item.title,
      outcomeId: item.outcomeId ?? undefined,
      planVersionId: item.planVersionId ?? undefined,
      routineId: item.routineId ?? undefined,
      scheduledStart: start.toISOString(),
      scheduledEnd: end.toISOString(),
      importance: 3,
      fullVersion: item.fullVersion,
      shortVersion: item.shortVersion,
      minimumVersion: item.minimumVersion,
      fullMinutes: item.estimatedMinutes,
      shortMinutes: null,
      minimumMinutes: item.minimumMinutes,
      // TRUE ONLY BECAUSE THE USER PRESSED APPROVE. Nothing else in this epic
      // sets it, and a materialiser that set it on its own would be the product
      // asserting the user agreed to a week it wrote for them.
      userConfirmed: true,
    } as Parameters<CommitmentsService['create']>[1];
  }

  private async detail(
    userId: string,
    row: WeeklyPlan,
  ): Promise<WeeklyPlanDetailDto> {
    const review = row.reviewId
      ? await this.prisma.weeklyReview
          .findFirst({ where: { id: row.reviewId, userId } })
          .then((found) =>
            found
              ? { id: found.id, weekStart: found.weekStart, status: found.status }
              : null,
          )
      : null;

    return {
      ...this.summaryOf(row),
      constraints: this.readConstraints(row),
      domainModes: this.readDomainModes(row),
      proposal: this.readProposal(row),
      review,
    };
  }

  private summaryOf(row: WeeklyPlan): WeeklyPlanSummaryDto {
    return {
      id: row.id,
      weekStart: row.weekStart,
      status: row.status,
      primaryFocus: row.primaryFocus,
      reviewId: row.reviewId,
      approvedAt: row.approvedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private readConstraints(row: WeeklyPlan): WeeklyPlanConstraints {
    const parsed = weeklyPlanConstraintsSchema.safeParse(row.constraints);

    // A stored value that no longer parses is a shape change, not user input.
    // Defaults keep the wizard usable while the row is repaired by a save.
    return parsed.success ? parsed.data : weeklyPlanConstraintsSchema.parse({});
  }

  private readDomainModes(row: WeeklyPlan): WeeklyDomainModes {
    const parsed = weeklyDomainModesSchema.safeParse(row.domainModes);

    return parsed.success ? parsed.data : {};
  }

  private readProposal(row: WeeklyPlan): WeeklyPlanProposal | null {
    return (row.proposal as unknown as WeeklyPlanProposal | null) ?? null;
  }

  private async findOwned(userId: string, id: string): Promise<WeeklyPlan> {
    return findOwnedOrThrow(
      () => this.prisma.weeklyPlan.findFirst({ where: { id, userId } }),
      'Weekly plan',
    );
  }

  private async findEditable(userId: string, id: string): Promise<WeeklyPlan> {
    const row = await this.findOwned(userId, id);

    if (row.status !== 'DRAFT') {
      throw new ConflictException({
        code: 'WEEKLY_PLAN_NOT_EDITABLE',
        message: `A ${row.status} weekly plan cannot be changed.`,
      });
    }

    return row;
  }

  private async timeZoneFor(userId: string): Promise<string> {
    const profile = await this.profiles.find(userId);

    return safeTimeZone(profile?.timezone);
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
        targetType: 'weekly_plan',
        targetId,
        meta: meta as Prisma.InputJsonValue,
      },
    });
  }
}

/** Re-exported for the controller's response typing. */
export type { LoadWarning };
