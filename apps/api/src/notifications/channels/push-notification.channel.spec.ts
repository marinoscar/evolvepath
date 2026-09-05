import { NOTIFICATION_EVENTS } from '../notification-events';
import type {
  NotificationDispatchContext,
  NotificationRecipient,
} from '../notification.types';
import {
  MAX_PUSH_ACTIONS,
  PUSH_TTL_SECONDS,
  PushNotificationChannel,
  hostOf,
} from './push-notification.channel';

const N = '22222222-2222-4222-8222-222222222222';
const C = '11111111-1111-4111-8111-111111111111';

const recipient: NotificationRecipient = {
  userId: 'user-1',
  email: 'user@example.com',
  preferences: {},
};

const UPCOMING = {
  sentInteractionId: N,
  commitmentId: C,
  domain: 'HEALTH',
  commitmentTitle: 'Upper A',
  scheduledStart: '2026-09-08T15:00:00.000Z',
  minutesUntil: 20,
  startMinutes: 38,
};

const START_CUE = {
  sentInteractionId: N,
  commitmentId: C,
  domain: 'WORK',
  commitmentTitle: 'Draft the storyline',
  startMinutes: 25,
};

function contextFor(eventKey: string, data: unknown): NotificationDispatchContext {
  const event = NOTIFICATION_EVENTS.find((e) => e.key === eventKey);
  if (!event) throw new Error(`Test fixture error: no such event '${eventKey}'.`);
  return { event, recipient, data };
}

const subscription = (over: Record<string, unknown> = {}) => ({
  id: 'sub-1',
  endpoint: 'https://push.example.test/abc',
  keys: { p256dh: 'p', auth: 'a' },
  ...over,
});

