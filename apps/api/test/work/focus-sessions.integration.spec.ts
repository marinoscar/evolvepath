import request from 'supertest';
import { randomUUID } from 'crypto';

import { TestContext, createTestApp, closeTestApp } from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { createMockContributorUser, authHeader, TestUser } from '../helpers/auth-mock.helper';

// =============================================================================
// Focus sessions over HTTP (issue #110, epic E07)
// =============================================================================
//
// The service spec proves the delegation. What only a real request can show is
// the round trip — start, active, extend, note, stop — and that every route
// answers 404 for somebody else's session rather than confirming it exists.
// =============================================================================

describe('Focus sessions (integration)', () => {
  let context: TestContext;
  let user: TestUser;

  const commitmentId = randomUUID();
  const sessionId = randomUUID();
  const now = new Date();

  const commitmentRow = (over: Record<string, unknown> = {}) => ({
    id: commitmentId,
    userId: 'owner',
    domain: 'WORK',
    title: 'Storyline',
    status: 'PLANNED',
    scheduledStart: now,
    scheduledEnd: null,
    activeSince: null,
    activeSeconds: 600,
    timerMinutes: 25,
    startedAt: now,
    completedAt: null,
    rescheduleCount: 0,
    importance: 3,
    fullVersion: null,
    shortVersion: null,
    minimumVersion: null,
    fullMinutes: null,
    shortMinutes: null,
    minimumMinutes: null,
    versionUsed: null,
    minutesSpent: null,
    outcomeId: null,
    planVersionId: null,
    routineId: null,
    workoutTemplateId: null,
    ritualId: null,
    familyMemberId: null,
    decomposedFromId: null,
    steps: null,
    skipReason: null,
    skipNote: null,
    userConfirmed: false,
    rescheduledFromId: null,
    workMilestoneId: null,
    commitmentType: 'FOCUS_SESSION',
    createdAt: now,
    updatedAt: now,
    ...over,
  });

  const sessionRow = (over: Record<string, unknown> = {}) => ({
    id: sessionId,
    userId: 'owner',
    commitmentId,
    plannedMinutes: 25,
    instruction: 'Write the decision sentence',
    startedAt: now,
    endedAt: null,
    outcome: null,
    actualMinutes: null,
    continuedCount: 0,
    distractionNotes: [],
    evidenceId: null,
    createdAt: now,
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
    context.prismaMock.commitment.findFirst.mockResolvedValue(commitmentRow());
    context.prismaMock.commitment.findUnique.mockResolvedValue(commitmentRow());
    context.prismaMock.commitment.findMany.mockResolvedValue([]);
    // Echo the update back, so `stop` sees the status E05-02 actually wrote
    // rather than a fixture that always says STARTED.
    context.prismaMock.commitment.update.mockImplementation(async ({ data }: never) =>
      commitmentRow({ status: 'STARTED', activeSince: now, ...(data as object) }),
    );
    context.prismaMock.evidence.create.mockResolvedValue({ id: 'evidence-1' });
    context.prismaMock.focusSession.findFirst.mockResolvedValue(null);
    context.prismaMock.focusSession.findMany.mockResolvedValue([]);
    context.prismaMock.focusSession.create.mockResolvedValue(sessionRow());
    context.prismaMock.focusSession.update.mockResolvedValue(sessionRow());
    context.prismaMock.$transaction.mockImplementation(async (fn: never) =>
      typeof fn === 'function' ? (fn as (tx: unknown) => unknown)(context.prismaMock) : fn,
    );
  });

  const server = () => context.app.getHttpServer();

  describe('authentication', () => {
    it.each([
      ['post', '/api/focus-sessions'],
      ['get', '/api/focus-sessions/active'],
      ['get', '/api/focus-sessions'],
      ['post', `/api/focus-sessions/${sessionId}/extend`],
      ['post', `/api/focus-sessions/${sessionId}/note`],
      ['post', `/api/focus-sessions/${sessionId}/stop`],
    ])('refuses an unauthenticated %s %s', async (method, path) => {
      await (request(server()) as never as Record<string, (p: string) => request.Test>)
        [method](path)
        .expect(401);
    });
  });

  it('starts, reads, extends, notes and stops a session', async () => {
    const start = await request(server())
      .post('/api/focus-sessions')
      .set(authHeader(user.accessToken))
      .send({ commitmentId, plannedMinutes: 25, instruction: 'Write the decision sentence' })
      .expect(201);

    expect(start.body.data.id).toBe(sessionId);
    expect(start.body.data.commitment.timer).toBeTruthy();

    context.prismaMock.focusSession.findFirst.mockResolvedValue({
      ...sessionRow(),
      commitment: commitmentRow({ status: 'STARTED', activeSince: now }),
    });

    const active = await request(server())
      .get('/api/focus-sessions/active')
      .set(authHeader(user.accessToken))
      .expect(200);

    expect(active.body.data.session.id).toBe(sessionId);
    expect(active.body.data.serverNow).toEqual(expect.any(String));

    // The commitment is running now: `continue` and `pause` are only available
    // on a STARTED row, and E05-02 checks the row, not our say-so.
    context.prismaMock.commitment.findFirst.mockResolvedValue(
      commitmentRow({ status: 'STARTED', activeSince: now }),
    );
    context.prismaMock.commitment.findUnique.mockResolvedValue(
      commitmentRow({ status: 'STARTED', activeSince: now }),
    );
    context.prismaMock.focusSession.update.mockResolvedValue(
      sessionRow({ plannedMinutes: 40, continuedCount: 1 }),
    );

    const extended = await request(server())
      .post(`/api/focus-sessions/${sessionId}/extend`)
      .set(authHeader(user.accessToken))
      .send({ minutes: 15 })
      .expect(200);

    expect(extended.body.data.plannedMinutes).toBe(40);
    expect(extended.body.data.continuedCount).toBe(1);

    context.prismaMock.focusSession.update.mockResolvedValue(
      sessionRow({ distractionNotes: ['Checked Slack'] }),
    );

    const noted = await request(server())
      .post(`/api/focus-sessions/${sessionId}/note`)
      .set(authHeader(user.accessToken))
      .send({ text: 'Checked Slack' })
      .expect(200);

    expect(noted.body.data.distractionNotes).toEqual(['Checked Slack']);

    context.prismaMock.focusSession.update.mockResolvedValue(
      sessionRow({ endedAt: now, outcome: 'PARTIAL', actualMinutes: 10, evidenceId: 'evidence-1' }),
    );

    const stopped = await request(server())
      .post(`/api/focus-sessions/${sessionId}/stop`)
      .set(authHeader(user.accessToken))
      .send({ outcome: 'partial' })
      .expect(200);

    expect(stopped.body.data).toMatchObject({
      evidenceId: 'evidence-1',
      commitmentStatus: 'PARTIALLY_COMPLETED',
      actualMinutes: 10,
    });
    expect(context.prismaMock.evidence.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ source: 'TIMER', evidenceType: 'focus_session' }),
      }),
    );
  });

  it('answers 409 with the running session id when one is already open', async () => {
    context.prismaMock.focusSession.findFirst.mockResolvedValue(
      sessionRow({ id: 'other-session', commitmentId: 'other-commitment' }),
    );

    const res = await request(server())
      .post('/api/focus-sessions')
      .set(authHeader(user.accessToken))
      .send({ commitmentId, plannedMinutes: 25 })
      .expect(409);

    expect(res.body.details).toMatchObject({
      reason: 'FOCUS_SESSION_ACTIVE',
      activeSessionId: 'other-session',
    });
  });

  it.each([
    ['extend', { minutes: 15 }],
    ['note', { text: 'x' }],
    ['stop', { outcome: 'done' }],
  ])("answers 404 on %s for another user's session", async (route, body) => {
    context.prismaMock.focusSession.findFirst.mockResolvedValue(null);

    await request(server())
      .post(`/api/focus-sessions/${sessionId}/${route}`)
      .set(authHeader(user.accessToken))
      .send(body)
      .expect(404);
  });

  it('refuses a non-WORK commitment with 400', async () => {
    context.prismaMock.commitment.findFirst.mockResolvedValue(commitmentRow({ domain: 'FAMILY' }));

    const res = await request(server())
      .post('/api/focus-sessions')
      .set(authHeader(user.accessToken))
      .send({ commitmentId, plannedMinutes: 25 })
      .expect(400);

    expect(res.body.details).toMatchObject({ reason: 'COMMITMENT_NOT_WORK' });
  });

  it('filters the list by commitment', async () => {
    context.prismaMock.focusSession.findMany.mockResolvedValue([
      { ...sessionRow({ endedAt: now, outcome: 'DONE' }), commitment: commitmentRow() },
    ]);

    const res = await request(server())
      .get(`/api/focus-sessions?commitmentId=${commitmentId}`)
      .set(authHeader(user.accessToken))
      .expect(200);

    expect(res.body.data.sessions).toHaveLength(1);
    expect(context.prismaMock.focusSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ commitmentId }) }),
    );
  });
});
