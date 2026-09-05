import {
  BrowserNotificationChannel,
  EVENT_BROWSER_TEMPLATES,
  sanitizeLink,
} from './browser-notification.channel';
import { NOTIFICATION_EVENTS } from '../notification-events';
import type {
  NotificationDispatchContext,
  NotificationRecipient,
} from '../notification.types';

// =============================================================================
// BrowserNotificationChannel — tests (issue #127, epic #109)
// =============================================================================
//
// `mockStream = { publish: jest.fn() }` — a plain jest mock, not a real
// `NotificationStreamService`. This suite is about the channel's own
// branching (render fallback, ordering, truncation, link sanitisation), not
// about the stream registry (see notification-stream.service.spec.ts for
// that).
//
// THE ORDERING CENTREPIECE: `prisma.notification.create` must be called and
// awaited BEFORE `stream.publish` — a durable row for a crashed/never-open
// stream, never the reverse. See the source file's header for why.
// =============================================================================

const recipient: NotificationRecipient = {
  userId: 'user-1',
  email: 'user@example.com',
  preferences: {},
};

/**
 * A payload each event's registered browser template can actually render.
 *
 * #128 registered one template (`security.role_changed`), and it reads fields
 * off the payload. Feeding it `{}` would exercise the render-throw branch
 * rather than the happy path, so the loops below say what a real dispatch
 * would carry. An event with no template ignores this entirely — the fallback
 * renders from the registry's own label and description.
 */
const N = '22222222-2222-4222-8222-222222222222';
const C = '11111111-1111-4111-8111-111111111111';

const SAMPLE_PAYLOADS: Record<string, unknown> = {
  'security.role_changed': {
    recipientEmail: 'user@example.com',
    previousRoles: ['admin'],
    currentRoles: ['viewer'],
    changedAt: new Date('2026-01-01T00:00:00.000Z'),
  },

  // E09's two events. Both templates read a field off the payload, so `{}`
  // would exercise the render-throw branch rather than the happy path.
  'plan.proposal_created': {
    summary: "You've skipped Upper A twice in two weeks. Shall we make it 25 minutes?",
    proposalId: '11111111-1111-4111-8111-111111111111',
  },
  'health.program_activated': {
    programName: 'Two-day upper/lower',
    programId: '22222222-2222-4222-8222-222222222222',
  },

  // The nine coaching categories (#54). Every one of them VALIDATES its payload
  // and throws otherwise, so `{}` would exercise the render-throw branch for
  // all nine and the loop below would prove nothing about the happy path.
  'coach.commitment_upcoming': {
    sentInteractionId: N,
    commitmentId: C,
    domain: 'HEALTH',
    commitmentTitle: 'Upper A',
    scheduledStart: '2026-09-08T15:00:00.000Z',
    minutesUntil: 20,
    startMinutes: 38,
  },
  'coach.start_cue': {
    sentInteractionId: N,
    commitmentId: C,
    domain: 'WORK',
    commitmentTitle: 'Draft the storyline',
    startMinutes: 25,
  },
  'coach.rescue': {
    sentInteractionId: N,
    commitmentId: C,
    domain: 'WORK',
    commitmentTitle: 'Draft the storyline',
    rescheduleCount: 3,
    level: 4,
    minimumMinutes: 10,
  },
  'coach.fallback_offer': {
    sentInteractionId: N,
    commitmentId: C,
    domain: 'HEALTH',
    commitmentTitle: 'Upper A',
    fullMinutes: 38,
    shortMinutes: 20,
    remainingMinutes: 25,
  },
  'coach.family_presence': {
    sentInteractionId: N,
    commitmentId: C,
    commitmentTitle: 'Phone-free dinner',
    minutesUntil: 15,
  },
  'coach.recovery': { sentInteractionId: N, comebackId: C, daysAway: 4 },
  'coach.evidence': {
    sentInteractionId: N,
    commitmentId: C,
    domain: 'HEALTH',
    outcomeTitle: 'Train consistently',
    count: 3,
    windowDays: 8,
    milestone: 'THIRD_IN_8_DAYS',
  },
  'coach.weekly_review_ready': {
    sentInteractionId: N,
    reviewId: C,
    weekStart: '2026-08-31',
  },
  'coach.plan_issue': {
    sentInteractionId: N,
    proposalId: C,
    planId: C,
    summary: 'Three sessions a week is not landing',
    sourceKind: 'PATTERN',
  },
};

function contextFor(eventKey: string, data: unknown = {}): NotificationDispatchContext {
  const event = NOTIFICATION_EVENTS.find((e) => e.key === eventKey);
  if (!event) {
    throw new Error(`Test fixture error: no such event '${eventKey}' in the registry.`);
  }
  return { event, recipient, data };
}

