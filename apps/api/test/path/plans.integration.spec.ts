import request from 'supertest';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';

import { TestContext, createTestApp, closeTestApp } from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { createMockContributorUser, authHeader, TestUser } from '../helpers/auth-mock.helper';

// =============================================================================
// Plans and versions — HTTP contract (issue #42, epic #33)
// =============================================================================
//
// The versioning contract is the whole point of this module, and it is a
// contract about TWO rows at once — which is exactly what a service unit test
// with a mocked transaction cannot show end to end. What this file proves:
//
//   - v1 arrives ACTIVE and approved; a second plan for the same outcome is a
//     409, not a second plan.
//   - A draft is numbered max+1, links back to the active version, and clones
//     its routines — while v1 STILL RETURNS IN FULL. PRD §103's "the user can
//     inspect why the plan changed" needs both sides of the change to exist.
//   - Activation moves both rows, and a racing P2002 from the partial unique
//     index reaches the client as 409, never a 500.
//   - History is read-only: PATCHing a superseded version is a 409.
// =============================================================================

describe('Plans and plan versions (integration)', () => {
  let context: TestContext;

  const now = new Date('2026-02-01T10:00:00.000Z');
  const planId = randomUUID();
  const outcomeId = randomUUID();

  const versionRow = (over: Record<string, unknown> = {}) => ({
    id: randomUUID(),
    userId: 'owner',
    planId,
    version: 1,
    status: 'ACTIVE',
    rationale: 'Start with mornings',
    expectedWeeklyLoad: 120,
    fallbackStrategy: null,
    userApproved: true,
    createdBy: 'USER',
    previousVersionId: null,
    activeFrom: now,
    activeUntil: null,
    createdAt: now,
    updatedAt: now,
    routines: [],
    _count: { routines: 0 },
    ...over,
  });

  const planRow = (versions: Array<Record<string, unknown>>) => ({
    id: planId,
    userId: 'owner',
    outcomeId,
    createdAt: now,
    updatedAt: now,
    versions,
  });

  /** Interactive `$transaction` callbacks run against the same mock client. */
  const runTransaction = () =>
    context.prismaMock.$transaction.mockImplementation(async (arg: unknown) =>
      typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(context.prismaMock) : arg,
    );

  let user: TestUser;

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
    context.prismaMock.auditEvent.create.mockResolvedValue({ id: 'audit' });
  });

  describe('POST /api/outcomes/:id/plans', () => {
    it('creates a plan whose v1 is ACTIVE and approved', async () => {
      const v1 = versionRow();
      context.prismaMock.outcome.findFirst.mockResolvedValue({
        id: outcomeId,
        userId: user.id,
        domain: 'HEALTH',
        state: 'ACTIVE',
        plan: null,
      });
      runTransaction();
      context.prismaMock.plan.create.mockResolvedValue({ id: planId });
      context.prismaMock.planVersion.create.mockResolvedValue({ id: v1.id });
      context.prismaMock.plan.findUniqueOrThrow.mockResolvedValue(planRow([v1]));

      const res = await request(context.app.getHttpServer())
        .post(`/api/outcomes/${outcomeId}/plans`)
        .set(authHeader(user.accessToken))
        .send({ rationale: 'Start with mornings', expectedWeeklyLoad: 120 })
        .expect(201);

      expect(res.body.data).toMatchObject({
        id: planId,
        outcomeId,
        versionCount: 1,
        activeVersion: { version: 1, status: 'ACTIVE', userApproved: true, createdBy: 'USER' },
      });
    });

    it('refuses a second plan for the same outcome', async () => {
      context.prismaMock.outcome.findFirst.mockResolvedValue({
        id: outcomeId,
        userId: user.id,
        domain: 'HEALTH',
        state: 'ACTIVE',
        plan: { id: planId, versions: [] },
      });

      const res = await request(context.app.getHttpServer())
        .post(`/api/outcomes/${outcomeId}/plans`)
        .set(authHeader(user.accessToken))
        .send({})
        .expect(409);

      expect(res.body.code).toBe('CONFLICT');
    });

    it('rejects an inline routine whose minimum is longer than its full version', async () => {
      const res = await request(context.app.getHttpServer())
        .post(`/api/outcomes/${outcomeId}/plans`)
        .set(authHeader(user.accessToken))
        .send({
          routines: [
            { title: 'Workout', estimatedDurationMin: 20, minimumDurationMin: 45 },
          ],
        })
        .expect(400);

      expect(JSON.stringify(res.body)).toContain('minimumDurationMin');
    });
  });

  describe('POST /api/plans/:id/versions', () => {
    it('drafts v2 linked to v1, and v1 still returns in full', async () => {
      const v1 = versionRow({
        routines: [
          {
            id: randomUUID(),
            userId: user.id,
            planVersionId: 'pv-1',
            title: 'Morning workout',
            domain: 'HEALTH',
            triggerType: 'EVENT',
            triggerValue: 'after morning coffee',
            frequency: 'WEEKDAYS',
            daysOfWeek: [],
            preferredTime: '06:30',
            estimatedDurationMin: 45,
            minimumDurationMin: 10,
            fallbackBehavior: null,
            active: true,
            sortOrder: 0,
            createdAt: now,
            updatedAt: now,
          },
        ],
      });
      const v2 = versionRow({
        version: 2,
        status: 'DRAFT',
        userApproved: false,
        previousVersionId: v1.id,
        rationale: 'Evenings kept slipping',
        activeFrom: null,
        routines: v1.routines,
      });

      context.prismaMock.plan.findFirst.mockResolvedValue(planRow([v1]));
      context.prismaMock.planVersion.findMany.mockResolvedValue([v1]);
      runTransaction();
      context.prismaMock.planVersion.create.mockResolvedValue({ id: v2.id });
      context.prismaMock.routine.findMany.mockResolvedValue(v1.routines);
      context.prismaMock.planVersion.findUniqueOrThrow.mockResolvedValue(v2);

      const created = await request(context.app.getHttpServer())
        .post(`/api/plans/${planId}/versions`)
        .set(authHeader(user.accessToken))
        .send({ rationale: 'Evenings kept slipping' })
        .expect(201);

      expect(created.body.data).toMatchObject({
        version: 2,
        status: 'DRAFT',
        previousVersionId: v1.id,
        userApproved: false,
      });
      expect(created.body.data.routines).toHaveLength(1);

      // v1 is untouched and still readable — the before side of the change.
      context.prismaMock.planVersion.findFirst.mockResolvedValue(v1);

      const original = await request(context.app.getHttpServer())
        .get(`/api/plans/${planId}/versions/1`)
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(original.body.data).toMatchObject({ version: 1, status: 'ACTIVE' });
      expect(original.body.data.routines).toHaveLength(1);
    });

    it('requires a rationale — "why it changed" must stay renderable', async () => {
      context.prismaMock.plan.findFirst.mockResolvedValue(planRow([versionRow()]));

      const res = await request(context.app.getHttpServer())
        .post(`/api/plans/${planId}/versions`)
        .set(authHeader(user.accessToken))
        .send({ rationale: '   ' })
        .expect(400);

      expect(JSON.stringify(res.body)).toContain('rationale');
    });

    it('refuses a second draft', async () => {
      const v1 = versionRow();
      const v2 = versionRow({ version: 2, status: 'DRAFT' });
      context.prismaMock.plan.findFirst.mockResolvedValue(planRow([v2, v1]));
      context.prismaMock.planVersion.findMany.mockResolvedValue([v2, v1]);

      await request(context.app.getHttpServer())
        .post(`/api/plans/${planId}/versions`)
        .set(authHeader(user.accessToken))
        .send({ rationale: 'Another idea' })
        .expect(409);
    });
  });

  describe('POST /api/plans/:id/versions/:version/activate', () => {
    it('supersedes v1 and activates v2', async () => {
      const v1 = versionRow();
      const v2 = versionRow({ version: 2, status: 'DRAFT', previousVersionId: v1.id });

      context.prismaMock.plan.findFirst.mockResolvedValue(planRow([v2, v1]));
      context.prismaMock.planVersion.findFirst.mockImplementation(async (args: any) =>
        args?.where?.status === 'ACTIVE' ? v1 : v2,
      );
      runTransaction();
      context.prismaMock.planVersion.update.mockResolvedValue({
        ...v2,
        status: 'ACTIVE',
        activeFrom: now,
        userApproved: true,
      });

      const res = await request(context.app.getHttpServer())
        .post(`/api/plans/${planId}/versions/2/activate`)
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(res.body.data).toMatchObject({ version: 2, status: 'ACTIVE', userApproved: true });

      const [supersede, activate] = context.prismaMock.planVersion.update.mock.calls;
      expect(supersede[0].data).toMatchObject({ status: 'SUPERSEDED' });
      expect(supersede[0].data.activeUntil).toBeInstanceOf(Date);
      expect(activate[0].data).toMatchObject({ status: 'ACTIVE' });
    });

    // The invariant the partial unique index exists for, seen from the wire:
    // two versions of one plan can never both be ACTIVE, and the loser of a
    // race is told so rather than shown a 500.
    it('turns a racing unique violation into 409, not 500', async () => {
      const v1 = versionRow();
      const v2 = versionRow({ version: 2, status: 'DRAFT' });

      context.prismaMock.plan.findFirst.mockResolvedValue(planRow([v2, v1]));
      context.prismaMock.planVersion.findFirst.mockImplementation(async (args: any) =>
        args?.where?.status === 'ACTIVE' ? v1 : v2,
      );
      context.prismaMock.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      const res = await request(context.app.getHttpServer())
        .post(`/api/plans/${planId}/versions/2/activate`)
        .set(authHeader(user.accessToken))
        .expect(409);

      expect(res.body.code).toBe('CONFLICT');
    });

    it('refuses to re-activate a version that is already active', async () => {
      const v1 = versionRow();
      context.prismaMock.plan.findFirst.mockResolvedValue(planRow([v1]));
      context.prismaMock.planVersion.findFirst.mockResolvedValue(v1);

      const res = await request(context.app.getHttpServer())
        .post(`/api/plans/${planId}/versions/1/activate`)
        .set(authHeader(user.accessToken))
        .expect(409);

      expect(res.body.message).toContain('ACTIVE');
    });
  });

  describe('history is read-only', () => {
    it('refuses to PATCH a superseded version', async () => {
      const v1 = versionRow({ status: 'SUPERSEDED', activeUntil: now });
      context.prismaMock.plan.findFirst.mockResolvedValue(planRow([v1]));
      context.prismaMock.planVersion.findFirst.mockResolvedValue(v1);

      const res = await request(context.app.getHttpServer())
        .patch(`/api/plans/${planId}/versions/1`)
        .set(authHeader(user.accessToken))
        .send({ rationale: 'rewritten' })
        .expect(409);

      expect(res.body.code).toBe('CONFLICT');
      expect(context.prismaMock.planVersion.update).not.toHaveBeenCalled();
    });

    it('lists the whole history, newest first', async () => {
      const v1 = versionRow({ status: 'SUPERSEDED', activeUntil: now });
      const v2 = versionRow({ version: 2, status: 'ACTIVE', previousVersionId: v1.id });

      context.prismaMock.plan.findFirst.mockResolvedValue(planRow([v2, v1]));
      context.prismaMock.planVersion.findMany.mockResolvedValue([v2, v1]);

      const res = await request(context.app.getHttpServer())
        .get(`/api/plans/${planId}/versions`)
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(res.body.data.map((v: { version: number; status: string }) => [v.version, v.status]))
        .toEqual([
          [2, 'ACTIVE'],
          [1, 'SUPERSEDED'],
        ]);
      expect(res.body.data[1].activeUntil).toBe(now.toISOString());
    });
  });

  describe('ownership', () => {
    it("answers 404 for another user's plan", async () => {
      context.prismaMock.plan.findFirst.mockResolvedValue(null);

      const res = await request(context.app.getHttpServer())
        .get(`/api/plans/${planId}`)
        .set(authHeader(user.accessToken))
        .expect(404);

      expect(res.body.code).toBe('NOT_FOUND');
      expect(context.prismaMock.plan.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: planId, userId: user.id } }),
      );
    });

    it('requires a token', async () => {
      await request(context.app.getHttpServer()).get(`/api/plans/${planId}`).expect(401);
    });
  });
});
