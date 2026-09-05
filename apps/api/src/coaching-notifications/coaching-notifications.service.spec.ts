import { Test } from '@nestjs/testing';

import { createMockPrismaService, MockPrismaService } from '../../test/mocks/prisma.mock';
import { EmailSettingsService } from '../email';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { CandidateScannerService } from './candidates/candidate-scanner.service';
import type { NotificationCandidate } from './candidates/notification-candidate';
import { CoachingNotificationsService } from './coaching-notifications.service';
import { NotificationCopywriterService } from './copy/notification-copywriter.service';
import { NotificationInteractionsService } from './interactions/notification-interactions.service';
import { NotificationPolicyService } from './policy/notification-policy.service';
import { NOTIFICATION_POLICY_DEFAULTS } from './policy/notification-policy.schema';

const USER = 'user-1';
const NOW = new Date('2026-09-08T18:00:00.000Z');

const candidate = (over: Partial<NotificationCandidate> = {}): NotificationCandidate => ({
  userId: USER,
  eventKey: 'coach.commitment_upcoming',
  category: 'N1',
  dueAt: new Date('2026-09-08T18:20:00.000Z'),
  dedupeKey: 'c1',
  commitmentId: 'c1',
  commitment: {
    id: 'c1',
    domain: 'HEALTH',
    status: 'PLANNED',
    scheduledStart: new Date('2026-09-08T18:20:00.000Z'),
    skippedToday: false,
  },
  domain: 'HEALTH',
  leadMinutes: 20,
  payload: {
    commitmentId: 'c1',
    domain: 'HEALTH',
    commitmentTitle: 'Upper A',
    scheduledStart: '2026-09-08T18:20:00.000Z',
    minutesUntil: 20,
    startMinutes: 10,
  },
  ...over,
});

