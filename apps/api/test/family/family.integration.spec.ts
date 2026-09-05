import request from 'supertest';
import { randomUUID } from 'crypto';

import { TestContext, createTestApp, closeTestApp } from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { createMockContributorUser, authHeader, TestUser } from '../helpers/auth-mock.helper';
import { AiGatewayService } from '../../src/ai/gateway/ai-gateway.service';
import { FAMILY_MEMBER_RESPONSE_KEYS } from '../../src/family/family.schema';

// =============================================================================
// The Family routes over HTTP (issue #41, epic E08)
// =============================================================================
//
// The recurrence maths, the lint rules and the materializer's branching are all
// proved by their unit specs. What only a real request can show is what this
// file asserts:
//
//   - The member record on the wire has EXACTLY five keys. Everything else in
//     the epic is a convention; this is the promise (PRD §33, VISION §50).
//   - `POST /commitments` with `domain: 'FAMILY'` is held to the same PRD §32
//     rule as a ritual, and a WORK commitment with the same words is not.
//   - `POST /family/lint` is a 200 even when the gateway refuses, so a UI can
//     render the verdict without branching on a status code.
//   - A foreign id is a 404 on every route, never a 403.
// =============================================================================

/** The coach never answers in this suite unless a test says so. */
const gateway = { invoke: jest.fn() };