describe('PushNotificationChannel (#64)', () => {
  let channel: PushNotificationChannel;
  let prisma: {
    pushSubscription: { findMany: jest.Mock; update: jest.Mock; delete: jest.Mock };
  };
  let webPush: { isConfigured: jest.Mock; send: jest.Mock; getPublicKey: jest.Mock };

  beforeEach(() => {
    prisma = {
      pushSubscription: {
        findMany: jest.fn().mockResolvedValue([subscription()]),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
      },
    };
    webPush = {
      isConfigured: jest.fn().mockReturnValue(true),
      getPublicKey: jest.fn().mockReturnValue('pk'),
      send: jest.fn().mockResolvedValue({ ok: true, gone: false, statusCode: 201 }),
    };
    channel = new PushNotificationChannel(prisma as never, webPush as never);
  });

  describe('resolveTo', () => {
    it('is the user id when push is configured', () => {
      expect(channel.resolveTo(recipient)).toBe('user-1');
    });

    // The dispatcher already logs and skips on null, and the browser channel
    // still writes the inbox row — that IS the fallback, and it needs no branch
    // in this file.
    it('is null when the deployment has no VAPID keys', () => {
      webPush.isConfigured.mockReturnValue(false);

      expect(channel.resolveTo(recipient)).toBeNull();
    });

    it('is null for a recipient with no account', () => {
      expect(channel.resolveTo({ userId: null, email: 'x@y.z', preferences: {} })).toBeNull();
    });
  });

  describe('deliver', () => {
    const deliver = (eventKey = 'coach.commitment_upcoming', data: unknown = UPCOMING) =>
      channel.deliver(contextFor(eventKey, data), 'user-1');

    it('reports a failure, not a crash, when the user has no devices', async () => {
      prisma.pushSubscription.findMany.mockResolvedValue([]);

      await expect(deliver()).resolves.toMatchObject({ success: false });
      expect(webPush.send).not.toHaveBeenCalled();
    });

    it('sends to every device the user has', async () => {
      prisma.pushSubscription.findMany.mockResolvedValue([
        subscription(),
        subscription({ id: 'sub-2', endpoint: 'https://push.example.test/def' }),
      ]);

      const result = await deliver();

      expect(webPush.send).toHaveBeenCalledTimes(2);
      expect(result).toMatchObject({ success: true, messageId: '2/2' });
    });

    // A phone that comes back online tomorrow morning and buzzes "starts in 20
    // minutes" is worse than one that never buzzes: the user cannot tell it is
    // stale.
    it('gives the push service half an hour, not the protocol default', async () => {
      await deliver();

      expect(webPush.send.mock.calls[0][2]).toMatchObject({ TTL: PUSH_TTL_SECONDS });
    });

    it('wakes the device for a start cue, not for an upcoming reminder', async () => {
      await deliver('coach.start_cue', START_CUE);
      expect(webPush.send.mock.calls[0][2].urgency).toBe('high');

      webPush.send.mockClear();
      await deliver();
      expect(webPush.send.mock.calls[0][2].urgency).toBe('normal');
    });

    describe('the payload', () => {
      const payload = () => JSON.parse(webPush.send.mock.calls[0][1] as string);

      it('carries the same words the inbox row shows', async () => {
        await deliver();

        expect(payload().title).toBe('Upper A starts in 20 minutes');
      });

      it('carries at most two actions, because browsers show two', async () => {
        await deliver();

        expect(payload().actions.length).toBeLessThanOrEqual(MAX_PUSH_ACTIONS);
        expect(payload().actions[0]).toMatchObject({ action: 'start' });
      });

      // A re-send about the same moment REPLACES the banner rather than
      // stacking beside it.
      it('tags the banner with the decision it came from', async () => {
        await deliver();

        expect(payload().tag).toBe(N);
        expect(payload().sentInteractionId).toBe(N);
      });

      it('carries a root-relative deep link and nothing else', async () => {
        await deliver();

        expect(payload().link).toBe(`/today?commitment=${C}&action=start&n=${N}`);
      });

      it('fits comfortably inside the 4 KB push ceiling', async () => {
        await deliver('coach.commitment_upcoming', {
          ...UPCOMING,
          commitmentTitle: 'x'.repeat(300),
        });

        expect(Buffer.byteLength(webPush.send.mock.calls[0][1] as string)).toBeLessThan(4096);
      });
    });

    describe('dead subscriptions', () => {
      it('deletes an endpoint the push service says is gone', async () => {
        webPush.send.mockResolvedValue({ ok: false, gone: true, statusCode: 410 });

        const result = await deliver();

        expect(prisma.pushSubscription.delete).toHaveBeenCalledWith({
          where: { id: 'sub-1' },
        });
        expect(result.success).toBe(false);
      });

      // Someone with a laptop and a phone: if one endpoint is dead and the
      // other works, the user WAS notified. Reporting a failure would make the
      // metric measure stale browser profiles rather than undelivered messages.
      it('still succeeds when another device took it', async () => {
        prisma.pushSubscription.findMany.mockResolvedValue([
          subscription(),
          subscription({ id: 'sub-2', endpoint: 'https://push.example.test/def' }),
        ]);
        webPush.send
          .mockResolvedValueOnce({ ok: false, gone: true, statusCode: 410 })
          .mockResolvedValueOnce({ ok: true, gone: false, statusCode: 201 });

        const result = await deliver();

        expect(prisma.pushSubscription.delete).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({ success: true, messageId: '1/2' });
      });

      it('deletes a row whose keys can never be used', async () => {
        prisma.pushSubscription.findMany.mockResolvedValue([
          subscription({ keys: { nope: true } }),
        ]);

        await deliver();

        expect(webPush.send).not.toHaveBeenCalled();
        expect(prisma.pushSubscription.delete).toHaveBeenCalled();
      });

      it('keeps a subscription that failed for a transient reason', async () => {
        webPush.send.mockResolvedValue({
          ok: false,
          gone: false,
          statusCode: 503,
          error: 'service unavailable',
        });

        const result = await deliver();

        expect(prisma.pushSubscription.delete).not.toHaveBeenCalled();
        expect(result.error).toContain('service unavailable');
      });
    });

    it('marks a device live after a successful push', async () => {
      await deliver();

      expect(prisma.pushSubscription.update.mock.calls[0][0]).toMatchObject({
        where: { id: 'sub-1' },
      });
    });

    it('fails the delivery rather than pushing a broken payload', async () => {
      const result = await deliver('coach.commitment_upcoming', { sentInteractionId: N });

      expect(result.success).toBe(false);
      expect(webPush.send).not.toHaveBeenCalled();
    });
  });
});

describe('hostOf (#64)', () => {
  // A full endpoint is a bearer capability for a device; the host is enough to
  // recognise a browser and useless to anybody who intercepts a log line.
  it('keeps the host and drops the capability', () => {
    expect(hostOf('https://fcm.googleapis.com/fcm/send/ABCDEF-secret')).toBe(
      'fcm.googleapis.com',
    );
  });

  it('never throws on something that is not a URL', () => {
    expect(hostOf('not a url')).toBe('unknown');
  });
});
