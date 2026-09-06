import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { AiKeyRequiredException } from '../../ai/gateway/ai-errors';
import { WorkSessionPlanningService } from './work-session-planning.service';
import { buildTemplateSessionPlan } from './work-session-templates';
import type { WorkSessionPlan } from './work-session-plan.schema';

// =============================================================================
// Propose, validate, apply (issue #108)
// =============================================================================
//
// The assertions that matter are the ones about what is NOT written: a propose
// that creates no commitment, a guardrail failure that stores no proposal, an
// apply that creates no plan version when one is already active. Each of those
// is a promise PRD §15 makes and nothing but a counting test can keep.
// =============================================================================

const USER = 'user-1';
const OUTCOME = '11111111-1111-4111-8111-111111111111';
const PROPOSAL = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-09-07T08:00:00.000Z'); // Monday

function goodPlan(overrides: Partial<WorkSessionPlan> = {}): WorkSessionPlan {
  return {
    ...buildTemplateSessionPlan({
      outcome: { title: 'Finish strategy presentation' },
      now: NOW,
      timezone: 'UTC',
      targetDate: null,
      availableMinutesPerDay: 45,
    }),
    ...overrides,
  };
}

interface BuildOptions {
  outcome?: Record<string, unknown> | null;
  aiResult?: unknown;
  proposal?: Record<string, unknown> | null;
  activeVersion?: boolean;
  planExists?: boolean;
  profile?: Record<string, unknown> | null;
}

function build(options: BuildOptions = {}) {
  const outcome =
    options.outcome === null
      ? null
      : {
          id: OUTCOME,
          userId: USER,
          domain: 'WORK',
          title: 'Finish strategy presentation',
          motivation: 'The board decides budget on it',
          successDefinition: null,
          targetDate: null,
          importance: 4,
          ...options.outcome,
        };

  const created = {
    commitments: [] as any[],
    milestones: [] as any[],
    routines: [] as any[],
    planVersions: [] as any[],
    proposals: [] as any[],
    audits: [] as any[],
  };

  let seq = 0;
  const id = (prefix: string) => `${prefix}-${(seq += 1)}`;

  const proposalRow =
    options.proposal === null
      ? null
      : {
          id: PROPOSAL,
          userId: USER,
          outcomeId: OUTCOME,
          source: 'AI',
          status: 'PROPOSED',
          plan: goodPlan(),
          appliedPlan: null,
          expiresAt: new Date(NOW.getTime() + 86_400_000),
          ...options.proposal,
        };

  const prisma: any = {
    outcome: { findFirst: jest.fn(async () => outcome) },
    commitment: {
      findMany: jest.fn(async () => []),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: id('commitment'), ...data };
        created.commitments.push(row);
        return row;
      }),
    },
    workMilestone: {
      findMany: jest.fn(async () => created.milestones),
      aggregate: jest.fn(async () => ({ _max: { order: null } })),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: id('milestone'), ...data };
        created.milestones.push(row);
        return row;
      }),
    },
    workSessionPlanProposal: {
      findFirst: jest.fn(async () => proposalRow),
      findMany: jest.fn(async () => []),
      updateMany: jest.fn(async () => ({ count: 0 })),
      update: jest.fn(async ({ data }: any) => {
        Object.assign(proposalRow as object, data);
        return proposalRow;
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: PROPOSAL, ...data };
        created.proposals.push(row);
        return row;
      }),
    },
    plan: {
      findUnique: jest.fn(async () =>
        options.planExists === false
          ? null
          : {
              id: 'plan-1',
              versions:
                options.activeVersion === false
                  ? []
                  : [{ id: 'version-1', planId: 'plan-1', status: 'ACTIVE' }],
            },
      ),
      create: jest.fn(async ({ data }: any) => ({ id: 'plan-1', versions: [], ...data })),
    },
    planVersion: {
      aggregate: jest.fn(async () => ({ _max: { version: null } })),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: 'version-new', ...data };
        created.planVersions.push(row);
        return row;
      }),
    },
    routine: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: id('routine'), ...data };
        created.routines.push(row);
        return row;
      }),
    },
    auditEvent: {
      create: jest.fn(async ({ data }: any) => {
        created.audits.push(data);
        return data;
      }),
    },
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
  };

  const ai = {
    invoke: jest.fn(
      async () =>
        options.aiResult ?? { ok: true, invocationId: 'inv-1', output: goodPlan() },
    ),
  };

  const profiles = {
    find: jest.fn(async () =>
      options.profile === undefined
        ? { timezone: 'UTC', weekdayMinutes: null }
        : options.profile,
    ),
  };

  const service = new WorkSessionPlanningService(
    prisma as never,
    ai as never,
    profiles as never,
  );

  return { service, prisma, ai, profiles, created };
}

