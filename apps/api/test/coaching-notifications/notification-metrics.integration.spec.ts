import request from 'supertest';

import { TestContext, createTestApp, closeTestApp } from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { createMockContributorUser, authHeader, TestUser } from '../helpers/auth-mock.helper';

// =============================================================================
// GET /api/notifications/metrics (issue #69, epic E12)
// =============================================================================
//
// The independence metric (PRD §65) over HTTP, plus the two guarantees a caller
// depends on: the shape does not change with the data, and the window is
// bounded.
// =============================================================================

const SENT_ID = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-09-20T12:00:00.000Z');

describe('Notification metrics (integration)', () => {
  let context: TestContext;
  let user: TestUser;

  const interaction = (over: Record<string, unknown> = {}) => ({
    id: SENT_ID,
    eventKey: 'coach.commitment_upcoming',
    kind: 'SENT',
    commitmentId: 'c1',
    sentInteractionId: null,
    action: null,
    suppressReason: null,
    createdAt: new Date('2026-09-15T12:00:00.000Z'),
    meta: { category: 'N1', leadMinutes: 20 },
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
    context.prismaMock.userProfile.upsert.mockResolvedValue({
      userId: user.id,
      timezone: 'America/Costa_Rica',
      quietHoursStart: null,
      quietHoursEnd: null,
      notificationPolicy: null,
    });
    context.prismaMock.notificationInteraction.findMany.mockResolvedValue([]);
    context.prismaMock.commitment.findMany.mockResolvedValue([]);
  });

  const url = '/api/notifications/metrics';
  const get = (query = '') =>
    request(context.app.getHttpServer())
      .get(`${url}${query}`)
      .set(authHeader(user.accessToken));

  it('requires a bearer token', async () => {
    await request(context.app.getHttpServer()).get(url).expect(401);
  });

  // Nothing having happened is a normal answer, not an empty page.
  it('answers with a full shape for a user with no history', async () => {
    const res = await get().expect(200);

    expect(res.body.data.perEvent).toHaveLength(9);
    expect(res.body.data.independence).toEqual({
      completions: 0,
      unprompted: 0,
      ratio: null,
    });
    expect(res.body.data.insights).toEqual([]);
    expect(res.body.data.window.days).toBe(30);
  });

  it('reports the suppressions with their reasons', async () => {
    context.prismaMock.notificationInteraction.findMany.mockResolvedValue([
      interaction({ id: 's1', kind: 'SUPPRESSED', suppressReason: 'QUIET_HOURS' }),
    ]);

    const res = await get().expect(200);

    const upcoming = res.body.data.perEvent.find(
      (event: { eventKey: string }) => event.eventKey === 'coach.commitment_upcoming',
    );
    expect(upcoming.suppressed.QUIET_HOURS).toBe(1);
    expect(upcoming.suppressed.DAILY_CAP).toBe(0);
  });

  it('computes independence over prompted and unprompted completions', async () => {
    context.prismaMock.notificationInteraction.findMany.mockResolvedValue([interaction()]);
    context.prismaMock.commitment.findMany.mockResolvedValue([
      { id: 'c1', domain: 'HEALTH', completedAt: new Date('2026-09-15T14:00:00.000Z') },
      { id: 'c2', domain: 'HEALTH', completedAt: new Date('2026-09-16T14:00:00.000Z') },
    ]);

    const res = await get().expect(200);

    expect(res.body.data.independence).toEqual({
      completions: 2,
      unprompted: 1,
      ratio: 0.5,
    });
  });

  it('reads only completed work', async () => {
    await get().expect(200);

    const where = (context.prismaMock.commitment.findMany.mock.calls[0][0] as any).where;
    expect(where.status.in).toEqual(['COMPLETED', 'PARTIALLY_COMPLETED']);
  });

  describe('scoping', () => {
    it('reads only the caller’s own rows', async () => {
      await get().expect(200);

      expect(
        (context.prismaMock.notificationInteraction.findMany.mock.calls[0][0] as any).where
          .userId,
      ).toBe(user.id);
      expect(
        (context.prismaMock.commitment.findMany.mock.calls[0][0] as any).where.userId,
      ).toBe(user.id);
    });
  });

  describe('the window', () => {
    it('accepts a window inside the range', async () => {
      const res = await get('?days=90').expect(200);

      expect(res.body.data.window.days).toBe(90);
    });

    // Below seven days every rate is noise; above 180 the aggregation walks
    // rows nobody is asking a question about.
    it.each([1, 6, 181, 999])('rejects days=%i', async (days) => {
      await get(`?days=${days}`).expect(400);
    });

    it('rejects a window that is not a number', async () => {
      await get('?days=lots').expect(400);
    });

    it('asks the database for exactly that window', async () => {
      await get('?days=7').expect(200);

      const where = (
        context.prismaMock.notificationInteraction.findMany.mock.calls[0][0] as any
      ).where;
      const span = where.createdAt.lte.getTime() - where.createdAt.gte.getTime();
      expect(Math.round(span / (24 * 3600_000))).toBe(7);
    });
  });

  it('uses the user’s own timezone for the monthly trend', async () => {
    context.prismaMock.userProfile.upsert.mockResolvedValue({
      userId: user.id,
      timezone: 'America/Costa_Rica',
      quietHoursStart: null,
      quietHoursEnd: null,
      notificationPolicy: null,
    });
    context.prismaMock.notificationInteraction.findMany.mockResolvedValue([
      // 23:30 on 31 August in Costa Rica, which is 1 September in UTC.
      interaction({ createdAt: new Date('2026-09-01T05:30:00.000Z') }),
    ]);
    context.prismaMock.commitment.findMany.mockResolvedValue([
      { id: 'c1', domain: 'HEALTH', completedAt: new Date('2026-09-01T06:30:00.000Z') },
    ]);

    const res = await get().expect(200);

    expect(res.body.data.reminderTrend[0].month).toBe('2026-08');
  });
});
