import request from 'supertest';
import { randomUUID } from 'crypto';

import { TestContext, createTestApp, closeTestApp } from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { createMockContributorUser, authHeader, TestUser } from '../helpers/auth-mock.helper';
import { AiGatewayService } from '../../src/ai/gateway/ai-gateway.service';
import { EmailSettingsService } from '../../src/email';

// =============================================================================
// The coaching engine end to end over HTTP (issue #59, epic E12)
// =============================================================================
//
// What only a full request proves: that the pipeline the cron runs — scan,
// decide, write copy, dispatch, record — actually connects. The unit specs each
// prove one link of it against mocks; this one drives the REAL `runOnce`
// through the same `POST /auth/test/run-job` route the e2e suite uses, with a
// simulated clock so the assertions are about rules rather than about timing.
// =============================================================================

const COMMITMENT_ID = '11111111-1111-4111-8111-111111111111';
/**
 * The SENT row's id. A REAL uuid on purpose: every coaching payload declares
 * `sentInteractionId` as a uuid, so a fixture like `'sent-1'` would fail schema
 * validation inside the browser template and the whole notification would be
 * recorded as a delivery failure — which is exactly what the production code
 * should do, and exactly why the fixture has to be honest.
 */
const SENT_ID = '33333333-3333-4333-8333-333333333333';

/** 12:00 in Costa Rica, outside every quiet window unless one is configured. */
const NOW = new Date('2026-09-08T18:00:00.000Z');
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

