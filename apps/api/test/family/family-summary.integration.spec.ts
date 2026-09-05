import request from 'supertest';
import { randomUUID } from 'crypto';

import { TestContext, createTestApp, closeTestApp } from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { createMockContributorUser, authHeader, TestUser } from '../helpers/auth-mock.helper';
import { AiGatewayService } from '../../src/ai/gateway/ai-gateway.service';
import { familySummarySchema } from '../../src/family/family-summary.schema';
import { weekStartOfDate } from '../../src/family/recurrence';

// =============================================================================
// GET /api/family/summary over HTTP (issue #45, epic E08)
// =============================================================================
//
// The aggregation is proved by the service spec. What a real request adds is
// the shape of the CONTRACT: that the body validates against the published
// schema, that a serialised response contains none of the forbidden words
// (VISION §12), that a non-Monday `weekStart` is a 400 a client can branch on,
// and that the coach note degrades to the template rather than to an error.
// =============================================================================

const gateway = { invoke: jest.fn() };

describe('Family summary (integration)', () => {
  let context: TestContext;
  let user: TestUser;

  const ritualId = randomUUID();
  const monday = weekStartOfDate(new Date().toISOString().slice(0, 10));

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
    context.prismaMock.userProfile.findUnique.mockResolvedValue({ timezone: 'UTC' });
    context.prismaMock.ritual.findMany.mockResolvedValue([]);
    context.prismaMock.commitment.findMany.mockResolvedValue([]);
    context.prismaMock.reflection.findMany.mockResolvedValue([]);
  });

  const server = () => context.app.getHttpServer();

  it('refuses an unauthenticated request', async () => {
    await request(server()).get('/api/family/summary').expect(401);
  });

  it('defaults to four weeks starting at the current local Monday', async () => {
    const res = await request(server())
      .get('/api/family/summary')
      .set(authHeader(user.accessToken))
      .expect(200);

    expect(res.body.data.weeks).toHaveLength(4);
    expect(res.body.data.weeks[0].weekStart).toBe(monday);
    expect(res.body.data.timezone).toBe('UTC');
  });

  it('validates against the published schema', async () => {
    const res = await request(server())
      .get('/api/family/summary?weeks=1')
      .set(authHeader(user.accessToken))
      .expect(200);

    expect(familySummarySchema.safeParse(res.body.data).success).toBe(true);
  });

  it('reports the counts of one week', async () => {
    const at = new Date(`${monday}T18:30:00.000Z`);
    context.prismaMock.ritual.findMany.mockResolvedValue([
      {
        id: ritualId,
        userId: 'owner',
        title: 'Phone-free dinner',
        active: true,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
    context.prismaMock.commitment.findMany.mockResolvedValue([
      { id: 'a', ritualId, status: 'COMPLETED', skipReason: null, scheduledStart: at },
      { id: 'b', ritualId, status: 'SKIPPED', skipReason: 'UNEXPECTED_CONFLICT', scheduledStart: at },
      { id: 'c', ritualId, status: 'PLANNED', skipReason: null, scheduledStart: at },
    ]);

    const res = await request(server())
      .get(`/api/family/summary?weekStart=${monday}&weeks=1`)
      .set(authHeader(user.accessToken))
      .expect(200);

    expect(res.body.data.weeks[0].rituals[0]).toMatchObject({
      title: 'Phone-free dinner',
      planned: 3,
      kept: 1,
      skipped: 1,
      open: 1,
    });
  });

  it('rejects a weekStart that is not a Monday', async () => {
    const tuesday = new Date(`${monday}T00:00:00.000Z`);
    tuesday.setUTCDate(tuesday.getUTCDate() + 1);

    const res = await request(server())
      .get(`/api/family/summary?weekStart=${tuesday.toISOString().slice(0, 10)}`)
      .set(authHeader(user.accessToken))
      .expect(400);

    expect(res.body.details).toMatchObject({ reason: 'WEEK_START_NOT_MONDAY' });
  });

  it('rejects a window longer than twelve weeks', async () => {
    await request(server())
      .get('/api/family/summary?weeks=13')
      .set(authHeader(user.accessToken))
      .expect(400);
  });

  it('falls back to the template sentence when the coach is unavailable', async () => {
    const at = new Date(`${monday}T18:30:00.000Z`);
    context.prismaMock.commitment.findMany.mockResolvedValue([
      { id: 'a', ritualId, status: 'SKIPPED', skipReason: 'UNEXPECTED_CONFLICT', scheduledStart: at },
      { id: 'b', ritualId, status: 'SKIPPED', skipReason: 'BAD_TIMING', scheduledStart: at },
    ]);
    gateway.invoke.mockResolvedValue({
      ok: false,
      invocationId: 'inv',
      error: { code: 'no_user_key', message: 'no key' },
    });

    const res = await request(server())
      .get(`/api/family/summary?weekStart=${monday}&weeks=1`)
      .set(authHeader(user.accessToken))
      .expect(200);

    expect(res.body.data.coachNote).toMatchObject({ source: 'template' });
    expect(res.body.data.coachNote.text).toContain('Work displaced 2 evening family commitments');
  });

  // VISION §12 / PRD §105: the product never creates a family-quality score.
  it('serialises no forbidden word anywhere in the body', async () => {
    const at = new Date(`${monday}T18:30:00.000Z`);
    context.prismaMock.ritual.findMany.mockResolvedValue([
      { id: ritualId, userId: 'owner', title: 'Phone-free dinner', active: true, createdAt: at },
    ]);
    context.prismaMock.commitment.findMany.mockResolvedValue([
      { id: 'a', ritualId, status: 'COMPLETED', skipReason: null, scheduledStart: at },
    ]);

    const res = await request(server())
      .get(`/api/family/summary?weekStart=${monday}&weeks=1`)
      .set(authHeader(user.accessToken))
      .expect(200);

    expect(JSON.stringify(res.body)).not.toMatch(/score|quality|rating|grade/i);
  });

  it('never lets another user’s rows into the query', async () => {
    await request(server())
      .get('/api/family/summary?weeks=1')
      .set(authHeader(user.accessToken))
      .expect(200);

    const where = (context.prismaMock.commitment.findMany.mock.calls[0][0] as any).where;
    expect(where.userId).toBeDefined();
    expect(where.userId).not.toBe('someone-else');
  });
});
