import request from 'supertest';
import { randomUUID } from 'crypto';

import { TestContext, createTestApp, closeTestApp } from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { createMockContributorUser, authHeader, TestUser } from '../helpers/auth-mock.helper';

// =============================================================================
// The commitment lifecycle over HTTP (issue #47, epic #33)
// =============================================================================
//
// The state machine itself is proved exhaustively by commitment-transitions.spec
// (all 81 pairs) and the branching by commitments.service.spec. What this file
// adds is what only a real request can show:
//
//   - `allowedTransitions` on the wire matches the matrix, so a UI that renders
//     exactly what the server sends can never offer a move the API refuses.
//   - A forbidden move is a 409 whose body carries a machine-readable
//     `details.reason` a client can branch on.
//   - `from`/`to` really are required, and the window really is capped.
// =============================================================================

describe('Commitments (integration)', () => {
  let context: TestContext;
  let user: TestUser;

  const id = randomUUID();
  const start = new Date('2026-02-10T06:30:00.000Z');
  const end = new Date('2026-02-10T07:15:00.000Z');

  const commitment = (over: Record<string, unknown> = {}) => ({
    id,
    userId: 'owner',
    domain: 'HEALTH',
    title: 'Upper A',
    outcomeId: null,
    planVersionId: null,
    routineId: null,
    scheduledStart: start,
    scheduledEnd: end,
    importance: 4,
    commitmentType: null,
    fullVersion: null,
    shortVersion: null,
    minimumVersion: '10-minute circuit',
    status: 'PLANNED',
    rescheduleCount: 0,
    rescheduledFromId: null,
    skipReason: null,
    userConfirmed: false,
    startedAt: null,
    completedAt: null,
    createdAt: start,
    updatedAt: start,
    _count: { evidence: 0 },
    rescheduledTo: [],
    evidence: [],
    reflections: [],
    ...over,
  });

  const runTransaction = () =>
    context.prismaMock.$transaction.mockImplementation(async (arg: unknown) =>
      typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(context.prismaMock) : arg,
    );

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

  describe('POST /api/commitments', () => {
    it('creates a commitment, with no evidence and the matrix on the wire', async () => {
      context.prismaMock.commitment.create.mockResolvedValue(commitment());

      const res = await request(context.app.getHttpServer())
        .post('/api/commitments')
        .set(authHeader(user.accessToken))
        .send({
          domain: 'HEALTH',
          title: 'Upper A',
          scheduledStart: start.toISOString(),
          scheduledEnd: end.toISOString(),
          importance: 4,
          minimumVersion: '10-minute circuit',
        })
        .expect(201);

      expect(res.body.data).toMatchObject({ status: 'PLANNED', rescheduleCount: 0 });
      expect(res.body.data.allowedTransitions).toEqual([
        'READY',
        'STARTED',
        'RESCHEDULED',
        'SKIPPED',
        'MISSED',
        'CANCELLED',
      ]);
      expect(res.body.data.evidenceCount).toBe(0);
      expect(context.prismaMock.evidence.create).not.toHaveBeenCalled();
    });

    it('rejects an end before its start', async () => {
      const res = await request(context.app.getHttpServer())
        .post('/api/commitments')
        .set(authHeader(user.accessToken))
        .send({
          domain: 'HEALTH',
          title: 'Upper A',
          scheduledStart: end.toISOString(),
          scheduledEnd: start.toISOString(),
        })
        .expect(400);

      expect(JSON.stringify(res.body)).toContain('scheduledEnd');
    });
  });

  describe('POST /api/commitments/:id/transition', () => {
    it('starts, then completes with one USER_LOG evidence row', async () => {
      context.prismaMock.commitment.findFirst.mockResolvedValue(commitment());
      runTransaction();
      context.prismaMock.commitment.update.mockResolvedValue(
        commitment({ status: 'STARTED', startedAt: start }),
      );

      const started = await request(context.app.getHttpServer())
        .post(`/api/commitments/${id}/transition`)
        .set(authHeader(user.accessToken))
        .send({ to: 'STARTED' })
        .expect(200);

      expect(started.body.data.commitment.startedAt).toBe(start.toISOString());
      expect(started.body.data.evidence).toBeNull();

      context.prismaMock.commitment.findFirst.mockResolvedValue(
        commitment({ status: 'STARTED', startedAt: start }),
      );
      context.prismaMock.evidence.create.mockResolvedValue({
        id: 'ev-1',
        commitmentId: id,
        evidenceType: 'completion',
        source: 'USER_LOG',
        occurredAt: end,
        quantitativeValue: null,
        quantitativeUnit: null,
        qualitativeValue: 'Finished all sets',
        confidence: null,
        createdAt: end,
      });
      context.prismaMock.commitment.update.mockResolvedValue(
        commitment({ status: 'COMPLETED', completedAt: end, _count: { evidence: 1 } }),
      );

      const completed = await request(context.app.getHttpServer())
        .post(`/api/commitments/${id}/transition`)
        .set(authHeader(user.accessToken))
        .send({ to: 'COMPLETED', evidence: { qualitativeValue: 'Finished all sets' } })
        .expect(200);

      expect(completed.body.data.evidence).toMatchObject({
        source: 'USER_LOG',
        evidenceType: 'completion',
        qualitativeValue: 'Finished all sets',
      });
      expect(completed.body.data.commitment.evidenceCount).toBe(1);
      // A terminal commitment offers nothing further.
      expect(completed.body.data.commitment.allowedTransitions).toEqual([]);
    });

    it('refuses to reopen a completed commitment, with a reason a client can branch on', async () => {
      context.prismaMock.commitment.findFirst.mockResolvedValue(commitment({ status: 'COMPLETED' }));

      const res = await request(context.app.getHttpServer())
        .post(`/api/commitments/${id}/transition`)
        .set(authHeader(user.accessToken))
        .send({ to: 'STARTED' })
        .expect(409);

      expect(res.body.code).toBe('CONFLICT');
      expect(res.body.message).toBe('Cannot move a COMPLETED commitment to STARTED');
      expect(res.body.details).toEqual({
        reason: 'INVALID_TRANSITION',
        from: 'COMPLETED',
        to: 'STARTED',
      });
    });

    it('rejects evidence attached to a skip', async () => {
      const res = await request(context.app.getHttpServer())
        .post(`/api/commitments/${id}/transition`)
        .set(authHeader(user.accessToken))
        .send({ to: 'SKIPPED', evidence: { qualitativeValue: 'did it anyway' } })
        .expect(400);

      expect(JSON.stringify(res.body)).toContain('evidence');
    });

    it('rejects a reschedule with no new time', async () => {
      const res = await request(context.app.getHttpServer())
        .post(`/api/commitments/${id}/transition`)
        .set(authHeader(user.accessToken))
        .send({ to: 'RESCHEDULED' })
        .expect(400);

      expect(JSON.stringify(res.body)).toContain('rescheduleTo');
    });

    it('rejects a reschedule into the past', async () => {
      await request(context.app.getHttpServer())
        .post(`/api/commitments/${id}/transition`)
        .set(authHeader(user.accessToken))
        .send({ to: 'RESCHEDULED', rescheduleTo: '2020-01-01T00:00:00.000Z' })
        .expect(400);
    });

    it('carries the reschedule count onto the new commitment', async () => {
      const later = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);

      context.prismaMock.commitment.findFirst.mockResolvedValue(commitment({ rescheduleCount: 1 }));
      runTransaction();
      context.prismaMock.commitment.create.mockResolvedValue(
        commitment({
          id: randomUUID(),
          status: 'PLANNED',
          rescheduleCount: 2,
          rescheduledFromId: id,
          scheduledStart: later,
        }),
      );
      context.prismaMock.commitment.update.mockResolvedValue(
        commitment({ status: 'RESCHEDULED', rescheduleCount: 1 }),
      );

      const res = await request(context.app.getHttpServer())
        .post(`/api/commitments/${id}/transition`)
        .set(authHeader(user.accessToken))
        .send({ to: 'RESCHEDULED', rescheduleTo: later.toISOString() })
        .expect(200);

      expect(res.body.data.commitment.status).toBe('RESCHEDULED');
      expect(res.body.data.rescheduledTo).toMatchObject({
        status: 'PLANNED',
        rescheduleCount: 2,
        rescheduledFromId: id,
      });
    });
  });

  describe('PATCH /api/commitments/:id', () => {
    it('refuses to edit a terminal commitment', async () => {
      context.prismaMock.commitment.findFirst.mockResolvedValue(commitment({ status: 'SKIPPED' }));

      const res = await request(context.app.getHttpServer())
        .patch(`/api/commitments/${id}`)
        .set(authHeader(user.accessToken))
        .send({ title: 'Renamed' })
        .expect(409);

      expect(res.body.code).toBe('CONFLICT');
    });

    // `status` is not a field on this route — it is stripped, leaving an empty
    // patch, which the schema rejects. There is exactly one way to move a
    // commitment's status and it validates the matrix.
    it('refuses a status change through PATCH', async () => {
      context.prismaMock.commitment.findFirst.mockResolvedValue(commitment());

      await request(context.app.getHttpServer())
        .patch(`/api/commitments/${id}`)
        .set(authHeader(user.accessToken))
        .send({ status: 'COMPLETED' })
        .expect(400);

      expect(context.prismaMock.commitment.update).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/commitments', () => {
    it('requires a window', async () => {
      const res = await request(context.app.getHttpServer())
        .get('/api/commitments')
        .set(authHeader(user.accessToken))
        .expect(400);

      expect(JSON.stringify(res.body)).toContain('from');
    });

    it('rejects a window wider than the cap', async () => {
      const res = await request(context.app.getHttpServer())
        .get('/api/commitments?from=2026-01-01T00:00:00.000Z&to=2026-12-31T00:00:00.000Z')
        .set(authHeader(user.accessToken))
        .expect(400);

      expect(JSON.stringify(res.body)).toContain('62 days');
    });

    it('rejects a window that runs backwards', async () => {
      await request(context.app.getHttpServer())
        .get('/api/commitments?from=2026-02-28T00:00:00.000Z&to=2026-02-01T00:00:00.000Z')
        .set(authHeader(user.accessToken))
        .expect(400);
    });

    it('accepts a csv status filter', async () => {
      context.prismaMock.commitment.findMany.mockResolvedValue([commitment()]);

      await request(context.app.getHttpServer())
        .get(
          '/api/commitments?from=2026-02-01T00:00:00.000Z&to=2026-02-28T00:00:00.000Z&status=PLANNED,READY',
        )
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(context.prismaMock.commitment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: { in: ['PLANNED', 'READY'] } }),
        }),
      );
    });

    it('rejects an unknown status in the filter', async () => {
      await request(context.app.getHttpServer())
        .get('/api/commitments?from=2026-02-01T00:00:00.000Z&to=2026-02-28T00:00:00.000Z&status=NAPPING')
        .set(authHeader(user.accessToken))
        .expect(400);
    });
  });

  describe('ownership and auth', () => {
    it.each([
      ['get', `/api/commitments/${id}`],
      ['patch', `/api/commitments/${id}`],
      ['post', `/api/commitments/${id}/transition`],
    ])("answers 404 on %s %s for another user's commitment", async (method, path) => {
      context.prismaMock.commitment.findFirst.mockResolvedValue(null);

      const res = await (request(context.app.getHttpServer()) as any)
        [method](path)
        .set(authHeader(user.accessToken))
        .send({ to: 'STARTED', title: 'x' })
        .expect(404);

      expect(res.body.code).toBe('NOT_FOUND');
    });

    it('requires a token', async () => {
      await request(context.app.getHttpServer()).get(`/api/commitments/${id}`).expect(401);
    });
  });
});
