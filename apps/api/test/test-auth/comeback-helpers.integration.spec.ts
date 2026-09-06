import request from 'supertest';
import { randomUUID } from 'crypto';

import { TestContext, createTestApp, closeTestApp } from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { createMockContributorUser, authHeader, TestUser } from '../helpers/auth-mock.helper';

// =============================================================================
// The two helpers E11 needs to drive its loop (issue #112, epic E11)
// =============================================================================
//
// `simulate-idle` shifts a user's own history backwards; `run-job comeback`
// runs the real sweep for one user. Both exist only outside production — the
// module is not registered there at all, and `TestEnvironmentGuard` refuses
// them independently of that.
//
// The comeback job is added to the EXISTING `run-job` enum rather than as a
// second route, following that file's stated rule: one route, one enum, so a
// harness learns one shape.
// =============================================================================

describe('Test-auth comeback helpers (integration)', () => {
  let context: TestContext;
  let user: TestUser;

  const userId = randomUUID();

  beforeAll(async () => {
    context = await createTestApp({ useMockDatabase: true });
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(async () => {
    resetPrismaMock();
    setupBaseMocks();
    user = await createMockContributorUser(context);
    context.prismaMock.$executeRaw.mockResolvedValue(3);
    context.prismaMock.userProfile.upsert.mockResolvedValue({});
    context.prismaMock.commitment.findMany.mockResolvedValue([]);
    context.prismaMock.commitment.count.mockResolvedValue(0);
    context.prismaMock.evidence.count.mockResolvedValue(0);
  });

  describe('POST /api/auth/test/simulate-idle', () => {
    it('shifts the named user’s rows and stamps their last activity', async () => {
      context.prismaMock.user.findUnique.mockResolvedValue({ id: userId });

      const res = await request(context.app.getHttpServer())
        .post('/api/auth/test/simulate-idle')
        .send({ email: 'momentum@test.local', idleDays: 4 })
        .expect(201);

      expect(res.body.data ?? res.body).toMatchObject({
        userId,
        shiftedCommitments: 3,
        shiftedEvidence: 3,
      });
      expect(context.prismaMock.userProfile.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId } }),
      );
    });

    it('refuses an idle window outside 1–60 days', async () => {
      await request(context.app.getHttpServer())
        .post('/api/auth/test/simulate-idle')
        .send({ email: 'momentum@test.local', idleDays: 0 })
        .expect(400);

      await request(context.app.getHttpServer())
        .post('/api/auth/test/simulate-idle')
        .send({ email: 'momentum@test.local', idleDays: 61 })
        .expect(400);
    });

    it('is a 404 for an unknown user rather than a silent no-op', async () => {
      context.prismaMock.user.findUnique.mockResolvedValue(null);

      await request(context.app.getHttpServer())
        .post('/api/auth/test/simulate-idle')
        .send({ email: 'nobody@test.local', idleDays: 4 })
        .expect(404);
    });
  });

  describe('POST /api/auth/test/run-job', () => {
    it('runs the comeback sweep for one named user', async () => {
      // Only the email lookup is redirected: the JWT guard resolves the
      // CALLER through the same method, and a blanket mock would 401 the
      // request before the route ran.
      const authenticated = context.prismaMock.user.findUnique.getMockImplementation();
      context.prismaMock.user.findUnique.mockImplementation(async (args: any) =>
        args?.where?.email === 'momentum@test.local'
          ? { id: userId }
          : authenticated?.(args),
      );
      context.prismaMock.userProfile.upsert.mockResolvedValue({
        userId,
        timezone: 'UTC',
        coachingStyle: 'BALANCED',
        comebackState: 'NONE',
        comebackTrigger: null,
        comebackOfferedAt: null,
        comebackCommitmentId: null,
        lastActiveAt: null,
        planReviewSuggestedAt: null,
      });
      context.prismaMock.userProfile.update.mockResolvedValue({});

      const res = await request(context.app.getHttpServer())
        .post('/api/auth/test/run-job')
        .set(authHeader(user.accessToken))
        .send({ job: 'comeback', email: 'momentum@test.local' })
        .expect(201);

      const body = res.body.data ?? res.body;
      expect(body.job).toBe('comeback');
      expect(body).toHaveProperty('closedCount');
      expect(body).toHaveProperty('comebackState');
    });

    it('rejects a job name that is not in the enum', async () => {
      await request(context.app.getHttpServer())
        .post('/api/auth/test/run-job')
        .set(authHeader(user.accessToken))
        .send({ job: 'not-a-job' })
        .expect(400);
    });
  });
});
