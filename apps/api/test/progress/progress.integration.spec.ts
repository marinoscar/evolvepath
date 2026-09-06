import request from 'supertest';
import { randomUUID } from 'crypto';

import { TestContext, createTestApp, closeTestApp } from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { createMockContributorUser, authHeader, TestUser } from '../helpers/auth-mock.helper';
import { progressResponseSchema } from '../../src/progress/progress.schema';

// =============================================================================
// GET /progress over HTTP (issue #98, epic E11)
// =============================================================================
//
// The states are proved by `momentum-engine.spec`. What only a real request
// shows:
//
//   - the body satisfies `progressResponseSchema`, which the web app mirrors;
//   - `independence.ratio` is null rather than a fabricated zero, and
//     `milestones` is an empty array rather than a missing key;
//   - the SERIALISED payload carries no `ratio` under `momentum` and no `/100`
//     anywhere — PRD P13 enforced against the wire, not against a comment;
//   - one user's commitments never reach another user's numbers.
// =============================================================================

const DAY = 86_400_000;

describe('Progress (integration)', () => {
  let context: TestContext;
  let user: TestUser;

  const commitmentRow = (over: Record<string, unknown> = {}) => ({
    id: randomUUID(),
    userId: 'owner',
    domain: 'HEALTH',
    scheduledStart: new Date(Date.now() - 2 * DAY),
    status: 'COMPLETED',
    rescheduleCount: 0,
    versionUsed: null,
    completedAt: new Date(Date.now() - 2 * DAY),
    commitmentType: 'workout',
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
    context.prismaMock.userProfile.findUnique.mockResolvedValue(null);
    context.prismaMock.commitment.findMany.mockResolvedValue([]);
    context.prismaMock.commitment.groupBy.mockResolvedValue([]);
    context.prismaMock.evidence.findMany.mockResolvedValue([]);
    context.prismaMock.memoryInsight.findMany.mockResolvedValue([]);
  });

  const getProgress = () =>
    request(context.app.getHttpServer())
      .get('/api/progress')
      .set(authHeader(user.accessToken));

  it('requires a bearer token', async () => {
    await request(context.app.getHttpServer()).get('/api/progress').expect(401);
  });

  it('returns a schema-valid body for a user with no history at all', async () => {
    const res = await getProgress().expect(200);

    const parsed = progressResponseSchema.safeParse(res.body.data);
    expect(parsed.success).toBe(true);
    expect(Object.keys(res.body.data.momentum).sort()).toEqual([
      'FAMILY',
      'HEALTH',
      'WORK',
    ]);
    expect(res.body.data.momentum.WORK.state).toBe('INSUFFICIENT_DATA');
    expect(res.body.data.momentum.WORK.trend).toHaveLength(4);
  });

  it('reports coach dependency as unknown rather than as zero', async () => {
    const res = await getProgress().expect(200);

    expect(res.body.data.independence.ratio).toBeNull();
    expect(res.body.data.milestones).toEqual([]);
  });

  it('counts what the user actually did, and names it in counts', async () => {
    context.prismaMock.commitment.findMany.mockResolvedValue([
      commitmentRow({ scheduledStart: new Date(Date.now() - 2 * DAY) }),
      commitmentRow({ scheduledStart: new Date(Date.now() - 4 * DAY) }),
      commitmentRow({ scheduledStart: new Date(Date.now() - 6 * DAY), versionUsed: 'MINIMUM' }),
      commitmentRow({
        scheduledStart: new Date(Date.now() - 8 * DAY),
        status: 'MISSED',
        completedAt: null,
      }),
    ]);

    const res = await getProgress().expect(200);

    expect(res.body.data.momentum.HEALTH.signals).toMatchObject({
      planned: 4,
      completed: 3,
      fallback: 1,
      missed: 1,
    });
    expect(res.body.data.momentum.HEALTH.evidence[0]).toBe(
      '3 of 4 planned workouts completed',
    );
  });

  it('returns the caller’s confirmed insights only', async () => {
    const id = randomUUID();
    context.prismaMock.memoryInsight.findMany.mockResolvedValue([
      { id, category: 'PATTERN', statement: 'Mornings work better than evenings' },
    ]);

    const res = await getProgress().expect(200);

    expect(res.body.data.insights).toEqual([
      { id, category: 'PATTERN', statement: 'Mornings work better than evenings' },
    ]);
    expect(context.prismaMock.memoryInsight.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userConfirmed: true, doNotUse: false }),
      }),
    );
  });

  it('scopes every read to the calling user', async () => {
    await getProgress().expect(200);

    for (const call of context.prismaMock.commitment.findMany.mock.calls) {
      expect(call[0].where.userId).toBeDefined();
    }
    expect(context.prismaMock.memoryInsight.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: expect.any(String) }) }),
    );
  });

  it('never puts a score, a percentage or a momentum ratio on the wire', async () => {
    context.prismaMock.commitment.findMany.mockResolvedValue([
      commitmentRow(),
      commitmentRow({ scheduledStart: new Date(Date.now() - 3 * DAY) }),
      commitmentRow({
        scheduledStart: new Date(Date.now() - 5 * DAY),
        status: 'MISSED',
        completedAt: null,
      }),
    ]);

    const res = await getProgress().expect(200);
    const body = JSON.stringify(res.body.data);

    expect(body).not.toContain('/100');
    expect(body.match(/"ratio"/g)).toEqual(['"ratio"']); // independence only
    for (const domain of ['WORK', 'FAMILY', 'HEALTH']) {
      expect(res.body.data.momentum[domain].ratio).toBeUndefined();
      expect(res.body.data.momentum[domain].signals.ratio).toBeUndefined();
      for (const bullet of res.body.data.momentum[domain].evidence) {
        expect(bullet).not.toMatch(/\d+\s*%|\/\s*100/);
      }
    }
  });
});
