import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, type Outcome, type WorkSessionPlanSource } from '@prisma/client';

import { AiGatewayService } from '../../ai/gateway/ai-gateway.service';
import { AiKeyRequiredException, type AiErrorCode } from '../../ai/gateway/ai-errors';
import { PrismaService } from '../../prisma/prisma.service';
import { findOwnedOrThrow } from '../../path/owned-resource';
import { localDate, safeTimeZone } from '../../today/local-date';
import { addDays, weekdayOf } from '../../weekly/week-bounds';
import { UserProfileService } from '../../user-profile/user-profile.service';
import { WORK_PLANNING_INSTRUCTIONS } from './work-planning.instructions';
import {
  DEFAULT_AVAILABLE_MINUTES_PER_DAY,
  validateWorkSessionPlan,
  type GuardrailContext,
} from './work-session-plan.guardrails';
import {
  WORK_SESSION_PLAN_PROMPT_VERSION,
  WORK_SESSION_PLAN_SCHEMA_NAME,
  workSessionPlanSchema,
  type WorkSessionPlan,
} from './work-session-plan.schema';
import { buildTemplateSessionPlan } from './work-session-templates';
import type { ApplySessionPlanDto, PlanSessionsDto } from './dto/plan-sessions.dto';

// =============================================================================
// Work session planning (issue #108, epic E07)
// =============================================================================
//
// PROPOSE → VALIDATE → APPLY, and the middle step is the product.
//
// PRD §15 forbids the AI from mutating a plan, so `propose` writes exactly one
// row — a `work_session_plan_proposals` row — and nothing else. No commitment,
// no milestone, no routine, no plan version exists until the user presses
// Apply, which is the approval step. An integration spec counts the tables
// before and after, because "we did not write anything" is invisible to every
// other kind of assertion.
//
// The guardrails run on ALL THREE sources — the model's output, the template,
// and the copy the user edited — and a model plan that fails them is treated as
// a `schema` failure: nothing is stored, and the caller falls back to the
// template. A plan the server had to correct is a plan the user did not agree
// to.
//
// NO NEW `PlanVersion`. Sessions live under the outcome's CURRENT active
// version. A version per applied plan would make E06's diff view show a
// "strategy change" every time somebody scheduled five mornings, and version
// creation belongs to E06-04's proposal protocol.
// =============================================================================

/** A proposal is worth applying for a week; after that the dates are stale. */
export const PROPOSAL_TTL_DAYS = 7;

export interface WorkSessionPlanProposalView {
  proposalId: string;
  proposal: WorkSessionPlan;
  source: 'ai' | 'template';
  expiresAt: string;
}

export interface AppliedSessionPlan {
  routineId: string;
  milestoneIds: string[];
  commitmentIds: string[];
}

export interface OutcomeWorkPlanView {
  milestones: Array<{
    id: string;
    title: string;
    order: number;
    targetDate: string | null;
    completedAt: string | null;
  }>;
  sessions: Array<{
    id: string;
    title: string;
    status: string;
    scheduledStart: string;
    durationMinutes: number | null;
    milestoneId: string | null;
    rescheduleCount: number;
  }>;
  implementationIntention: { when: string; then: string } | null;
  reviewCadence: 'DAILY' | 'TWICE_WEEKLY' | 'WEEKLY' | null;
  latestProposal: { id: string; status: string; source: 'ai' | 'template' } | null;
}

/** `commitments.commitment_type` for a planned work session. */
export const FOCUS_SESSION_COMMITMENT_TYPE = 'FOCUS_SESSION';

@Injectable()
export class WorkSessionPlanningService {
  private readonly logger = new Logger(WorkSessionPlanningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiGatewayService,
    private readonly profiles: UserProfileService,
  ) {}

  // ---------------------------------------------------------------------------
  // Proposing
  // ---------------------------------------------------------------------------

