import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma, type PlanAuthor } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { findOwnedOrThrow } from '../owned-resource';
import { PlansService } from './plans.service';
import { CreatePlanVersionDto } from './dto/create-plan-version.dto';
import { UpdatePlanVersionDto } from './dto/update-plan-version.dto';
import { RejectPlanVersionDto } from './dto/reject-plan-version.dto';
import { PlanVersionSummaryDto } from './dto/plan-response.dto';
import { PlanVersionResponseDto } from './dto/plan-version-response.dto';
import { toPlanVersionDto, toPlanVersionSummary } from './plan-version.mapper';
import { ROUTINE_ORDER } from '../routines/routine.mapper';

const VERSION_INCLUDE = {
  routines: { orderBy: ROUTINE_ORDER },
} satisfies Prisma.PlanVersionInclude;

type VersionRow = Prisma.PlanVersionGetPayload<{ include: typeof VERSION_INCLUDE }>;

@Injectable()
export class PlanVersionsService {
  private readonly logger = new Logger(PlanVersionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlansService,
  ) {}

  async list(userId: string, planId: string): Promise<PlanVersionSummaryDto[]> {
    await this.plans.findOwned(userId, planId);

    const versions = await this.prisma.planVersion.findMany({
      where: { planId, userId },
      include: { _count: { select: { routines: true } } },
      // Newest first: the history reads downward from what is in force now.
      orderBy: { version: 'desc' },
    });

    return versions.map((version) => toPlanVersionSummary(version, version._count.routines));
  }

  async get(userId: string, planId: string, version: number): Promise<PlanVersionResponseDto> {
    return toPlanVersionDto(await this.findOwned(userId, planId, version));
  }

  /**
   * Creates the next version as a DRAFT.
   *
   * `author` exists so E06 can create AI-authored drafts through exactly this
   * code path — the same numbering, the same lineage, the same clone. No route
   * passes it: `createdBy` is never accepted from a request body, because a
   * client that can claim `AI` can launder a user edit as a coach suggestion.
   */
  async createDraft(
    userId: string,
    planId: string,
    dto: CreatePlanVersionDto,
    author: PlanAuthor = 'USER',
  ): Promise<PlanVersionResponseDto> {
    await this.plans.findOwned(userId, planId);

    const versions = await this.prisma.planVersion.findMany({
      where: { planId, userId },
      orderBy: { version: 'desc' },
    });

    // ONE DRAFT AT A TIME, and this is a SERVICE rule, not a database one.
    // Do not add a second partial unique index for it: a rejected draft and a
    // superseded version are both non-draft, so the constraint would have to be
    // `WHERE status = 'DRAFT'` — which would make E06's "propose an
    // alternative alongside mine" impossible to add without a migration. The
    // rule is a product decision about focus; the ACTIVE index is an integrity
    // invariant. They are not the same kind of thing.
    const existingDraft = versions.find((v) => v.status === 'DRAFT');
    if (existingDraft) {
      throw new ConflictException(
        `Plan already has a draft (v${existingDraft.version}); activate or reject it first`,
      );
    }

    const active = versions.find((v) => v.status === 'ACTIVE') ?? null;
    // Falls back to the newest version when nothing is active, so the lineage
    // is never broken by a plan whose only version was rejected.
    const previous = active ?? versions[0] ?? null;
    const nextNumber = (versions[0]?.version ?? 0) + 1;

    const copyFrom = dto.copyRoutinesFrom === 'active' ? previous : null;

    const created = await this.prisma.$transaction(async (tx) => {
      const version = await tx.planVersion.create({
        data: {
          userId,
          planId,
          version: nextNumber,
          status: 'DRAFT',
          rationale: dto.rationale,
          expectedWeeklyLoad: dto.expectedWeeklyLoad ?? previous?.expectedWeeklyLoad ?? null,
          fallbackStrategy: dto.fallbackStrategy ?? previous?.fallbackStrategy ?? null,
          createdBy: author,
          // A draft is not approved by existing; activating it is the approval.
          userApproved: false,
          previousVersionId: previous?.id ?? null,
        },
      });

      if (copyFrom) {
        const source = await tx.routine.findMany({
          where: { planVersionId: copyFrom.id, userId },
          orderBy: ROUTINE_ORDER,
        });

        if (source.length > 0) {
          // CLONED, not moved. The source version must keep its routines or its
          // history stops being readable — PRD §103's "the user can inspect why
          // the plan changed" needs both sides of the change to still exist.
          await tx.routine.createMany({
            data: source.map((routine) => ({
              userId,
              planVersionId: version.id,
              title: routine.title,
              domain: routine.domain,
              triggerType: routine.triggerType,
              triggerValue: routine.triggerValue,
              frequency: routine.frequency,
              daysOfWeek: routine.daysOfWeek,
              preferredTime: routine.preferredTime,
              estimatedDurationMin: routine.estimatedDurationMin,
              minimumDurationMin: routine.minimumDurationMin,
              fallbackBehavior: routine.fallbackBehavior,
              active: routine.active,
              sortOrder: routine.sortOrder,
            })),
          });
        }
      }

      return tx.planVersion.findUniqueOrThrow({
        where: { id: version.id },
        include: VERSION_INCLUDE,
      });
    });

    await this.audit(userId, 'plan_version:create', created.id, {
      planId,
      version: created.version,
      previousVersionId: created.previousVersionId,
      createdBy: created.createdBy,
      routinesCopied: created.routines.length,
    });

    return toPlanVersionDto(created);
  }

