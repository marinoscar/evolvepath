import { Test } from '@nestjs/testing';

import { createMockPrismaService, MockPrismaService } from '../../../test/mocks/prisma.mock';
import { PrismaService } from '../../prisma/prisma.service';
import { CandidateScannerService } from './candidate-scanner.service';

const USER = 'user-1';
const CR = 'America/Costa_Rica';

/** 12:00 in Costa Rica — comfortably outside any day-end boundary. */
const NOW = new Date('2026-09-08T18:00:00.000Z');
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

const commitment = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  userId: USER,
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

describe('CandidateScannerService (#59)', () => {
  let scanner: CandidateScannerService;
  let prisma: MockPrismaService;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    const module = await Test.createTestingModule({
      providers: [CandidateScannerService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    scanner = module.get(CandidateScannerService);

    prisma.userProfile.findMany.mockResolvedValue([
      { userId: USER, timezone: CR, quietHoursStart: null },
    ] as never);
    prisma.notificationInteraction.findMany.mockResolvedValue([] as never);
    prisma.ritual.findUnique.mockResolvedValue(null as never);
    prisma.familyMember.findUnique.mockResolvedValue(null as never);
    prisma.weeklyReview.findMany.mockResolvedValue([] as never);
  });

  const scanWith = async (rows: ReturnType<typeof commitment>[]) => {
    prisma.commitment.findMany.mockResolvedValue(rows as never);
    return scanner.scan(NOW);
  };

  it('produces nothing when there is nothing in the window', async () => {
    await expect(scanWith([])).resolves.toEqual([]);
    expect(prisma.userProfile.findMany).not.toHaveBeenCalled();
  });

  describe('N1 — upcoming', () => {
    it('fires twenty minutes out', async () => {
      const [candidate] = await scanWith([commitment()]);

      expect(candidate.eventKey).toBe('coach.commitment_upcoming');
      expect(candidate.leadMinutes).toBe(20);
      expect(candidate.dedupeKey).toBe('c1');
      expect(candidate.payload.minutesUntil).toBe(20);
    });

    // The Start button offers the SMALLEST defined version: a notification is
    // read in a gap, and the number in it is the one being agreed to.
    it('offers the minimum version’s minutes, not the full one', async () => {
      const [candidate] = await scanWith([commitment()]);

      expect(candidate.payload.startMinutes).toBe(10);
    });

    it.each([
      ['too far out', 26],
      ['too close — that is N2 territory', 8],
    ])('does not fire %s', async (_label, delta) => {
      const found = await scanWith([commitment({ scheduledStart: minutes(delta) })]);

      expect(found.map((c) => c.eventKey)).not.toContain('coach.commitment_upcoming');
    });
  });

  describe('N2 — start cue', () => {
    it('fires at the moment itself', async () => {
      const [candidate] = await scanWith([commitment({ scheduledStart: minutes(0) })]);

      expect(candidate.eventKey).toBe('coach.start_cue');
      expect(candidate.leadMinutes).toBe(0);
    });

    it('carries the first decomposed step, which beats the duration', async () => {
      const [candidate] = await scanWith([
        commitment({
          scheduledStart: minutes(2),
          steps: [{ title: 'Open the doc', minutes: 5 }],
        }),
      ]);

      expect(candidate.payload.firstStep).toBe('Open the doc');
    });

    it('never fires for a commitment already running', async () => {
      const found = await scanWith([
        commitment({ scheduledStart: minutes(0), status: 'STARTED' }),
      ]);

      expect(found).toEqual([]);
    });
  });

  // One moment, one message: N3 REPLACES N1 rather than joining it, because the
  // per-commitment cap would let two through on a quiet day and the second
  // would be a worse-worded duplicate of the first.
  describe('N3 — rescue', () => {
    it('replaces N1 once the commitment has been moved', async () => {
      const [candidate] = await scanWith([commitment({ rescheduleCount: 2 })]);

      expect(candidate.eventKey).toBe('coach.rescue');
      expect(candidate.payload.rescheduleCount).toBe(2);
      expect(candidate.payload.level).toBe(2);
      expect(candidate.payload.minimumMinutes).toBe(10);
    });

    it('leaves an unmoved commitment to N1', async () => {
      const [candidate] = await scanWith([commitment({ rescheduleCount: 0 })]);

      expect(candidate.eventKey).toBe('coach.commitment_upcoming');
    });

    it('caps the interim level at the avoidance scale’s ceiling', async () => {
      const [candidate] = await scanWith([commitment({ rescheduleCount: 12 })]);

      expect(candidate.payload.level).toBe(6);
    });
  });

  describe('N4 — fallback offer', () => {
    const late = (over: Record<string, unknown> = {}) =>
      commitment({ scheduledStart: minutes(-10), ...over });

    it('offers the short version when the full one no longer fits', async () => {
      const [candidate] = await scanWith([late({ scheduledEnd: minutes(25) })]);

      expect(candidate.eventKey).toBe('coach.fallback_offer');
      expect(candidate.payload).toMatchObject({
        fullMinutes: 38,
        shortMinutes: 20,
        remainingMinutes: 25,
      });
    });

    // Outside the band there is nothing honest to say: either nothing changed,
    // or nothing fits and the right answer is silence rather than a message
    // about how late the user is.
    it('stays quiet while the full version still fits', async () => {
      const found = await scanWith([late({ scheduledEnd: minutes(60) })]);

      expect(found).toEqual([]);
    });

    it('stays quiet when not even the short version fits', async () => {
      const found = await scanWith([late({ scheduledEnd: minutes(5) })]);

      expect(found).toEqual([]);
    });

    it('stays quiet for a commitment with no sizes at all', async () => {
      const found = await scanWith([
        late({ fullMinutes: null, shortMinutes: null, minimumMinutes: null }),
      ]);

      expect(found).toEqual([]);
    });

    // Midnight would offer a 20-minute workout at 23:40, which is technically
    // true and obviously wrong — so the day ends at 22:00 local by default.
    it('uses the end of the usable day when there is no scheduled end', async () => {
      // 21:35 in Costa Rica: 25 minutes of usable day left, so the full 38 no
      // longer fits and the 20-minute version does.
      const evening = new Date('2026-09-09T03:35:00.000Z');
      prisma.commitment.findMany.mockResolvedValue([
        commitment({ scheduledStart: new Date(evening.getTime() - 10 * 60_000) }),
      ] as never);

      const [candidate] = await scanner.scan(evening);

      expect(candidate.eventKey).toBe('coach.fallback_offer');
      expect(candidate.payload.remainingMinutes).toBe(25);
    });

    it('ends the day at the start of quiet hours when the user set some', async () => {
      prisma.userProfile.findMany.mockResolvedValue([
        { userId: USER, timezone: CR, quietHoursStart: '12:25' },
      ] as never);

      const [candidate] = await scanWith([late()]);

      expect(candidate.eventKey).toBe('coach.fallback_offer');
      expect(candidate.payload.remainingMinutes).toBe(25);
    });

    // The whole day is still ahead, so there is nothing to offer and nothing
    // to say.
    it('stays quiet at midday, when the full version obviously still fits', async () => {
      await expect(scanWith([late()])).resolves.toEqual([]);
    });
  });

  describe('N5 — family presence', () => {
    const family = (over: Record<string, unknown> = {}) =>
      commitment({
        domain: 'FAMILY',
        title: 'Phone-free dinner',
        scheduledStart: minutes(15),
        ...over,
      });

    it('replaces N1 for a family commitment', async () => {
      const [candidate] = await scanWith([family()]);

      expect(candidate.eventKey).toBe('coach.family_presence');
      expect(candidate.domain).toBe('FAMILY');
      expect(candidate.payload.minutesUntil).toBe(15);
    });

    it('quotes the ritual’s own purpose when there is one', async () => {
      prisma.ritual.findUnique.mockResolvedValue({
        purpose: 'Mia talks at dinner',
      } as never);

      const [candidate] = await scanWith([family({ ritualId: 'r1' })]);

      expect(candidate.payload.purpose).toBe('Mia talks at dinner');
    });

    // PRD §33 / VISION §50: the record is five fields and a notification
    // payload is exactly where a sixth would quietly appear.
    it('carries the nickname and nothing else about the person', async () => {
      prisma.familyMember.findUnique.mockResolvedValue({ nickname: 'Mia' } as never);

      const [candidate] = await scanWith([family({ familyMemberId: 'f1' })]);

      expect(candidate.payload.familyNickname).toBe('Mia');
      expect(prisma.familyMember.findUnique.mock.calls[0][0].select).toEqual({
        nickname: true,
      });
    });

    it('uses a tighter window than the work one', async () => {
      const found = await scanWith([family({ scheduledStart: minutes(23) })]);

      expect(found).toEqual([]);
    });
  });

  describe('N7 — evidence celebration', () => {
    const completed = () =>
      commitment({
        status: 'COMPLETED',
        outcomeId: 'o1',
        completedAt: minutes(-5),
        scheduledStart: minutes(-40),
      });

    beforeEach(() => {
      prisma.outcome.findUnique.mockResolvedValue({
        title: 'Train consistently',
      } as never);
      prisma.commitment.count.mockResolvedValue(0 as never);
    });

    it('fires on a milestone', async () => {
      prisma.commitment.findMany
        .mockResolvedValueOnce([completed()] as never)
        .mockResolvedValueOnce([
          { completedAt: minutes(-5) },
          { completedAt: new Date(NOW.getTime() - 3 * 86_400_000) },
          { completedAt: new Date(NOW.getTime() - 7 * 86_400_000) },
        ] as never);

      const [candidate] = await scanner.scan(NOW);

      expect(candidate.eventKey).toBe('coach.evidence');
      expect(candidate.payload).toMatchObject({
        milestone: 'THIRD_IN_8_DAYS',
        count: 3,
        windowDays: 8,
        outcomeTitle: 'Train consistently',
      });
    });

    it('says nothing about an ordinary completion', async () => {
      prisma.commitment.findMany
        .mockResolvedValueOnce([completed()] as never)
        .mockResolvedValueOnce([{ completedAt: minutes(-5) }] as never);

      await expect(scanner.scan(NOW)).resolves.toEqual([]);
    });

    it('says nothing for a completion with no outcome to celebrate', async () => {
      prisma.commitment.findMany.mockResolvedValueOnce([
        { ...completed(), outcomeId: null },
      ] as never);

      await expect(scanner.scan(NOW)).resolves.toEqual([]);
    });
  });

  // These reach `decide()` on purpose: the most valuable thing this engine
  // records is what it did NOT say, and why.
  describe('terminal rows still become candidates, so the reason gets recorded', () => {
    it('lets a skipped commitment through to the policy', async () => {
      const [candidate] = await scanWith([
        commitment({ scheduledStart: minutes(0), status: 'SKIPPED', updatedAt: NOW }),
      ]);

      expect(candidate.eventKey).toBe('coach.start_cue');
      expect(candidate.commitment?.skippedToday).toBe(true);
    });

    it('marks a commitment skipped on an earlier day as not skipped today', async () => {
      const [candidate] = await scanWith([
        commitment({
          scheduledStart: minutes(0),
          status: 'SKIPPED',
          updatedAt: new Date('2026-09-01T18:00:00.000Z'),
        }),
      ]);

      expect(candidate.commitment?.skippedToday).toBe(false);
    });

    it('lets a completed commitment through so the start cue is ALREADY_DONE', async () => {
      prisma.commitment.findMany.mockResolvedValue([
        commitment({
          scheduledStart: minutes(0),
          status: 'COMPLETED',
          completedAt: new Date(NOW.getTime() - 60 * 60_000),
          outcomeId: null,
        }),
      ] as never);

      const [candidate] = await scanner.scan(NOW);

      expect(candidate.eventKey).toBe('coach.start_cue');
      expect(candidate.commitment?.status).toBe('COMPLETED');
    });
  });

  describe('N8 — the week is ready to review', () => {
    const review = (over: Record<string, unknown> = {}) => ({
      id: 'review-1',
      userId: USER,
      weekStart: '2026-08-31',
      generatedAt: new Date(NOW.getTime() - 30 * 60_000),
      ...over,
    });

    const scanReviews = async (rows: ReturnType<typeof review>[]) => {
      prisma.commitment.findMany.mockResolvedValue([] as never);
      prisma.weeklyReview.findMany.mockResolvedValue(rows as never);
      return scanner.scan(NOW);
    };

    it('raises a candidate for a review generated in the last day', async () => {
      const [candidate] = await scanReviews([review()]);

      expect(candidate.eventKey).toBe('coach.weekly_review_ready');
      expect(candidate.category).toBe('N8');
      expect(candidate.payload).toEqual({ reviewId: 'review-1', weekStart: '2026-08-31' });
    });

    // Daily, not once-ever: a review prepared on Sunday evening may be
    // mentioned that evening and once the next day, and then never again.
    it('carries the local date in its dedupe key', async () => {
      const [candidate] = await scanReviews([review()]);

      expect(candidate.dedupeKey).toBe('review-1:2026-09-08');
    });

    it('asks only for READY reviews inside the window', async () => {
      await scanReviews([]);

      const where = prisma.weeklyReview.findMany.mock.calls[0][0]?.where as {
        status: string;
        generatedAt: { gte: Date };
      };

      expect(where.status).toBe('READY');
      expect(where.generatedAt.gte.getTime()).toBe(NOW.getTime() - 24 * 60 * 60_000);
    });

    // It is the review's own moment, not this instant: the interaction row
    // records what the message was *for*.
    it('uses the generation time as the moment the message is for', async () => {
      const generatedAt = new Date(NOW.getTime() - 90 * 60_000);
      const [candidate] = await scanReviews([review({ generatedAt })]);

      expect(candidate.dueAt).toEqual(generatedAt);
    });

    it('drops one whose decision has already been recorded today', async () => {
      prisma.notificationInteraction.findMany.mockResolvedValue([
        {
          userId: USER,
          eventKey: 'coach.weekly_review_ready',
          dedupeKey: 'review-1:2026-09-08',
        },
      ] as never);

      await expect(scanReviews([review()])).resolves.toEqual([]);
    });
  });

  describe('idempotency', () => {
    it('drops a candidate whose decision has already been recorded', async () => {
      prisma.notificationInteraction.findMany.mockResolvedValue([
        { userId: USER, eventKey: 'coach.commitment_upcoming', dedupeKey: 'c1' },
      ] as never);

      await expect(scanWith([commitment()])).resolves.toEqual([]);
    });

    it('keeps a candidate whose decision was recorded under a different event', async () => {
      prisma.notificationInteraction.findMany.mockResolvedValue([
        { userId: USER, eventKey: 'coach.start_cue', dedupeKey: 'c1' },
      ] as never);

      await expect(scanWith([commitment()])).resolves.toHaveLength(1);
    });

    it('asks once for the whole batch, not once per candidate', async () => {
      await scanWith([commitment(), commitment({ id: 'c2' })]);

      expect(prisma.notificationInteraction.findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('user context', () => {
    // Refusing to scan them would silently exclude everybody who has not
    // finished onboarding.
    it('still scans a user with no profile row, in UTC', async () => {
      prisma.userProfile.findMany.mockResolvedValue([] as never);

      await expect(scanWith([commitment()])).resolves.toHaveLength(1);
    });

    it('skips one malformed row without losing the rest of the run', async () => {
      const found = await scanWith([
        commitment({ id: 'bad', scheduledStart: null as never }),
        commitment({ id: 'good' }),
      ]);

      expect(found.map((c) => c.commitmentId)).toEqual(['good']);
    });
  });
});
