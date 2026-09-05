import request from 'supertest';
import { randomUUID } from 'crypto';

import { TestContext, createTestApp, closeTestApp } from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { createMockContributorUser, authHeader, TestUser } from '../helpers/auth-mock.helper';
import { AiGatewayService } from '../../src/ai/gateway/ai-gateway.service';
import { todayInsightSchema, todayResponseSchema } from '../../src/today/today.schema';

// =============================================================================
// GET /today over HTTP (issue #38, epic E05)
// =============================================================================
//
// The ranking is proved by `nba-scorer.spec` and the composition by
// `today.service.spec`. What only a real request shows:
//
//   - the body actually satisfies `todayResponseSchema`, which the web app's
//     types mirror;
//   - `GET /today` makes ZERO gateway calls — a spy on the real injected
//     service, not a comment;
//   - `/today/insight` is a 200 whatever the gateway does, because PRD §120 is
//     a transport-level promise on this route;
//   - a user with nothing scheduled still gets three domain sections.
// =============================================================================

describe('Today (integration)', () => {
  let context: TestContext;
  let user: TestUser;
  let gateway: { invoke: jest.Mock };

  const commitmentId = randomUUID();

  const commitment = (over: Record<string, unknown> = {}) => ({
    id: commitmentId,
    userId: 'owner',
    domain: 'WORK',
    title: 'Draft the proposal storyline',
    outcomeId: null,
    planVersionId: null,
    routineId: null,
    // Relative to now so the row always lands inside today's window, whatever
    // day the suite runs.
    scheduledStart: new Date(Date.now() + 30 * 60_000),
    scheduledEnd: null,
    importance: 5,
    commitmentType: null,
    fullVersion: null,
    shortVersion: 'Write the decision statement',
    minimumVersion: 'Open the doc and write one sentence',
    fullMinutes: 25,
    shortMinutes: 10,
    minimumMinutes: 5,
    status: 'PLANNED',
    rescheduleCount: 0,
    rescheduledFromId: null,
    skipReason: null,
    skipNote: null,
    userConfirmed: false,
    startedAt: null,
    completedAt: null,
    activeSince: null,
    activeSeconds: 0,
    timerMinutes: null,
    versionUsed: null,
    minutesSpent: null,
    steps: null,
    decomposedFromId: null,
    workoutTemplateId: null,
    ritualId: null,
    familyMemberId: null,
    createdAt: new Date(Date.now() - 86_400_000),
    updatedAt: new Date(Date.now() - 86_400_000),
    ...over,
  });

  const emptyDay = () => {
    context.prismaMock.commitment.findMany.mockResolvedValue([]);
    context.prismaMock.domainMode.findMany.mockResolvedValue([]);
  };

  beforeAll(async () => {
    gateway = { invoke: jest.fn() };
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
    context.prismaMock.userProfile.findUnique.mockResolvedValue(null);
    context.prismaMock.commitment.findMany.mockResolvedValue([]);
    context.prismaMock.domainMode.findMany.mockResolvedValue([]);
    context.prismaMock.outcome.findMany.mockResolvedValue([]);
    context.prismaMock.planVersion.findMany.mockResolvedValue([]);
    context.prismaMock.evidence.findFirst.mockResolvedValue(null);
    context.prismaMock.commitment.count.mockResolvedValue(0);
    context.prismaMock.commitment.groupBy.mockResolvedValue([]);
  });

  const getToday = () =>
    request(context.app.getHttpServer())
      .get('/api/today')
      .set(authHeader(user.accessToken));

  describe('GET /api/today', () => {
    it('requires a bearer token', async () => {
      await request(context.app.getHttpServer()).get('/api/today').expect(401);
    });

    it('returns a schema-valid body for a user with nothing scheduled', async () => {
      emptyDay();

      const res = await getToday().expect(200);

      const parsed = todayResponseSchema.safeParse(res.body.data);
      expect(parsed.success).toBe(true);
      expect(res.body.data.nextBestAction).toBeNull();
      expect(res.body.data.domains).toHaveLength(3);
      expect(res.body.data.domains.map((d: { domain: string }) => d.domain)).toEqual([
        'WORK',
        'FAMILY',
        'HEALTH',
      ]);
    });

    it('returns a schema-valid body with commitments in all three domains', async () => {
      context.prismaMock.commitment.findMany.mockResolvedValue([
        commitment(),
        commitment({ id: randomUUID(), domain: 'FAMILY', title: 'Phone-free dinner' }),
        commitment({ id: randomUUID(), domain: 'HEALTH', title: 'Upper A' }),
      ]);

      const res = await getToday().expect(200);

      expect(todayResponseSchema.safeParse(res.body.data).success).toBe(true);
      expect(res.body.data.nextBestAction).not.toBeNull();
      expect(
        res.body.data.domains.map((d: { commitments: unknown[] }) => d.commitments.length),
      ).toEqual([1, 1, 1]);
      expect(res.body.data.stateLine).toContain('3 commitments today.');
    });

    // PRD §120: the guarantee is structural, not a timeout somebody could raise.
    it('makes no AI call at all', async () => {
      context.prismaMock.commitment.findMany.mockResolvedValue([commitment()]);

      await getToday().expect(200);

      expect(gateway.invoke).not.toHaveBeenCalled();
    });

    it('is reproducible across two calls with the same data', async () => {
      context.prismaMock.commitment.findMany.mockResolvedValue([
        commitment(),
        commitment({ id: randomUUID(), domain: 'FAMILY' }),
      ]);

      const first = await getToday().expect(200);
      const second = await getToday().expect(200);

      expect(first.body.data.nextBestAction.commitmentId).toBe(
        second.body.data.nextBestAction.commitmentId,
      );
    });

    it('never recommends a paused domain, but still renders its card', async () => {
      context.prismaMock.commitment.findMany.mockResolvedValue([
        commitment({ id: randomUUID(), domain: 'HEALTH', title: 'Upper A' }),
      ]);
      context.prismaMock.domainMode.findMany.mockResolvedValue([
        { domain: 'HEALTH', mode: 'PAUSE' },
      ]);

      const res = await getToday().expect(200);

      const health = res.body.data.domains.find(
        (d: { domain: string }) => d.domain === 'HEALTH',
      );
      expect(health.mode).toBe('PAUSE');
      expect(health.commitments).toHaveLength(1);
      expect(res.body.data.nextBestAction).toBeNull();
    });

    it('makes a started commitment the recommendation', async () => {
      const startedId = randomUUID();
      context.prismaMock.commitment.findMany.mockResolvedValue([
        commitment({
          id: startedId,
          status: 'STARTED',
          startedAt: new Date(Date.now() - 5 * 60_000),
          activeSince: new Date(Date.now() - 5 * 60_000),
          timerMinutes: 25,
        }),
        commitment({ id: randomUUID(), domain: 'FAMILY', importance: 5 }),
      ]);

      const res = await getToday().expect(200);

      expect(res.body.data.nextBestAction.commitmentId).toBe(startedId);
      expect(res.body.data.nextBestAction.interventionMode).toBe('ACT');
    });

    // Every query is filtered by userId, so a foreign row cannot reach a card.
    it('scopes its commitment query to the caller', async () => {
      await getToday().expect(200);

      const where = (
        context.prismaMock.commitment.findMany.mock.calls[0][0] as {
          where: { userId: string };
        }
      ).where;
      expect(where.userId).toBe(user.id);
    });
  });

  describe('GET /api/today/insight', () => {
    const getInsight = () =>
      request(context.app.getHttpServer())
        .get('/api/today/insight')
        .set(authHeader(user.accessToken));

    it('requires a bearer token', async () => {
      await request(context.app.getHttpServer()).get('/api/today/insight').expect(401);
    });

    it('answers 200 with source "template" when the gateway fails', async () => {
      context.prismaMock.commitment.findMany.mockResolvedValue([commitment()]);
      gateway.invoke.mockResolvedValue({
        ok: false,
        error: { code: 'provider_error', message: 'down' },
        invocationId: 'inv-1',
        model: null,
        latencyMs: 3,
      });

      const res = await getInsight().expect(200);

      expect(todayInsightSchema.safeParse(res.body.data).success).toBe(true);
      expect(res.body.data.source).toBe('template');
      expect(res.body.data.text.length).toBeGreaterThan(0);
    });

    it('answers 200 with source "ai" when the gateway succeeds', async () => {
      context.prismaMock.commitment.findMany.mockResolvedValue([commitment()]);
      gateway.invoke.mockResolvedValue({
        ok: true,
        invocationId: 'inv-1',
        model: 'gpt-test',
        latencyMs: 12,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        output: { text: 'One good block on the proposal is the whole day.' },
      });

      const res = await getInsight().expect(200);

      expect(res.body.data).toMatchObject({
        text: 'One good block on the proposal is the whole day.',
        source: 'ai',
      });
    });
  });
});