describe('Family (integration)', () => {
  let context: TestContext;
  let user: TestUser;

  const ritualId = randomUUID();
  const memberId = randomUUID();
  const now = new Date('2026-06-01T15:00:00.000Z');

  const memberRow = (over: Record<string, unknown> = {}) => ({
    id: memberId,
    userId: 'owner',
    nickname: 'Mia',
    relationship: 'CHILD',
    birthday: new Date('1900-09-09T00:00:00.000Z'),
    createdAt: now,
    ...over,
  });

  const ritualRow = (over: Record<string, unknown> = {}) => ({
    id: ritualId,
    userId: 'owner',
    title: 'Phone-free dinner',
    purpose: 'Be present at the table',
    familyMemberId: null,
    recurrence: { weekdays: [2, 4, 0], time: '18:30', everyNWeeks: 1 },
    idealMinutes: 45,
    minimumMinutes: 10,
    fallbackBehavior: 'Sit down phone-free for the first 10 minutes',
    active: true,
    lastMaterializedThrough: null,
    routineId: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  });

  beforeAll(async () => {
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
    context.prismaMock.auditEvent.create.mockResolvedValue({ id: 'audit' });
    context.prismaMock.userProfile.findUnique.mockResolvedValue({
      timezone: 'America/Costa_Rica',
    });
    context.prismaMock.commitment.findMany.mockResolvedValue([]);
    context.prismaMock.commitment.create.mockResolvedValue({ id: 'c' });
    context.prismaMock.ritual.update.mockResolvedValue(ritualRow());
  });

  const server = () => context.app.getHttpServer();

  describe('authentication', () => {
    it.each([
      ['get', '/api/family/members'],
      ['get', '/api/family/rituals'],
      ['post', '/api/family/rituals'],
      ['post', '/api/family/lint'],
    ])('refuses an unauthenticated %s %s', async (method, path) => {
      await (request(server()) as never as Record<string, (p: string) => request.Test>)
        [method](path)
        .expect(401);
    });
  });

  describe('POST /api/family/members', () => {
    it('returns exactly the five permitted keys', async () => {
      context.prismaMock.familyMember.create.mockResolvedValue(memberRow());

      const res = await request(server())
        .post('/api/family/members')
        .set(authHeader(user.accessToken))
        .send({ nickname: 'Mia', relationship: 'CHILD', birthday: '1900-09-09' })
        .expect(201);

      expect(Object.keys(res.body.data).sort()).toEqual([...FAMILY_MEMBER_RESPONSE_KEYS].sort());
      expect(res.body.data.birthday).toBe('1900-09-09');
    });

    it('rejects a nickname longer than the column', async () => {
      await request(server())
        .post('/api/family/members')
        .set(authHeader(user.accessToken))
        .send({ nickname: 'x'.repeat(41), relationship: 'CHILD' })
        .expect(400);
    });

    it('rejects a key the record may not hold', async () => {
      await request(server())
        .post('/api/family/members')
        .set(authHeader(user.accessToken))
        .send({ nickname: 'Mia', relationship: 'CHILD', notes: 'seemed quiet' })
        .expect(400);
    });

    it('writes an audit row carrying only the relationship', async () => {
      context.prismaMock.familyMember.create.mockResolvedValue(memberRow());

      await request(server())
        .post('/api/family/members')
        .set(authHeader(user.accessToken))
        .send({ nickname: 'Mia', relationship: 'CHILD', birthday: '1900-09-09' })
        .expect(201);

      const audit = context.prismaMock.auditEvent.create.mock.calls[0][0].data;
      expect(audit).toMatchObject({
        action: 'family_member:create',
        targetType: 'family_member',
        meta: { relationship: 'CHILD' },
      });
      expect(JSON.stringify(audit.meta)).not.toContain('Mia');
      expect(JSON.stringify(audit.meta)).not.toContain('1900');
    });
  });

  describe('POST /api/family/rituals', () => {
    const body = {
      title: 'Phone-free dinner',
      purpose: 'Be present at the table',
      recurrence: { weekdays: [2, 4, 0], time: '18:30', everyNWeeks: 1 },
      idealMinutes: 45,
      minimumMinutes: 10,
      fallbackBehavior: 'Sit down phone-free for the first 10 minutes',
    };

    it('creates the ritual and materializes the next seven days', async () => {
      context.prismaMock.ritual.create.mockResolvedValue(ritualRow());
      context.prismaMock.ritual.findFirst.mockResolvedValue(ritualRow());

      const res = await request(server())
        .post('/api/family/rituals')
        .set(authHeader(user.accessToken))
        .send(body)
        .expect(201);

      expect(res.body.data).toMatchObject({ title: 'Phone-free dinner', active: true });
      expect(res.body.data).not.toHaveProperty('userId');

      // Tue, Thu and Sun fall inside the next seven days.
      const rows = context.prismaMock.commitment.create.mock.calls.map((call: any) => call[0].data);
      expect(rows).toHaveLength(3);
      expect(rows[0]).toMatchObject({
        domain: 'FAMILY',
        status: 'PLANNED',
        ritualId,
        fullMinutes: 45,
        minimumMinutes: 10,
        minimumVersion: 'Sit down phone-free for the first 10 minutes',
      });
      // 18:30 in Costa Rica is 00:30Z the following day.
      expect(rows[0].scheduledStart.toISOString()).toMatch(/T00:30:00\.000Z$/);
    });

    it('refuses a title that legislates another person', async () => {
      const res = await request(server())
        .post('/api/family/rituals')
        .set(authHeader(user.accessToken))
        .send({ ...body, title: 'Make Mia happier' })
        .expect(400);

      expect(res.body.details).toMatchObject({
        reason: 'BEHAVIOUR_TARGETS_OTHER_PERSON',
        match: 'Make Mia happier',
      });
      expect(context.prismaMock.ritual.create).not.toHaveBeenCalled();
    });

    it('refuses a minimum longer than the ideal', async () => {
      await request(server())
        .post('/api/family/rituals')
        .set(authHeader(user.accessToken))
        .send({ ...body, idealMinutes: 10, minimumMinutes: 45 })
        .expect(400);
    });

    it('refuses a cadence that is not 1, 2 or 4 weeks', async () => {
      await request(server())
        .post('/api/family/rituals')
        .set(authHeader(user.accessToken))
        .send({ ...body, recurrence: { ...body.recurrence, everyNWeeks: 3 } })
        .expect(400);
    });

    it('answers 404 for a family member that is not the caller’s', async () => {
      context.prismaMock.familyMember.findFirst.mockResolvedValue(null);

      await request(server())
        .post('/api/family/rituals')
        .set(authHeader(user.accessToken))
        .send({ ...body, familyMemberId: randomUUID() })
        .expect(404);
    });
  });

  describe('POST /api/family/rituals/:id/materialize', () => {
    it('is idempotent: a repeat is skipped, never duplicated', async () => {
      // The horizon is seven days out from the REAL clock here, so the covered
      // date has to be computed the same way rather than pinned to a literal.
      const covered = new Date(Date.now() + 30 * 24 * 3600_000);
      context.prismaMock.ritual.findFirst.mockResolvedValue(
        ritualRow({ lastMaterializedThrough: covered }),
      );

      const res = await request(server())
        .post(`/api/family/rituals/${ritualId}/materialize`)
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(res.body.data).toMatchObject({ created: 0, skipped: 0 });
      expect(context.prismaMock.commitment.create).not.toHaveBeenCalled();
    });

    it('answers 404 for another user’s ritual', async () => {
      context.prismaMock.ritual.findFirst.mockResolvedValue(null);

      await request(server())
        .post(`/api/family/rituals/${randomUUID()}/materialize`)
        .set(authHeader(user.accessToken))
        .expect(404);
    });
  });

  describe('the lint hook on POST /api/commitments', () => {
    it('holds a FAMILY commitment to the same rule as a ritual', async () => {
      const res = await request(server())
        .post('/api/commitments')
        .set(authHeader(user.accessToken))
        .send({
          domain: 'FAMILY',
          title: "Fix Dad's attitude",
          scheduledStart: '2026-06-03T00:30:00.000Z',
        })
        .expect(400);

      expect(res.body.details).toMatchObject({
        reason: 'BEHAVIOUR_TARGETS_OTHER_PERSON',
      });
    });

    // The rule is about controlling another PERSON. "Fix" is a perfectly good
    // work verb and the same sentence shape.
    it('does not lint a WORK commitment with the same words', async () => {
      context.prismaMock.commitment.create.mockResolvedValue({
        ...ritualRow(),
        id: randomUUID(),
        domain: 'WORK',
        title: "Fix Dad's attitude",
        outcomeId: null,
        planVersionId: null,
        routineId: null,
        ritualId: null,
        familyMemberId: null,
        scheduledStart: now,
        scheduledEnd: null,
        importance: 3,
        commitmentType: null,
        fullVersion: null,
        shortVersion: null,
        minimumVersion: null,
        fullMinutes: null,
        shortMinutes: null,
        status: 'PLANNED',
        rescheduleCount: 0,
        rescheduledFromId: null,
        skipReason: null,
        userConfirmed: false,
        startedAt: null,
        completedAt: null,
        _count: { evidence: 0 },
        rescheduledTo: [],
      });

      await request(server())
        .post('/api/commitments')
        .set(authHeader(user.accessToken))
        .send({
          domain: 'WORK',
          title: "Fix Dad's attitude",
          scheduledStart: '2026-06-03T00:30:00.000Z',
        })
        .expect(201);
    });
  });

  describe('POST /api/family/lint', () => {
    it('is a 200 with a suggestion when the coach answers', async () => {
      gateway.invoke.mockResolvedValue({
        ok: true,
        invocationId: 'inv',
        output: { suggestion: 'Read with Mia for 15 minutes' },
        usage: {},
      });

      const res = await request(server())
        .post('/api/family/lint')
        .set(authHeader(user.accessToken))
        .send({ title: 'Make Mia happier' })
        .expect(200);

      expect(res.body.data).toMatchObject({
        ok: false,
        code: 'TARGETS_OTHER_PERSON',
        suggestion: 'Read with Mia for 15 minutes',
        source: 'ai',
      });
    });

    // PRD §120: the verdict never depends on the provider.
    it('is still a 200 when the gateway refuses', async () => {
      gateway.invoke.mockResolvedValue({
        ok: false,
        invocationId: 'inv',
        error: { code: 'no_user_key', message: 'no key' },
      });

      const res = await request(server())
        .post('/api/family/lint')
        .set(authHeader(user.accessToken))
        .send({ title: 'Make Mia happier' })
        .expect(200);

      expect(res.body.data).toMatchObject({ ok: false, suggestion: null, source: 'none' });
    });

    it('never calls the coach for a title that passes', async () => {
      const res = await request(server())
        .post('/api/family/lint')
        .set(authHeader(user.accessToken))
        .send({ title: 'Put phone away during dinner' })
        .expect(200);

      expect(res.body.data).toMatchObject({ ok: true, match: null, source: 'none' });
      expect(gateway.invoke).not.toHaveBeenCalled();
    });
  });

  describe('ownership', () => {
    it.each([
      ['get', '/api/family/rituals/'],
      ['patch', '/api/family/rituals/'],
      ['delete', '/api/family/rituals/'],
    ])('answers 404, never 403, for %s on another user’s ritual', async (method, prefix) => {
      context.prismaMock.ritual.findFirst.mockResolvedValue(null);

      await (request(server()) as never as Record<string, (p: string) => request.Test>)
        [method](`${prefix}${randomUUID()}`)
        .set(authHeader(user.accessToken))
        .send({})
        .expect(404);
    });

    it.each([
      ['patch', '/api/family/members/'],
      ['delete', '/api/family/members/'],
    ])('answers 404 for %s on another user’s member', async (method, prefix) => {
      context.prismaMock.familyMember.findFirst.mockResolvedValue(null);

      await (request(server()) as never as Record<string, (p: string) => request.Test>)
        [method](`${prefix}${randomUUID()}`)
        .set(authHeader(user.accessToken))
        .send({})
        .expect(404);
    });
  });

  describe('DELETE /api/family/rituals/:id', () => {
    it('cancels the future occurrences and audits what it withdrew', async () => {
      context.prismaMock.ritual.findFirst.mockResolvedValue(ritualRow());
      context.prismaMock.ritual.delete.mockResolvedValue(ritualRow());
      context.prismaMock.commitment.findMany.mockResolvedValue([]);

      await request(server())
        .delete(`/api/family/rituals/${ritualId}`)
        .set(authHeader(user.accessToken))
        .expect(204);

      const audit = context.prismaMock.auditEvent.create.mock.calls.at(-1)![0].data;
      expect(audit).toMatchObject({ action: 'ritual:delete', targetType: 'ritual' });
    });
  });
});
