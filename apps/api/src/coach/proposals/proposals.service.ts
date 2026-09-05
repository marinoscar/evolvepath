import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, type ProposalSourceKind, type ProposalStatus } from '@prisma/client';
import { trace } from '@opentelemetry/api';

import { PrismaService } from '../../prisma/prisma.service';
import { findOwnedOrThrow } from '../../path/owned-resource';
import { PlanVersionsService } from '../../path/plans/plan-versions.service';
import { localDate, localDayBounds, safeTimeZone } from '../../today/local-date';
import {
  applyChanges,
  type ApplyError,
  type CommitmentEffect,
  type PlanVersionSnapshot,
} from './apply-changes';
import { planChangeListSchema, type PlanChange } from './plan-change.schema';
import { PROPOSAL_EFFECT, type ProposalEffect } from './proposal-effects';
import type { ProposalDetailDto, ProposalSummaryDto } from './dto/proposal-response.dto';

// =============================================================================
// The mutation protocol (issue #76, epic E06)
// =============================================================================
//
// VISION §19: "EvolvePath owns the plan. AI owns the coaching." This service is
// where that sentence becomes code. PRD §15 spells the steps out — AI proposes,
// the product shows a diff, the user approves or edits, the plan service
// validates, a new version becomes active, the old one stays in history, the
// change is recorded — and §89/§107 add the constraint that makes it worth
// having: the AI never changes a plan without an explicit approval.
//
// THE INVARIANT, STATED ONCE: no code path except `accept` turns AI output
// into a `PlanVersion`. Creating a proposal writes a row in
// `plan_change_proposals` and nothing else; reading one runs `applyChanges` in
// memory and writes nothing at all. The integration spec asserts the
// `plan_versions` count at each of those steps, because "we did not write
// anything" is exactly the kind of claim that rots silently.
//
// AND THE PREVIEW IS THE APPLICATION. `GET /proposals/:id` and `accept` call
// the same pure `applyChanges`. Two implementations would mean the user
// approves one thing and gets another, which is the specific failure the whole
// protocol exists to prevent.
// =============================================================================

const tracer = trace.getTracer('evolvepath-api');

/** How long a proposal stays actionable. A constant, not an env var: it is a
 *  product decision about how stale advice may get, not a deployment knob. */
export const PROPOSAL_TTL_DAYS = 7;

/** Statuses a user can still act on. */
const ACTIONABLE: ProposalStatus[] = ['PROPOSED', 'EDITED'];

const PROPOSAL_INCLUDE = {
  plan: { select: { id: true, outcome: { select: { title: true, domain: true } } } },
} satisfies Prisma.PlanChangeProposalInclude;

type ProposalRow = Prisma.PlanChangeProposalGetPayload<{
  include: typeof PROPOSAL_INCLUDE;
}>;

export interface CreateProposalInput {
  planId: string;
  summary: string;
  changes: PlanChange[];
  sourceMessageId?: string | null;
  invocationId?: string | null;
}

@Injectable()
export class ProposalsService {
  private readonly logger = new Logger(ProposalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly versions: PlanVersionsService,
    /**
     * Domain effects, matched on `sourceKind` and run inside the accept
     * transaction. Optional and empty by default: a deployment with no domain
     * effects registered accepts proposals exactly as it did before the hook
     * existed.
     */
    @Optional()
    @Inject(PROPOSAL_EFFECT)
    private readonly effects: ProposalEffect[] = [],
  ) {}

  // ---------------------------------------------------------------------------
  // Creation — the only writers are other services, never a route
  // ---------------------------------------------------------------------------

  /** The coach's entry point (E06-03). */
  async createFromCoach(
    userId: string,
    input: CreateProposalInput,
  ): Promise<ProposalDetailDto> {
    return this.createFromSource(userId, 'COACH', input);
  }

