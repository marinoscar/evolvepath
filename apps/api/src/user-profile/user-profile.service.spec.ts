import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { UserProfileService } from './user-profile.service';

describe('UserProfileService (#100)', () => {
  let service: UserProfileService;
  let prisma: {
    userProfile: {
      upsert: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      userProfile: {
        upsert: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [UserProfileService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(UserProfileService);
  });

  describe('getOrCreate', () => {
    it('upserts once and returns the row', async () => {
      const row = { id: 'p1', userId: 'u1', timezone: 'UTC' };
      prisma.userProfile.upsert.mockResolvedValue(row);

      await expect(service.getOrCreate('u1')).resolves.toBe(row);

      expect(prisma.userProfile.upsert).toHaveBeenCalledTimes(1);
      expect(prisma.userProfile.upsert).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        create: { userId: 'u1' },
        update: {},
      });
    });

    it('is idempotent: a second call still leaves one row', async () => {
      const row = { id: 'p1', userId: 'u1' };
      prisma.userProfile.upsert.mockResolvedValue(row);

      const first = await service.getOrCreate('u1');
      const second = await service.getOrCreate('u1');

      // The upsert's `update: {}` is what makes this true — the second call
      // matches the unique row and writes nothing.
      expect(first).toBe(second);
      expect(prisma.userProfile.upsert).toHaveBeenCalledTimes(2);
    });

    it('absorbs a concurrent first-write (P2002) by re-reading the winner', async () => {
      const winner = { id: 'p1', userId: 'u1' };
      prisma.userProfile.upsert.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique constraint', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
      prisma.userProfile.findUnique.mockResolvedValue(winner);

      await expect(service.getOrCreate('u1')).resolves.toBe(winner);
    });

    it('rethrows anything that is not a unique-constraint race', async () => {
      prisma.userProfile.upsert.mockRejectedValue(new Error('connection lost'));

      await expect(service.getOrCreate('u1')).rejects.toThrow('connection lost');
      expect(prisma.userProfile.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('isOnboardingComplete', () => {
    it('is false when the user has no profile row at all', async () => {
      prisma.userProfile.findUnique.mockResolvedValue(null);

      await expect(service.isOnboardingComplete('u1')).resolves.toBe(false);
    });

    it('is false when the row exists but onboardingCompletedAt is null', async () => {
      prisma.userProfile.findUnique.mockResolvedValue({ onboardingCompletedAt: null });

      await expect(service.isOnboardingComplete('u1')).resolves.toBe(false);
    });

    it('is true once onboardingCompletedAt carries a timestamp', async () => {
      prisma.userProfile.findUnique.mockResolvedValue({
        onboardingCompletedAt: new Date('2026-01-01T00:00:00.000Z'),
      });

      await expect(service.isOnboardingComplete('u1')).resolves.toBe(true);
    });

    // `/auth/me` runs on every application boot. A write there would turn a
    // page load into a database write for every user who has never onboarded.
    it('never writes — the read path is hit on every app boot', async () => {
      prisma.userProfile.findUnique.mockResolvedValue(null);

      await service.isOnboardingComplete('u1');

      expect(prisma.userProfile.upsert).not.toHaveBeenCalled();
      expect(prisma.userProfile.update).not.toHaveBeenCalled();
      expect(prisma.userProfile.findUnique).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        select: { onboardingCompletedAt: true },
      });
    });
  });

  describe('update', () => {
    it('creates the row before patching it', async () => {
      prisma.userProfile.upsert.mockResolvedValue({ id: 'p1', userId: 'u1' });
      prisma.userProfile.update.mockResolvedValue({ id: 'p1', timezone: 'America/Costa_Rica' });

      await service.update('u1', { timezone: 'America/Costa_Rica' });

      expect(prisma.userProfile.upsert).toHaveBeenCalledTimes(1);
      expect(prisma.userProfile.update).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        data: { timezone: 'America/Costa_Rica' },
      });
    });
  });
});