  async update(
    userId: string,
    planId: string,
    version: number,
    dto: UpdatePlanVersionDto,
  ): Promise<PlanVersionResponseDto> {
    const existing = await this.findOwned(userId, planId, version);

    // A version that has been in force is a historical record. Editing its
    // rationale after the fact rewrites why the user says they changed.
    this.assertDraft(existing.status, version, 'edited');

    const data: Prisma.PlanVersionUpdateInput = {};
    if (dto.rationale !== undefined) data.rationale = dto.rationale;
    if (dto.expectedWeeklyLoad !== undefined) data.expectedWeeklyLoad = dto.expectedWeeklyLoad ?? null;
    if (dto.fallbackStrategy !== undefined) data.fallbackStrategy = dto.fallbackStrategy ?? null;

    const updated = await this.prisma.planVersion.update({
      where: { id: existing.id },
      data,
      include: VERSION_INCLUDE,
    });

    await this.audit(userId, 'plan_version:update', updated.id, {
      planId,
      version,
      changed: Object.keys(data),
    });

    return toPlanVersionDto(updated);
  }

  /**
   * Supersede-then-activate, in one transaction.
   *
   * The order matters and the atomicity matters: between the two writes there
   * would otherwise be an instant with two ACTIVE versions, which the partial
   * unique index rejects — so a non-transactional implementation would fail
   * roughly half the time under any concurrency at all. Inside the
   * transaction the index never fires under normal use; a P2002 that escapes
   * means a genuine race with another activation, and that is a 409 (someone
   * else changed the plan), not a 500.
   */
  async activate(
    userId: string,
    planId: string,
    version: number,
  ): Promise<PlanVersionResponseDto> {
    const target = await this.findOwned(userId, planId, version);

    this.assertDraft(target.status, version, 'activated');

    const current = await this.prisma.planVersion.findFirst({
      where: { planId, userId, status: 'ACTIVE' },
    });

    const now = new Date();

    let activated: VersionRow;
    try {
      activated = await this.prisma.$transaction(async (tx) => {
        if (current) {
          await tx.planVersion.update({
            where: { id: current.id },
            data: { status: 'SUPERSEDED', activeUntil: now },
          });
        }

        return tx.planVersion.update({
          where: { id: target.id },
          data: { status: 'ACTIVE', activeFrom: now, userApproved: true },
          include: VERSION_INCLUDE,
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(
          'Another version of this plan was activated at the same time; reload and try again',
        );
      }
      throw error;
    }

    this.logger.log(
      `plan_version.activate planId=${planId} from=${
        current ? `v${current.version}` : 'none'
      } to=v${version} user=${userId}`,
    );

    await this.audit(userId, 'plan_version:activate', activated.id, {
      planId,
      version,
      supersededVersion: current?.version ?? null,
    });

    return toPlanVersionDto(activated);
  }

  async reject(
    userId: string,
    planId: string,
    version: number,
    dto: RejectPlanVersionDto,
  ): Promise<PlanVersionResponseDto> {
    const target = await this.findOwned(userId, planId, version);

    this.assertDraft(target.status, version, 'rejected');

    const rejected = await this.prisma.planVersion.update({
      where: { id: target.id },
      data: { status: 'REJECTED' },
      include: VERSION_INCLUDE,
    });

    // The rationale is KEPT. A rejected version is part of the record of what
    // the user considered and decided against, and E06 reads it.
    await this.audit(userId, 'plan_version:reject', rejected.id, {
      planId,
      version,
      hasReason: Boolean(dto.reason?.trim()),
    });

    return toPlanVersionDto(rejected);
  }

  async findOwned(userId: string, planId: string, version: number): Promise<VersionRow> {
    await this.plans.findOwned(userId, planId);

    return findOwnedOrThrow(
      () =>
        this.prisma.planVersion.findFirst({
          where: { planId, userId, version },
          include: VERSION_INCLUDE,
        }),
      'Plan version',
    );
  }

  private assertDraft(status: string, version: number, verb: string): void {
    if (status !== 'DRAFT') {
      throw new ConflictException(`v${version} is ${status} and cannot be ${verb}`);
    }
  }

  private async audit(
    userId: string,
    action: string,
    targetId: string,
    meta: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.prisma.auditEvent.create({
      data: { actorUserId: userId, action, targetType: 'plan_version', targetId, meta },
    });
  }
}
