import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import { UserProfileService } from '../../user-profile/user-profile.service';
import { DomainWindowLoader, toWindowCommitment } from './domain-window.loader';
import { MomentumService } from './momentum.service';

// =============================================================================
// The engine, wired (issue #98, epic E11)
// =============================================================================
//
// Two things only a wired test shows: that `versionUsed` becomes `fallbackUsed`
// on the way in (so a short completion is a completion downstream), and that
// the timezone comes from the profile with UTC as the fallback rather than the
// process default — a server in UTC would otherwise pass every timezone test
// while every user's week boundary was wrong.
// =============================================================================

const NOW = new Date('2026-03-02T12:00:00.000Z');
const DAY = 86_400_000;

function commitmentRow(over: Record<string, unknown> = {}) {
  return {
    id: 'a',
    domain: 'HEALTH',
    scheduledStart: new Date(NOW.getTime() - DAY),
    status: 'COMPLETED',
    rescheduleCount: 0,
    versionUsed: null,
    completedAt: new Date(NOW.getTime() - DAY),
    commitmentType: 'workout',
    ...over,
  };
}

describe('MomentumService (#98)', () => {
  let service: MomentumService;
  let prisma: {
    commitment: { findMany: jest.Mock; groupBy: jest.Mock };
    evidence: { findMany: jest.Mock };
  };
  let profiles: { find: jest.Mock };

  beforeEach(async () => {
    prisma = {
      commitment: {
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      evidence: { findMany: jest.fn().mockResolvedValue([]) },
    };
    profiles = { find: jest.fn().mockResolvedValue({ timezone: 'America/Costa_Rica' }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MomentumService,
        DomainWindowLoader,
        { provide: PrismaService, useValue: prisma },
        { provide: UserProfileService, useValue: profiles },
      ],
    }).compile();

    service = module.get(MomentumService);
  });

  describe('the loader', () => {
    it('turns a SHORT or MINIMUM version into a fallback completion', () => {
      expect(toWindowCommitment(commitmentRow({ versionUsed: 'MINIMUM' }) as never).fallbackUsed)
        .toBe(true);
      expect(toWindowCommitment(commitmentRow({ versionUsed: 'SHORT' }) as never).fallbackUsed)
        .toBe(true);
      expect(toWindowCommitment(commitmentRow({ versionUsed: 'FULL' }) as never).fallbackUsed)
        .toBe(false);
      expect(toWindowCommitment(commitmentRow() as never).fallbackUsed).toBe(false);
    });

    it('reads the timezone from the profile', async () => {
      const loaded = await service.load('u1', NOW);

      expect(loaded.timeZone).toBe('America/Costa_Rica');
    });

    it('falls back to UTC for a missing or unusable zone', async () => {
      profiles.find.mockResolvedValue({ timezone: 'Mars/Olympus_Mons' });
      expect((await service.load('u1', NOW)).timeZone).toBe('UTC');

      profiles.find.mockResolvedValue(null);
      expect((await service.load('u1', NOW)).timeZone).toBe('UTC');
    });

    it('scopes every query to the caller', async () => {
      await service.load('user-a', NOW);

      expect(prisma.commitment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId: 'user-a' }) }),
      );
      expect(prisma.evidence.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId: 'user-a' }) }),
      );
    });

    it('keeps a domain’s window to the last 28 days of its own rows', async () => {
      prisma.commitment.findMany.mockResolvedValue([
        commitmentRow({ id: 'recent', scheduledStart: new Date(NOW.getTime() - 5 * DAY) }),
        commitmentRow({ id: 'old', scheduledStart: new Date(NOW.getTime() - 40 * DAY) }),
        commitmentRow({ id: 'work', domain: 'WORK' }),
      ]);

      const loaded = await service.load('u1', NOW);

      expect(loaded.windows.HEALTH.commitments.map((row) => row.id)).toEqual(['recent']);
      expect(loaded.windows.WORK.commitments.map((row) => row.id)).toEqual(['work']);
      expect(loaded.history).toHaveLength(3);
    });

    it('keeps a row scheduled ahead but already finished', async () => {
      // The window has NO upper bound on purpose: `isDecided` excludes a still
      // open future row, and cutting at `now` here dropped the comeback restart
      // — scheduled an hour out, completed immediately.
      prisma.commitment.findMany.mockResolvedValue([
        commitmentRow({
          id: 'done-early',
          scheduledStart: new Date(NOW.getTime() + 3_600_000),
          completedAt: NOW,
        }),
      ]);

      const loaded = await service.load('u1', NOW);

      expect(loaded.windows.HEALTH.commitments.map((row) => row.id)).toEqual(['done-early']);
    });
  });

  describe('summary', () => {
    it('is the state plus the first evidence bullet, and nothing else', async () => {
      prisma.commitment.findMany.mockResolvedValue([
        commitmentRow({ id: '1', scheduledStart: new Date(NOW.getTime() - 2 * DAY) }),
        commitmentRow({ id: '2', scheduledStart: new Date(NOW.getTime() - 4 * DAY) }),
        commitmentRow({
          id: '3',
          scheduledStart: new Date(NOW.getTime() - 6 * DAY),
          status: 'MISSED',
          completedAt: null,
        }),
      ]);

      const summary = await service.summary('u1', NOW);

      expect(Object.keys(summary).sort()).toEqual(['FAMILY', 'HEALTH', 'WORK']);
      expect(Object.keys(summary.HEALTH).sort()).toEqual(['headline', 'state']);
      expect(summary.HEALTH.headline).toBe('2 of 3 planned workouts completed');
      expect(summary.FAMILY).toEqual({
        state: 'INSUFFICIENT_DATA',
        headline: expect.stringContaining('Not enough planned'),
      });
    });
  });
});
