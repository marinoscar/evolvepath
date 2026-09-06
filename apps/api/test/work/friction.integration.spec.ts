import request from 'supertest';
import { randomUUID } from 'crypto';

import { TestContext, createTestApp, closeTestApp } from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { createMockContributorUser, authHeader, TestUser } from '../helpers/auth-mock.helper';
import { AiGatewayService } from '../../src/ai/gateway/ai-gateway.service';
import { SafetyPolicyService } from '../../src/coach/safety/safety-policy.service';

// =============================================================================
// The friction question and the ladder over HTTP (issue #116, epic E07)
// =============================================================================
//
// The detector's rule and the answer routing have their own specs. What only a
// real request can show is that the two meet correctly on `GET /today`: two
// reschedules produce level 3, the card carries the assessment, the next best
// action goes into DIAGNOSE, and a FAMILY card carries `avoidance: null`.
// =============================================================================

const gateway = { invoke: jest.fn() };
const safety = { evaluate: jest.fn() };

describe('Friction and the intervention ladder (integration)', () => {
  let context: TestContext;
  let user: TestUser;

  const commitmentId = randomUUID();
  const outcomeId = randomUUID();
  const now = new Date();

  const commitmentRow = (over: Record<string, unknown> = {}) => ({
    id: commitmentId,
    userId: 'owner',
    domain: 'WORK',
    title: 'Finish the strategy presentation',
    outcomeId,
    planVersionId: null,
    routineId: null,
    scheduledStart: now,
    scheduledEnd: null,
    importance: 4,
    commitmentType: 'FOCUS_SESSION',
    fullVersion: null,
    shortVersion: null,
    minimumVersion: 'Open the deck and write one line',
    fullMinutes: 25,
    shortMinutes: null,
    minimumMinutes: 5,
    status: 'PLANNED',
    rescheduleCount: 2,
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
    workMilestoneId: null,
    ritualId: null,
    familyMemberId: null,
    // Created today: the ONLY active signal in this fixture is the two moves,
    // so a level-3 assertion is about the reschedule rule and nothing else.
    createdAt: now,
    updatedAt: now,
    ...over,
  });

  beforeAll(async () => {
    context = await createTestApp({
      useMockDatabase: true,
      overrideProviders: [
        { provide: AiGatewayService, useValue: gateway },
        { provide: SafetyPolicyService, useValue: safety },
      ],
    });
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(async () => {
    resetPrismaMock();
    setupBaseMocks();
    gateway.invoke.mockReset();
    safety.evaluate.mockReset();
    safety.evaluate.mockResolvedValue({
      decision: 'allow',
      category: 'none',
      source: 'precheck',
    });
    user = await createMockContributorUser(context);

    context.prismaMock.auditEvent.create.mockResolvedValue({ id: 'audit' });
    context.prismaMock.userProfile.findUnique.mockResolvedValue({
      timezone: 'UTC',
      coachingStyle: 'BALANCED',
    });
    context.prismaMock.commitment.findFirst.mockResolvedValue(commitmentRow());
    context.prismaMock.commitment.findMany.mockResolvedValue([]);
    context.prismaMock.outcome.findFirst.mockResolvedValue({
      id: outcomeId,
      userId: 'owner',
      domain: 'WORK',
      title: 'Win the budget',
      motivation: 'The board decides budget on it',
      createdAt: new Date(now.getTime() - 30 * 86_400_000),
    });
    context.prismaMock.outcome.findMany.mockResolvedValue([
      { id: outcomeId, createdAt: new Date(now.getTime() - 30 * 86_400_000) },
    ]);
    context.prismaMock.evidence.findMany.mockResolvedValue([]);
    context.prismaMock.reflection.findMany.mockResolvedValue([]);
    context.prismaMock.reflection.create.mockResolvedValue({ id: 'reflection-1' });
    context.prismaMock.obstacle.findFirst.mockResolvedValue(null);
    context.prismaMock.obstacle.create.mockResolvedValue({ id: 'obstacle-1' });
    context.prismaMock.$transaction.mockImplementation(async (fn: never) =>
      typeof fn === 'function' ? (fn as (tx: unknown) => unknown)(context.prismaMock) : fn,
    );
  });

  const server = () => context.app.getHttpServer();

  describe('authentication', () => {
    it.each([
      ['post', `/api/commitments/${commitmentId}/friction`],
      ['get', `/api/commitments/${commitmentId}/avoidance`],
    ])('refuses an unauthenticated %s %s', async (method, path) => {
      await (request(server()) as never as Record<string, (p: string) => request.Test>)
        [method](path)
        .expect(401);
    });
  });

  describe('GET /api/commitments/:id/avoidance', () => {
    it('reads level 3 off two reschedules', async () => {
      const res = await request(server())
        .get(`/api/commitments/${commitmentId}/avoidance`)
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(res.body.data).toMatchObject({
        level: 3,
        interventionType: 'FRICTION_DIAGNOSIS',
        signals: ['RESCHEDULED_TWICE'],
        suggestedAction: 'FRICTION_QUESTION',
      });
    });

    it('drops to DECOMPOSE once the question has been answered', async () => {
      context.prismaMock.reflection.findMany.mockResolvedValue([
        { commitmentId, frictionTags: ['TOO_BIG'] },
      ]);

      const res = await request(server())
        .get(`/api/commitments/${commitmentId}/avoidance`)
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(res.body.data.suggestedAction).toBe('DECOMPOSE');
    });

    it('stays at level 0 after a single reschedule', async () => {
      context.prismaMock.commitment.findFirst.mockResolvedValue(
        commitmentRow({ rescheduleCount: 1 }),
      );

      const res = await request(server())
        .get(`/api/commitments/${commitmentId}/avoidance`)
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(res.body.data.level).toBe(0);
      expect(res.body.data.signals).toEqual([]);
    });

    it("answers 404 for another user's commitment", async () => {
      context.prismaMock.commitment.findFirst.mockResolvedValue(null);

      await request(server())
        .get(`/api/commitments/${commitmentId}/avoidance`)
        .set(authHeader(user.accessToken))
        .expect(404);
    });
  });

  describe('POST /api/commitments/:id/friction', () => {
    it('routes "it feels too big" to decomposition and records the obstacle', async () => {
      gateway.invoke.mockResolvedValue({
        ok: false,
        invocationId: 'inv-1',
        error: { code: 'network', message: 'down' },
      });

      const res = await request(server())
        .post(`/api/commitments/${commitmentId}/friction`)
        .set(authHeader(user.accessToken))
        .send({ answer: 'TOO_BIG' })
        .expect(200);

      expect(res.body.data.level).toBe(3);
      expect(res.body.data.intervention).toMatchObject({
        interventionType: 'DECOMPOSITION',
        source: 'template',
      });
      expect(res.body.data.intervention.recommendedAction.durationMinutes).toBeLessThanOrEqual(10);

      expect(context.prismaMock.reflection.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ frictionTags: ['TOO_BIG'] }),
        }),
      );
      expect(context.prismaMock.obstacle.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'TASK_TOO_LARGE', observedCount: 1 }),
        }),
      );
    });

    it('answers 400 for OTHER with no text', async () => {
      await request(server())
        .post(`/api/commitments/${commitmentId}/friction`)
        .set(authHeader(user.accessToken))
        .send({ answer: 'OTHER' })
        .expect(400);
    });

    it('a safety redirect returns the copy and writes nothing', async () => {
      safety.evaluate.mockResolvedValue({
        decision: 'redirect',
        category: 'crisis',
        source: 'precheck',
        userFacingNote: 'Please talk to someone who can help.',
      });

      const res = await request(server())
        .post(`/api/commitments/${commitmentId}/friction`)
        .set(authHeader(user.accessToken))
        .send({ answer: 'OTHER', text: 'a distressing sentence' })
        .expect(200);

      expect(res.body.data.intervention.userMessage).toBe('Please talk to someone who can help.');
      expect(res.body.data.obstacleId).toBeNull();
      expect(context.prismaMock.reflection.create).not.toHaveBeenCalled();
      expect(gateway.invoke).not.toHaveBeenCalled();
    });

    it('answers 400 for a FAMILY commitment', async () => {
      context.prismaMock.commitment.findFirst.mockResolvedValue(
        commitmentRow({ domain: 'FAMILY' }),
      );

      const res = await request(server())
        .post(`/api/commitments/${commitmentId}/friction`)
        .set(authHeader(user.accessToken))
        .send({ answer: 'TIRED' })
        .expect(400);

      expect(res.body.details).toMatchObject({ reason: 'COMMITMENT_NOT_WORK' });
    });
  });

  describe('GET /api/today', () => {
    it('carries the assessment on the WORK card and drives DIAGNOSE', async () => {
      context.prismaMock.commitment.findMany.mockResolvedValue([commitmentRow()]);
      context.prismaMock.domainMode.findMany.mockResolvedValue([]);
      context.prismaMock.dailyCheckIn.findUnique.mockResolvedValue(null);
      context.prismaMock.dailyCheckIn.findFirst.mockResolvedValue(null);
      context.prismaMock.evidence.findFirst.mockResolvedValue(null);
      context.prismaMock.outcome.findMany.mockResolvedValue([
        {
          id: outcomeId,
          motivation: 'The board decides budget on it',
          successDefinition: null,
          targetDate: null,
          createdAt: new Date(now.getTime() - 30 * 86_400_000),
        },
      ]);

      const res = await request(server())
        .get('/api/today')
        .set(authHeader(user.accessToken))
        .expect(200);

      const work = res.body.data.domains.find(
        (d: { domain: string }) => d.domain === 'WORK',
      );

      expect(work.commitments[0].avoidance).toMatchObject({
        level: 3,
        suggestedAction: 'FRICTION_QUESTION',
      });
      expect(res.body.data.nextBestAction.interventionMode).toBe('DIAGNOSE');
    });
  });
});