  /** Ask the planner. Writes one proposal row and nothing else. */
  async propose(
    userId: string,
    outcomeId: string,
    dto: PlanSessionsDto,
    now: Date = new Date(),
  ): Promise<WorkSessionPlanProposalView> {
    const ctx = await this.context(userId, outcomeId, dto, now);

    const result = await this.ai.invoke({
      persona: 'planner',
      userId,
      promptVersion: WORK_SESSION_PLAN_PROMPT_VERSION,
      instructions: WORK_PLANNING_INSTRUCTIONS,
      input: JSON.stringify({
        today: localDate(now, ctx.guardrails.timezone),
        timezone: ctx.guardrails.timezone,
        outcome: {
          title: ctx.outcome.title,
          motivation: ctx.outcome.motivation,
          successDefinition: ctx.outcome.successDefinition,
          targetDate: ctx.guardrails.targetDate,
          importance: ctx.outcome.importance,
        },
        availableMinutesPerDay: ctx.guardrails.availableMinutesPerDay,
        existingSessions: ctx.existingSessions,
      }),
      schema: workSessionPlanSchema,
      schemaName: WORK_SESSION_PLAN_SCHEMA_NAME,
    });

    if (!result.ok) {
      // The one AI failure the USER can fix. Everything else is the server's
      // problem and comes back as a 503 the dialog answers with "use a standard
      // plan" (PRD §120).
      if (result.error.code === 'no_user_key') throw new AiKeyRequiredException();

      throw this.unavailable(result.error.code, result.error.message);
    }

    const details = validateWorkSessionPlan(result.output, ctx.guardrails);

    if (details.length > 0) {
      // Treated exactly like a schema failure: the model produced something
      // shaped right and wrong. Nothing is stored — a corrected plan is not the
      // plan the model proposed, and the user would be applying our edit.
      this.logger.warn(
        `Work plan-sessions guardrails rejected user=${userId} outcome=${outcomeId} rules=${details.length}`,
      );

      throw this.unavailable('schema', 'The coach produced a plan that does not fit your week.');
    }

    return this.store(userId, ctx.outcome, result.output, 'AI', result.invocationId, now);
  }

  /** The deterministic plan. Never calls the gateway. */
  async proposeTemplate(
    userId: string,
    outcomeId: string,
    dto: PlanSessionsDto,
    now: Date = new Date(),
  ): Promise<WorkSessionPlanProposalView> {
    const ctx = await this.context(userId, outcomeId, dto, now);

    const plan = buildTemplateSessionPlan({
      outcome: { title: ctx.outcome.title },
      now,
      timezone: ctx.guardrails.timezone,
      targetDate: ctx.guardrails.targetDate,
      availableMinutesPerDay: ctx.guardrails.availableMinutesPerDay,
    });

    // The template is held to the same rules as the model. A template that
    // could not be applied would be a fallback that does not fall back.
    const details = validateWorkSessionPlan(plan, ctx.guardrails);

    if (details.length > 0) {
      throw new BadRequestException({
        message: 'A standard plan does not fit inside your target date and daily minutes.',
        details: { reason: 'PROPOSAL_INVALID', rules: details },
      });
    }

    return this.store(userId, ctx.outcome, plan, 'TEMPLATE', null, now);
  }

  // ---------------------------------------------------------------------------
  // Applying
  // ---------------------------------------------------------------------------

