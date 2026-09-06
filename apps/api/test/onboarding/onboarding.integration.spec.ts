import request from 'supertest';
import { randomUUID } from 'crypto';

import { TestContext, createTestApp, closeTestApp } from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { createMockContributorUser, authHeader, TestUser } from '../helpers/auth-mock.helper';
import { AiGatewayService } from '../../src/ai/gateway/ai-gateway.service';
import { buildTemplateProposal } from '../../src/onboarding/onboarding-templates';

// =============================================================================
// Onboarding over HTTP (issue #101, epic E04)
// =============================================================================
//
// The schema, the templates and the approve transaction each have their own
// unit spec. What only a real request shows is what this file asserts:
//
//   - every route refuses an anonymous caller
//   - `start` → `PATCH` → `GET` round-trips the answers
//   - `propose` writes ONE profile row and touches no domain table, which is
//     PRD §15's promise and is invisible to a test that reads only the body
//   - `skip-ai` completes with the gateway failing (PRD §120)
//   - the second `approve` is a 409
// =============================================================================

const gateway = { invoke: jest.fn() };

describe('Onboarding (integration)', () => {
  let context: TestContext;
  let user: TestUser;

  const profileId = randomUUID();
  const now = new Date();

  /** The mutable profile row the mocked Prisma layer hands back. */
  let profile: Record<string, unknown>;

  const proposal = () =>
    buildTemplateProposal(
      {
        sixMonthVision: 'Stop wasting mornings, be present at dinner, get back in shape',
        domains: ['WORK', 'FAMILY', 'HEALTH'],
        weekdayMinutes: 60,
        healthBaseline: null,
      },
      now,
      'UTC',
    );

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

    profile = {
      id: profileId,
      userId: 'owner',
      timezone: 'UTC',
      locale: 'en',
      onboardingStep: 'PROMISE',
      onboardingCompletedAt: null,
      coachingStyle: 'BALANCED',
      weekdayMinutes: null,
      obstacles: [],
      sixMonthVision: null,
      selectedDomains: [],
      domainReflections: null,
      healthBaseline: null,
      pendingProposal: null,
      confidenceScore: null,
    };

    // `UserProfileService` upserts to create and updates to patch; both are
    // pointed at the same in-memory row so a round-trip through the API reads
    // back what the previous request wrote.
    context.prismaMock.userProfile.upsert.mockImplementation(async () => profile);
    context.prismaMock.userProfile.findUnique.mockImplementation(async () => profile);
    context.prismaMock.userProfile.update.mockImplementation(async ({ data }: never) => {
      profile = { ...profile, ...(data as object) };
      return profile;
    });

    context.prismaMock.auditEvent.create.mockResolvedValue({ id: 'audit' });
    context.prismaMock.$transaction.mockImplementation(async (fn: never) =>
      typeof fn === 'function' ? (fn as (tx: unknown) => unknown)(context.prismaMock) : fn,
    );

    for (const table of [
      'bestSelfProfile',
      'outcome',
      'plan',
      'planVersion',
      'routine',
      'commitment',
      'domainMode',
    ] as const) {
      const model = context.prismaMock[table] as { create: jest.Mock; upsert: jest.Mock };
      model.create.mockImplementation(async ({ data }: never) => ({
        id: randomUUID(),
        ...(data as object),
      }));
      model.upsert.mockImplementation(async () => ({ id: randomUUID() }));
    }
  });

  const server = () => context.app.getHttpServer();

  describe('authentication', () => {
    it.each([
      ['get', '/api/onboarding'],
      ['post', '/api/onboarding/start'],
      ['patch', '/api/onboarding/answers'],
      ['post', '/api/onboarding/propose'],
      ['post', '/api/onboarding/skip-ai'],
      ['post', '/api/onboarding/confidence'],
      ['post', '/api/onboarding/approve'],
    ])('refuses an unauthenticated %s %s', async (method, path) => {
      await (request(server()) as never as Record<string, (p: string) => request.Test>)
        [method](path)
        .expect(401);
    });
  });

  describe('answers', () => {
    it('round-trips start → patch → get', async () => {
      await request(server())
        .post('/api/onboarding/start')
        .set(authHeader(user.accessToken))
        .send({ timezone: 'America/Costa_Rica', locale: 'es' })
        .expect(200)
        .expect((res) => expect(res.body.data.step).toBe('VISION'));

      await request(server())
        .patch('/api/onboarding/answers')
        .set(authHeader(user.accessToken))
        .send({
          step: 'REALITY',
          sixMonthVision: 'Stop wasting mornings',
          domains: ['WORK', 'HEALTH'],
          weekdayMinutes: 45,
        })
        .expect(200);

      const res = await request(server())
        .get('/api/onboarding')
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(res.body.data).toMatchObject({
        step: 'REALITY',
        completed: false,
        answers: {
          sixMonthVision: 'Stop wasting mornings',
          domains: ['WORK', 'HEALTH'],
          weekdayMinutes: 45,
        },
        pendingProposal: null,
      });
    });

    it('rejects an unrecognised timezone', async () => {
      const res = await request(server())
        .post('/api/onboarding/start')
        .set(authHeader(user.accessToken))
        .send({ timezone: 'Mars/Olympus' })
        .expect(400);

      expect(res.body.details).toMatchObject({ reason: 'INVALID_TIMEZONE' });
    });

    it('rejects an unknown answer key rather than silently dropping it', async () => {
      await request(server())
        .patch('/api/onboarding/answers')
        .set(authHeader(user.accessToken))
        .send({ favouriteColour: 'blue' })
        .expect(400);
    });

    it('refuses to be patched to DONE', async () => {
      await request(server())
        .patch('/api/onboarding/answers')
        .set(authHeader(user.accessToken))
        .send({ step: 'DONE' })
        .expect(400);
    });
  });

  describe('propose', () => {
    beforeEach(() => {
      profile = {
        ...profile,
        sixMonthVision: 'Stop wasting mornings',
        selectedDomains: ['WORK', 'FAMILY', 'HEALTH'],
        weekdayMinutes: 60,
      };
    });

    it('stores the proposal and creates no outcome, plan or commitment', async () => {
      gateway.invoke.mockResolvedValue({ ok: true, invocationId: 'inv-1', output: proposal() });

      const res = await request(server())
        .post('/api/onboarding/propose')
        .set(authHeader(user.accessToken))
        .send({})
        .expect(200);

      expect(res.body.data.source).toBe('ai');
      expect(res.body.data.proposal.routines).toHaveLength(3);

      expect(profile.pendingProposal).toMatchObject({ source: 'ai' });
      expect(context.prismaMock.outcome.create).not.toHaveBeenCalled();
      expect(context.prismaMock.plan.create).not.toHaveBeenCalled();
      expect(context.prismaMock.planVersion.create).not.toHaveBeenCalled();
      expect(context.prismaMock.routine.create).not.toHaveBeenCalled();
      expect(context.prismaMock.commitment.create).not.toHaveBeenCalled();
    });

    it('answers 412 when the caller has no key', async () => {
      gateway.invoke.mockResolvedValue({
        ok: false,
        invocationId: 'inv-1',
        error: { code: 'no_user_key', message: 'no key' },
      });

      const res = await request(server())
        .post('/api/onboarding/propose')
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
        .post('/api/onboarding/propose')
        .set(authHeader(user.accessToken))
        .send({})
        .expect(503);

      expect(res.body.details).toMatchObject({ reason: 'AI_UNAVAILABLE', retryable: true });
    });

    it('refuses to guess for a user who has named no area', async () => {
      profile = { ...profile, selectedDomains: [] };

      const res = await request(server())
        .post('/api/onboarding/propose')
        .set(authHeader(user.accessToken))
        .send({})
        .expect(400);

      expect(res.body.details).toMatchObject({ reason: 'ONBOARDING_INCOMPLETE' });
      expect(gateway.invoke).not.toHaveBeenCalled();
    });
  });

  describe('skip-ai and approve', () => {
    beforeEach(() => {
      profile = {
        ...profile,
        sixMonthVision: 'Stop wasting mornings',
        selectedDomains: ['WORK', 'FAMILY', 'HEALTH'],
        weekdayMinutes: 60,
      };
    });

    it('completes the flow with the provider down', async () => {
      gateway.invoke.mockResolvedValue({
        ok: false,
        invocationId: 'inv-1',
        error: { code: 'provider', message: 'down' },
      });

      const template = await request(server())
        .post('/api/onboarding/skip-ai')
        .set(authHeader(user.accessToken))
        .send({})
        .expect(200);

      expect(template.body.data.source).toBe('template');
      expect(gateway.invoke).not.toHaveBeenCalled();

      const approved = await request(server())
        .post('/api/onboarding/approve')
        .set(authHeader(user.accessToken))
        .send({ proposal: template.body.data.proposal })
        .expect(201);

      expect(approved.body.data.outcomeIds).toHaveLength(3);
      expect(approved.body.data.commitmentIds.length).toBeGreaterThanOrEqual(3);

      // The plan is attributed to the USER, because no coach wrote it.
      expect(context.prismaMock.planVersion.create.mock.calls[0][0].data.createdBy).toBe('USER');
      expect(profile.onboardingStep).toBe('DONE');
      expect(profile.onboardingCompletedAt).toBeInstanceOf(Date);
      expect(context.prismaMock.auditEvent.create).toHaveBeenCalledTimes(1);
    });

    it('answers a second approve with 409 and creates nothing more', async () => {
      const template = await request(server())
        .post('/api/onboarding/skip-ai')
        .set(authHeader(user.accessToken))
        .send({})
        .expect(200);

      await request(server())
        .post('/api/onboarding/approve')
        .set(authHeader(user.accessToken))
        .send({ proposal: template.body.data.proposal })
        .expect(201);

      const created = context.prismaMock.outcome.create.mock.calls.length;

      const res = await request(server())
        .post('/api/onboarding/approve')
        .set(authHeader(user.accessToken))
        .send({ proposal: template.body.data.proposal })
        .expect(409);

      expect(res.body.details).toMatchObject({ reason: 'ONBOARDING_ALREADY_COMPLETED' });
      expect(context.prismaMock.outcome.create).toHaveBeenCalledTimes(created);
    });

    it('rejects an edited plan that adds a fourth behaviour', async () => {
      const template = await request(server())
        .post('/api/onboarding/skip-ai')
        .set(authHeader(user.accessToken))
        .send({})
        .expect(200);

      const edited = template.body.data.proposal;
      edited.routines = [...edited.routines, { ...edited.routines[0], title: 'A fourth' }];

      const res = await request(server())
        .post('/api/onboarding/approve')
        .set(authHeader(user.accessToken))
        .send({ proposal: edited })
        .expect(400);

      expect(res.body.details.reason).toBe('PROPOSAL_INVALID');
      expect(res.body.details.rules.length).toBeGreaterThan(0);
    });
  });

  describe('confidence', () => {
    beforeEach(async () => {
      profile = {
        ...profile,
        sixMonthVision: 'Stop wasting mornings',
        selectedDomains: ['WORK', 'FAMILY', 'HEALTH'],
        weekdayMinutes: 60,
        pendingProposal: { source: 'template', proposal: proposal() },
      };
    });

    it('replaces the plan with a smaller one at 2 and records the score', async () => {
      const res = await request(server())
        .post('/api/onboarding/confidence')
        .set(authHeader(user.accessToken))
        .send({ score: 2 })
        .expect(200);

      expect(res.body.data.reproposed).toBe(true);
      expect(res.body.data.proposal.reducedFromRequest).toBe(true);
      expect(res.body.data.proposal.routines.length).toBeLessThan(3);
      expect(profile.confidenceScore).toBe(2);
    });

    it('keeps the plan at 4', async () => {
      const res = await request(server())
        .post('/api/onboarding/confidence')
        .set(authHeader(user.accessToken))
        .send({ score: 4 })
        .expect(200);

      expect(res.body.data.reproposed).toBe(false);
      expect(profile.confidenceScore).toBe(4);
    });

    it('rejects a score outside 1–5', async () => {
      await request(server())
        .post('/api/onboarding/confidence')
        .set(authHeader(user.accessToken))
        .send({ score: 9 })
        .expect(400);
    });
  });
});
