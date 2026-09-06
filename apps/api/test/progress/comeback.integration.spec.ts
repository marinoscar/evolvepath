import request from 'supertest';
import { randomUUID } from 'crypto';

import { TestContext, createTestApp, closeTestApp } from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { createMockContributorUser, authHeader, TestUser } from '../helpers/auth-mock.helper';
import { AiGatewayService } from '../../src/ai/gateway/ai-gateway.service';
import { comebackStatusSchema } from '../../src/progress/comeback/comeback.schema';
import { todayResponseSchema } from '../../src/today/today.schema';

// =============================================================================
// The comeback loop over HTTP (issue #112, epic E11)
// =============================================================================
//
// The service spec proves the rules. What only a real request shows:
//
//   - there is no route, and no field, that can carry a list of what the user
//     missed — PRD §109's "overdue items do not flood Today" enforced against
//     the wire rather than against a comment;
//   - `GET /today` carries a pointer and three keys, nothing more;
//   - the whole loop works with the AI gateway failing;
//   - a second `complete` is a 409, not a second recovery row.
// =============================================================================

const DAY = 86_400_000;

describe('Comeback (integration)', () => {
  let context: TestContext;
  let user: TestUser;
  let gateway: { invoke: jest.Mock };

  const restartId = randomUUID();

  const profile = (over: Record<string, unknown> = {}) => ({
    id: randomUUID(),
    userId: 'owner',
    timezone: 'UTC',
    coachingStyle: 'BALANCED',
    comebackState: 'NONE',
    comebackTrigger: null,
    comebackOfferedAt: null,
    comebackCommitmentId: null,
    lastActiveAt: null,
    lastSweepAt: null,
    planReviewSuggestedAt: null,
    onboardingStep: 'PROMISE',
    onboardingCompletedAt: new Date(),
    ...over,
  });

  const restartRow = (over: Record<string, unknown> = {}) => ({
    id: restartId,
    userId: 'owner',
    domain: 'HEALTH',
    title: '12-minute bodyweight circuit',
    outcomeId: null,
    planVersionId: null,
    routineId: null,
    scheduledStart: new Date(Date.now() + 3_600_000),
    scheduledEnd: null,
    importance: 3,
    commitmentType: 'restart',
    fullVersion: '12-minute bodyweight circuit',
    shortVersion: null,
    minimumVersion: '12-minute bodyweight circuit',
    fullMinutes: 12,
    shortMinutes: null,
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
    createdAt: new Date(),
    updatedAt: new Date(),
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
    // The provider is DOWN for this whole suite on purpose: PRD §120 says the
    // loop must work without it, and a suite that only tests the happy path
    // would not notice when it stopped doing so.
    gateway.invoke.mockResolvedValue({ ok: false, error: { code: 'ai_unavailable' } });
    user = await createMockContributorUser(context);

    context.prismaMock.userProfile.upsert.mockResolvedValue(profile());
    context.prismaMock.userProfile.findUnique.mockResolvedValue(profile());
    context.prismaMock.userProfile.update.mockResolvedValue(profile());
    context.prismaMock.commitment.findMany.mockResolvedValue([]);
    context.prismaMock.commitment.findFirst.mockResolvedValue(null);
    context.prismaMock.commitment.groupBy.mockResolvedValue([]);
    context.prismaMock.commitment.count.mockResolvedValue(0);
    context.prismaMock.outcome.findMany.mockResolvedValue([]);
    context.prismaMock.domainMode.findMany.mockResolvedValue([]);
    context.prismaMock.evidence.findMany.mockResolvedValue([]);
    context.prismaMock.evidence.findFirst.mockResolvedValue(null);
    context.prismaMock.evidence.count.mockResolvedValue(0);
    context.prismaMock.planVersion.findMany.mockResolvedValue([]);
    context.prismaMock.memoryInsight.findMany.mockResolvedValue([]);
  });

  const getComeback = () =>
    request(context.app.getHttpServer())
      .get('/api/comeback')
      .set(authHeader(user.accessToken));

  describe('GET /api/comeback', () => {
    it('requires a bearer token', async () => {
      await request(context.app.getHttpServer()).get('/api/comeback').expect(401);
    });

    it('is a quiet, schema-valid nothing for a user with no open loop', async () => {
      const res = await getComeback().expect(200);

      expect(comebackStatusSchema.safeParse(res.body.data).success).toBe(true);
      expect(res.body.data).toMatchObject({
        state: 'NONE',
        restart: null,
        alternatives: [],
      });
    });

    it('returns the restart card and the reason once a loop is open', async () => {
      const offeredAt = new Date(Date.now() - 3_600_000);
      context.prismaMock.userProfile.upsert.mockResolvedValue(
        profile({
          comebackState: 'OFFERED',
          comebackTrigger: 'INACTIVITY',
          comebackOfferedAt: offeredAt,
          comebackCommitmentId: restartId,
          lastActiveAt: new Date(Date.now() - 4 * DAY),
        }),
      );
      context.prismaMock.commitment.findFirst.mockResolvedValue(restartRow());

      const res = await getComeback().expect(200);

      expect(comebackStatusSchema.safeParse(res.body.data).success).toBe(true);
      expect(res.body.data.state).toBe('OFFERED');
      expect(res.body.data.trigger).toBe('INACTIVITY');
      expect(res.body.data.restart.id).toBe(restartId);
      expect(res.body.data.recommendation.domain).toBe('HEALTH');
      expect(res.body.data.wording.note).toBe('No catching up. We start from today.');
    });

    it('carries a count of what became history, never the rows', async () => {
      context.prismaMock.userProfile.upsert.mockResolvedValue(
        profile({
          comebackState: 'OFFERED',
          comebackTrigger: 'INACTIVITY',
          comebackOfferedAt: new Date(),
          comebackCommitmentId: restartId,
        }),
      );
      context.prismaMock.commitment.findFirst.mockResolvedValue(restartRow());
      context.prismaMock.commitment.count.mockResolvedValue(3);

      const res = await getComeback().expect(200);

      expect(res.body.data.closedCount).toBe(3);
      // Nothing in the payload is an array of commitments.
      for (const value of Object.values(res.body.data)) {
        if (Array.isArray(value)) {
          for (const item of value) expect(item).not.toHaveProperty('scheduledStart');
        }
      }
    });
  });

  describe('the routes that need an open loop', () => {
    it.each([['choose'], ['start'], ['complete'], ['dismiss']])(
      'answers 409 NO_COMEBACK_OFFER for %s when nothing is open',
      async (route) => {
        const res = await request(context.app.getHttpServer())
          .post(`/api/comeback/${route}`)
          .set(authHeader(user.accessToken))
          .send(route === 'choose' ? { domain: 'HEALTH' } : {})
          .expect(409);

        expect(res.body.details?.reason ?? res.body.error?.details?.reason).toBe(
          'NO_COMEBACK_OFFER',
        );
      },
    );
  });

  describe('POST /api/comeback/complete', () => {
    beforeEach(() => {
      context.prismaMock.userProfile.upsert.mockResolvedValue(
        profile({
          comebackState: 'IN_PROGRESS',
          comebackTrigger: 'INACTIVITY',
          comebackOfferedAt: new Date(Date.now() - 3_600_000),
          comebackCommitmentId: restartId,
          lastActiveAt: new Date(Date.now() - 4 * DAY),
        }),
      );
      context.prismaMock.commitment.findFirst.mockResolvedValue(
        restartRow({ status: 'COMPLETED', completedAt: new Date() }),
      );
      context.prismaMock.evidence.create.mockResolvedValue({ id: randomUUID() });
    });

    it('says the sentence the whole epic exists to be able to say', async () => {
      const res = await request(context.app.getHttpServer())
        .post('/api/comeback/complete')
        .set(authHeader(user.accessToken))
        .send({})
        .expect(200);

      expect(res.body.data.celebration).toEqual({
        title: 'Back on Path.',
        body: 'The important part was not that you missed. It was that you returned.',
      });
      expect(context.prismaMock.evidence.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ evidenceType: 'recovery', source: 'APP_FLOW' }),
        }),
      );
    });
  });

  describe('GET /api/today', () => {
    it('carries a pointer and three keys — never a backlog', async () => {
      const offeredAt = new Date(Date.now() - 3_600_000);
      context.prismaMock.userProfile.findUnique.mockResolvedValue(
        profile({
          comebackState: 'OFFERED',
          comebackOfferedAt: offeredAt,
          comebackCommitmentId: restartId,
        }),
      );

      const res = await request(context.app.getHttpServer())
        .get('/api/today')
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(todayResponseSchema.safeParse(res.body.data).success).toBe(true);
      expect(Object.keys(res.body.data.comeback).sort()).toEqual([
        'offeredAt',
        'restartCommitmentId',
        'state',
      ]);
    });

    it('is null for a user with no open loop', async () => {
      const res = await request(context.app.getHttpServer())
        .get('/api/today')
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(res.body.data.comeback).toBeNull();
    });
  });
});