  /**
   * The PRD §15 approval step: the one path that turns a proposal into rows.
   *
   * Everything happens in ONE transaction. A half-applied plan — milestones
   * with no sessions, sessions with no routine — is worse than a failed apply,
   * because the user would see a partial plan and believe it.
   */
  async apply(
    userId: string,
    outcomeId: string,
    dto: ApplySessionPlanDto,
    now: Date = new Date(),
  ): Promise<AppliedSessionPlan> {
    const outcome = await this.findWorkOutcome(userId, outcomeId);

    const proposal = await findOwnedOrThrow(
      () =>
        this.prisma.workSessionPlanProposal.findFirst({
          where: { id: dto.proposalId, userId, outcomeId },
        }),
      'Proposal',
    );

    if (proposal.status !== 'PROPOSED') {
      throw new ConflictException({
        message: `This plan has already been ${proposal.status.toLowerCase()}.`,
        details: { reason: 'PROPOSAL_NOT_PENDING', status: proposal.status },
      });
    }

    if (proposal.expiresAt <= now) {
      // Lazily, on read: there is no sweeper, and a proposal nobody reopens
      // never needs one.
      await this.prisma.workSessionPlanProposal.update({
        where: { id: proposal.id },
        data: { status: 'EXPIRED' },
      });

      throw new ConflictException({
        message: 'This plan has expired. Ask for a new one.',
        details: { reason: 'PROPOSAL_NOT_PENDING', status: 'EXPIRED' },
      });
    }

    const timezone = await this.timezoneFor(userId);
    const availableMinutesPerDay = await this.minutesPerDayFor(userId, null);

    // The EDITED copy is validated; when none is sent the STORED one is used.
    // The body never says which source this was — `source` is read off the row.
    const edited = dto.proposal ?? null;
    const plan = workSessionPlanSchema.parse(edited ?? proposal.plan);

    const details = validateWorkSessionPlan(plan, {
      now,
      timezone,
      targetDate: outcome.targetDate ? localDate(outcome.targetDate, 'UTC') : null,
      availableMinutesPerDay,
    });

    if (details.length > 0) {
      throw new BadRequestException({
        message: 'This plan does not fit your week.',
        details: { reason: 'PROPOSAL_INVALID', rules: details },
      });
    }

    const applied = await this.prisma.$transaction(async (tx) => {
      // ---- 1. the plan and its active version ------------------------------
      //
      // An outcome created from the Path screen has no plan at all; a session
      // plan is not a reason to refuse. A plan + v1 is created when one is
      // missing and NOTHING is created when one is there — see the header.
      let planRow = await tx.plan.findUnique({
        where: { outcomeId },
        include: { versions: { where: { status: 'ACTIVE' }, take: 1 } },
      });

      if (!planRow) {
        planRow = await tx.plan.create({
          data: { userId, outcomeId },
          include: { versions: { where: { status: 'ACTIVE' }, take: 1 } },
        });
      }

      let activeVersion = planRow.versions[0] ?? null;

      if (!activeVersion) {
        activeVersion = await tx.planVersion.create({
          data: {
            userId,
            planId: planRow.id,
            version:
              ((
                await tx.planVersion.aggregate({
                  where: { planId: planRow.id },
                  _max: { version: true },
                })
              )._max.version ?? 0) + 1,
            status: 'ACTIVE',
            createdBy: 'USER',
            userApproved: true,
            rationale: 'Created when planning focus sessions',
            activeFrom: now,
          },
        });
      }

      // ---- 2. milestones ---------------------------------------------------
      //
      // `order` continues from the outcome's current maximum, so a second plan
      // appends rather than colliding with the unique (outcome_id, order).
      const maxOrder =
        (
          await tx.workMilestone.aggregate({
            where: { outcomeId },
            _max: { order: true },
          })
        )._max.order ?? -1;

      const milestoneIds: string[] = [];

      for (const milestone of [...plan.milestones].sort((a, b) => a.order - b.order)) {
        const row = await tx.workMilestone.create({
          data: {
            userId,
            outcomeId,
            title: milestone.title,
            order: maxOrder + 1 + milestone.order,
          },
        });

        milestoneIds[milestone.order] = row.id;
      }

      // ---- 3. one routine --------------------------------------------------

      const routineTitle = `Focus session: ${outcome.title}`.slice(0, 200);

      const existingRoutine = await tx.routine.findFirst({
        where: { userId, planVersionId: activeVersion.id, title: routineTitle, active: true },
      });

      const durations = plan.sessions.map((s) => s.durationMinutes).sort((a, b) => a - b);
      const median = durations[Math.floor(durations.length / 2)];

      const routine =
        existingRoutine ??
        (await tx.routine.create({
          data: {
            userId,
            planVersionId: activeVersion.id,
            domain: 'WORK',
            title: routineTitle,
            triggerType: 'EVENT',
            triggerValue: plan.implementationIntention.when,
            frequency: 'CUSTOM',
            // 0 = Sunday … 6 = Saturday, in the USER's zone. Deriving it from
            // the UTC instant would put a 09:00 Monday session in Tokyo on a
            // Sunday for anybody reading the routine later.
            daysOfWeek: [
              ...new Set(
                plan.sessions.map((s) =>
                  weekdayOf(localDate(new Date(s.scheduledStart), timezone)),
                ),
              ),
            ].sort((a, b) => a - b),
            preferredTime: localTime(new Date(plan.sessions[0].scheduledStart), timezone),
            estimatedDurationMin: median,
            minimumDurationMin: Math.min(...plan.sessions.map((s) => s.minimumStart.minutes)),
            fallbackBehavior: mostCommon(plan.sessions.map((s) => s.minimumStart.title)),
            active: true,
          },
        }));

      // ---- 4. one commitment per session -----------------------------------

      const commitmentIds: string[] = [];

      for (const session of plan.sessions) {
        const start = new Date(session.scheduledStart);

        const commitment = await tx.commitment.create({
          data: {
            userId,
            domain: 'WORK',
            title: session.title,
            outcomeId,
            planVersionId: activeVersion.id,
            routineId: routine.id,
            workMilestoneId: milestoneIds[session.milestoneIndex] ?? null,
            scheduledStart: start,
            scheduledEnd: new Date(start.getTime() + session.durationMinutes * 60_000),
            importance: outcome.importance,
            commitmentType: FOCUS_SESSION_COMMITMENT_TYPE,
            status: 'PLANNED',
            fullVersion: session.title,
            fullMinutes: session.durationMinutes,
            shortVersion: session.title,
            shortMinutes: Math.max(
              session.minimumStart.minutes + 1,
              Math.ceil(session.durationMinutes / 2),
            ),
            minimumVersion: session.minimumStart.title,
            minimumMinutes: session.minimumStart.minutes,
          },
        });

        commitmentIds.push(commitment.id);
      }

      // ---- 5. close the proposal -------------------------------------------

      await tx.workSessionPlanProposal.update({
        where: { id: proposal.id },
        data: {
          status: 'APPLIED',
          appliedAt: now,
          appliedPlan: plan as unknown as Prisma.InputJsonValue,
        },
      });

      return { routineId: routine.id, milestoneIds: milestoneIds.filter(Boolean), commitmentIds };
    });

    await this.prisma.auditEvent.create({
      data: {
        actorUserId: userId,
        action: 'work:sessions_applied',
        targetType: 'outcome',
        targetId: outcomeId,
        meta: {
          source: proposal.source === 'AI' ? 'ai' : 'template',
          edited: edited !== null,
          milestones: applied.milestoneIds.length,
          sessions: applied.commitmentIds.length,
          routineId: applied.routineId,
        },
      },
    });

    // Ids and counts. Never a title: an outcome title is what the user is
    // trying to do with their life, and a log aggregator is not the place for it.
    this.logger.log(
      `Work plan-sessions applied user=${userId} outcome=${outcomeId} source=${proposal.source.toLowerCase()} sessions=${applied.commitmentIds.length} milestones=${applied.milestoneIds.length}`,
    );

    return applied;
  }

