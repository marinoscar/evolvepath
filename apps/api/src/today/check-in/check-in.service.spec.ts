import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService, MockPrismaService } from '../../../test/mocks/prisma.mock';
import { UserProfileService } from '../../user-profile/user-profile.service';
import { TodayInsightCache } from '../insight/today-insight.cache';
import { CheckInService } from './check-in.service';
import { ActivityTrackerService } from '../../progress/comeback/activity-tracker.service';

/** `record` is fire-and-forget; these specs only need it not to explode. */
const activity = { touch: jest.fn(), record: jest.fn() };

// 23:30 UTC is still 2 March in Costa Rica, and already 3 March in UTC.
const LATE = new Date('2026-03-02T23:30:00.000Z');

describe('CheckInService (#43)', () => {
  let service: CheckInService;
  let prisma: MockPrismaService;
  let userProfile: { find: jest.Mock };
  let cache: TodayInsightCache;

  const userId = 'user-123';

  const row = (over: Record<string, unknown> = {}) =>
    ({
      id: 'ci-1',
      userId,
      dateLocal: '2026-03-02',
      feel: 'PACKED',
      createdAt: LATE,
      updatedAt: LATE,
      ...over,
    }) as never;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    userProfile = { find: jest.fn().mockResolvedValue(null) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CheckInService,
        TodayInsightCache,
        { provide: PrismaService, useValue: prisma },
        { provide: UserProfileService, useValue: userProfile },
        { provide: ActivityTrackerService, useValue: activity },
      ],
    }).compile();

    service = module.get(CheckInService);
    cache = module.get(TodayInsightCache);
    prisma.auditEvent.create.mockResolvedValue({ id: 'audit-1' } as never);
  });

  describe('upsert', () => {
    it('writes one row per user per local day', async () => {
      prisma.dailyCheckIn.upsert.mockResolvedValue(row());

      const result = await service.upsert(userId, 'PACKED', LATE);

      expect(prisma.dailyCheckIn.upsert).toHaveBeenCalledWith({
        where: { userId_dateLocal: { userId, dateLocal: '2026-03-02' } },
        create: { userId, dateLocal: '2026-03-02', feel: 'PACKED' },
        update: { feel: 'PACKED' },
      });
      expect(result).toEqual({
        dateLocal: '2026-03-02',
        feel: 'PACKED',
        updatedAt: LATE.toISOString(),
      });
    });

    // A morning that started fine can become a packed afternoon; a history of
    // taps would be noise.
    it('overwrites the same day rather than appending', async () => {
      prisma.dailyCheckIn.upsert.mockResolvedValue(row({ feel: 'LOW_ENERGY' }));

      await service.upsert(userId, 'PACKED', LATE);
      await service.upsert(userId, 'LOW_ENERGY', LATE);

      expect(prisma.dailyCheckIn.upsert).toHaveBeenCalledTimes(2);
      expect(prisma.dailyCheckIn.create).not.toHaveBeenCalled();
      const [, second] = prisma.dailyCheckIn.upsert.mock.calls;
      expect((second[0] as { update: { feel: string } }).update).toEqual({ feel: 'LOW_ENERGY' });
    });

    // The user checked in on their evening, not on the server's tomorrow.
    it('files the answer under the profile timezone, not UTC', async () => {
      userProfile.find.mockResolvedValue({ timezone: 'America/Costa_Rica' });
      prisma.dailyCheckIn.upsert.mockResolvedValue(row());

      const result = await service.upsert(userId, 'PACKED', LATE);

      expect(result.dateLocal).toBe('2026-03-02');
    });

    it('falls back to UTC for a user with no profile row', async () => {
      prisma.dailyCheckIn.upsert.mockResolvedValue(row({ dateLocal: '2026-03-02' }));

      await service.upsert(userId, 'PACKED', LATE);

      expect(
        (prisma.dailyCheckIn.upsert.mock.calls[0][0] as { create: { dateLocal: string } }).create
          .dateLocal,
      ).toBe('2026-03-02');
    });

    it('invalidates the cached insight', async () => {
      prisma.dailyCheckIn.upsert.mockResolvedValue(row());
      cache.set(userId, '2026-03-02', {
        text: 'stale',
        source: 'ai',
        generatedAt: LATE.toISOString(),
      });

      await service.upsert(userId, 'LOW_ENERGY', LATE);

      expect(cache.get(userId, '2026-03-02')).toBeNull();
    });

    it('writes an audit row carrying the day and the feeling', async () => {
      prisma.dailyCheckIn.upsert.mockResolvedValue(row());

      await service.upsert(userId, 'PACKED', LATE);

      expect(prisma.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: userId,
          action: 'today:check_in',
          targetType: 'daily_check_in',
          meta: { dateLocal: '2026-03-02', feel: 'PACKED' },
        }),
      });
    });

    it('absorbs a concurrent first tap and applies the newer answer', async () => {
      prisma.dailyCheckIn.upsert.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
      prisma.dailyCheckIn.update.mockResolvedValue(row({ feel: 'LOW_ENERGY' }));

      const result = await service.upsert(userId, 'LOW_ENERGY', LATE);

      expect(result.feel).toBe('LOW_ENERGY');
    });

    it('rethrows anything that is not the unique-index race', async () => {
      prisma.dailyCheckIn.upsert.mockRejectedValue(new Error('connection lost'));

      await expect(service.upsert(userId, 'PACKED', LATE)).rejects.toThrow('connection lost');
    });
  });

  describe('get', () => {
    it('is null before the user taps anything today', async () => {
      prisma.dailyCheckIn.findUnique.mockResolvedValue(null as never);

      await expect(service.get(userId, LATE)).resolves.toBeNull();
    });

    it('returns the stored answer', async () => {
      prisma.dailyCheckIn.findUnique.mockResolvedValue(row({ feel: 'LOW_ENERGY' }));

      await expect(service.get(userId, LATE)).resolves.toMatchObject({ feel: 'LOW_ENERGY' });
    });
  });

  describe('readForDate (the CheckInReader seam)', () => {
    it('answers the scorer with the feeling, or null', async () => {
      prisma.dailyCheckIn.findUnique.mockResolvedValue({ feel: 'LOW_ENERGY' } as never);
      await expect(service.readForDate(userId, '2026-03-02')).resolves.toBe('LOW_ENERGY');

      prisma.dailyCheckIn.findUnique.mockResolvedValue(null as never);
      await expect(service.readForDate(userId, '2026-03-02')).resolves.toBeNull();
    });

    // `GET /today` calls this on every request.
    it('never writes', async () => {
      prisma.dailyCheckIn.findUnique.mockResolvedValue(null as never);

      await service.readForDate(userId, '2026-03-02');

      expect(prisma.dailyCheckIn.upsert).not.toHaveBeenCalled();
      expect(prisma.auditEvent.create).not.toHaveBeenCalled();
    });
  });
});
