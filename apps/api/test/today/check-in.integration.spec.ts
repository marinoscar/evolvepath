import request from 'supertest';
import { randomUUID } from 'crypto';

import { TestContext, createTestApp, closeTestApp } from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { createMockContributorUser, authHeader, TestUser } from '../helpers/auth-mock.helper';
import { AiGatewayService } from '../../src/ai/gateway/ai-gateway.service';
import { todayResponseSchema } from '../../src/today/today.schema';

// =============================================================================
// The check-in and the end-of-day reflection over HTTP (issue #43, epic E05)
// =============================================================================
//
// What only a real request shows: that the check-in a user taps actually reaches
// the scorer through the `CHECK_IN_READER` seam — the thing #38 could not prove
// on its own, because until this issue the reader always answered null.
// =============================================================================

describe('Check-in and day reflection (integration)', () => {
  let context: TestContext;
  let user: TestUser;
  let gateway: { invoke: jest.Mock };

  const commitment = (over: Record<string, unknown> = {}) => ({
    id: randomUUID(),
    userId: 'owner',
    domain: 'WORK',
    title: 'Draft the proposal storyline',
    outcomeId: null,
    planVersionId: null,
    routineId: null,
    scheduledStart: new Date(Date.now() + 30 * 60_000),
    scheduledEnd: null,
    importance: 5,
    commitmentType: null,
    fullVersion: 'Draft the storyline',
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
    ritualId: null,
    familyMemberId: null,
    createdAt: new Date(Date.now() - 86_400_000),
    updatedAt: new Date(Date.now() - 86_400_000),
    ...over,
  });

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
    context.prismaMock.dailyCheckIn.findUnique.mockResolvedValue(null);
    context.prismaMock.auditEvent.create.mockResolvedValue({ id: 'audit' });
  });

  const auth = () => authHeader(user.accessToken);

  describe('POST /api/today/check-in', () => {
    it('records the feeling and reports the local date', async () => {
      context.prismaMock.dailyCheckIn.upsert.mockResolvedValue({
        id: 'ci-1',
        dateLocal: '2026-03-02',
        feel: 'PACKED',
        updatedAt: new Date('2026-03-02T10:00:00.000Z'),
      });

      const res = await request(context.app.getHttpServer())
        .post('/api/today/check-in')
        .set(auth())
        .send({ feel: 'PACKED' })
        .expect(200);

      expect(res.body.data).toMatchObject({ dateLocal: '2026-03-02', feel: 'PACKED' });
    });

    it('rejects an unknown feeling with a 400', async () => {
      await request(context.app.getHttpServer())
        .post('/api/today/check-in')
        .set(auth())
        .send({ feel: 'EXHAUSTED' })
        .expect(400);

      expect(context.prismaMock.dailyCheckIn.upsert).not.toHaveBeenCalled();
    });

    it('requires a bearer token', async () => {
      await request(context.app.getHttpServer())
        .post('/api/today/check-in')
        .send({ feel: 'NORMAL' })
        .expect(401);
    });

    it('writes an audit row without free text', async () => {
      context.prismaMock.dailyCheckIn.upsert.mockResolvedValue({
        id: 'ci-1',
        dateLocal: '2026-03-02',
        feel: 'NORMAL',
        updatedAt: new Date(),
      });

      await request(context.app.getHttpServer())
        .post('/api/today/check-in')
        .set(auth())
        .send({ feel: 'NORMAL' })
        .expect(200);

      expect(context.prismaMock.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'today:check_in' }),
      });
    });
  });

  describe('GET /api/today/check-in', () => {
    it('is null before the user taps a chip', async () => {
      const res = await request(context.app.getHttpServer())
        .get('/api/today/check-in')
        .set(auth())
        .expect(200);

      expect(res.body.data).toBeNull();
    });

    // A foreign row can never be returned: the lookup is keyed by (userId, day).
    it('scopes the lookup to the caller', async () => {
      await request(context.app.getHttpServer())
        .get('/api/today/check-in')
        .set(auth())
        .expect(200);

      const where = (
        context.prismaMock.dailyCheckIn.findUnique.mock.calls[0][0] as {
          where: { userId_dateLocal: { userId: string } };
        }
      ).where;
      expect(where.userId_dateLocal.userId).toBe(user.id);
    });
  });

  // The thing #38 could not prove on its own: the reader seam is now wired to
  // real data, so a tap actually changes what the engine recommends.
  describe('the check-in reaches the scorer', () => {
    it('sizes the next best action down to the minimum after LOW_ENERGY', async () => {
      context.prismaMock.commitment.findMany.mockResolvedValue([commitment()]);

      const before = await request(context.app.getHttpServer())
        .get('/api/today')
        .set(auth())
        .expect(200);

      expect(before.body.data.checkIn).toBeNull();
      expect(before.body.data.nextBestAction.version).toBe('full');
      expect(before.body.data.nextBestAction.durationMinutes).toBe(25);

      context.prismaMock.dailyCheckIn.findUnique.mockResolvedValue({
        id: 'ci-1',
        dateLocal: '2026-03-02',
        feel: 'LOW_ENERGY',
        updatedAt: new Date(),
      });

      const after = await request(context.app.getHttpServer())
        .get('/api/today')
        .set(auth())
        .expect(200);

      expect(todayResponseSchema.safeParse(after.body.data).success).toBe(true);
      expect(after.body.data.checkIn).toEqual({ feel: 'LOW_ENERGY' });
      expect(after.body.data.nextBestAction.version).toBe('minimum');
      expect(after.body.data.nextBestAction.durationMinutes).toBe(5);
      expect(after.body.data.nextBestAction.interventionMode).toBe('RECONNECT');
    });
  });

  describe('the check-in invalidates the cached insight', () => {
    it('makes the next /today/insight call the gateway again', async () => {
      context.prismaMock.commitment.findMany.mockResolvedValue([commitment()]);
      gateway.invoke.mockResolvedValue({
        ok: true,
        invocationId: 'inv-1',
        model: 'gpt-test',
        latencyMs: 5,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        output: { text: 'One good block and the day is made.' },
      });

      await request(context.app.getHttpServer())
        .get('/api/today/insight')
        .set(auth())
        .expect(200);
      await request(context.app.getHttpServer())
        .get('/api/today/insight')
        .set(auth())
        .expect(200);

      // Cached: the second read cost nothing.
      expect(gateway.invoke).toHaveBeenCalledTimes(1);

      context.prismaMock.dailyCheckIn.upsert.mockResolvedValue({
        id: 'ci-1',
        dateLocal: '2026-03-02',
        feel: 'LOW_ENERGY',
        updatedAt: new Date(),
      });
      await request(context.app.getHttpServer())
        .post('/api/today/check-in')
        .set(auth())
        .send({ feel: 'LOW_ENERGY' })
        .expect(200);

      await request(context.app.getHttpServer())
        .get('/api/today/insight')
        .set(auth())
        .expect(200);

      expect(gateway.invoke).toHaveBeenCalledTimes(2);
    });
  });

  describe('POST /api/today/reflection', () => {
    it('creates a day reflection tagged with the quick option', async () => {
      context.prismaMock.reflection.create.mockResolvedValue({
        id: 'r1',
        userText: 'evenings are chaos',
        frictionTags: ['TOO_MUCH'],
        createdAt: new Date('2026-03-02T23:00:00.000Z'),
      });

      const res = await request(context.app.getHttpServer())
        .post('/api/today/reflection')
        .set(auth())
        .send({ quickOption: 'TOO_MUCH', text: 'evenings are chaos' })
        .expect(201);

      expect(res.body.data).toMatchObject({
        quickOption: 'TOO_MUCH',
        text: 'evenings are chaos',
      });

      const data = context.prismaMock.reflection.create.mock.calls[0][0].data as {
        relatedType: string;
        frictionTags: string[];
      };
      expect(data.relatedType).toBe('day');
      expect(data.frictionTags).toEqual(['TOO_MUCH']);
    });

    it('rejects an option outside the list', async () => {
      await request(context.app.getHttpServer())
        .post('/api/today/reflection')
        .set(auth())
        .send({ quickOption: 'TIRED' })
        .expect(400);
    });

    it('rejects text past the cap', async () => {
      await request(context.app.getHttpServer())
        .post('/api/today/reflection')
        .set(auth())
        .send({ quickOption: 'OTHER', text: 'x'.repeat(1001) })
        .expect(400);
    });

    it('requires a bearer token', async () => {
      await request(context.app.getHttpServer())
        .post('/api/today/reflection')
        .send({ quickOption: 'OTHER' })
        .expect(401);
    });
  });

  describe('GET /api/today/reflection', () => {
    it('is null when the user has said nothing today', async () => {
      context.prismaMock.reflection.findFirst.mockResolvedValue(null);

      const res = await request(context.app.getHttpServer())
        .get('/api/today/reflection')
        .set(auth())
        .expect(200);

      expect(res.body.data).toBeNull();
    });

    it('returns the newest one', async () => {
      context.prismaMock.reflection.findFirst.mockResolvedValue({
        id: 'r2',
        userText: null,
        frictionTags: ['PLAN_WORKED'],
        createdAt: new Date(),
      });

      const res = await request(context.app.getHttpServer())
        .get('/api/today/reflection')
        .set(auth())
        .expect(200);

      expect(res.body.data).toMatchObject({ quickOption: 'PLAN_WORKED', text: null });
    });
  });
});