  // ---------------------------------------------------------------------------
  // Reading
  // ---------------------------------------------------------------------------

  async getWorkPlan(userId: string, outcomeId: string): Promise<OutcomeWorkPlanView> {
    await this.findWorkOutcome(userId, outcomeId);

    const [milestones, sessions, latestApplied, latestProposal] = await Promise.all([
      this.prisma.workMilestone.findMany({ where: { userId, outcomeId }, orderBy: { order: 'asc' } }),
      this.prisma.commitment.findMany({
        where: { userId, outcomeId, commitmentType: FOCUS_SESSION_COMMITMENT_TYPE },
        orderBy: { scheduledStart: 'asc' },
      }),
      this.prisma.workSessionPlanProposal.findFirst({
        where: { userId, outcomeId, status: 'APPLIED' },
        orderBy: { appliedAt: 'desc' },
      }),
      this.prisma.workSessionPlanProposal.findFirst({
        where: { userId, outcomeId },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    // The intention and the cadence are read off the plan the user APPLIED, not
    // the one that was proposed: an edited "when" is the one they agreed to.
    const appliedPlan = latestApplied?.appliedPlan
      ? workSessionPlanSchema.safeParse(latestApplied.appliedPlan)
      : null;

    return {
      milestones: milestones.map((m) => ({
        id: m.id,
        title: m.title,
        order: m.order,
        targetDate: m.targetDate ? localDate(m.targetDate, 'UTC') : null,
        completedAt: m.completedAt ? m.completedAt.toISOString() : null,
      })),
      sessions: sessions.map((c) => ({
        id: c.id,
        title: c.title,
        status: c.status,
        scheduledStart: c.scheduledStart.toISOString(),
        durationMinutes: c.fullMinutes,
        milestoneId: c.workMilestoneId,
        rescheduleCount: c.rescheduleCount,
      })),
      implementationIntention:
        appliedPlan?.success === true ? appliedPlan.data.implementationIntention : null,
      reviewCadence: appliedPlan?.success === true ? appliedPlan.data.reviewCadence : null,
      latestProposal: latestProposal
        ? {
            id: latestProposal.id,
            status: latestProposal.status,
            source: latestProposal.source === 'AI' ? 'ai' : 'template',
          }
        : null,
    };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async findWorkOutcome(userId: string, outcomeId: string): Promise<Outcome> {
    const outcome = await findOwnedOrThrow(
      () => this.prisma.outcome.findFirst({ where: { id: outcomeId, userId } }),
      'Outcome',
    );

    if (outcome.domain !== 'WORK') {
      throw new BadRequestException({
        message: 'Focus sessions are planned for Work outcomes only.',
        details: { reason: 'OUTCOME_NOT_WORK', domain: outcome.domain },
      });
    }

    return outcome;
  }

  /** Everything both propose paths need, resolved once. */
  private async context(
    userId: string,
    outcomeId: string,
    dto: PlanSessionsDto,
    now: Date,
  ): Promise<{
    outcome: Outcome;
    guardrails: GuardrailContext;
    existingSessions: Array<{ scheduledStart: string; durationMinutes: number | null }>;
  }> {
    const outcome = await this.findWorkOutcome(userId, outcomeId);
    const timezone = await this.timezoneFor(userId);

    const targetDate =
      dto.targetDate ?? (outcome.targetDate ? localDate(outcome.targetDate, 'UTC') : null);

    // Today is not a horizon: a plan needs at least tomorrow to put a session on.
    if (targetDate && targetDate < addDays(localDate(now, timezone), 1)) {
      throw new BadRequestException({
        message: 'The target date must be tomorrow or later.',
        details: { reason: 'TARGET_DATE_PAST', targetDate },
      });
    }

    const existing = await this.prisma.commitment.findMany({
      where: {
        userId,
        outcomeId,
        commitmentType: FOCUS_SESSION_COMMITMENT_TYPE,
        status: { in: ['PLANNED', 'READY', 'STARTED'] },
        scheduledStart: { gte: now },
      },
      orderBy: { scheduledStart: 'asc' },
      take: 20,
    });

    return {
      outcome,
      guardrails: {
        now,
        timezone,
        targetDate,
        availableMinutesPerDay: await this.minutesPerDayFor(
          userId,
          dto.availableMinutesPerDay ?? null,
        ),
      },
      existingSessions: existing.map((c) => ({
        scheduledStart: c.scheduledStart.toISOString(),
        durationMinutes: c.fullMinutes,
      })),
    };
  }

  /** Request → profile → 60. Documented in `docs/API.md`; do not reorder. */
  private async minutesPerDayFor(userId: string, requested: number | null): Promise<number> {
    if (requested !== null) return requested;

    const profile = await this.profiles.find(userId);

    return profile?.weekdayMinutes ?? DEFAULT_AVAILABLE_MINUTES_PER_DAY;
  }

  private async timezoneFor(userId: string): Promise<string> {
    const profile = await this.profiles.find(userId);

    return safeTimeZone(profile?.timezone);
  }

  private async store(
    userId: string,
    outcome: Outcome,
    plan: WorkSessionPlan,
    source: WorkSessionPlanSource,
    invocationId: string | null,
    now: Date,
  ): Promise<WorkSessionPlanProposalView> {
    const expiresAt = new Date(now.getTime() + PROPOSAL_TTL_DAYS * 86_400_000);

    const row = await this.prisma.$transaction(async (tx) => {
      // One pending proposal per outcome. A second one the user never saw would
      // make "apply" ambiguous the moment two tabs are open.
      await tx.workSessionPlanProposal.updateMany({
        where: { userId, outcomeId: outcome.id, status: 'PROPOSED' },
        data: { status: 'DISCARDED' },
      });

      return tx.workSessionPlanProposal.create({
        data: {
          userId,
          outcomeId: outcome.id,
          source,
          status: 'PROPOSED',
          plan: plan as unknown as Prisma.InputJsonValue,
          invocationId,
          expiresAt,
        },
      });
    });

    this.logger.log(
      `Work plan-sessions user=${userId} outcome=${outcome.id} source=${source.toLowerCase()} sessions=${plan.sessions.length} milestones=${plan.milestones.length}`,
    );

    return {
      proposalId: row.id,
      proposal: plan,
      source: source === 'AI' ? 'ai' : 'template',
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * A gateway failure as a 503 the dialog can act on.
   *
   * `retryable` is the whole reason this is not a bare 503: a timeout is worth
   * a "Try again" button and a missing model is not — the second needs an
   * administrator, and offering a retry would be a lie.
   */
  private unavailable(code: AiErrorCode, message: string): ServiceUnavailableException {
    const retryable = ['rate_limit', 'timeout', 'network', 'provider'].includes(code);

    return new ServiceUnavailableException({
      message,
      details: { reason: 'AI_UNAVAILABLE', code, retryable },
    });
  }
}

/** `HH:mm` in the given zone. */
function localTime(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: safeTimeZone(timeZone),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
}

/** The most frequent string, first-seen winning a tie. */
function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();

  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);

  return [...counts.entries()].reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0];
}