  /**
   * The shared entry point. E09's workout adaptation and E10's weekly review
   * pass their own `sourceKind` and get the identical protocol — which is the
   * reason this is a service parameter and not three copies of the flow.
   */
  async createFromSource(
    userId: string,
    sourceKind: ProposalSourceKind,
    input: CreateProposalInput,
  ): Promise<ProposalDetailDto> {
    const changes = this.parseChanges(input.changes);

    const plan = await findOwnedOrThrow(
      () =>
        this.prisma.plan.findFirst({
          where: { id: input.planId, userId },
          include: { versions: { where: { status: 'ACTIVE' } } },
        }),
      'Plan',
    );

    if (plan.versions.length === 0) {
      throw new ConflictException('Plan has no active version to change');
    }

    const created = await this.prisma.planChangeProposal.create({
      data: {
        userId,
        planId: input.planId,
        sourceKind,
        sourceMessageId: input.sourceMessageId ?? null,
        summary: input.summary.slice(0, 300),
        changes: changes as unknown as Prisma.InputJsonValue,
        invocationId: input.invocationId ?? null,
        expiresAt: new Date(Date.now() + PROPOSAL_TTL_DAYS * 24 * 60 * 60 * 1000),
      },
      include: PROPOSAL_INCLUDE,
    });

    return this.detail(userId, created);
  }

  // ---------------------------------------------------------------------------
  // Reading
  // ---------------------------------------------------------------------------