describe('Coaching notifications (integration)', () => {
  let context: TestContext;
  let user: TestUser;
  let gateway: { invoke: jest.Mock };

  const commitment = (over: Record<string, unknown> = {}) => ({
    id: COMMITMENT_ID,
    userId: 'will-be-replaced',
    domain: 'HEALTH',
    title: 'Upper A',
    outcomeId: null,
    planVersionId: null,
    routineId: null,
    scheduledStart: minutes(20),
    scheduledEnd: null,
    importance: 4,
    commitmentType: null,
    fullVersion: 'Upper A',
    shortVersion: 'Upper A short',
    minimumVersion: '10-minute Upper A',
    fullMinutes: 38,
    shortMinutes: 20,
    minimumMinutes: 10,
    status: 'PLANNED',
    rescheduleCount: 0,
    rescheduledFromId: null,
    skipReason: null,
    skipNote: null,
    userConfirmed: false,
    startedAt: null,
    completedAt: null,
    activeSince: null,
    activeSeconds: 0,
    timerMinutes: null,
    versionUsed: null,
    minutesSpent: null,
    steps: null,
    decomposedFromId: null,
    ritualId: null,
    familyMemberId: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    ...over,
  });

  beforeAll(async () => {
    gateway = { invoke: jest.fn() };
    context = await createTestApp({
      useMockDatabase: true,
      overrideProviders: [
        { provide: AiGatewayService, useValue: gateway },
        {
          provide: EmailSettingsService,
          useValue: { get: jest.fn().mockResolvedValue({ enabled: false }) },
        },
      ],
    });
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(async () => {
    resetPrismaMock();
    setupBaseMocks();
    gateway.invoke.mockReset();
    // No key by default: the commonest real state, and the one that must still
    // produce a notification.
    gateway.invoke.mockResolvedValue({
      ok: false,
      invocationId: 'inv',
      error: { code: 'no_user_key', message: 'no key' },
      model: null,
      latencyMs: 1,
    });

    user = await createMockContributorUser(context);

    context.prismaMock.userProfile.findMany.mockResolvedValue([
      { userId: user.id, timezone: 'America/Costa_Rica', quietHoursStart: null },
    ]);
    context.prismaMock.userProfile.findUnique.mockResolvedValue({
      coachingStyle: 'BALANCED',
    });
    context.prismaMock.userProfile.upsert.mockResolvedValue({
      userId: user.id,
      timezone: 'America/Costa_Rica',
      quietHoursStart: null,
      quietHoursEnd: null,
      notificationPolicy: null,
    });
    context.prismaMock.userSettings.findUnique.mockResolvedValue(null);
    context.prismaMock.domainMode.findFirst.mockResolvedValue(null);
    context.prismaMock.commitment.findMany.mockResolvedValue([]);
    context.prismaMock.commitment.count.mockResolvedValue(0);
    context.prismaMock.notificationInteraction.findMany.mockResolvedValue([]);
    context.prismaMock.notificationInteraction.count.mockResolvedValue(0);
    context.prismaMock.notificationInteraction.findFirst.mockResolvedValue(null);
    context.prismaMock.notificationInteraction.create.mockResolvedValue({ id: SENT_ID });
    context.prismaMock.notificationInteraction.findUnique.mockResolvedValue({ meta: {} });
    context.prismaMock.notificationInteraction.update.mockResolvedValue({});
    context.prismaMock.notification.create.mockResolvedValue({
      id: 'notif-1',
      createdAt: NOW,
    });
    context.prismaMock.notification.findFirst.mockResolvedValue({ id: 'notif-1' });
    context.prismaMock.notificationDelivery.create.mockResolvedValue({ id: 'del-1' });
    context.prismaMock.notificationDelivery.update.mockResolvedValue({ id: 'del-1' });
  });

  const runJob = (body: Record<string, unknown> = {}) =>
    request(context.app.getHttpServer())
      .post('/api/auth/test/run-job')
      .set(authHeader(user.accessToken))
      .send({ job: 'coaching-notifications', now: NOW.toISOString(), ...body });

  const withCommitment = (over: Record<string, unknown> = {}) => {
    context.prismaMock.commitment.findMany.mockResolvedValue([
      commitment({ userId: user.id, ...over }),
    ]);
  };

  const inboxRow = () =>
    context.prismaMock.notification.create.mock.calls[0]?.[0].data as Record<
      string,
      unknown
    >;
  const interactionRows = () =>
    context.prismaMock.notificationInteraction.create.mock.calls.map(
      (call: [{ data: Record<string, unknown> }]) => call[0].data,
    );

  it('requires a bearer token', async () => {
    await request(context.app.getHttpServer())
      .post('/api/auth/test/run-job')
      .send({ job: 'coaching-notifications' })
      .expect(401);
  });

  it('rejects a job it does not know', async () => {
    await runJob({ job: 'delete-everything' }).expect(400);
  });

  it('reports zero counts when there is nothing to say', async () => {
    const res = await runJob().expect(201);

    expect(res.body.data).toMatchObject({ scanned: 0, sent: 0, suppressed: 0 });
  });

  describe('a commitment twenty minutes out', () => {
    beforeEach(() => {
      withCommitment();
    });

    it('sends one notification', async () => {
      const res = await runJob().expect(201);

      expect(res.body.data).toMatchObject({ scanned: 1, sent: 1, suppressed: 0 });
    });

    it('writes an inbox row whose link lands on the action', async () => {
      await runJob().expect(201);

      expect(inboxRow().eventKey).toBe('coach.commitment_upcoming');
      expect(inboxRow().link).toBe(
        `/today?commitment=${COMMITMENT_ID}&action=start&n=${SENT_ID}`,
      );
    });

    // PRD §120 at its narrowest: the coach's words are the optional part, never
    // the message. This user has no key at all.
    it('uses the deterministic copy when the coach is unavailable', async () => {
      await runJob().expect(201);

      expect(inboxRow().title).toBe('Upper A starts in 20 minutes');
    });

    it('records the decision with its category and lead time', async () => {
      await runJob().expect(201);

      const [row] = interactionRows();
      expect(row).toMatchObject({
        kind: 'SENT',
        eventKey: 'coach.commitment_upcoming',
        dedupeKey: COMMITMENT_ID,
      });
      expect(row.meta).toMatchObject({ category: 'N1', leadMinutes: 20 });
    });

    it('closes the attribution chain back to the inbox row', async () => {
      await runJob().expect(201);

      expect(context.prismaMock.notification.findFirst.mock.calls[0][0]).toMatchObject({
        where: { link: { contains: `n=${SENT_ID}` } },
      });
    });

    it('uses the AI copy when the coach is available and clean', async () => {
      gateway.invoke.mockResolvedValue({
        ok: true,
        invocationId: 'inv',
        output: { title: 'Upper A in twenty', body: 'Shoes by the door.', actionLabel: 'Start' },
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        model: 'gpt-test',
        latencyMs: 10,
      });

      await runJob().expect(201);

      expect(inboxRow().title).toBe('Upper A in twenty');
    });

    // PRD §129, proved through the whole stack rather than in the copywriter's
    // own unit test: the shaming sentence never reaches the inbox.
    it('falls back to the template when the coach says something it must not', async () => {
      gateway.invoke.mockResolvedValue({
        ok: true,
        invocationId: 'inv',
        output: {
          title: "Don't let yourself down",
          body: 'You promised.',
          actionLabel: 'Start',
        },
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        model: 'gpt-test',
        latencyMs: 10,
      });

      await runJob().expect(201);

      expect(inboxRow().title).toBe('Upper A starts in 20 minutes');
    });
  });

  describe('idempotency', () => {
    it('says nothing a second time', async () => {
      withCommitment();
      context.prismaMock.notificationInteraction.findMany.mockResolvedValue([
        {
          userId: user.id,
          eventKey: 'coach.commitment_upcoming',
          dedupeKey: COMMITMENT_ID,
        },
      ]);

      const res = await runJob().expect(201);

      expect(res.body.data).toMatchObject({ scanned: 0, sent: 0 });
      expect(context.prismaMock.notification.create).not.toHaveBeenCalled();
    });
  });

  describe('the policy, through the whole stack', () => {
    it('suppresses inside quiet hours, in the user’s own zone', async () => {
      withCommitment();
      context.prismaMock.userProfile.upsert.mockResolvedValue({
        userId: user.id,
        timezone: 'America/Costa_Rica',
        quietHoursStart: '00:00',
        quietHoursEnd: '23:59',
        notificationPolicy: null,
      });

      const res = await runJob().expect(201);

      expect(res.body.data).toMatchObject({ sent: 0, suppressed: 1 });
      expect(interactionRows()[0]).toMatchObject({
        kind: 'SUPPRESSED',
        suppressReason: 'QUIET_HOURS',
      });
      expect(context.prismaMock.notification.create).not.toHaveBeenCalled();
    });

    // PRD §61: a skip is an answer, not a postponement.
    it('never asks again about something skipped today', async () => {
      withCommitment({
        scheduledStart: minutes(0),
        status: 'SKIPPED',
        updatedAt: NOW,
      });

      const res = await runJob().expect(201);

      expect(res.body.data).toMatchObject({ sent: 0, suppressed: 1 });
      expect(interactionRows()[0]).toMatchObject({ suppressReason: 'SKIPPED' });
    });

    it('suppresses a start cue for something already finished', async () => {
      withCommitment({
        scheduledStart: minutes(0),
        status: 'COMPLETED',
        completedAt: new Date(NOW.getTime() - 60 * 60_000),
      });

      const res = await runJob().expect(201);

      expect(res.body.data).toMatchObject({ sent: 0, suppressed: 1 });
      expect(interactionRows()[0]).toMatchObject({ suppressReason: 'ALREADY_DONE' });
    });

    it('respects a paused domain', async () => {
      withCommitment();
      context.prismaMock.domainMode.findFirst.mockResolvedValue({ mode: 'PAUSE' });

      const res = await runJob().expect(201);

      expect(interactionRows()[0]).toMatchObject({ suppressReason: 'DOMAIN_PAUSED' });
    });

    it('respects a muted category', async () => {
      withCommitment();
      context.prismaMock.userProfile.upsert.mockResolvedValue({
        userId: user.id,
        timezone: 'America/Costa_Rica',
        quietHoursStart: null,
        quietHoursEnd: null,
        notificationPolicy: { mutedCategories: ['coach.commitment_upcoming'] },
      });

      const res = await runJob().expect(201);

      expect(interactionRows()[0]).toMatchObject({ suppressReason: 'MUTED' });
    });

    it('respects the per-commitment maximum before the daily cap', async () => {
      withCommitment();
      context.prismaMock.notificationInteraction.count.mockResolvedValue(4);

      await runJob().expect(201);

      expect(interactionRows()[0]).toMatchObject({
        suppressReason: 'PER_COMMITMENT_MAX',
      });
    });

    it('respects the daily cap', async () => {
      withCommitment();
      // `history()` counts today, then the week, then this commitment.
      context.prismaMock.notificationInteraction.count
        .mockResolvedValueOnce(4)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);

      const res = await runJob().expect(201);

      expect(interactionRows()[0]).toMatchObject({ suppressReason: 'DAILY_CAP' });
    });
  });

  describe('the family cue', () => {
    it('offers "I\'m in" rather than a start', async () => {
      withCommitment({
        id: randomUUID(),
        domain: 'FAMILY',
        title: 'Phone-free dinner',
        scheduledStart: minutes(15),
      });

      await runJob().expect(201);

      expect(inboxRow().eventKey).toBe('coach.family_presence');
      expect(inboxRow().link).toContain('action=in');
      expect(inboxRow().title).toBe('Phone-free dinner starts in 15 minutes');
    });
  });
});