describe('BrowserNotificationChannel', () => {
  let channel: BrowserNotificationChannel;
  let mockPrisma: { notification: { create: jest.Mock } };
  let mockStream: { publish: jest.Mock };

  beforeEach(() => {
    mockPrisma = { notification: { create: jest.fn() } };
    mockStream = { publish: jest.fn() };

    channel = new BrowserNotificationChannel(mockPrisma as never, mockStream as never);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==========================================================================
  // resolveTo
  // ==========================================================================

  describe('resolveTo', () => {
    it('returns the recipient userId', () => {
      expect(channel.resolveTo(recipient)).toBe('user-1');
    });

    it('returns null when the recipient has no account (userId: null)', () => {
      expect(channel.resolveTo({ ...recipient, userId: null })).toBeNull();
    });
  });

  // ==========================================================================
  // EVENT_BROWSER_TEMPLATES is empty until #128
  // ==========================================================================

  describe('EVENT_BROWSER_TEMPLATES agrees with the registry (#128)', () => {
    it('registers no template for an event that does not declare the browser channel', () => {
      // The registry's per-event `channels` list is the source of truth. A
      // renderer for an event that never offers this channel is dead code
      // that reads as a live feature — `user.welcome` and
      // `allowlist.invitation` are email-only, the latter because its
      // recipient has no account and therefore no inbox row to write.
      const nonBrowserEvents = NOTIFICATION_EVENTS.filter(
        (event) => !event.channels.includes('browser'),
      ).map((event) => event.key);

      expect(nonBrowserEvents.length).toBeGreaterThan(0);

      for (const key of nonBrowserEvents) {
        expect(EVENT_BROWSER_TEMPLATES[key]).toBeUndefined();
      }
    });

    it('a browser-channel event without a template still delivers, via the fallback', () => {
      // Deliberately NOT "every browser event has a template". Unlike the
      // email channel, a miss here is not a failed delivery — it falls back to
      // the registry's label and description, which is truthful if generic.
      // See the source file's `render()` for why the two channels differ.
      for (const event of NOTIFICATION_EVENTS.filter((e) =>
        e.channels.includes('browser'),
      )) {
        expect(typeof event.label).toBe('string');
        expect(event.label.length).toBeGreaterThan(0);
        expect(typeof event.description).toBe('string');
        expect(event.description.length).toBeGreaterThan(0);
      }
    });
  });

  // ==========================================================================
  // ORDERING CENTREPIECE: create() awaited BEFORE publish()
  // ==========================================================================

  describe('deliver() ordering: the row is written before the stream is published to', () => {
    it('calls prisma.notification.create and awaits it before calling stream.publish', async () => {
      const callOrder: string[] = [];

      mockPrisma.notification.create.mockImplementation(async () => {
        callOrder.push('create');
        return { id: 'notif-1', createdAt: new Date('2026-01-01T00:00:00.000Z') };
      });
      mockStream.publish.mockImplementation(() => {
        callOrder.push('publish');
        return 1;
      });

      const context = contextFor('user.welcome');
      const result = await channel.deliver(context, 'user-1');

      expect(callOrder).toEqual(['create', 'publish']);
      expect(result).toEqual({ success: true, messageId: 'notif-1' });
    });
  });

  // ==========================================================================
  // Render fallback: a miss falls back to the registry's label/description
  // ==========================================================================

  describe('render() fallback when no template is registered (true for every current event)', () => {
    it('deliver() succeeds using event.label/event.description as title/body', async () => {
      mockPrisma.notification.create.mockResolvedValue({
        id: 'notif-1',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      mockStream.publish.mockReturnValue(0);

      const event = NOTIFICATION_EVENTS.find((e) => e.key === 'user.welcome')!;
      const context = contextFor('user.welcome');

      const result = await channel.deliver(context, 'user-1');

      expect(result.success).toBe(true);
      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: event.label,
            body: event.description,
          }),
        }),
      );
    });

    it('delivers successfully for every registered event, template or fallback', async () => {
      mockPrisma.notification.create.mockResolvedValue({
        id: 'notif-x',
        createdAt: new Date(),
      });
      mockStream.publish.mockReturnValue(0);

      for (const event of NOTIFICATION_EVENTS) {
        const context = contextFor(event.key, SAMPLE_PAYLOADS[event.key] ?? {});
        await expect(channel.deliver(context, 'user-1')).resolves.toMatchObject({
          success: true,
        });
      }
    });

    it('the #128 role-change template renders the before/after delta, not just the new state', async () => {
      // The one registered template, asserted on directly: "you are now a
      // Viewer" cannot tell the reader whether they gained access or lost it,
      // which is why the delta is the alertable fact (see
      // role-changed.email.ts for the same argument on the email side).
      mockPrisma.notification.create.mockResolvedValue({
        id: 'notif-role',
        createdAt: new Date(),
      });
      mockStream.publish.mockReturnValue(0);

      const context = contextFor(
        'security.role_changed',
        SAMPLE_PAYLOADS['security.role_changed'],
      );

      await channel.deliver(context, 'user-1');

      const written = mockPrisma.notification.create.mock.calls[0]![0].data;
      expect(written.title).toBe('Your roles changed');
      expect(written.body).toContain('Admin');
      expect(written.body).toContain('Viewer');
      // No link: this application has no page showing a user their own roles.
      expect(written.link).toBeNull();
    });
  });

  // ==========================================================================
  // Database failure: create() rejects
  // ==========================================================================

  describe('when prisma.notification.create rejects', () => {
    it('returns { success: false, error } and never calls stream.publish', async () => {
      mockPrisma.notification.create.mockRejectedValue(new Error('db unavailable'));

      const context = contextFor('user.welcome');
      const result = await channel.deliver(context, 'user-1');

      expect(result.success).toBe(false);
      expect((result as { error: string }).error).toContain('db unavailable');
      expect(mockStream.publish).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Truncation, and a throwing template
  // ==========================================================================
  //
  // `EVENT_BROWSER_TEMPLATES` is a plain (non-frozen) object exported for
  // #128 to populate later. It is empty today, but nothing stops a test from
  // registering a temporary entry at runtime to exercise `render()`'s other
  // two branches — a template that returns oversized content, and one that
  // throws — without touching the source file. Removed in `afterEach` so it
  // never leaks into another test.
  // ==========================================================================

  describe('title/body truncation (registered template returns oversized content)', () => {
    const EVENT_KEY = 'user.welcome';

    afterEach(() => {
      delete EVENT_BROWSER_TEMPLATES[EVENT_KEY];
    });

    it('caps title at 200 chars and body at 2000 chars, each ending with an ellipsis', async () => {
      const oversizedTitle = 'T'.repeat(250);
      const oversizedBody = 'B'.repeat(2500);

      EVENT_BROWSER_TEMPLATES[EVENT_KEY] = () => ({
        title: oversizedTitle,
        body: oversizedBody,
      });

      mockPrisma.notification.create.mockResolvedValue({
        id: 'notif-1',
        createdAt: new Date(),
      });
      mockStream.publish.mockReturnValue(0);

      const context = contextFor(EVENT_KEY);
      await channel.deliver(context, 'user-1');

      const [[createArgs]] = mockPrisma.notification.create.mock.calls as unknown as [
        [{ data: { title: string; body: string } }],
      ];

      expect(createArgs.data.title).toHaveLength(200);
      expect(createArgs.data.title.endsWith('…')).toBe(true);
      expect(createArgs.data.body).toHaveLength(2000);
      expect(createArgs.data.body.endsWith('…')).toBe(true);
    });

    it('leaves content under the cap untouched, with no ellipsis added', async () => {
      EVENT_BROWSER_TEMPLATES[EVENT_KEY] = () => ({
        title: 'Short title',
        body: 'Short body.',
      });

      mockPrisma.notification.create.mockResolvedValue({
        id: 'notif-1',
        createdAt: new Date(),
      });
      mockStream.publish.mockReturnValue(0);

      const context = contextFor(EVENT_KEY);
      await channel.deliver(context, 'user-1');

      const [[createArgs]] = mockPrisma.notification.create.mock.calls as unknown as [
        [{ data: { title: string; body: string } }],
      ];
      expect(createArgs.data.title).toBe('Short title');
      expect(createArgs.data.body).toBe('Short body.');
    });
  });

  describe('when a registered template throws', () => {
    const EVENT_KEY = 'user.welcome';

    afterEach(() => {
      delete EVENT_BROWSER_TEMPLATES[EVENT_KEY];
    });

    it('deliver() returns { success: false, error } WITHOUT ever calling prisma.notification.create', async () => {
      EVENT_BROWSER_TEMPLATES[EVENT_KEY] = () => {
        throw new Error('template blew up');
      };

      const context = contextFor(EVENT_KEY);
      const result = await channel.deliver(context, 'user-1');

      expect(result.success).toBe(false);
      expect((result as { error: string }).error).toContain('template blew up');
      expect(mockPrisma.notification.create).not.toHaveBeenCalled();
      expect(mockStream.publish).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // sanitizeLink — exported, tested directly
  // ==========================================================================

  describe('sanitizeLink', () => {
    describe('accepted', () => {
      it.each([
        ['/settings', '/settings'],
        ['/admin/users?tab=roles', '/admin/users?tab=roles'],
        ['/x#frag', '/x#frag'],
        [' /settings ', '/settings'], // trimmed then accepted
      ])('accepts %j -> %j', (input, expected) => {
        expect(sanitizeLink(input)).toBe(expected);
      });
    });

    describe('rejected -> null', () => {
      it.each([
        ['protocol-relative', '//evil.example/x'],
        ['absolute https URL', 'https://evil/x'],
        ['javascript scheme', 'javascript:alert(1)'],
        ['data URL', 'data:text/html,x'],
        ['relative without leading slash', 'settings'],
        ['backslash after slash', '/\\evil.example'],
        ['embedded tab', '/settings\tpath'],
        ['embedded newline', '/settings\npath'],
        ['embedded carriage return', '/settings\rpath'],
        ['empty string', ''],
      ])('rejects %s (%j) -> null', (_label, input) => {
        expect(sanitizeLink(input)).toBeNull();
      });

      it('rejects undefined -> null', () => {
        expect(sanitizeLink(undefined)).toBeNull();
      });

      // The coaching deep links (#54) carry a query string, and every one of
      // them has to survive this function or the notification lands on Today
      // with no commitment and no attribution.
      it('keeps a coaching deep link, query string and all', () => {
        const link = `/today?commitment=${C}&action=start&n=${N}`;

        expect(sanitizeLink(link)).toBe(link);
      });

      it('still rejects a query string smuggled onto another origin', () => {
        expect(sanitizeLink(`//evil.test/today?commitment=${C}`)).toBeNull();
        expect(sanitizeLink(`javascript:void(0)?commitment=${C}`)).toBeNull();
      });
    });
  });

  // ==========================================================================
  // The coaching categories (#54, epic E12)
  // ==========================================================================

  describe('coaching templates', () => {
    beforeEach(() => {
      mockPrisma.notification.create.mockResolvedValue({
        id: 'notif-coach',
        createdAt: new Date('2026-09-08T14:40:00.000Z'),
      });
      mockStream.publish.mockReturnValue(0);
    });

    const written = () => mockPrisma.notification.create.mock.calls[0]![0].data;
    const published = () => mockStream.publish.mock.calls[0]![1];

    it('renders the deterministic copy and the deep link', async () => {
      await channel.deliver(
        contextFor('coach.commitment_upcoming', SAMPLE_PAYLOADS['coach.commitment_upcoming']),
        'user-1',
      );

      expect(written().title).toBe('Upper A starts in 20 minutes');
      expect(written().link).toBe(`/today?commitment=${C}&action=start&n=${N}`);
    });

    // PRD §14.7: the copywriter personalises wording AFTER the policy said yes.
    // Modelling it as an overlay is what makes a provider outage produce
    // template copy rather than a missing message.
    it('prefers the copywriter’s words when the payload carries them', async () => {
      await channel.deliver(
        contextFor('coach.commitment_upcoming', {
          ...(SAMPLE_PAYLOADS['coach.commitment_upcoming'] as object),
          copy: {
            title: 'Upper A in twenty',
            body: 'Shoes are by the door.',
            actionLabel: 'Start workout',
          },
        }),
        'user-1',
      );

      expect(written().title).toBe('Upper A in twenty');
      expect(written().body).toBe('Shoes are by the door.');
      // The link is still derived, never taken from the copy.
      expect(written().link).toBe(`/today?commitment=${C}&action=start&n=${N}`);
    });

    it('publishes the buttons on the live event, with the precise labels', async () => {
      await channel.deliver(
        contextFor('coach.family_presence', SAMPLE_PAYLOADS['coach.family_presence']),
        'user-1',
      );

      expect(published().actions.map((a: { action: string }) => a.action)).toEqual([
        'in',
        'move',
        'skip',
      ]);
      expect(published().actions[0].label).toBe("I'm in");
    });

    it('publishes an empty action list for an event that has none', async () => {
      await channel.deliver(
        contextFor('coach.weekly_review_ready', SAMPLE_PAYLOADS['coach.weekly_review_ready']),
        'user-1',
      );

      expect(published().actions).toEqual([]);
      expect(written().link).toBe(`/progress/week?n=${N}`);
    });

    // A coaching message rendered from a half-built payload would show
    // "undefined minutes" to a user; a recorded delivery failure is better.
    it('fails the delivery rather than rendering a broken payload', async () => {
      const result = await channel.deliver(
        contextFor('coach.commitment_upcoming', { sentInteractionId: N }),
        'user-1',
      );

      expect(result.success).toBe(false);
      expect(mockPrisma.notification.create).not.toHaveBeenCalled();
    });
  });
});