  async list(
    userId: string,
    filter: { status?: ProposalStatus; planId?: string; sourceKind?: ProposalSourceKind } = {},
  ): Promise<ProposalSummaryDto[]> {
    const rows = await this.prisma.planChangeProposal.findMany({
      where: {
        userId,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.planId ? { planId: filter.planId } : {}),
        ...(filter.sourceKind ? { sourceKind: filter.sourceKind } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: PROPOSAL_INCLUDE,
    });

    const expired = await this.expireAll(rows);

    return expired
      .filter((row) => !filter.status || row.status === filter.status)
      .map((row) => this.summary(row));
  }

  async get(userId: string, id: string): Promise<ProposalDetailDto> {
    const row = await this.findOwned(userId, id);

    return this.detail(userId, await this.expire(row));
  }

  // ---------------------------------------------------------------------------
  // Deciding
  // ---------------------------------------------------------------------------

  async edit(
    userId: string,
    id: string,
    changes: PlanChange[],
  ): Promise<ProposalDetailDto> {
    const row = this.assertActionable(await this.expire(await this.findOwned(userId, id)));
    const parsed = this.parseChanges(changes);

    // Validated against the CURRENT plan before anything is stored: an edit
    // that cannot apply is a proposal the user would meet a 422 on at accept
    // time, having already been told it was saved.
    const snapshot = await this.snapshot(userId, row.planId);
    const applied = applyChanges(snapshot, parsed);
    if (!applied.ok) this.rejectChanges(applied.errors);

    const updated = await this.prisma.planChangeProposal.update({
      where: { id: row.id },
      data: {
        // Stored once, the first time. `originalChanges` is what the coach
        // actually proposed, and the second edit must not overwrite it with
        // the first edit — that would make the record of the AI's suggestion
        // a record of the user's.
        originalChanges:
          row.originalChanges === null
            ? (row.changes as Prisma.InputJsonValue)
            : undefined,
        changes: parsed as unknown as Prisma.InputJsonValue,
        status: 'EDITED',
        editedAt: new Date(),
      },
      include: PROPOSAL_INCLUDE,
    });

    return this.detail(userId, updated);
  }

  async accept(
    userId: string,
    id: string,
  ): Promise<{
    proposal: ProposalDetailDto;
    planVersion: { id: string; version: number; status: 'ACTIVE' };
  }> {
    return tracer.startActiveSpan('proposals.accept', async (span) => {
      try {
        const result = await this.applyAccept(userId, id);
        span.setAttribute('proposal.id', id);
        span.setAttribute('proposal.to_version', result.planVersion.version);
        return result;
      } finally {
        span.end();
      }
    });
  }

  private async applyAccept(userId: string, id: string) {
    const existing = this.assertActionable(
      await this.expire(await this.findOwned(userId, id)),
    );
    const changes = this.parseChanges(existing.changes as unknown as PlanChange[]);
    const wasEdited = existing.status === 'EDITED';

    const snapshot = await this.snapshot(userId, existing.planId);
    const applied = applyChanges(snapshot, changes);
    if (!applied.ok) this.rejectChanges(applied.errors);

    const outcome = await this.prisma.$transaction(async (tx) => {
      // Re-read inside the transaction. Between the checks above and here, a
      // second tab could have accepted the same proposal; the update below is
      // conditional on the status it was actionable in, so exactly one of the
      // two wins.
      const locked = await tx.planChangeProposal.updateMany({
        where: { id: existing.id, userId, status: { in: ACTIONABLE } },
        data: { status: 'ACCEPTED', decidedAt: new Date() },
      });

      if (locked.count === 0) {
        throw new ConflictException('proposal_not_actionable');
      }

      const version = await this.versions.createAndActivateInTx(
        tx,
        userId,
        existing.planId,
        {
          // PRD §80: the history has to say WHY. The summary is the sentence
          // the user read; the per-change reasons are what they agreed to.
          rationale: [existing.summary, ...changes.map((c) => c.reason)].join('\n'),
          expectedWeeklyLoad: applied.next.expectedWeeklyLoad,
          fallbackStrategy: applied.next.fallbackStrategy,
          // Attribution follows who wrote the CONTENT. A user who edited the
          // proposal authored the version, whatever suggested it first.
          author: wasEdited ? 'USER' : 'AI',
          routines: applied.next.routines.map((routine, index) => ({
            title: routine.title,
            domain: routine.domain,
            triggerType: routine.triggerType ?? 'TIME',
            triggerValue: routine.triggerValue ?? null,
            frequency: routine.frequency ?? 'WEEKDAYS',
            daysOfWeek: routine.daysOfWeek ?? [],
            preferredTime: routine.preferredTime ?? null,
            estimatedDurationMin: routine.estimatedDurationMin ?? 30,
            minimumDurationMin: routine.minimumDurationMin ?? 10,
            fallbackBehavior: routine.fallbackBehavior ?? null,
            active: routine.active ?? true,
            sortOrder: index,
          })),
        },
      );

      await this.applyEffects(tx, userId, applied.commitmentEffects);

      // The domain's own half of the acceptance, inside the same transaction:
      // a workout template that failed to change must take the plan version
      // with it rather than leaving the user a plan that says 25 minutes and a
      // workout that is still 40.
      for (const effect of this.effects.filter((e) => e.sourceKind === existing.sourceKind)) {
        await effect.apply(tx, {
          userId,
          planId: existing.planId,
          planVersionId: version.id,
          changes,
        });
      }

      await tx.planChangeProposal.update({
        where: { id: existing.id },
        data: { appliedPlanVersionId: version.id },
      });

      if (existing.sourceMessageId) {
        const message = await tx.coachMessage.findUnique({
          where: { id: existing.sourceMessageId },
          select: { conversationId: true },
        });

        if (message) {
          // A SYSTEM turn, so re-reading the thread later shows what the
          // conversation actually caused. The coach did not say this.
          await tx.coachMessage.create({
            data: {
              conversationId: message.conversationId,
              role: 'SYSTEM',
              content: `Plan updated to v${version.version}.`,
            },
          });
        }
      }

      return version;
    });

    // After the commit, per the side-effects-outside-transactions rule.
    await this.audit(userId, 'plan:change_accepted', existing.planId, {
      proposalId: existing.id,
      planId: existing.planId,
      fromVersion: outcome.supersededVersion,
      toVersion: outcome.version,
      opCount: changes.length,
      edited: wasEdited,
      invocationId: existing.invocationId,
    });

    this.logger.log(
      `proposal.accept proposalId=${existing.id} planId=${existing.planId} ` +
        `from=v${outcome.supersededVersion ?? 0} to=v${outcome.version} user=${userId}`,
    );

    const refreshed = await this.findOwned(userId, existing.id);

    return {
      proposal: await this.detail(userId, refreshed),
      planVersion: {
        id: outcome.id,
        version: outcome.version,
        status: 'ACTIVE' as const,
      },
    };
  }

  async reject(
    userId: string,
    id: string,
    reason?: string | null,
  ): Promise<ProposalSummaryDto> {
    const row = this.assertActionable(
      await this.expire(await this.findOwned(userId, id)),
    );

    const updated = await this.prisma.planChangeProposal.update({
      where: { id: row.id },
      data: {
        status: 'REJECTED',
        decidedAt: new Date(),
        decisionReason: reason?.trim() ? reason.trim().slice(0, 300) : null,
      },
      include: PROPOSAL_INCLUDE,
    });

    await this.audit(userId, 'plan:change_rejected', row.planId, {
      proposalId: row.id,
      planId: row.planId,
      invocationId: row.invocationId,
      hasReason: Boolean(reason?.trim()),
    });

    return this.summary(updated);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async findOwned(userId: string, id: string): Promise<ProposalRow> {
    // 404 for a proposal that is not yours, never 403 — the repo-wide rule in
    // `path/owned-resource.ts`. A 403 confirms the id exists.
    return findOwnedOrThrow(
      () =>
        this.prisma.planChangeProposal.findFirst({
          where: { id, userId },
          include: PROPOSAL_INCLUDE,
        }),
      'Proposal',
    );
  }

  /**
   * Lazy expiry: a stale proposal becomes EXPIRED the first time anyone looks
   * at it. There is deliberately no sweeper — a row nobody reads costs nothing,
   * and a cron that rewrites user data on a schedule is a much larger thing to
   * own than a `WHERE` clause.
   */
  private async expire(row: ProposalRow): Promise<ProposalRow> {
    if (!ACTIONABLE.includes(row.status) || row.expiresAt > new Date()) return row;

    return this.prisma.planChangeProposal.update({
      where: { id: row.id },
      data: { status: 'EXPIRED' },
      include: PROPOSAL_INCLUDE,
    });
  }

  private async expireAll(rows: ProposalRow[]): Promise<ProposalRow[]> {
    return Promise.all(rows.map((row) => this.expire(row)));
  }

  private assertActionable(row: ProposalRow): ProposalRow {
    if (row.status === 'EXPIRED') {
      throw new ConflictException('proposal_expired');
    }
    if (!ACTIONABLE.includes(row.status)) {
      throw new ConflictException('proposal_not_actionable');
    }
    return row;
  }

  private parseChanges(changes: unknown): PlanChange[] {
    const parsed = planChangeListSchema.safeParse(changes);

    if (!parsed.success) {
      throw new UnprocessableEntityException({
        code: 'invalid_changes',
        message: 'The proposed changes are not a valid change set',
        errors: parsed.error.issues.map((issue) => ({
          index: typeof issue.path[0] === 'number' ? issue.path[0] : 0,
          code: 'invalid_after',
          message: issue.message,
        })),
      });
    }

    return parsed.data;
  }

  private rejectChanges(errors: ApplyError[]): never {
    throw new UnprocessableEntityException({
      code: 'invalid_changes',
      message: 'The proposed changes cannot be applied to the current plan',
      errors,
    });
  }

  /** The active version, its routines, and the commitments still ahead. */
  private async snapshot(
    userId: string,
    planId: string,
  ): Promise<PlanVersionSnapshot> {
    const active = await this.prisma.planVersion.findFirst({
      where: { planId, userId, status: 'ACTIVE' },
      include: { routines: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } },
    });

    if (!active) throw new ConflictException('Plan has no active version to change');

    const profile = await this.prisma.userProfile.findUnique({
      where: { userId },
      select: { timezone: true },
    });
    const timezone = safeTimeZone(profile?.timezone);
    // "Future" is the user's own day boundary. A server-side cutoff would
    // cancel tonight's commitment for everyone west of UTC.
    const { start } = localDayBounds(localDate(new Date(), timezone), timezone);

    const futureCommitments = await this.prisma.commitment.findMany({
      where: {
        userId,
        status: 'PLANNED',
        scheduledStart: { gte: start },
        routineId: { in: active.routines.map((r) => r.id) },
      },
      select: { id: true, routineId: true, title: true, scheduledStart: true },
      orderBy: { scheduledStart: 'asc' },
    });

    return {
      routines: active.routines.map((routine) => ({
        id: routine.id,
        title: routine.title,
        domain: routine.domain,
        sortOrder: routine.sortOrder,
        triggerType: routine.triggerType,
        triggerValue: routine.triggerValue,
        frequency: routine.frequency,
        daysOfWeek: routine.daysOfWeek,
        preferredTime: routine.preferredTime,
        estimatedDurationMin: routine.estimatedDurationMin,
        minimumDurationMin: routine.minimumDurationMin,
        fallbackBehavior: routine.fallbackBehavior,
        active: routine.active,
      })),
      futureCommitments: futureCommitments.map((c) => ({
        id: c.id,
        routineId: c.routineId,
        title: c.title,
        scheduledStart: c.scheduledStart.toISOString(),
      })),
      expectedWeeklyLoad: active.expectedWeeklyLoad,
      fallbackStrategy: active.fallbackStrategy,
    };
  }

  private async applyEffects(
    tx: Prisma.TransactionClient,
    userId: string,
    effects: CommitmentEffect[],
  ): Promise<void> {
    for (const effect of effects) {
      if (effect.effect === 'cancel') {
        await tx.commitment.update({
          where: { id: effect.commitmentId },
          data: { status: 'CANCELLED', skipReason: 'plan_change' },
        });
        continue;
      }

      const time = effect.to?.preferredTime;
      if (!time) continue;

      const commitment = await tx.commitment.findFirst({
        where: { id: effect.commitmentId, userId },
        select: { scheduledStart: true },
      });
      if (!commitment) continue;

      const [hours, minutes] = time.split(':').map(Number);
      const moved = new Date(commitment.scheduledStart);
      moved.setUTCHours(hours, minutes, 0, 0);

      await tx.commitment.update({
        where: { id: effect.commitmentId },
        data: {
          scheduledStart: moved,
          // `rescheduleCount` is NOT incremented. It counts how often the USER
          // pushed something — E07 reads it as a friction signal — and a plan
          // the user changed on purpose is not the same fact at all.
        },
      });
    }
  }

  private summary(row: ProposalRow): ProposalSummaryDto {
    return {
      id: row.id,
      planId: row.planId,
      sourceKind: row.sourceKind,
      status: row.status,
      summary: row.summary,
      changeCount: Array.isArray(row.changes) ? row.changes.length : 0,
      edited: row.originalChanges !== null,
      expiresAt: row.expiresAt.toISOString(),
      decidedAt: row.decidedAt?.toISOString() ?? null,
      decisionReason: row.decisionReason,
      appliedPlanVersionId: row.appliedPlanVersionId,
      createdAt: row.createdAt.toISOString(),
      plan: {
        id: row.plan.id,
        outcomeTitle: row.plan.outcome.title,
        domain: row.plan.outcome.domain,
      },
    };
  }

  private async detail(
    userId: string,
    row: ProposalRow,
  ): Promise<ProposalDetailDto> {
    const changes = row.changes as unknown as PlanChange[];

    let preview: ProposalDetailDto['preview'] = { diff: [], errors: [] };

    try {
      const applied = applyChanges(await this.snapshot(userId, row.planId), changes);
      preview = applied.ok
        ? { diff: applied.diff, errors: [] }
        : { diff: [], errors: applied.errors };
    } catch {
      // A plan whose active version has gone (archived outcome, deleted plan)
      // still has to render its decided proposals — the history is the point.
      preview = { diff: [], errors: [] };
    }

    const activeVersion = await this.prisma.planVersion.findFirst({
      where: { planId: row.planId, userId, status: 'ACTIVE' },
      select: { id: true, version: true },
    });

    return {
      ...this.summary(row),
      changes,
      originalChanges: (row.originalChanges as unknown as PlanChange[]) ?? null,
      preview,
      activeVersion: activeVersion
        ? { id: activeVersion.id, version: activeVersion.version }
        : null,
    };
  }

  private async audit(
    userId: string,
    action: string,
    planId: string,
    meta: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.prisma.auditEvent.create({
      data: { actorUserId: userId, action, targetType: 'plan', targetId: planId, meta },
    });
  }
}
