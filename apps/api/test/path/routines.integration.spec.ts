import request from 'supertest';
import { randomUUID } from 'crypto';

import { TestContext, createTestApp, closeTestApp } from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { createMockContributorUser, authHeader, TestUser } from '../helpers/auth-mock.helper';

describe('Routines (integration)', () => {
  let context: TestContext;
  let user: TestUser;

  const now = new Date('2026-02-01T10:00:00.000Z');
  const planVersionId = randomUUID();
  const routineId = randomUUID();

  const planVersion = (status = 'ACTIVE') => ({
    id: planVersionId,
    userId: 'owner',
    planId: randomUUID(),
    version: 1,
    status,
  });

  const routine = (over: Record<string, unknown> = {}) => ({
    id: routineId,
    userId: 'owner',
    planVersionId,
    title: 'Morning workout',
    domain: 'HEALTH',
    triggerType: 'EVENT',
    triggerValue: 'after morning coffee',
    frequency: 'WEEKDAYS',
    daysOfWeek: [],
    preferredTime: '06:30',
    estimatedDurationMin: 45,
    minimumDurationMin: 10,
    fallbackBehavior: '10-minute circuit',
    active: true,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    ...over,
  });

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

  it('requires planVersionId on the listing', async () => {
    const res = await request(context.app.getHttpServer())
      .get('/api/routines')
      .set(authHeader(user.accessToken))
      .expect(400);

    expect(JSON.stringify(res.body)).toContain('planVersionId');
  });

  it('lists a version\'s routines', async () => {
    context.prismaMock.planVersion.findFirst.mockResolvedValue(planVersion());
    context.prismaMock.routine.findMany.mockResolvedValue([routine()]);

    const res = await request(context.app.getHttpServer())
      .get(`/api/routines?planVersionId=${planVersionId}`)
      .set(authHeader(user.accessToken))
      .expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      title: 'Morning workout',
      triggerType: 'EVENT',
      minimumDurationMin: 10,
    });
  });

  it('creates a routine on an active version', async () => {
    context.prismaMock.planVersion.findFirst.mockResolvedValue(planVersion());
    context.prismaMock.plan.findUniqueOrThrow.mockResolvedValue({
      outcome: { domain: 'HEALTH' },
    });
    context.prismaMock.routine.create.mockResolvedValue(routine());

    const res = await request(context.app.getHttpServer())
      .post('/api/routines')
      .set(authHeader(user.accessToken))
      .send({
        planVersionId,
        title: 'Morning workout',
        triggerType: 'EVENT',
        triggerValue: 'after morning coffee',
        frequency: 'WEEKDAYS',
        preferredTime: '06:30',
        estimatedDurationMin: 45,
        minimumDurationMin: 10,
        fallbackBehavior: '10-minute circuit',
      })
      .expect(201);

    expect(res.body.data.title).toBe('Morning workout');
  });

  it('rejects an EVENT trigger with no event', async () => {
    const res = await request(context.app.getHttpServer())
      .post('/api/routines')
      .set(authHeader(user.accessToken))
      .send({
        planVersionId,
        title: 'Morning workout',
        triggerType: 'EVENT',
        estimatedDurationMin: 45,
        minimumDurationMin: 10,
      })
      .expect(400);

    expect(JSON.stringify(res.body)).toContain('triggerValue');
  });

  it('updates a routine on an active version', async () => {
    context.prismaMock.routine.findFirst.mockResolvedValue(routine());
    context.prismaMock.planVersion.findFirst.mockResolvedValue(planVersion());
    context.prismaMock.routine.update.mockResolvedValue(routine({ active: false }));

    const res = await request(context.app.getHttpServer())
      .patch(`/api/routines/${routineId}`)
      .set(authHeader(user.accessToken))
      .send({ active: false })
      .expect(200);

    expect(res.body.data.active).toBe(false);
  });

  it('deletes a routine from an active version', async () => {
    context.prismaMock.routine.findFirst.mockResolvedValue(routine());
    context.prismaMock.planVersion.findFirst.mockResolvedValue(planVersion());
    context.prismaMock.routine.delete.mockResolvedValue(routine());

    await request(context.app.getHttpServer())
      .delete(`/api/routines/${routineId}`)
      .set(authHeader(user.accessToken))
      .expect(204);
  });

  // A superseded version's routines are the record of what the plan used to
  // say. Editing them would make the before side of a change become the after.
  it.each([['SUPERSEDED'], ['REJECTED']])(
    'refuses to delete a routine on a %s version',
    async (status) => {
      context.prismaMock.routine.findFirst.mockResolvedValue(routine());
      context.prismaMock.planVersion.findFirst.mockResolvedValue(planVersion(status));

      const res = await request(context.app.getHttpServer())
        .delete(`/api/routines/${routineId}`)
        .set(authHeader(user.accessToken))
        .expect(409);

      expect(res.body.code).toBe('CONFLICT');
      expect(context.prismaMock.routine.delete).not.toHaveBeenCalled();
    },
  );

  it("answers 404 for another user's routine", async () => {
    context.prismaMock.routine.findFirst.mockResolvedValue(null);

    await request(context.app.getHttpServer())
      .get(`/api/routines/${routineId}`)
      .set(authHeader(user.accessToken))
      .expect(404);
  });

  it('requires a token', async () => {
    await request(context.app.getHttpServer())
      .get(`/api/routines?planVersionId=${planVersionId}`)
      .expect(401);
  });
});
