import { Test, TestingModule } from '@nestjs/testing';
import type { Commitment } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService, MockPrismaService } from '../../../test/mocks/prisma.mock';
import { CHECK_IN_READER } from '../check-in-reader';
import { CandidateLoaderService, DEFAULT_WEEKDAY_MINUTES } from './candidate-loader.service';

const NOW = new Date('2026-03-02T23:30:00.000Z');

function row(over: Partial<Commitment> = {}): Commitment {
  return {
    id: 'c1',
    userId: 'u1',
    domain: 'WORK',
    title: 'Draft',
    outcomeId: null,
    planVersionId: null,
    routineId: null,
    scheduledStart: new Date('2026-03-02T15:00:00.000Z'),
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
    createdAt: new Date('2026-03-01T00:00:00.000Z'),
    updatedAt: new Date('2026-03-01T00:00:00.000Z'),
    ...over,
  } as Commitment;
}

describe('CandidateLoaderService (#38)', () => {
  let service: CandidateLoaderService;
  let prisma: MockPrismaService;
  let checkIns: { readForDate: jest.Mock };

  // `groupBy` is an overloaded Prisma signature, so the deep mock's return type
  // does not narrow to a jest.Mock the way the plain delegates do.
  const groupBy = () => prisma.commitment.groupBy as unknown as jest.Mock;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    checkIns = { readForDate: jest.fn().mockResolvedValue(null) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CandidateLoaderService,
        { provide: PrismaService, useValue: prisma },
        { provide: CHECK_IN_READER, useValue: checkIns },
      ],
    }).compile();

    service = module.get(CandidateLoaderService);

    prisma.userProfile.findUnique.mockResolvedValue(null as never);
    prisma.commitment.findMany.mockResolvedValue([] as never);
    prisma.domainMode.findMany.mockResolvedValue([] as never);
    prisma.outcome.findMany.mockResolvedValue([] as never);
    prisma.planVersion.findMany.mockResolvedValue([] as never);
    prisma.evidence.findFirst.mockResolvedValue(null as never);
    prisma.commitment.count.mockResolvedValue(0 as never);
    groupBy().mockResolvedValue([] as never);
  });

  describe('the day window', () => {
    it('follows the profile timezone, not the server', async () => {
      prisma.userProfile.findUnique.mockResolvedValue({
        timezone: 'America/Costa_Rica',
        weekdayMinutes: null,
      } as never);

      const loaded = await service.load('u1', NOW);

      // 23:30 UTC is still 2 March in Costa Rica.
      expect(loaded.dateLocal).toBe('2026-03-02');
      expect(loaded.timeZone).toBe('America/Costa_Rica');
      expect(loaded.dayStart.toISOString()).toBe('2026-03-02T06:00:00.000Z');
    });

    it('defaults to UTC when the user has no profile row', async () => {
      const loaded = await service.load('u1', NOW);

      expect(loaded.timeZone).toBe('UTC');
      expect(loaded.dateLocal).toBe('2026-03-02');
    });

    // A stored timezone survived a migration and a client library; a bad one
    // must not take the whole screen down.
    it('degrades an unusable stored timezone to UTC', async () => {
      prisma.userProfile.findUnique.mockResolvedValue({
        timezone: 'Mars/Olympus_Mons',
        weekdayMinutes: null,
      } as never);

      const loaded = await service.load('u1', NOW);

      expect(loaded.timeZone).toBe('UTC');
    });

    // VISION §33 refuses catch-up debt; E11's comeback loop closes yesterday.
    it('queries only the local day, so yesterday is never a candidate', async () => {
      await service.load('u1', NOW);

      const where = (
        prisma.commitment.findMany.mock.calls[0][0] as {
          where: { scheduledStart: { gte: Date; lt: Date } };
        }
      ).where;
      expect(where.scheduledStart.gte.toISOString()).toBe('2026-03-02T00:00:00.000Z');
      expect(where.scheduledStart.lt.toISOString()).toBe('2026-03-03T00:00:00.000Z');
    });
  });

  describe('candidates', () => {
    it('excludes a paused domain from candidates but keeps its rows', async () => {
      prisma.commitment.findMany.mockResolvedValue([
        row({ id: 'health', domain: 'HEALTH' }),
        row({ id: 'work', domain: 'WORK' }),
      ] as never);
      prisma.domainMode.findMany.mockResolvedValue([
        { domain: 'HEALTH', mode: 'PAUSE' },
      ] as never);

      const loaded = await service.load('u1', NOW);

      expect(loaded.candidates.map((c) => c.id)).toEqual(['work']);
      expect(loaded.rows).toHaveLength(2);
      expect(loaded.domainModes.HEALTH).toBe('PAUSE');
    });

    it('synthesises GROW for a domain with no stored mode', async () => {
      const loaded = await service.load('u1', NOW);

      expect(loaded.domainModes).toEqual({ WORK: 'GROW', FAMILY: 'GROW', HEALTH: 'GROW' });
    });

    it('excludes terminal statuses', async () => {
      prisma.commitment.findMany.mockResolvedValue([
        row({ id: 'done', status: 'COMPLETED' }),
        row({ id: 'skipped', status: 'SKIPPED' }),
        row({ id: 'open', status: 'READY' }),
      ] as never);

      const loaded = await service.load('u1', NOW);

      expect(loaded.candidates.map((c) => c.id)).toEqual(['open']);
    });

    it('marks a candidate whose plan version is ACTIVE', async () => {
      prisma.commitment.findMany.mockResolvedValue([row({ planVersionId: 'v1' })] as never);
      prisma.planVersion.findMany.mockResolvedValue([{ id: 'v1' }] as never);

      const loaded = await service.load('u1', NOW);

      expect(loaded.candidates[0].planIsActive).toBe(true);
    });
  });

  describe('the budget', () => {
    it('defaults when the user never stated their weekday minutes', async () => {
      const loaded = await service.load('u1', NOW);

      expect(loaded.context.availableMinutesRemaining).toBe(DEFAULT_WEEKDAY_MINUTES);
    });

    it('subtracts what today already consumed, floored at zero', async () => {
      prisma.userProfile.findUnique.mockResolvedValue({
        timezone: 'UTC',
        weekdayMinutes: 60,
      } as never);
      prisma.commitment.findMany.mockResolvedValue([
        row({ id: 'done', status: 'COMPLETED', minutesSpent: 45 }),
      ] as never);

      expect((await service.load('u1', NOW)).context.availableMinutesRemaining).toBe(15);

      prisma.commitment.findMany.mockResolvedValue([
        row({ id: 'done', status: 'COMPLETED', minutesSpent: 200 }),
      ] as never);

      expect((await service.load('u1', NOW)).context.availableMinutesRemaining).toBe(0);
    });
  });

  describe('the started commitment', () => {
    it('is reported on the context', async () => {
      prisma.commitment.findMany.mockResolvedValue([
        row({ id: 'running', status: 'STARTED' }),
      ] as never);

      expect((await service.load('u1', NOW)).context.startedCommitmentId).toBe('running');
    });
  });

  describe('history', () => {
    it('distinguishes "never logged anything" from "has not logged for days"', async () => {
      const fresh = await service.load('u1', NOW);
      expect(fresh.hasAnyEvidence).toBe(false);
      expect(fresh.daysSinceLastEvidence).toBeNull();

      prisma.evidence.findFirst.mockResolvedValue({
        occurredAt: new Date('2026-02-26T09:00:00.000Z'),
      } as never);

      const lapsed = await service.load('u1', NOW);
      expect(lapsed.hasAnyEvidence).toBe(true);
      expect(lapsed.daysSinceLastEvidence).toBe(4);
    });

    it('counts routine failures only for routines on today’s board', async () => {
      prisma.commitment.findMany.mockResolvedValue([row({ routineId: 'r1' })] as never);
      groupBy().mockResolvedValue([
        { routineId: 'r1', _count: { _all: 5 } },
      ] as never);

      const loaded = await service.load('u1', NOW);

      expect(loaded.routineFailuresLast14Days.get('r1')).toBe(5);
    });

    it('skips the routine query entirely when nothing today has a routine', async () => {
      await service.load('u1', NOW);

      expect(groupBy()).not.toHaveBeenCalled();
    });
  });

  it('asks the check-in reader for today’s local date', async () => {
    await service.load('u1', NOW);

    expect(checkIns.readForDate).toHaveBeenCalledWith('u1', '2026-03-02');
  });

  // Every query filtered by userId; a foreign row can never reach the scorer.
  it('scopes every read to the caller', async () => {
    prisma.commitment.findMany.mockResolvedValue([
      row({ outcomeId: 'o1', planVersionId: 'v1' }),
    ] as never);

    await service.load('u1', NOW);

    for (const call of [
      prisma.commitment.findMany.mock.calls[0][0],
      prisma.domainMode.findMany.mock.calls[0][0],
      prisma.outcome.findMany.mock.calls[0][0],
      prisma.planVersion.findMany.mock.calls[0][0],
    ]) {
      expect((call as { where: { userId: string } }).where.userId).toBe('u1');
    }
  });
});
