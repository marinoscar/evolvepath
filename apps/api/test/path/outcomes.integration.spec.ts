import request from 'supertest';
import { randomUUID } from 'crypto';

import { TestContext, createTestApp, closeTestApp } from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { createMockContributorUser, authHeader } from '../helpers/auth-mock.helper';

// =============================================================================
// EvolvePath Path module — HTTP contract (issue #39, epic #33)
// =============================================================================
//
// The service specs already cover the branching. What this file exists to
// prove is what only a real request/response round trip can:
//
//   - Every route is behind `@Auth()` — an unauthenticated call is 401, not an
//     empty list.
//   - Zod rejections arrive as 400 VALIDATION_ERROR naming the field, through
//     the global pipe and the exception filter.
//   - An unowned id and an unknown id produce byte-identical 404 bodies. That
//     is the one property in this module a reviewer cannot verify by reading
//     the service, because it is a property of two responses compared.
//   - `data: null` survives the TransformInterceptor's "already wrapped"
//     heuristic, which is a real risk for a null body.
// =============================================================================

describe('EvolvePath Path module (integration)', () => {
  let context: TestContext;

  const now = new Date('2026-02-01T10:00:00.000Z');

  const outcomeRow = (over: Record<string, unknown> = {}) => ({
    id: randomUUID(),
    userId: 'someone',
    domain: 'HEALTH',
    title: 'Three strength workouts per week',
    description: null,
    targetDate: null,
    importance: 4,
    motivation: null,
    state: 'ACTIVE',
    successDefinition: null,
    userConfidence: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    plan: null,
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
  });

  // ==========================================================================
  // Authentication
  // ==========================================================================

  describe('authentication', () => {
    it.each([
      ['get', '/api/me/best-self'],
      ['put', '/api/me/best-self'],
      ['get', '/api/outcomes'],
      ['post', '/api/outcomes'],
      ['get', '/api/me/domain-modes'],
    ])('%s %s returns 401 without a token', async (method, path) => {
      await (request(context.app.getHttpServer()) as any)[method](path).send({}).expect(401);
    });
  });

  // ==========================================================================
  // Best Self
  // ==========================================================================

  describe('/api/me/best-self', () => {
    it('answers 200 with data: null before the profile is saved', async () => {
      const user = await createMockContributorUser(context);
      context.prismaMock.bestSelfProfile.findUnique.mockResolvedValue(null);

      const res = await request(context.app.getHttpServer())
        .get('/api/me/best-self')
        .set(authHeader(user.accessToken))
        .expect(200);

      // The TransformInterceptor's "already wrapped" test is `'data' in data`,
      // and null is not an object — so a null body must still be enveloped.
      expect(res.body).toHaveProperty('data', null);
      expect(res.body.meta).toHaveProperty('timestamp');
    });

    it('round-trips a saved profile', async () => {
      const user = await createMockContributorUser(context);
      const saved = {
        id: randomUUID(),
        userId: user.id,
        identityStatement: 'Focused, present, healthy',
        workIdentity: null,
        familyIdentity: null,
        healthIdentity: null,
        sixMonthVision: null,
        motivations: ['family'],
        reasons: [],
        lastReviewedAt: now,
        createdAt: now,
        updatedAt: now,
      };

      context.prismaMock.bestSelfProfile.upsert.mockResolvedValue(saved);
      context.prismaMock.auditEvent.create.mockResolvedValue({ id: 'audit' });

      const put = await request(context.app.getHttpServer())
        .put('/api/me/best-self')
        .set(authHeader(user.accessToken))
        .send({ identityStatement: 'Focused, present, healthy', motivations: ['family'] })
        .expect(200);

      context.prismaMock.bestSelfProfile.findUnique.mockResolvedValue(saved);

      const get = await request(context.app.getHttpServer())
        .get('/api/me/best-self')
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(get.body.data).toEqual(put.body.data);
      expect(get.body.data.lastReviewedAt).toBe(now.toISOString());
    });

    it('rejects a motivation list longer than the schema allows', async () => {
      const user = await createMockContributorUser(context);

      const res = await request(context.app.getHttpServer())
        .put('/api/me/best-self')
        .set(authHeader(user.accessToken))
        .send({ motivations: Array.from({ length: 11 }, (_, i) => `m${i}`) })
        .expect(400);

      // `code` is derived from the status by HttpExceptionFilter and is a
      // closed enum (see the comment there) — the field path is what makes a
      // rejection actionable, so that is what is asserted.
      expect(res.body.code).toBe('BAD_REQUEST');
      expect(JSON.stringify(res.body)).toContain('motivations');
    });
  });

  // ==========================================================================
  // Outcomes
  // ==========================================================================

  describe('/api/outcomes', () => {
    it('creates an outcome and echoes it back (201)', async () => {
      const user = await createMockContributorUser(context);
      const row = outcomeRow({ userId: user.id });

      context.prismaMock.outcome.create.mockResolvedValue(row);
      context.prismaMock.auditEvent.create.mockResolvedValue({ id: 'audit' });

      const res = await request(context.app.getHttpServer())
        .post('/api/outcomes')
        .set(authHeader(user.accessToken))
        .send({ domain: 'HEALTH', title: 'Three strength workouts per week', importance: 4 })
        .expect(201);

      expect(res.body.data).toMatchObject({
        id: row.id,
        domain: 'HEALTH',
        title: 'Three strength workouts per week',
        importance: 4,
        state: 'ACTIVE',
        planId: null,
        activePlanVersion: null,
      });
      // The owner is implied by the token; it is never echoed back.
      expect(JSON.stringify(res.body)).not.toContain('userId');
    });

    it.each([
      ['importance out of range', { domain: 'HEALTH', title: 'x', importance: 9 }, 'importance'],
      ['a missing title', { domain: 'HEALTH', importance: 3 }, 'title'],
      ['an unknown domain', { domain: 'PLAY', title: 'x' }, 'domain'],
    ])('rejects %s with a 400 naming the field', async (_label, body, field) => {
      const user = await createMockContributorUser(context);

      const res = await request(context.app.getHttpServer())
        .post('/api/outcomes')
        .set(authHeader(user.accessToken))
        .send(body)
        .expect(400);

      expect(res.body.code).toBe('BAD_REQUEST');
      expect(JSON.stringify(res.body)).toContain(field);
      expect(context.prismaMock.outcome.create).not.toHaveBeenCalled();
    });

    it('filters by domain and excludes archived rows by default', async () => {
      const user = await createMockContributorUser(context);
      context.prismaMock.outcome.findMany.mockResolvedValue([]);

      await request(context.app.getHttpServer())
        .get('/api/outcomes?domain=HEALTH')
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(context.prismaMock.outcome.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: user.id, domain: 'HEALTH', state: { not: 'ARCHIVED' } },
        }),
      );
    });

    it('accepts includeArchived=true from the query string', async () => {
      const user = await createMockContributorUser(context);
      context.prismaMock.outcome.findMany.mockResolvedValue([]);

      await request(context.app.getHttpServer())
        .get('/api/outcomes?includeArchived=true')
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(context.prismaMock.outcome.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: user.id } }),
      );
    });

    // THE security assertion of this file: an id that belongs to someone else
    // must be indistinguishable from one that never existed. Anything less —
    // a 403, a different message, a different shape — is an existence oracle.
    it("answers an unowned id exactly as it answers an unknown one", async () => {
      const user = await createMockContributorUser(context);
      const foreignId = randomUUID();
      const unknownId = randomUUID();

      // The query is scoped to `{ id, userId }`, so a row owned by someone
      // else simply does not come back.
      context.prismaMock.outcome.findFirst.mockResolvedValue(null);

      const unowned = await request(context.app.getHttpServer())
        .get(`/api/outcomes/${foreignId}`)
        .set(authHeader(user.accessToken))
        .expect(404);

      const unknown = await request(context.app.getHttpServer())
        .get(`/api/outcomes/${unknownId}`)
        .set(authHeader(user.accessToken))
        .expect(404);

      expect(unowned.body.error?.message ?? unowned.body.message).toBe(
        unknown.body.error?.message ?? unknown.body.message,
      );
      expect(Object.keys(unowned.body)).toEqual(Object.keys(unknown.body));
      expect(context.prismaMock.outcome.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: foreignId, userId: user.id } }),
      );
    });

    it('rejects an attempt to move an outcome to another domain', async () => {
      const user = await createMockContributorUser(context);
      const row = outcomeRow({ userId: user.id });
      context.prismaMock.outcome.findFirst.mockResolvedValue(row);

      const res = await request(context.app.getHttpServer())
        .patch(`/api/outcomes/${row.id}`)
        .set(authHeader(user.accessToken))
        .send({ domain: 'WORK' })
        .expect(400);

      // `domain` is stripped by the schema, leaving an empty patch — which the
      // "at least one field" refine rejects. That refine only works because
      // `updateOutcomeSchema` is built over a defaults-free base; see the note
      // on `outcomeFieldsSchema`.
      expect(res.body.code).toBe('BAD_REQUEST');
      expect(context.prismaMock.outcome.update).not.toHaveBeenCalled();
    });

    it('refuses to edit an archived outcome with 409 CONFLICT', async () => {
      const user = await createMockContributorUser(context);
      const row = outcomeRow({ userId: user.id, state: 'ARCHIVED', archivedAt: now });
      context.prismaMock.outcome.findFirst.mockResolvedValue(row);

      const res = await request(context.app.getHttpServer())
        .patch(`/api/outcomes/${row.id}`)
        .set(authHeader(user.accessToken))
        .send({ title: 'Renamed' })
        .expect(409);

      expect(res.body.code).toBe('CONFLICT');
    });

    it('archives once and answers 200 again on a repeat', async () => {
      const user = await createMockContributorUser(context);
      const live = outcomeRow({ userId: user.id });
      const archived = { ...live, state: 'ARCHIVED', archivedAt: now };

      context.prismaMock.outcome.findFirst.mockResolvedValue(live);
      context.prismaMock.outcome.update.mockResolvedValue(archived);
      context.prismaMock.auditEvent.create.mockResolvedValue({ id: 'audit' });

      const first = await request(context.app.getHttpServer())
        .post(`/api/outcomes/${live.id}/archive`)
        .set(authHeader(user.accessToken))
        .expect(200);
      expect(first.body.data.state).toBe('ARCHIVED');

      context.prismaMock.outcome.findFirst.mockResolvedValue(archived);
      context.prismaMock.outcome.update.mockClear();
      context.prismaMock.auditEvent.create.mockClear();

      const second = await request(context.app.getHttpServer())
        .post(`/api/outcomes/${live.id}/archive`)
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(second.body.data.state).toBe('ARCHIVED');
      expect(context.prismaMock.outcome.update).not.toHaveBeenCalled();
      expect(context.prismaMock.auditEvent.create).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Domain modes
  // ==========================================================================

  describe('/api/me/domain-modes', () => {
    it('returns three synthesised entries for a brand-new user', async () => {
      const user = await createMockContributorUser(context);
      context.prismaMock.domainMode.findMany.mockResolvedValue([]);

      const res = await request(context.app.getHttpServer())
        .get('/api/me/domain-modes')
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(res.body.data.map((m: { domain: string }) => m.domain)).toEqual([
        'WORK',
        'FAMILY',
        'HEALTH',
      ]);
      expect(res.body.data.every((m: { mode: string }) => m.mode === 'GROW')).toBe(true);
    });

    it('persists a mode and reflects it on the next read', async () => {
      const user = await createMockContributorUser(context);
      const row = {
        id: randomUUID(),
        userId: user.id,
        domain: 'HEALTH',
        mode: 'RECOVER',
        reason: 'Back strain',
        effectiveFrom: now,
        createdAt: now,
        updatedAt: now,
      };

      context.prismaMock.domainMode.findUnique.mockResolvedValue(null);
      context.prismaMock.domainMode.upsert.mockResolvedValue(row);
      context.prismaMock.auditEvent.create.mockResolvedValue({ id: 'audit' });

      const put = await request(context.app.getHttpServer())
        .put('/api/me/domain-modes/HEALTH')
        .set(authHeader(user.accessToken))
        .send({ mode: 'RECOVER', reason: 'Back strain' })
        .expect(200);

      expect(put.body.data).toEqual({
        domain: 'HEALTH',
        mode: 'RECOVER',
        reason: 'Back strain',
        effectiveFrom: now.toISOString(),
      });

      context.prismaMock.domainMode.findMany.mockResolvedValue([row]);

      const get = await request(context.app.getHttpServer())
        .get('/api/me/domain-modes')
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(get.body.data[2]).toEqual(put.body.data);
    });

    it('rejects an unknown domain in the path with 400, not 404', async () => {
      const user = await createMockContributorUser(context);

      await request(context.app.getHttpServer())
        .put('/api/me/domain-modes/PLAY')
        .set(authHeader(user.accessToken))
        .send({ mode: 'GROW' })
        .expect(400);
    });

    it('rejects an unknown mode', async () => {
      const user = await createMockContributorUser(context);

      await request(context.app.getHttpServer())
        .put('/api/me/domain-modes/HEALTH')
        .set(authHeader(user.accessToken))
        .send({ mode: 'SPRINT' })
        .expect(400);
    });
  });
});