describe('CoachingNotificationsService (#59)', () => {
  let service: CoachingNotificationsService;
  let prisma: MockPrismaService;
  let scanner: { scan: jest.Mock };
  let interactions: {
    recordSent: jest.Mock;
    recordSuppressed: jest.Mock;
    history: jest.Mock;
    linkNotification: jest.Mock;
  };
  let copywriter: { write: jest.Mock };
  let notifications: { notify: jest.Mock; flush: jest.Mock };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    scanner = { scan: jest.fn().mockResolvedValue([]) };
    interactions = {
      recordSent: jest.fn().mockResolvedValue({ id: 'sent-1', duplicate: false }),
      recordSuppressed: jest.fn().mockResolvedValue({ id: 'sup-1', duplicate: false }),
      history: jest.fn().mockResolvedValue({
        sentToday: 0,
        sentThisWeek: 0,
        sentForCommitment: 0,
        consecutiveIgnored: 0,
        lastActionedAt: null,
      }),
      linkNotification: jest.fn().mockResolvedValue(undefined),
    };
    copywriter = {
      write: jest.fn().mockResolvedValue({
        copy: { title: 'T', body: 'B', actionLabel: 'Start' },
        source: 'template',
      }),
    };
    notifications = {
      notify: jest.fn().mockResolvedValue(undefined),
      flush: jest.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      providers: [
        CoachingNotificationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: CandidateScannerService, useValue: scanner },
        { provide: NotificationInteractionsService, useValue: interactions },
        { provide: NotificationCopywriterService, useValue: copywriter },
        { provide: NotificationsService, useValue: notifications },
        {
          provide: NotificationPolicyService,
          useValue: {
            resolve: jest.fn().mockResolvedValue({
              ...NOTIFICATION_POLICY_DEFAULTS,
              mutedCategories: [],
              timezone: 'America/Costa_Rica',
              quietHours: null,
            }),
          },
        },
        {
          provide: EmailSettingsService,
          useValue: { get: jest.fn().mockResolvedValue({ enabled: false }) },
        },
      ],
    }).compile();

    service = module.get(CoachingNotificationsService);

    prisma.userSettings.findUnique.mockResolvedValue(null as never);
    prisma.userProfile.findUnique.mockResolvedValue({ coachingStyle: 'BALANCED' } as never);
    prisma.domainMode.findFirst.mockResolvedValue(null as never);
    prisma.notificationInteraction.findMany.mockResolvedValue([] as never);
    prisma.notificationInteraction.findUnique.mockResolvedValue({ meta: {} } as never);
    prisma.notificationInteraction.update.mockResolvedValue({} as never);
    prisma.notification.findFirst.mockResolvedValue({ id: 'notif-1' } as never);
  });

  it('reports zero counts for an empty scan', async () => {
    await expect(service.runOnce(NOW)).resolves.toEqual({
      scanned: 0,
      sent: 0,
      suppressed: 0,
      skipped: false,
    });
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  describe('a candidate the policy approves', () => {
    beforeEach(() => {
      scanner.scan.mockResolvedValue([candidate()]);
    });

    it('records the decision BEFORE dispatching', async () => {
      await service.runOnce(NOW);

      const recordOrder = interactions.recordSent.mock.invocationCallOrder[0];
      const notifyOrder = notifications.notify.mock.invocationCallOrder[0];
      expect(recordOrder).toBeLessThan(notifyOrder);
    });

    // The SENT row's id becomes `?n=` on every link, so it has to exist before
    // the message does. That inversion is also what makes the run idempotent.
    it('passes the SENT row’s id into the payload as the attribution', async () => {
      await service.runOnce(NOW);

      const [eventKey, userId, payload] = notifications.notify.mock.calls[0];
      expect(eventKey).toBe('coach.commitment_upcoming');
      expect(userId).toBe(USER);
      expect((payload as { sentInteractionId: string }).sentInteractionId).toBe('sent-1');
    });

    it('passes the written copy alongside the payload', async () => {
      await service.runOnce(NOW);

      const payload = notifications.notify.mock.calls[0][2] as { copy: unknown };
      expect(payload.copy).toEqual({ title: 'T', body: 'B', actionLabel: 'Start' });
    });

    it('stamps the category and the lead time on the interaction row', async () => {
      await service.runOnce(NOW);

      expect(interactions.recordSent.mock.calls[0][0].meta).toMatchObject({
        category: 'N1',
        leadMinutes: 20,
        localDate: '2026-09-08',
      });
    });

    it('records where the copy came from', async () => {
      copywriter.write.mockResolvedValue({
        copy: { title: 'T', body: 'B', actionLabel: 'Start' },
        source: 'ai',
      });

      await service.runOnce(NOW);

      const update = prisma.notificationInteraction.update.mock.calls[0][0] as any;
      expect(update.data.meta).toMatchObject({ copySource: 'ai' });
    });

    // `notify` is detached by design, so the inbox row's id cannot be returned;
    // the run flushes and matches on the `n=` the link carries.
    it('back-fills the inbox row after flushing the detached dispatches', async () => {
      await service.runOnce(NOW);

      expect(notifications.flush).toHaveBeenCalled();
      expect(prisma.notification.findFirst.mock.calls[0][0]).toMatchObject({
        where: { link: { contains: 'n=sent-1' } },
      });
      expect(interactions.linkNotification).toHaveBeenCalledWith('sent-1', 'notif-1');
    });

    it('counts it as sent', async () => {
      await expect(service.runOnce(NOW)).resolves.toMatchObject({
        scanned: 1,
        sent: 1,
        suppressed: 0,
      });
    });

    // Another run won the unique index. It has already sent, or is about to.
    it('sends nothing when the decision row already existed', async () => {
      interactions.recordSent.mockResolvedValue({ id: 'sent-0', duplicate: true });

      const result = await service.runOnce(NOW);

      expect(notifications.notify).not.toHaveBeenCalled();
      expect(result.sent).toBe(0);
    });
  });

  describe('a candidate the policy refuses', () => {
    beforeEach(() => {
      scanner.scan.mockResolvedValue([candidate()]);
      interactions.history.mockResolvedValue({
        sentToday: 99,
        sentThisWeek: 0,
        sentForCommitment: 0,
        consecutiveIgnored: 0,
        lastActionedAt: null,
      });
    });

    it('never reaches the dispatcher', async () => {
      await service.runOnce(NOW);

      expect(notifications.notify).not.toHaveBeenCalled();
    });

    // PRD §14.7, structurally: the copywriter is only ever called after the
    // policy has said yes, so it cannot influence the decision.
    it('never reaches the copywriter either', async () => {
      await service.runOnce(NOW);

      expect(copywriter.write).not.toHaveBeenCalled();
    });

    it('records the reason', async () => {
      await service.runOnce(NOW);

      expect(interactions.recordSuppressed.mock.calls[0][0]).toMatchObject({
        eventKey: 'coach.commitment_upcoming',
        dedupeKey: 'c1',
        suppressReason: 'DAILY_CAP',
      });
    });

    it('counts it as suppressed', async () => {
      await expect(service.runOnce(NOW)).resolves.toMatchObject({
        scanned: 1,
        sent: 0,
        suppressed: 1,
      });
    });
  });

  describe('reachable channels', () => {
    // `resolveChannels` is pure and knows nothing about whether a transport can
    // reach anybody; doing the subtraction here makes MUTED mean "there is
    // nowhere to send this" rather than "sent into a void".
    it('suppresses as MUTED when email is the only channel and email is off', async () => {
      scanner.scan.mockResolvedValue([
        candidate({
          eventKey: 'coach.weekly_review_ready',
          category: 'N8',
          commitment: undefined,
          commitmentId: undefined,
          domain: undefined,
          payload: { reviewId: 'r1', weekStart: '2026-08-31' },
        }),
      ]);
      prisma.userSettings.findUnique.mockResolvedValue({
        value: {
          notifications: {
            browser: { 'coach.weekly_review_ready': false },
            push: { 'coach.weekly_review_ready': false },
          },
        },
      } as never);

      await service.runOnce(NOW);

      expect(interactions.recordSuppressed.mock.calls[0][0].suppressReason).toBe('MUTED');
    });
  });

  describe('overlapping runs', () => {
    it('does nothing and says so', async () => {
      let release: () => void = () => {};
      scanner.scan.mockImplementation(
        () => new Promise((resolve) => {
          release = () => resolve([]);
        }),
      );

      const first = service.runOnce(NOW);
      const second = await service.runOnce(NOW);

      expect(second).toEqual({ scanned: 0, sent: 0, suppressed: 0, skipped: true });

      release();
      await first;
    });

    it('lets the next run proceed once the first has finished', async () => {
      await service.runOnce(NOW);

      await expect(service.runOnce(NOW)).resolves.toMatchObject({ skipped: false });
    });
  });

  describe('failure containment', () => {
    it('does not throw when the scan fails, and releases the lock', async () => {
      scanner.scan.mockRejectedValueOnce(new Error('db down'));

      await expect(service.runOnce(NOW)).resolves.toMatchObject({ skipped: false });
      await expect(service.runOnce(NOW)).resolves.toMatchObject({ skipped: false });
    });
  });
});