describe('WorkSessionPlanningService.propose', () => {
  it('calls the planner persona with the versioned prompt and schema name', async () => {
    const { service, ai } = build();

    await service.propose(USER, OUTCOME, {}, NOW);

    expect(ai.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        persona: 'planner',
        userId: USER,
        promptVersion: 'work-session-plan.v1',
        schemaName: 'work_session_plan',
      }),
    );
  });

  it('writes exactly one proposal row and no commitments, milestones or versions', async () => {
    const { service, created, prisma } = build();

    await service.propose(USER, OUTCOME, {}, NOW);

    expect(created.proposals).toHaveLength(1);
    expect(prisma.commitment.create).not.toHaveBeenCalled();
    expect(prisma.workMilestone.create).not.toHaveBeenCalled();
    expect(prisma.routine.create).not.toHaveBeenCalled();
    expect(prisma.planVersion.create).not.toHaveBeenCalled();
  });

  it('discards the outcome\'s previous pending proposal', async () => {
    const { service, prisma } = build();

    await service.propose(USER, OUTCOME, {}, NOW);

    expect(prisma.workSessionPlanProposal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: USER, outcomeId: OUTCOME, status: 'PROPOSED' },
        data: { status: 'DISCARDED' },
      }),
    );
  });

  it('turns a missing key into 412 AI_KEY_REQUIRED', async () => {
    const { service } = build({
      aiResult: { ok: false, invocationId: 'i', error: { code: 'no_user_key', message: 'x' } },
    });

    await expect(service.propose(USER, OUTCOME, {}, NOW)).rejects.toBeInstanceOf(
      AiKeyRequiredException,
    );
  });

  it('turns a timeout into a retryable 503', async () => {
    const { service } = build({
      aiResult: { ok: false, invocationId: 'i', error: { code: 'timeout', message: 'x' } },
    });

    await expect(service.propose(USER, OUTCOME, {}, NOW)).rejects.toMatchObject({
      response: { details: { reason: 'AI_UNAVAILABLE', retryable: true } },
    });
  });

  it('turns a missing model into a non-retryable 503', async () => {
    const { service } = build({
      aiResult: { ok: false, invocationId: 'i', error: { code: 'no_model', message: 'x' } },
    });

    await expect(service.propose(USER, OUTCOME, {}, NOW)).rejects.toMatchObject({
      response: { details: { reason: 'AI_UNAVAILABLE', retryable: false } },
    });
  });

  it('stores nothing when the model plan breaks the guardrails', async () => {
    const plan = goodPlan();
    // Three sessions on one day: shaped right, unworkable.
    plan.sessions = [
      { ...plan.sessions[0], scheduledStart: '2026-09-08T09:00:00.000Z' },
      { ...plan.sessions[0], scheduledStart: '2026-09-08T11:00:00.000Z' },
      { ...plan.sessions[0], scheduledStart: '2026-09-08T14:00:00.000Z' },
    ];

    const { service, prisma } = build({
      aiResult: { ok: true, invocationId: 'inv-1', output: plan },
    });

    await expect(service.propose(USER, OUTCOME, {}, NOW)).rejects.toMatchObject({
      response: { details: { reason: 'AI_UNAVAILABLE', code: 'schema', retryable: false } },
    });

    expect(prisma.workSessionPlanProposal.create).not.toHaveBeenCalled();
  });

  it('refuses a non-WORK outcome with 400 OUTCOME_NOT_WORK', async () => {
    const { service } = build({ outcome: { domain: 'FAMILY' } });

    await expect(service.propose(USER, OUTCOME, {}, NOW)).rejects.toMatchObject({
      response: { details: { reason: 'OUTCOME_NOT_WORK' } },
    });
  });

  it("answers 404 for another user's outcome", async () => {
    const { service } = build({ outcome: null });

    await expect(service.propose(USER, OUTCOME, {}, NOW)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('refuses a target date that is today or earlier', async () => {
    const { service } = build();

    await expect(
      service.propose(USER, OUTCOME, { targetDate: '2026-09-07' }, NOW),
    ).rejects.toMatchObject({ response: { details: { reason: 'TARGET_DATE_PAST' } } });
  });

  it('falls back to the profile minutes, then to 60', async () => {
    const withProfile = build({ profile: { timezone: 'UTC', weekdayMinutes: 30 } });
    await withProfile.service.proposeTemplate(USER, OUTCOME, {}, NOW);
    expect(withProfile.created.proposals[0].plan.sessions[0].durationMinutes).toBe(30);

    const noProfile = build({ profile: null });
    await noProfile.service.proposeTemplate(USER, OUTCOME, {}, NOW);
    // 60 minutes available, but a template session is capped at 45.
    expect(noProfile.created.proposals[0].plan.sessions[0].durationMinutes).toBe(45);
  });
});

describe('WorkSessionPlanningService.proposeTemplate', () => {
  it('never calls the gateway', async () => {
    const { service, ai, created } = build();

    const result = await service.proposeTemplate(USER, OUTCOME, {}, NOW);

    expect(ai.invoke).not.toHaveBeenCalled();
    expect(result.source).toBe('template');
    expect(created.proposals[0].source).toBe('TEMPLATE');
  });
});

describe('WorkSessionPlanningService.apply', () => {
  it('creates milestones, one routine and one commitment per session, atomically', async () => {
    const { service, created, prisma } = build();

    const result = await service.apply(USER, OUTCOME, { proposalId: PROPOSAL }, NOW);

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(created.milestones).toHaveLength(3);
    expect(created.routines).toHaveLength(1);
    expect(created.commitments).toHaveLength(5);
    expect(result.commitmentIds).toHaveLength(5);

    const commitment = created.commitments[0];
    expect(commitment).toMatchObject({
      domain: 'WORK',
      commitmentType: 'FOCUS_SESSION',
      status: 'PLANNED',
      outcomeId: OUTCOME,
      importance: 4,
    });
    expect(commitment.workMilestoneId).toBeTruthy();
    expect(commitment.routineId).toBeTruthy();
    expect(commitment.minimumMinutes).toBeGreaterThan(0);

    const routine = created.routines[0];
    expect(routine).toMatchObject({ domain: 'WORK', triggerType: 'EVENT', frequency: 'CUSTOM' });
    expect(routine.triggerValue).toBe('After I sit down at my desk in the morning');
    expect(routine.preferredTime).toBe('09:00');
  });

  it('creates no plan version when the outcome already has an active one', async () => {
    const { service, created } = build();

    await service.apply(USER, OUTCOME, { proposalId: PROPOSAL }, NOW);

    expect(created.planVersions).toHaveLength(0);
  });

  it('creates plan + v1 when the outcome has neither', async () => {
    const { service, created, prisma } = build({ planExists: false });

    await service.apply(USER, OUTCOME, { proposalId: PROPOSAL }, NOW);

    expect(prisma.plan.create).toHaveBeenCalled();
    expect(created.planVersions).toHaveLength(1);
    expect(created.planVersions[0]).toMatchObject({
      version: 1,
      status: 'ACTIVE',
      createdBy: 'USER',
      userApproved: true,
    });
  });

  it('marks the proposal APPLIED and audits once', async () => {
    const { service, created, prisma } = build();

    await service.apply(USER, OUTCOME, { proposalId: PROPOSAL }, NOW);

    expect(prisma.workSessionPlanProposal.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'APPLIED' }) }),
    );
    expect(created.audits).toHaveLength(1);
    expect(created.audits[0]).toMatchObject({
      action: 'work:sessions_applied',
      targetType: 'outcome',
      targetId: OUTCOME,
      meta: expect.objectContaining({ source: 'ai', edited: false, sessions: 5 }),
    });
  });

  it('records `edited: true` when a copy was sent, and applies the copy', async () => {
    const { service, created } = build();
    const edited = goodPlan();
    edited.sessions[0] = { ...edited.sessions[0], durationMinutes: 20, title: 'Edited session' };

    await service.apply(USER, OUTCOME, { proposalId: PROPOSAL, proposal: edited }, NOW);

    expect(created.audits[0].meta).toMatchObject({ edited: true });
    expect(created.commitments[0]).toMatchObject({ title: 'Edited session', fullMinutes: 20 });
  });

  it('re-validates an edited copy and rejects a day over the daily cap', async () => {
    const { service, prisma } = build();
    const edited = goodPlan();
    const day = edited.sessions[0].scheduledStart;
    edited.sessions = [
      { ...edited.sessions[0], scheduledStart: day, durationMinutes: 45 },
      { ...edited.sessions[0], scheduledStart: day, durationMinutes: 45 },
    ];

    await expect(
      service.apply(USER, OUTCOME, { proposalId: PROPOSAL, proposal: edited }, NOW),
    ).rejects.toMatchObject({
      response: { details: { reason: 'PROPOSAL_INVALID' } },
    });

    expect(prisma.commitment.create).not.toHaveBeenCalled();
  });

  it('answers 409 for a proposal that has already been applied', async () => {
    const { service } = build({ proposal: { status: 'APPLIED' } });

    await expect(
      service.apply(USER, OUTCOME, { proposalId: PROPOSAL }, NOW),
    ).rejects.toMatchObject({ response: { details: { reason: 'PROPOSAL_NOT_PENDING' } } });
  });

  it('flips an expired proposal to EXPIRED and answers 409', async () => {
    const { service, prisma } = build({
      proposal: { expiresAt: new Date(NOW.getTime() - 1000) },
    });

    await expect(
      service.apply(USER, OUTCOME, { proposalId: PROPOSAL }, NOW),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.workSessionPlanProposal.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'EXPIRED' } }),
    );
  });

  it("answers 404 for another user's proposal", async () => {
    const { service } = build({ proposal: null });

    await expect(
      service.apply(USER, OUTCOME, { proposalId: PROPOSAL }, NOW),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('WorkSessionPlanningService.getWorkPlan', () => {
  it('reads the intention and cadence off the APPLIED copy', async () => {
    const { service, prisma } = build();
    const applied = goodPlan();
    applied.implementationIntention = { when: 'After stand-up', then: 'I open the deck' };

    prisma.workSessionPlanProposal.findFirst = jest.fn(async ({ where }: any) =>
      where.status === 'APPLIED'
        ? { id: PROPOSAL, status: 'APPLIED', source: 'AI', appliedPlan: applied }
        : { id: PROPOSAL, status: 'APPLIED', source: 'AI' },
    );

    const view = await service.getWorkPlan(USER, OUTCOME);

    expect(view.implementationIntention).toEqual({
      when: 'After stand-up',
      then: 'I open the deck',
    });
    expect(view.reviewCadence).toBe('WEEKLY');
  });

  it('refuses a non-WORK outcome', async () => {
    const { service } = build({ outcome: { domain: 'HEALTH' } });

    await expect(service.getWorkPlan(USER, OUTCOME)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('the 503 it raises', () => {
  it('is a ServiceUnavailableException, not a 500', async () => {
    const { service } = build({
      aiResult: { ok: false, invocationId: 'i', error: { code: 'provider', message: 'x' } },
    });

    await expect(service.propose(USER, OUTCOME, {}, NOW)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
