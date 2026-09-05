import request from 'supertest';

import { TestContext, createTestApp, closeTestApp } from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { createMockContributorUser, authHeader, TestUser } from '../helpers/auth-mock.helper';
import { WebPushProvider } from '../../src/notifications/push/web-push.provider';

// =============================================================================
// Push subscriptions and the public dismissal route (issue #64, epic E12)
// =============================================================================

const SENT_ID = '33333333-3333-4333-8333-333333333333';
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/ABCDEF';

describe('Push subscriptions (integration)', () => {
  let context: TestContext;
  let user: TestUser;
  let webPush: { isConfigured: jest.Mock; getPublicKey: jest.Mock; send: jest.Mock };

  beforeAll(async () => {
    webPush = {
      isConfigured: jest.fn().mockReturnValue(true),
      getPublicKey: jest.fn().mockReturnValue('BPublicKey'),
      send: jest.fn(),
    };
    context = await createTestApp({
      useMockDatabase: true,
      overrideProviders: [{ provide: WebPushProvider, useValue: webPush }],
    });
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(async () => {
    resetPrismaMock();
    setupBaseMocks();
    webPush.getPublicKey.mockReturnValue('BPublicKey');
    user = await createMockContributorUser(context);
    context.prismaMock.pushSubscription.findMany.mockResolvedValue([]);
    context.prismaMock.pushSubscription.upsert.mockResolvedValue({ id: 'sub-1' });
    context.prismaMock.pushSubscription.deleteMany.mockResolvedValue({ count: 1 });
    context.prismaMock.notificationInteraction.findFirst.mockResolvedValue(null);
    context.prismaMock.notificationInteraction.create.mockResolvedValue({ id: 'r1' });
  });

  const auth = () => authHeader(user.accessToken);
  const server = () => context.app.getHttpServer();

  describe('GET /notifications/push/public-key', () => {
    it('returns the public half when the deployment is configured', async () => {
      const res = await request(server())
        .get('/api/notifications/push/public-key')
        .set(auth())
        .expect(200);

      expect(res.body.data).toEqual({ publicKey: 'BPublicKey' });
    });

    // A valid state, not an error: the push channel is simply inactive and the
    // user still gets the inbox row and the live update.
    it('returns null when it is not', async () => {
      webPush.getPublicKey.mockReturnValue(null);

      const res = await request(server())
        .get('/api/notifications/push/public-key')
        .set(auth())
        .expect(200);

      expect(res.body.data).toEqual({ publicKey: null });
    });

    it('requires a bearer token', async () => {
      await request(server()).get('/api/notifications/push/public-key').expect(401);
    });
  });

  describe('POST /notifications/push-subscriptions', () => {
    const body = {
      endpoint: ENDPOINT,
      keys: { p256dh: 'p256', auth: 'auth' },
      userAgent: 'Chrome on Linux',
    };

    it('registers the browser', async () => {
      const res = await request(server())
        .post('/api/notifications/push-subscriptions')
        .set(auth())
        .send(body)
        .expect(201);

      expect(res.body.data).toEqual({ id: 'sub-1' });
    });

    // One browser profile, signed out and signed in as somebody else. The
    // endpoint belongs to the browser, so the account that most recently proved
    // it controls that browser is the one whose coaching should reach it.
    it('upserts on the endpoint, re-owning it for the caller', async () => {
      await request(server())
        .post('/api/notifications/push-subscriptions')
        .set(auth())
        .send(body)
        .expect(201);

      const call = context.prismaMock.pushSubscription.upsert.mock.calls[0][0] as any;
      expect(call.where).toEqual({ endpoint: ENDPOINT });
      expect(call.update.userId).toBe(user.id);
    });

    // A push endpoint is a bearer capability for a device; sending one over
    // plain HTTP hands it to anybody on the path.
    it('refuses an endpoint that is not https', async () => {
      await request(server())
        .post('/api/notifications/push-subscriptions')
        .set(auth())
        .send({ ...body, endpoint: 'http://push.example.test/abc' })
        .expect(400);

      expect(context.prismaMock.pushSubscription.upsert).not.toHaveBeenCalled();
    });

    it('refuses a body with no keys', async () => {
      await request(server())
        .post('/api/notifications/push-subscriptions')
        .set(auth())
        .send({ endpoint: ENDPOINT })
        .expect(400);
    });

    it('requires a bearer token', async () => {
      await request(server())
        .post('/api/notifications/push-subscriptions')
        .send(body)
        .expect(401);
    });
  });

  describe('GET /notifications/push-subscriptions', () => {
    it('lists the host, never the endpoint and never the keys', async () => {
      context.prismaMock.pushSubscription.findMany.mockResolvedValue([
        {
          id: 'sub-1',
          endpoint: ENDPOINT,
          userAgent: 'Chrome on Linux',
          createdAt: new Date('2026-09-01T00:00:00.000Z'),
          lastSeenAt: new Date('2026-09-08T00:00:00.000Z'),
        },
      ]);

      const res = await request(server())
        .get('/api/notifications/push-subscriptions')
        .set(auth())
        .expect(200);

      expect(res.body.data.items[0]).toEqual({
        id: 'sub-1',
        endpointHost: 'fcm.googleapis.com',
        userAgent: 'Chrome on Linux',
        createdAt: '2026-09-01T00:00:00.000Z',
        lastSeenAt: '2026-09-08T00:00:00.000Z',
      });
      expect(JSON.stringify(res.body)).not.toContain('ABCDEF');
      expect(JSON.stringify(res.body)).not.toContain('p256');
    });

    it('scopes the listing to the caller', async () => {
      await request(server())
        .get('/api/notifications/push-subscriptions')
        .set(auth())
        .expect(200);

      expect(context.prismaMock.pushSubscription.findMany.mock.calls[0][0]).toMatchObject(
        { where: { userId: user.id } },
      );
    });
  });

  describe('DELETE /notifications/push-subscriptions', () => {
    it('removes the caller’s own row', async () => {
      await request(server())
        .delete('/api/notifications/push-subscriptions')
        .set(auth())
        .send({ endpoint: ENDPOINT })
        .expect(204);

      expect(context.prismaMock.pushSubscription.deleteMany.mock.calls[0][0]).toEqual({
        where: { userId: user.id, endpoint: ENDPOINT },
      });
    });

    it('is idempotent', async () => {
      context.prismaMock.pushSubscription.deleteMany.mockResolvedValue({ count: 0 });

      await request(server())
        .delete('/api/notifications/push-subscriptions')
        .set(auth())
        .send({ endpoint: ENDPOINT })
        .expect(204);
    });

    it('cannot touch another user’s row', async () => {
      await request(server())
        .delete('/api/notifications/push-subscriptions')
        .set(auth())
        .send({ endpoint: ENDPOINT })
        .expect(204);

      // The userId is in the WHERE, so a foreign endpoint simply matches nothing.
      expect(
        (context.prismaMock.pushSubscription.deleteMany.mock.calls[0][0] as any).where
          .userId,
      ).toBe(user.id);
    });
  });

  describe('POST /notifications/interactions/dismissed', () => {
    const url = '/api/notifications/interactions/dismissed';

    // The whole point: `notificationclose` fires in a service worker with no
    // page, no session and no token.
    it('needs no session at all', async () => {
      const sentRow = {
        id: SENT_ID,
        userId: user.id,
        eventKey: 'coach.commitment_upcoming',
        commitmentId: 'c1',
        notificationId: 'n1',
      };
      // `findSentRowForDismissal` finds it without a caller; `recordResponse`
      // then re-reads it by id to copy the event key and commitment across.
      context.prismaMock.notificationInteraction.findFirst.mockResolvedValue(sentRow);
      context.prismaMock.notificationInteraction.findUnique.mockResolvedValue(sentRow);

      await request(server()).post(url).send({ sentInteractionId: SENT_ID }).expect(204);

      const created = context.prismaMock.notificationInteraction.create.mock
        .calls[0][0] as any;
      expect(created.data.kind).toBe('DISMISSED');
      expect(created.data.sentInteractionId).toBe(SENT_ID);
    });

    // A different answer for a real id would turn this into an oracle for
    // guessing them.
    it('answers 204 for an id that does not exist, and writes nothing', async () => {
      await request(server())
        .post(url)
        .send({ sentInteractionId: '00000000-0000-4000-8000-000000000000' })
        .expect(204);

      expect(context.prismaMock.notificationInteraction.create).not.toHaveBeenCalled();
    });

    it('accepts one field and nothing else', async () => {
      await request(server()).post(url).send({ sentInteractionId: 'nope' }).expect(400);
    });

    it('rejects an empty body', async () => {
      await request(server()).post(url).send({}).expect(400);
    });
  });
});
