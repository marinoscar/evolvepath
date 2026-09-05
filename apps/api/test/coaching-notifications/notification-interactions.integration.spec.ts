import request from 'supertest';

import { TestContext, createTestApp, closeTestApp } from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { createMockContributorUser, authHeader, TestUser } from '../helpers/auth-mock.helper';

// =============================================================================
// POST /api/notifications/interactions (issue #68, epic E12)
// =============================================================================
//
// The attribution chain closing: a click on a notification becomes a row that
// points back at the decision that produced it. Without this endpoint every
// coaching notification is a page view with no way home, and PRD §64's "which
// messages are acted on" has no answer at all.
// =============================================================================

const SENT_ID = '33333333-3333-4333-8333-333333333333';
const NOTIFICATION_ID = '44444444-4444-4444-8444-444444444444';
const COMMITMENT_ID = '11111111-1111-4111-8111-111111111111';

describe('Notification interactions (integration)', () => {
  let context: TestContext;
  let user: TestUser;

  const sentRow = (over: Record<string, unknown> = {}) => ({
    id: SENT_ID,
    userId: user.id,
    eventKey: 'coach.commitment_upcoming',
    commitmentId: COMMITMENT_ID,
    notificationId: NOTIFICATION_ID,
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
    context.prismaMock.notificationInteraction.create.mockResolvedValue({ id: 'r1' });
    context.prismaMock.notificationInteraction.findFirst.mockResolvedValue(null);
    context.prismaMock.notificationInteraction.findUnique.mockResolvedValue(null);
  });

  const url = '/api/notifications/interactions';
  const post = (body: Record<string, unknown>) =>
    request(context.app.getHttpServer()).post(url).set(authHeader(user.accessToken)).send(body);

  const created = () =>
    (context.prismaMock.notificationInteraction.create.mock.calls[0][0] as any).data;

  it('requires a bearer token', async () => {
    await request(context.app.getHttpServer())
      .post(url)
      .send({ sentInteractionId: SENT_ID, kind: 'OPENED' })
      .expect(401);
  });

  describe('naming the message', () => {
    it('accepts the deep link’s `?n=` directly', async () => {
      context.prismaMock.notificationInteraction.findUnique.mockResolvedValue(sentRow());

      const res = await post({ sentInteractionId: SENT_ID, kind: 'OPENED' }).expect(201);

      expect(res.body.data).toMatchObject({ id: 'r1', kind: 'OPENED' });
    });

    // The bell holds an inbox row, not a decision id. Making it parse a link to
    // find one would be the server's job done in the wrong place.
    it('accepts the bell’s inbox row id and resolves the decision from it', async () => {
      context.prismaMock.notificationInteraction.findFirst
        .mockResolvedValueOnce(sentRow()) // resolve by notificationId
        .mockResolvedValueOnce(null); // the already-opened check

      await post({ notificationId: NOTIFICATION_ID, kind: 'OPENED' }).expect(201);

      expect(created().sentInteractionId).toBe(SENT_ID);
    });

    it('rejects a body that names neither', async () => {
      await post({ kind: 'OPENED' }).expect(400);
    });
  });

  describe('ACTIONED', () => {
    beforeEach(() => {
      context.prismaMock.notificationInteraction.findUnique.mockResolvedValue(sentRow());
    });

    it('records which button was used', async () => {
      await post({ sentInteractionId: SENT_ID, kind: 'ACTIONED', action: 'move' }).expect(201);

      expect(created()).toMatchObject({ kind: 'ACTIONED', action: 'MOVE' });
    });

    it.each([
      ['start', 'START'],
      ['in', 'IN'],
      ['move', 'MOVE'],
      ['short', 'SHORT'],
      ['skip', 'SKIP'],
    ])('maps the URL spelling %s to the stored %s', async (action, stored) => {
      await post({ sentInteractionId: SENT_ID, kind: 'ACTIONED', action }).expect(201);

      expect(created().action).toBe(stored);
    });

    // "They did something" with no record of WHAT cannot answer the only
    // question the row exists for.
    it('refuses an ACTIONED with no action', async () => {
      await post({ sentInteractionId: SENT_ID, kind: 'ACTIONED' }).expect(400);

      expect(context.prismaMock.notificationInteraction.create).not.toHaveBeenCalled();
    });

    it('refuses an action the matrix does not know', async () => {
      await post({
        sentInteractionId: SENT_ID,
        kind: 'ACTIONED',
        action: 'detonate',
      }).expect(400);
    });

    // The event key and commitment are copied from the SENT row, never taken
    // from the request, so a client cannot mislabel a response.
    it('copies the event and commitment from the decision it answers', async () => {
      await post({ sentInteractionId: SENT_ID, kind: 'ACTIONED', action: 'start' }).expect(201);

      expect(created()).toMatchObject({
        eventKey: 'coach.commitment_upcoming',
        commitmentId: COMMITMENT_ID,
      });
    });
  });

  describe('OPENED', () => {
    // Counting re-reads would make the open rate depend on how often somebody
    // revisits their inbox, which measures nothing.
    it('returns the first open for a second one', async () => {
      context.prismaMock.notificationInteraction.findUnique.mockResolvedValue(sentRow());
      context.prismaMock.notificationInteraction.findFirst.mockResolvedValue({
        id: 'already-open',
      });

      const res = await post({ sentInteractionId: SENT_ID, kind: 'OPENED' }).expect(201);

      expect(res.body.data.id).toBe('already-open');
      expect(context.prismaMock.notificationInteraction.create).not.toHaveBeenCalled();
    });
  });

  describe('DISMISSED', () => {
    it('is recorded like any other response', async () => {
      context.prismaMock.notificationInteraction.findUnique.mockResolvedValue(sentRow());

      await post({ sentInteractionId: SENT_ID, kind: 'DISMISSED' }).expect(201);

      expect(created().kind).toBe('DISMISSED');
    });
  });

  describe('ownership', () => {
    // 404, never 403: the same answer an id that never existed gets.
    it('answers 404 for another user’s decision', async () => {
      context.prismaMock.notificationInteraction.findUnique.mockResolvedValue(
        sentRow({ userId: 'somebody-else' }),
      );

      await post({ sentInteractionId: SENT_ID, kind: 'OPENED' }).expect(404);
    });

    it('answers 404 for an id that does not exist', async () => {
      await post({ sentInteractionId: SENT_ID, kind: 'OPENED' }).expect(404);
    });
  });
});
