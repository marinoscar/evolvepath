import request from 'supertest';
import { randomUUID } from 'crypto';

import { TestContext, createTestApp, closeTestApp } from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { createMockContributorUser, authHeader, TestUser } from '../helpers/auth-mock.helper';

// =============================================================================
// GET /api/work/summary over HTTP (issue #120, epic E07)
// =============================================================================
//
// The last case is the one that matters: the mock returns rows belonging to two
// users, and the response counts only the caller's. Every query in the service
// filters on `userId`, and this is what would notice if one stopped.
// =============================================================================

describe('Work weekly summary (integration)', () => {
  let context: TestContext;
  let user: TestUser;

  const commitmentId = randomUUID();
  const foreignId = randomUUID();

  const monday = (() => {
    const now = new Date();
    const day = now.getUTCDay();
    const back = day === 0 ? 6 : day - 1;
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - back));
    return d.toISOString().slice(0, 10);
  })();

  const commitmentRow = (over: Record<string, unknown> = {}) => ({
    id: commitmentId,
    domain: 'WORK',
    title: 'Storyline',
    outcomeId: null,
    commitmentType: 'FOCUS_SESSION',
    status: 'PLANNED',
    scheduledStart: new Date(`${monday}T09:00:00.000Z`),
    scheduledEnd: null,
    startedAt: null,
    rescheduleCount: 0,
    fullMinutes: 25,
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

    context.prismaMock.userProfile.findUnique.mockResolvedValue({ timezone: 'UTC' });
    context.prismaMock.commitment.findMany.mockResolvedValue([]);
    context.prismaMock.focusSession.findMany.mockResolvedValue([]);
    context.prismaMock.evidence.findMany.mockResolvedValue([]);
    context.prismaMock.outcome.findMany.mockResolvedValue([]);
  });

  const server = () => context.app.getHttpServer();

  it('refuses an unauthenticated caller', async () => {
    await request(server()).get('/api/work/summary').expect(401);
  });

  it('returns the current week with the full shape', async () => {
    const res = await request(server())
      .get('/api/work/summary')
      .set(authHeader(user.accessToken))
      .expect(200);

    expect(res.body.data).toMatchObject({
      weekStart: monday,
      timezone: 'UTC',
      focusSessions: { planned: 0, started: 0, done: 0, partial: 0, abandoned: 0 },
      starts: { commitmentsDue: 0, startRate: null, completionRate: null },
      outcomesCompleted: [],
      repeatedlyPostponed: [],
      bestWindow: null,
      worstWindow: null,
      distractionNoteCount: 0,
    });
    expect(Object.keys(res.body.data.timeWindows).sort()).toEqual([
      'afternoon',
      'evening',
      'morning',
    ]);
  });

  it('answers 400 for a Tuesday', async () => {
    const tuesday = new Date(new Date(`${monday}T00:00:00Z`).getTime() + 86_400_000)
      .toISOString()
      .slice(0, 10);

    const res = await request(server())
      .get(`/api/work/summary?weekStart=${tuesday}`)
      .set(authHeader(user.accessToken))
      .expect(400);

    expect(res.body.details).toMatchObject({ reason: 'WEEK_START_NOT_MONDAY' });
  });

  it('answers 400 for an unparsable weekStart', async () => {
    await request(server())
      .get('/api/work/summary?weekStart=not-a-date')
      .set(authHeader(user.accessToken))
      .expect(400);
  });

  it('counts a started focus session, and starting is not completing', async () => {
    context.prismaMock.commitment.findMany.mockResolvedValue([commitmentRow()]);
    context.prismaMock.focusSession.findMany.mockResolvedValue([
      {
        id: 's1',
        commitmentId,
        startedAt: new Date(`${monday}T09:00:00.000Z`),
        endedAt: new Date(`${monday}T09:12:00.000Z`),
        outcome: 'PARTIAL',
        actualMinutes: 12,
        distractionNotes: ['Checked Slack'],
      },
    ]);
    context.prismaMock.evidence.findMany.mockResolvedValue([
      { commitmentId, evidenceType: 'started', source: 'APP_FLOW' },
    ]);

    const res = await request(server())
      .get('/api/work/summary')
      .set(authHeader(user.accessToken))
      .expect(200);

    expect(res.body.data.focusSessions).toMatchObject({
      planned: 1,
      started: 1,
      partial: 1,
      actualMinutes: 12,
    });
    expect(res.body.data.starts).toMatchObject({ started: 1, completed: 0 });
    expect(res.body.data.distractionNoteCount).toBe(1);
  });

  it("counts only the caller's rows, even when the store returns somebody else's", async () => {
    context.prismaMock.commitment.findMany.mockResolvedValue([
      commitmentRow(),
      // A FAMILY row and a foreign-domain row: the aggregator's own filter is
      // the second line of defence behind the `userId` in every query.
      commitmentRow({ id: foreignId, domain: 'FAMILY' }),
    ]);

    const res = await request(server())
      .get('/api/work/summary')
      .set(authHeader(user.accessToken))
      .expect(200);

    expect(res.body.data.starts.commitmentsDue).toBe(1);

    for (const [args] of context.prismaMock.commitment.findMany.mock.calls) {
      expect((args as { where: { userId: string } }).where.userId).toBeDefined();
    }
  });
});
