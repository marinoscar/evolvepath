import { ConflictException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { OutcomesService } from '../outcomes/outcomes.service';
import { findOwnedOrThrow } from '../owned-resource';
import { CreatePlanDto } from './dto/create-plan.dto';
import { PlanResponseDto } from './dto/plan-response.dto';
import { toPlanVersionSummary } from './plan-version.mapper';
import { ROUTINE_ORDER } from '../routines/routine.mapper';

const PLAN_INCLUDE = {
  versions: {
    orderBy: { version: 'desc' as const },
    include: { _count: { select: { routines: true } } },
  },
} satisfies Prisma.PlanInclude;

type PlanRow = Prisma.PlanGetPayload<{ include: typeof PLAN_INCLUDE }>;

@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outcomes: OutcomesService,
  ) {}

  /**
   * Creates the plan AND its first version AND its routines, or none of them.
   *
   * A plan with no versions is not a state this product has a meaning for —
   * `GET /plans/:id` would report `activeVersion: null` for something that was
   * never a draft — so the three writes are one transaction. The audit row is
   * written after it commits, per the side-effects-outside-transactions rule.
   */
  async createForOutcome(
    userId: string,
    outcomeId: string,
    dto: CreatePlanDto,
  ): Promise<PlanResponseDto> {
    const outcome = await this.outcomes.findOwned(userId, outcomeId);

    if (outcome.state === 'ARCHIVED') {
      throw new ConflictException('Outcome is archived');
    }

    if (outcome.plan) {
      // One plan per outcome is a database constraint (`outcome_id` is unique);
      // this check exists to answer 409 with an explanation rather than letting
      // a P2002 surface as a 500.
      throw new ConflictException('Outcome already has a plan');
    }

    const now = new Date();

    const plan = await this.prisma.$transaction(async (tx) => {
      const created = await tx.plan.create({ data: { userId, outcomeId } });

      const version = await tx.planVersion.create({
        data: {
          userId,
          planId: created.id,
          version: 1,
          // v1 is ACTIVE immediately. A first plan that lands as a draft would
          // ask the user to approve the thing they just wrote.
          status: 'ACTIVE',
          userApproved: true,
          createdBy: 'USER',
          rationale: dto.rationale ?? null,
          expectedWeeklyLoad: dto.expectedWeeklyLoad ?? null,
          fallbackStrategy: dto.fallbackStrategy ?? null,
          activeFrom: now,
        },
      });

      if (dto.routines.length > 0) {
        await tx.routine.createMany({
          data: dto.routines.map((routine, index) => ({
            userId,
            planVersionId: version.id,
            title: routine.title,
            // The outcome's domain is the default: a routine serving a health
            // outcome is a health routine unless the user says otherwise.
            domain: routine.domain ?? outcome.domain,
            triggerType: routine.triggerType,
            triggerValue: routine.triggerValue ?? null,
            frequency: routine.frequency,
            daysOfWeek: routine.daysOfWeek,
            preferredTime: routine.preferredTime ?? null,
            estimatedDurationMin: routine.estimatedDurationMin,
            minimumDurationMin: routine.minimumDurationMin,
            fallbackBehavior: routine.fallbackBehavior ?? null,
            sortOrder: routine.sortOrder || index,
          })),
        });
      }

      return tx.plan.findUniqueOrThrow({ where: { id: created.id }, include: PLAN_INCLUDE });
    });

    await this.prisma.auditEvent.create({
      data: {
        actorUserId: userId,
        action: 'plan:create',
        targetType: 'plan',
        targetId: plan.id,
        meta: { outcomeId, routines: dto.routines.length } as Prisma.InputJsonValue,
      },
    });

    return this.toDto(plan);
  }

  /**
   * An array, though there is at most one plan per outcome today. The shape is
   * the forward-compatible one: allowing a second plan later becomes a data
   * change rather than a breaking response change.
   */
  async listForOutcome(userId: string, outcomeId: string): Promise<PlanResponseDto[]> {
    await this.outcomes.findOwned(userId, outcomeId);

    const plans = await this.prisma.plan.findMany({
      where: { userId, outcomeId },
      include: PLAN_INCLUDE,
    });

    return plans.map((plan) => this.toDto(plan));
  }

  async get(userId: string, planId: string): Promise<PlanResponseDto> {
    return this.toDto(await this.findOwned(userId, planId));
  }

  async findOwned(userId: string, planId: string): Promise<PlanRow> {
    return findOwnedOrThrow(
      () => this.prisma.plan.findFirst({ where: { id: planId, userId }, include: PLAN_INCLUDE }),
      'Plan',
    );
  }

  private toDto(plan: PlanRow): PlanResponseDto {
    const active = plan.versions.find((version) => version.status === 'ACTIVE') ?? null;

    return {
      id: plan.id,
      outcomeId: plan.outcomeId,
      activeVersion: active ? toPlanVersionSummary(active, active._count.routines) : null,
      versionCount: plan.versions.length,
      createdAt: plan.createdAt.toISOString(),
    };
  }
}

export { PLAN_INCLUDE, ROUTINE_ORDER };
