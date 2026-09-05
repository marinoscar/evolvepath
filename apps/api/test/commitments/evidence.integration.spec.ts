import request from 'supertest';
import { randomUUID } from 'crypto';

import { TestContext, createTestApp, closeTestApp } from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { createMockContributorUser, authHeader, TestUser } from '../helpers/auth-mock.helper';

describe('Evidence and Reflections (integration)', () => {
  let context: TestContext;
  let user: TestUser;

  const evidenceId = randomUUID();
  const commitmentId = randomUUID();
  const at = new Date('2026-02-10T07:15:00.000Z');

  const evidence = (over: Record<string, unknown> = {}) => ({
    id: evidenceId,
    userId: 'owner',
    commitmentId,
    evidenceType: 'completion',
    source: 'USER_LOG',
    occurredAt: at,
    quantitativeValue: null,
    quantitativeUnit: null,
    qualitativeValue: 'Finished all sets',
    confidence: null,
    createdAt: at,
    updatedAt: at,
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

  describe('POST /api/evidence', () => {
    it('accepts a user log', async () => {
      context.prismaMock.commitment.findFirst.mockResolvedValue({ id: commitmentId });
      context.prismaMock.evidence.create.mockResolvedValue(evidence());

      const res = await request(context.app.getHttpServer())
        .post('/api/evidence')
        .set(authHeader(user.accessToken))
        .send({
          commitmentId,
          evidenceType: 'completion',
          source: 'USER_LOG',
          qualitativeValue: 'Finished all sets',
        })
        .expect(201);

      expect(res.body.data.source).toBe('USER_LOG');
    });

    // PRD §10.9. TIMER means "the system observed this"; a client that could
    // claim it could manufacture an observation.
    it.each([['TIMER'], ['WORKOUT_LOG'], ['APP_FLOW']])(
      'refuses a client-claimed %s source',
      async (source) => {
        const res = await request(context.app.getHttpServer())
          .post('/api/evidence')
          .set(authHeader(user.accessToken))
          .send({ evidenceType: 'completion', source })
          .expect(400);

        expect(JSON.stringify(res.body)).toContain('source');
        expect(context.prismaMock.evidence.create).not.toHaveBeenCalled();
      },
    );

    it("answers 404 for another user's commitment", async () => {
      context.prismaMock.commitment.findFirst.mockResolvedValue(null);

      await request(context.app.getHttpServer())
        .post('/api/evidence')
        .set(authHeader(user.accessToken))
        .send({ commitmentId, evidenceType: 'completion', source: 'USER_LOG' })
        .expect(404);
    });
  });

  describe('GET /api/evidence', () => {
    it('requires a window and caps it', async () => {
      await request(context.app.getHttpServer())
        .get('/api/evidence')
        .set(authHeader(user.accessToken))
        .expect(400);

      const res = await request(context.app.getHttpServer())
        .get('/api/evidence?from=2026-01-01T00:00:00.000Z&to=2026-12-31T00:00:00.000Z')
        .set(authHeader(user.accessToken))
        .expect(400);

      expect(JSON.stringify(res.body)).toContain('93 days');
    });

    it('lists newest first', async () => {
      context.prismaMock.evidence.findMany.mockResolvedValue([evidence()]);

      const res = await request(context.app.getHttpServer())
        .get('/api/evidence?from=2026-02-01T00:00:00.000Z&to=2026-02-28T00:00:00.000Z')
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(context.prismaMock.evidence.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { occurredAt: 'desc' } }),
      );
    });
  });

  describe('DELETE /api/evidence/:id', () => {
    it('deletes the caller\'s own row, then 404s once it is gone', async () => {
      context.prismaMock.evidence.findFirst.mockResolvedValue(evidence());
      context.prismaMock.evidence.delete.mockResolvedValue(evidence());

      await request(context.app.getHttpServer())
        .delete(`/api/evidence/${evidenceId}`)
        .set(authHeader(user.accessToken))
        .expect(204);

      context.prismaMock.evidence.findFirst.mockResolvedValue(null);

      await request(context.app.getHttpServer())
        .delete(`/api/evidence/${evidenceId}`)
        .set(authHeader(user.accessToken))
        .expect(404);
    });
  });

  describe('/api/reflections', () => {
    const reflection = (over: Record<string, unknown> = {}) => ({
      id: randomUUID(),
      userId: 'owner',
      relatedType: 'day',
      relatedId: null,
      commitmentId: null,
      userText: 'Better than yesterday',
      aiSummary: null,
      frictionTags: [],
      mood: 4,
      perceivedDifficulty: null,
      satisfaction: null,
      createdAt: at,
      updatedAt: at,
      ...over,
    });

    it('accepts a day reflection with no relatedId', async () => {
      context.prismaMock.reflection.create.mockResolvedValue(reflection());

      const res = await request(context.app.getHttpServer())
        .post('/api/reflections')
        .set(authHeader(user.accessToken))
        .send({ relatedType: 'day', userText: 'Better than yesterday', mood: 4 })
        .expect(201);

      expect(res.body.data.relatedType).toBe('day');
    });

    it('requires relatedId for a commitment reflection', async () => {
      const res = await request(context.app.getHttpServer())
        .post('/api/reflections')
        .set(authHeader(user.accessToken))
        .send({ relatedType: 'commitment', mood: 3 })
        .expect(400);

      expect(JSON.stringify(res.body)).toContain('relatedId');
    });

    it('rejects an empty reflection', async () => {
      await request(context.app.getHttpServer())
        .post('/api/reflections')
        .set(authHeader(user.accessToken))
        .send({ relatedType: 'day' })
        .expect(400);
    });

    it("answers 404 for another user's related row", async () => {
      context.prismaMock.outcome.findFirst.mockResolvedValue(null);

      await request(context.app.getHttpServer())
        .post('/api/reflections')
        .set(authHeader(user.accessToken))
        .send({ relatedType: 'outcome', relatedId: randomUUID(), mood: 3 })
        .expect(404);
    });

    it('lists reflections', async () => {
      context.prismaMock.reflection.findMany.mockResolvedValue([reflection()]);

      const res = await request(context.app.getHttpServer())
        .get('/api/reflections?relatedType=day')
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(res.body.data).toHaveLength(1);
    });

    it('requires a token', async () => {
      await request(context.app.getHttpServer()).get('/api/reflections').expect(401);
    });
  });
});
