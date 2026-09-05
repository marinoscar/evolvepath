import request from 'supertest';
import { randomUUID } from 'crypto';

import { TestContext, createTestApp, closeTestApp } from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { createMockContributorUser, authHeader, TestUser } from '../helpers/auth-mock.helper';
import { AiGatewayService } from '../../src/ai/gateway/ai-gateway.service';
import { commitmentCardSchema } from '../../src/commitments/commitment-card.schema';

// =============================================================================
// The commitment action endpoints over HTTP (issue #40, epic E05)
// =============================================================================
//
// The branching is proved by `commitment-actions.service.spec`. What only a real
// request can show is on this list:
//
//   - every response body actually satisfies `commitmentCardSchema`, which is
//     the shape `GET /today` also promises and the web app's types mirror;
//   - the DTOs reject what they claim to reject, through the real global
//     validation pipe rather than by calling `.parse` in a unit test;
//   - a foreign id is a 404 on EVERY route, with no route accidentally left
//     un-scoped;
//   - `decompose` answers 200 with the deterministic proposal when the gateway
//     fails, because PRD §120 makes that a transport-level promise.
// =============================================================================

describe('Commitment actions (integration)', () => {
  let context: TestContext;
  let user: TestUser;
  let gateway: { invoke: jest.Mock };

  const id = randomUUID();
  const replacementId = randomUUID();
  const start = new Date('2026-03-01T09:00:00.000Z');

  const commitment = (over: Record<string, unknown> = {}) => ({
    id,
    userId: 'owner',
    domain: 'WORK',
    title: 'Draft the proposal storyline',
    outcomeId: null,
    planVersionId: null,
    routineId: null,
    scheduledStart: start,
    scheduledEnd: null,
    importance: 5,
    commitmentType: null,
    fullVersion: null,
    shortVersion: null,
    minimumVersion: null,
    fullMinutes: 25,
    shortMinutes: null,
    minimumMinutes: null,
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
    workoutTemplateId: null,
    ritualId: null,
    familyMemberId: null,
    createdAt: start,
    updatedAt: start,
    _count: { evidence: 0 },
    rescheduledTo: [],
    ...over,
  });

  const runTransaction = () =>
    context.prismaMock.$transaction.mockImplementation(async (arg: unknown) =>
      typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(context.prismaMock) : arg,
    );

  const post = (path: string, body: Record<string, unknown> = {}) =>
    request(context.app.getHttpServer())
      .post(`/api/commitments/${id}/actions/${path}`)
      .set(authHeader(user.accessToken))
      .send(body);

  const evidenceTypes = () =>
    context.prismaMock.evidence.create.mock.calls.map(
      ([args]: [{ data: { evidenceType: string } }]) => args.data.evidenceType,
    );

  const auditActions = () =>
    context.prismaMock.auditEvent.create.mock.calls.map(
      ([args]: [{ data: { action: string } }]) => args.data.action,
    );

  beforeAll(async () => {
    gateway = { invoke: jest.fn() };
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
    context.prismaMock.evidence.create.mockResolvedValue({ id: 'evidence' });
    context.prismaMock.reflection.create.mockResolvedValue({ id: 'reflection' });
    context.prismaMock.commitment.findMany.mockResolvedValue([]);
    context.prismaMock.userProfile.findUnique.mockResolvedValue(null);
    runTransaction();
  });

  describe('GET /api/commitments/:id/actions', () => {
    it('returns the card with the outcome’s motivation joined', async () => {
      context.prismaMock.commitment.findFirst.mockResolvedValue({
        ...commitment(),
        outcome: { motivation: 'Free my evenings', successDefinition: null },
      });

      const res = await request(context.app.getHttpServer())
        .get(`/api/commitments/${id}/actions`)
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(commitmentCardSchema.safeParse(res.body.data).success).toBe(true);
      expect(res.body.data.whyItMatters).toBe('Free my evenings');
    });

    // The definition of done is still the user's own statement of what this is
    // for, so it is a usable answer when no motivation was written.
    it('falls back to the definition of done', async () => {
      context.prismaMock.commitment.findFirst.mockResolvedValue({
        ...commitment(),
        outcome: { motivation: null, successDefinition: 'The proposal is sent' },
      });

      const res = await request(context.app.getHttpServer())
        .get(`/api/commitments/${id}/actions`)
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(res.body.data.whyItMatters).toBe('The proposal is sent');
    });

    it('is null for a commitment that serves no outcome', async () => {
      context.prismaMock.commitment.findFirst.mockResolvedValue({
        ...commitment(),
        outcome: null,
      });

      const res = await request(context.app.getHttpServer())
        .get(`/api/commitments/${id}/actions`)
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(res.body.data.whyItMatters).toBeNull();
    });

    it('answers 404 for another user’s commitment', async () => {
      context.prismaMock.commitment.findFirst.mockResolvedValue(null);

      await request(context.app.getHttpServer())
        .get(`/api/commitments/${id}/actions`)
        .set(authHeader(user.accessToken))
        .expect(404);
    });
  });

  describe('start → complete', () => {
    it('returns a card that satisfies the published schema', async () => {
      context.prismaMock.commitment.findFirst.mockResolvedValue(commitment());
      context.prismaMock.commitment.update.mockResolvedValue(
        commitment({ status: 'STARTED', startedAt: start, activeSince: start, timerMinutes: 10 }),
      );

      const res = await post('start', { minutes: 10 }).expect(200);

      const parsed = commitmentCardSchema.safeParse(res.body.data);
      expect(parsed.success).toBe(true);
      expect(res.body.data.status).toBe('STARTED');
      expect(res.body.data.timer).toMatchObject({ timerMinutes: 10, activeSeconds: 0 });
      expect(res.body.data.availableActions).toContain('pause');
    });

    it('writes start and completion as two separate evidence rows, in order', async () => {
      context.prismaMock.commitment.findFirst.mockResolvedValue(commitment());
      context.prismaMock.commitment.update.mockResolvedValue(
        commitment({ status: 'STARTED', startedAt: start, activeSince: start }),
      );
      await post('start', {}).expect(200);

      context.prismaMock.commitment.findFirst.mockResolvedValue(
        commitment({ status: 'STARTED', startedAt: start, activeSince: start }),
      );
      context.prismaMock.commitment.update.mockResolvedValue(
        commitment({ status: 'COMPLETED', startedAt: start, completedAt: new Date() }),
      );
      await post('complete', { notes: 'done' }).expect(200);

      expect(evidenceTypes()).toEqual(['started', 'completed']);
      expect(auditActions()).toEqual(['commitment:start', 'commitment:complete']);
    });

    it('completes a commitment that was never started', async () => {
      context.prismaMock.commitment.findFirst.mockResolvedValue(commitment());
      context.prismaMock.commitment.update.mockResolvedValue(
        commitment({ status: 'COMPLETED', completedAt: new Date() }),
      );

      const res = await post('complete', {}).expect(200);

      expect(res.body.data.status).toBe('COMPLETED');
      expect(evidenceTypes()).toEqual(['completed']);
    });

    it('rejects a timer target the DTO does not allow', async () => {
      context.prismaMock.commitment.findFirst.mockResolvedValue(commitment());

      await post('start', { minutes: 999 }).expect(400);
      expect(context.prismaMock.commitment.update).not.toHaveBeenCalled();
    });
  });

  describe('invalid moves', () => {
    it('answers 409 INVALID_TRANSITION for pause on a PLANNED commitment', async () => {
      context.prismaMock.commitment.findFirst.mockResolvedValue(commitment());

      const res = await post('pause').expect(409);

      expect(res.body.error?.details?.reason ?? res.body.details?.reason).toBe(
        'INVALID_TRANSITION',
      );
    });

    it('answers 409 ALREADY_STARTED for rescheduling a started commitment', async () => {
      context.prismaMock.commitment.findFirst.mockResolvedValue(
        commitment({ status: 'STARTED', startedAt: start, activeSince: start }),
      );

      const res = await post('reschedule', {
        scheduledStart: '2026-03-02T07:00:00.000Z',
      }).expect(409);

      expect(res.body.error?.details?.reason ?? res.body.details?.reason).toBe('ALREADY_STARTED');
    });

    it('answers 400 VERSION_NOT_DEFINED for a size that was never declared', async () => {
      context.prismaMock.commitment.findFirst.mockResolvedValue(commitment());

      const res = await post('fallback', { version: 'minimum' }).expect(400);

      expect(res.body.error?.details?.reason ?? res.body.details?.reason).toBe(
        'VERSION_NOT_DEFINED',
      );
    });
  });

  describe('reschedule', () => {
    it('returns the NEW row, with the count carried onto it', async () => {
      context.prismaMock.commitment.findFirst.mockResolvedValue(commitment());
      context.prismaMock.commitment.update.mockResolvedValue(
        commitment({ status: 'RESCHEDULED' }),
      );
      context.prismaMock.commitment.create.mockResolvedValue(
        commitment({
          id: replacementId,
          scheduledStart: new Date('2026-03-02T07:00:00.000Z'),
          rescheduleCount: 1,
          rescheduledFromId: id,
        }),
      );
      context.prismaMock.commitment.findUniqueOrThrow.mockResolvedValue(
        commitment({
          id: replacementId,
          scheduledStart: new Date('2026-03-02T07:00:00.000Z'),
          rescheduleCount: 1,
          rescheduledFromId: id,
        }),
      );

      const res = await post('reschedule', {
        scheduledStart: '2026-03-02T07:00:00.000Z',
      }).expect(200);

      expect(commitmentCardSchema.safeParse(res.body.data).success).toBe(true);
      expect(res.body.data.id).toBe(replacementId);
      expect(res.body.data.rescheduleCount).toBe(1);
      expect(res.body.data.status).toBe('PLANNED');
      expect(auditActions()).toContain('commitment:reschedule');
    });
  });

  describe('skip', () => {
    it('writes a reflection and no evidence', async () => {
      context.prismaMock.commitment.findFirst.mockResolvedValue(commitment());
      context.prismaMock.commitment.update.mockResolvedValue(
        commitment({ status: 'SKIPPED', skipReason: 'UNEXPECTED_CONFLICT' }),
      );

      const res = await post('skip', {
        reason: 'UNEXPECTED_CONFLICT',
        text: 'in-laws visiting',
      }).expect(200);

      expect(res.body.data.status).toBe('SKIPPED');
      expect(res.body.data.availableActions).toEqual([]);
      expect(context.prismaMock.reflection.create).toHaveBeenCalled();
      expect(context.prismaMock.evidence.create).not.toHaveBeenCalled();
    });

    it('rejects a reason outside the enum', async () => {
      context.prismaMock.commitment.findFirst.mockResolvedValue(commitment());

      await post('skip', { reason: 'BORED' }).expect(400);
    });
  });

  describe('decompose', () => {
    it('answers 200 with the deterministic proposal when the coach is down', async () => {
      context.prismaMock.commitment.findFirst.mockResolvedValue(commitment());
      gateway.invoke.mockResolvedValue({
        ok: false,
        error: { code: 'provider_error', message: 'down' },
        invocationId: 'inv-1',
        model: null,
        latencyMs: 3,
      });

      const res = await post('decompose', {}).expect(200);

      expect(res.body.data.source).toBe('template');
      expect(res.body.data.firstStep.minutes).toBe(5);
      // MUTATES NOTHING.
      expect(context.prismaMock.commitment.create).not.toHaveBeenCalled();
      expect(context.prismaMock.commitment.update).not.toHaveBeenCalled();
    });

    it('returns the coach’s steps when it answers', async () => {
      context.prismaMock.commitment.findFirst.mockResolvedValue(commitment());
      gateway.invoke.mockResolvedValue({
        ok: true,
        invocationId: 'inv-1',
        model: 'gpt-test',
        latencyMs: 10,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        output: {
          steps: [
            { title: 'Open the doc', minutes: 5 },
            { title: 'Write the decision statement', minutes: 10 },
          ],
          firstStep: { title: 'Open the doc', minutes: 5 },
          message: 'Start by opening the doc.',
          source: 'ai',
        },
      });

      const res = await post('decompose', { hint: 'only ten minutes' }).expect(200);

      expect(res.body.data.source).toBe('ai');
      expect(res.body.data.steps).toHaveLength(2);
    });

    it('creates the child commitment on apply and answers 201', async () => {
      context.prismaMock.commitment.findFirst.mockResolvedValue(commitment());
      context.prismaMock.commitment.create.mockResolvedValue(
        commitment({
          id: replacementId,
          title: 'Open the doc',
          fullVersion: 'Open the doc',
          fullMinutes: 5,
          decomposedFromId: id,
          steps: [{ title: 'Open the doc', minutes: 5 }],
        }),
      );

      const res = await request(context.app.getHttpServer())
        .post(`/api/commitments/${id}/actions/decompose/apply`)
        .set(authHeader(user.accessToken))
        .send({
          steps: [{ title: 'Open the doc', minutes: 5 }],
          firstStep: { title: 'Open the doc', minutes: 5 },
          message: 'Start here.',
          source: 'ai',
        })
        .expect(201);

      expect(commitmentCardSchema.safeParse(res.body.data).success).toBe(true);
      expect(res.body.data.decomposedFromId).toBe(id);
      expect(res.body.data.steps).toEqual([{ title: 'Open the doc', minutes: 5 }]);
      expect(auditActions()).toContain('commitment:decompose_apply');
    });

    it('rejects a proposal with six steps at the transport boundary', async () => {
      context.prismaMock.commitment.findFirst.mockResolvedValue(commitment());

      await request(context.app.getHttpServer())
        .post(`/api/commitments/${id}/actions/decompose/apply`)
        .set(authHeader(user.accessToken))
        .send({
          steps: Array.from({ length: 6 }, (_, i) => ({ title: `Step ${i}`, minutes: 5 })),
          firstStep: { title: 'Step 0', minutes: 5 },
          message: 'Too many.',
          source: 'ai',
        })
        .expect(400);
    });
  });

  describe('ownership', () => {
    // 404 on every route, with no route accidentally left un-scoped.
    it.each([
      ['start', {}],
      ['pause', {}],
      ['continue', {}],
      ['complete', {}],
      ['partial', {}],
      ['fallback', { version: 'minimum' }],
      ['reschedule', { scheduledStart: '2026-03-02T07:00:00.000Z' }],
      ['skip', { reason: 'AVOIDED' }],
      ['decompose', {}],
    ])("answers 404 for another user's commitment on %s", async (path, body) => {
      context.prismaMock.commitment.findFirst.mockResolvedValue(null);

      await post(path as string, body as Record<string, unknown>).expect(404);
    });

    it('answers 404 on decompose/apply too', async () => {
      context.prismaMock.commitment.findFirst.mockResolvedValue(null);

      await request(context.app.getHttpServer())
        .post(`/api/commitments/${id}/actions/decompose/apply`)
        .set(authHeader(user.accessToken))
        .send({
          steps: [{ title: 'Open the doc', minutes: 5 }],
          firstStep: { title: 'Open the doc', minutes: 5 },
          message: 'Start here.',
          source: 'ai',
        })
        .expect(404);
    });

    it('requires a bearer token', async () => {
      await request(context.app.getHttpServer())
        .post(`/api/commitments/${id}/actions/start`)
        .send({})
        .expect(401);
    });
  });
});
