import request from 'supertest';
import { randomUUID } from 'crypto';

import { TestContext, createTestApp, closeTestApp } from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { createMockContributorUser, authHeader, TestUser } from '../helpers/auth-mock.helper';

// =============================================================================
// GET /progress/timeline and the milestone routes (issue #115, epic E11)
// =============================================================================
//
// The builder spec proves the mapping. What only a real request shows: the
// range cap is a refusal rather than a truncation, pagination is stable across
// two HTTP calls, and every read is scoped to the caller.
// =============================================================================

const DAY = 86_400_000;

describe('Progress timeline (integration)', () => {
  let context: TestContext;
  let user: TestUser;

  const evidenceRow = (over: Record<string, unknown> = {}) => ({
    id: randomUUID(),
    evidenceType: 'completed',
    occurredAt: new Date(Date.now() - 2 * DAY),
    commitmentId: randomUUID(),
    commitment: {
      title: 'Upper A',
      domain: 'HEALTH',
      rescheduleCount: 0,
      versionUsed: null,
      commitmentType: 'workout',
    },
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
    context.prismaMock.evidence.findMany.mockResolvedValue([]);
    context.prismaMock.commitment.findMany.mockResolvedValue([]);
    context.prismaMock.auditEvent.findMany.mockResolvedValue([]);
    context.prismaMock.milestone.findMany.mockResolvedValue([]);
    context.prismaMock.milestone.findFirst.mockResolvedValue(null);
    context.prismaMock.planVersion.findMany.mockResolvedValue([]);
  });

  const getTimeline = (query = '') =>
    request(context.app.getHttpServer())
      .get(`/api/progress/timeline${query}`)
      .set(authHeader(user.accessToken));

  describe('GET /api/progress/timeline', () => {
    it('requires a bearer token', async () => {
      await request(context.app.getHttpServer())
        .get('/api/progress/timeline')
        .expect(401);
    });

    it('is an empty page for a user with no history', async () => {
      const res = await getTimeline().expect(200);

      expect(res.body.data).toEqual({ items: [], nextCursor: null });
    });

    it('renders the events, newest first', async () => {
      context.prismaMock.evidence.findMany.mockResolvedValue([
        evidenceRow({ occurredAt: new Date(Date.now() - 4 * DAY) }),
        evidenceRow({
          occurredAt: new Date(Date.now() - DAY),
          commitment: {
            title: 'family dinner',
            domain: 'FAMILY',
            rescheduleCount: 0,
            versionUsed: null,
            commitmentType: null,
          },
        }),
      ]);

      const res = await getTimeline().expect(200);

      expect(res.body.data.items.map((item: { kind: string }) => item.kind)).toEqual([
        'family_kept',
        'completed',
      ]);
    });

    it('refuses a range it cannot honestly answer rather than truncating it', async () => {
      const to = new Date().toISOString();
      const from = new Date(Date.now() - 200 * DAY).toISOString();

      const res = await getTimeline(`?from=${from}&to=${to}`).expect(400);

      expect(JSON.stringify(res.body)).toContain('RANGE_TOO_LARGE');
    });

    it('pages with no duplicates and no gaps', async () => {
      context.prismaMock.evidence.findMany.mockResolvedValue(
        Array.from({ length: 5 }, (_, i) =>
          evidenceRow({ id: `e${i}`, occurredAt: new Date(Date.now() - (5 - i) * DAY) }),
        ),
      );

      const first = await getTimeline('?limit=2').expect(200);
      expect(first.body.data.items).toHaveLength(2);
      expect(first.body.data.nextCursor).not.toBeNull();

      const second = await getTimeline(
        `?limit=2&cursor=${encodeURIComponent(first.body.data.nextCursor)}`,
      ).expect(200);

      const firstIds = first.body.data.items.map((i: { id: string }) => i.id);
      const secondIds = second.body.data.items.map((i: { id: string }) => i.id);
      expect(secondIds).toHaveLength(2);
      expect(firstIds.filter((id: string) => secondIds.includes(id))).toEqual([]);
    });

    it('scopes every read to the caller', async () => {
      await getTimeline().expect(200);

      expect(context.prismaMock.evidence.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId: expect.any(String) }) }),
      );
      expect(context.prismaMock.milestone.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId: expect.any(String) }) }),
      );
    });
  });

  describe('the milestone routes', () => {
    const milestoneRow = (over: Record<string, unknown> = {}) => ({
      id: randomUUID(),
      userId: 'owner',
      kind: 'TEN_WORKOUTS',
      sequence: 1,
      domain: 'HEALTH',
      achievedAt: new Date(),
      acknowledgedAt: null,
      meta: { count: 10 },
      createdAt: new Date(),
      ...over,
    });

    it('lists what the user has reached', async () => {
      context.prismaMock.milestone.findMany.mockResolvedValue([milestoneRow()]);

      const res = await request(context.app.getHttpServer())
        .get('/api/progress/milestones')
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(res.body.data.items[0]).toMatchObject({
        kind: 'TEN_WORKOUTS',
        title: '10 workouts completed',
      });
    });

    it('filters to what has not been celebrated yet', async () => {
      await request(context.app.getHttpServer())
        .get('/api/progress/milestones?unacknowledged=true')
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(context.prismaMock.milestone.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ acknowledgedAt: null }),
        }),
      );
    });

    it('answers 404 for another user’s milestone', async () => {
      await request(context.app.getHttpServer())
        .post(`/api/progress/milestones/${randomUUID()}/ack`)
        .set(authHeader(user.accessToken))
        .expect(404);
    });

    it('marks one as seen', async () => {
      const row = milestoneRow();
      context.prismaMock.milestone.findFirst.mockResolvedValue(row);
      context.prismaMock.milestone.update.mockResolvedValue({
        ...row,
        acknowledgedAt: new Date(),
      });

      const res = await request(context.app.getHttpServer())
        .post(`/api/progress/milestones/${row.id}/ack`)
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(res.body.data.acknowledgedAt).not.toBeNull();
    });
  });
});
