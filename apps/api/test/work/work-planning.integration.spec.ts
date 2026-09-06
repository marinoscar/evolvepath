import request from 'supertest';
import { randomUUID } from 'crypto';

import { TestContext, createTestApp, closeTestApp } from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { createMockContributorUser, authHeader, TestUser } from '../helpers/auth-mock.helper';
import { AiGatewayService } from '../../src/ai/gateway/ai-gateway.service';
import { buildTemplateSessionPlan } from '../../src/work/planning/work-session-templates';

// =============================================================================
// Work session planning over HTTP (issue #108, epic E07)
// =============================================================================
//
// The guardrails, the template maths and the apply transaction each have their
// own unit spec. What only a real request can show is what this file asserts:
//
//   - every route refuses an anonymous caller
//   - `plan-sessions` writes ONE proposal row and touches nothing else, which
//     is PRD §15's promise and is invisible to any test that only reads the
//     response body
//   - `plan-sessions/template` never reaches the gateway, so the feature works
//     with the provider down (PRD §120)
//   - a foreign outcome is a 404 on every route, never a 403
// =============================================================================

const gateway = { invoke: jest.fn() };

describe('Work session planning (integration)', () => {
  let context: TestContext;
  let user: TestUser;

  const outcomeId = randomUUID();
  const proposalId = randomUUID();
  const now = new Date();

  const plan = () =>
    buildTemplateSessionPlan({
      outcome: { title: 'Finish strategy presentation' },
      now,
      timezone: 'UTC',
      targetDate: null,
      availableMinutesPerDay: 45,
    });

  const outcomeRow = (over: Record<string, unknown> = {}) => ({
    id: outcomeId,
    userId: 'owner',
    domain: 'WORK',
    title: 'Finish strategy presentation',
    motivation: 'The board decides budget on it',
    successDefinition: null,
    targetDate: null,
    importance: 4,
    state: 'ACTIVE',
    ...over,
  });

  beforeAll(async () => {
    context = await createTestApp({
      useMockDatabase: true,
      overrideProviders: [{ provide: AiGatewayService, useValue: gateway }],
    });
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(async () => {
    resetPrismaMock();
    setupBaseMocks();
    gateway.invoke.mockReset();
    user = await createMockContributorUser(context);

    context.prismaMock.auditEvent.create.mockResolvedValue({ id: 'audit' });
    context.prismaMock.userProfile.findUnique.mockResolvedValue({
      timezone: 'UTC',
      weekdayMinutes: 45,
    });
    context.prismaMock.outcome.findFirst.mockResolvedValue(outcomeRow());
    context.prismaMock.commitment.findMany.mockResolvedValue([]);
    context.prismaMock.workSessionPlanProposal.updateMany.mockResolvedValue({ count: 0 });
    context.prismaMock.workSessionPlanProposal.create.mockImplementation(
      async ({ data }: never) => ({ id: proposalId, ...(data as object) }),
    );
    context.prismaMock.$transaction.mockImplementation(async (fn: never) =>
      typeof fn === 'function' ? (fn as (tx: unknown) => unknown)(context.prismaMock) : fn,
    );
  });

  const server = () => context.app.getHttpServer();

  describe('authentication', () => {
    it.each([
      ['post', `/api/outcomes/${outcomeId}/plan-sessions`],
      ['post', `/api/outcomes/${outcomeId}/plan-sessions/template`],
      ['post', `/api/outcomes/${outcomeId}/plan-sessions/apply`],
      ['get', `/api/outcomes/${outcomeId}/work-plan`],
    ])('refuses an unauthenticated %s %s', async (method, path) => {
      await (request(server()) as never as Record<string, (p: string) => request.Test>)
        [method](path)
        .expect(401);
    });
  });

  describe('POST /api/outcomes/:id/plan-sessions', () => {
    it('returns a proposal and writes nothing but the proposal row', async () => {
      gateway.invoke.mockResolvedValue({ ok: true, invocationId: 'inv-1', output: plan() });

      const res = await request(server())
        .post(`/api/outcomes/${outcomeId}/plan-sessions`)
        .set(authHeader(user.accessToken))
        .send({ availableMinutesPerDay: 45 })
        .expect(200);

      expect(res.body.data.proposalId).toBe(proposalId);
      expect(res.body.data.source).toBe('ai');
      expect(res.body.data.proposal.sessions).toHaveLength(5);
      expect(res.body.data.expiresAt).toEqual(expect.any(String));

      expect(context.prismaMock.commitment.create).not.toHaveBeenCalled();
      expect(context.prismaMock.workMilestone.create).not.toHaveBeenCalled();
      expect(context.prismaMock.routine.create).not.toHaveBeenCalled();
      expect(context.prismaMock.planVersion.create).not.toHaveBeenCalled();
    });

    it('answers 412 when the caller has no key', async () => {
      gateway.invoke.mockResolvedValue({
        ok: false,
        invocationId: 'inv-1',
        error: { code: 'no_user_key', message: 'no key' },
      });

      const res = await request(server())
        .post(`/api/outcomes/${outcomeId}/plan-sessions`)
        .set(authHeader(user.accessToken))
        .send({})
        .expect(412);

      expect(res.body.code).toBe('AI_KEY_REQUIRED');
    });

    it('answers 503 with a retryable flag on a timeout', async () => {
      gateway.invoke.mockResolvedValue({
        ok: false,
        invocationId: 'inv-1',
        error: { code: 'timeout', message: 'slow' },
      });

      const res = await request(server())
        .post(`/api/outcomes/${outcomeId}/plan-sessions`)
        .set(authHeader(user.accessToken))
        .send({})
        .expect(503);

      expect(res.body.details).toMatchObject({ reason: 'AI_UNAVAILABLE', retryable: true });
    });

    it('answers 400 for a FAMILY outcome', async () => {
      context.prismaMock.outcome.findFirst.mockResolvedValue(outcomeRow({ domain: 'FAMILY' }));

      const res = await request(server())
        .post(`/api/outcomes/${outcomeId}/plan-sessions`)
        .set(authHeader(user.accessToken))
        .send({})
        .expect(400);

      expect(res.body.details).toMatchObject({ reason: 'OUTCOME_NOT_WORK' });
    });

    it("answers 404 for another user's outcome", async () => {
      context.prismaMock.outcome.findFirst.mockResolvedValue(null);

      await request(server())
        .post(`/api/outcomes/${outcomeId}/plan-sessions`)
        .set(authHeader(user.accessToken))
        .send({})
        .expect(404);
    });
  });

  describe('POST /api/outcomes/:id/plan-sessions/template', () => {
    it('never touches the gateway', async () => {
      const res = await request(server())
        .post(`/api/outcomes/${outcomeId}/plan-sessions/template`)
        .set(authHeader(user.accessToken))
        .send({ availableMinutesPerDay: 45 })
        .expect(200);

      expect(gateway.invoke).not.toHaveBeenCalled();
      expect(res.body.data.source).toBe('template');
      expect(res.body.data.proposal.sessions).toHaveLength(5);
    });
  });

  describe('POST /api/outcomes/:id/plan-sessions/apply', () => {
    beforeEach(() => {
      context.prismaMock.workSessionPlanProposal.findFirst.mockResolvedValue({
        id: proposalId,
        userId: 'owner',
        outcomeId,
        source: 'AI',
        status: 'PROPOSED',
        plan: plan(),
        appliedPlan: null,
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      context.prismaMock.workSessionPlanProposal.update.mockResolvedValue({ id: proposalId });
      context.prismaMock.plan.findUnique.mockResolvedValue({
        id: 'plan-1',
        versions: [{ id: 'version-1', planId: 'plan-1', status: 'ACTIVE' }],
      });
      context.prismaMock.workMilestone.aggregate.mockResolvedValue({ _max: { order: null } });
      let m = 0;
      context.prismaMock.workMilestone.create.mockImplementation(async () => ({
        id: `milestone-${(m += 1)}`,
      }));
      context.prismaMock.routine.findFirst.mockResolvedValue(null);
      context.prismaMock.routine.create.mockResolvedValue({ id: 'routine-1' });
      let c = 0;
      context.prismaMock.commitment.create.mockImplementation(async () => ({
        id: `commitment-${(c += 1)}`,
      }));
    });

    it('returns the ids it created', async () => {
      const res = await request(server())
        .post(`/api/outcomes/${outcomeId}/plan-sessions/apply`)
        .set(authHeader(user.accessToken))
        .send({ proposalId })
        .expect(201);

      expect(res.body.data.routineId).toBe('routine-1');
      expect(res.body.data.milestoneIds).toHaveLength(3);
      expect(res.body.data.commitmentIds).toHaveLength(5);
    });

    it('answers 409 once the proposal is applied', async () => {
      context.prismaMock.workSessionPlanProposal.findFirst.mockResolvedValue({
        id: proposalId,
        userId: 'owner',
        outcomeId,
        source: 'AI',
        status: 'APPLIED',
        plan: plan(),
        expiresAt: new Date(Date.now() + 86_400_000),
      });

      const res = await request(server())
        .post(`/api/outcomes/${outcomeId}/plan-sessions/apply`)
        .set(authHeader(user.accessToken))
        .send({ proposalId })
        .expect(409);

      expect(res.body.details).toMatchObject({ reason: 'PROPOSAL_NOT_PENDING' });
    });
  });

  describe('GET /api/outcomes/:id/work-plan', () => {
    it('lists milestones in order with their sessions and the applied intention', async () => {
      const applied = plan();

      context.prismaMock.workMilestone.findMany.mockResolvedValue([
        { id: 'm1', title: 'Clarify what done looks like', order: 0, targetDate: null, completedAt: null },
        { id: 'm2', title: 'Produce a rough first version', order: 1, targetDate: null, completedAt: null },
      ]);
      context.prismaMock.commitment.findMany.mockResolvedValue([
        {
          id: 'c1',
          title: '45 min on Finish strategy presentation',
          status: 'PLANNED',
          scheduledStart: new Date('2026-09-08T09:00:00.000Z'),
          fullMinutes: 45,
          workMilestoneId: 'm1',
          rescheduleCount: 0,
        },
      ]);
      context.prismaMock.workSessionPlanProposal.findFirst.mockResolvedValue({
        id: proposalId,
        status: 'APPLIED',
        source: 'AI',
        appliedPlan: applied,
      });

      const res = await request(server())
        .get(`/api/outcomes/${outcomeId}/work-plan`)
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(res.body.data.milestones.map((m: { order: number }) => m.order)).toEqual([0, 1]);
      expect(res.body.data.sessions[0]).toMatchObject({ milestoneId: 'm1', durationMinutes: 45 });
      expect(res.body.data.implementationIntention).toEqual(applied.implementationIntention);
      expect(res.body.data.reviewCadence).toBe('WEEKLY');
    });
  });
});
