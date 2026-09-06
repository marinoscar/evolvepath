import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import { UserProfileService } from '../../user-profile/user-profile.service';
import {
  ACTIVITY_WRITE_INTERVAL_MS,
  ActivityTrackerService,
} from './activity-tracker.service';

// =============================================================================
// "When did this user last do something?" (issue #112, epic E11)
// =============================================================================
//
// This runs after every action, so the interesting property is what it does
// NOT do: a second completion a minute later must not be a second write, and
// nothing it does may reach a caller as an exception.
// =============================================================================

const NOW = new Date('2026-03-06T12:00:00.000Z');

describe('ActivityTrackerService (#112)', () => {
  let service: ActivityTrackerService;
  let prisma: {
    userProfile: { updateMany: jest.Mock; findUnique: jest.Mock; upsert: jest.Mock };
  };
  let profiles: { getOrCreate: jest.Mock };

  beforeEach(async () => {
    prisma = {
      userProfile: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ lastActiveAt: NOW }),
        upsert: jest.fn(),
      },
    };
    profiles = { getOrCreate: jest.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivityTrackerService,
        { provide: PrismaService, useValue: prisma },
        { provide: UserProfileService, useValue: profiles },
      ],
    }).compile();

    service = module.get(ActivityTrackerService);
  });

  it('stamps the profile when the recorded activity is stale', async () => {
    expect(await service.touch('u1', NOW)).toBe(true);

    expect(prisma.userProfile.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'u1',
        OR: [
          { lastActiveAt: null },
          { lastActiveAt: { lt: new Date(NOW.getTime() - ACTIVITY_WRITE_INTERVAL_MS) } },
        ],
      },
      data: { lastActiveAt: NOW },
    });
  });

  it('writes nothing for a second action inside the interval', async () => {
    prisma.userProfile.updateMany.mockResolvedValue({ count: 0 });

    expect(await service.touch('u1', NOW)).toBe(false);
    expect(profiles.getOrCreate).not.toHaveBeenCalled();
  });

  it('creates the profile for a user who has none yet', async () => {
    prisma.userProfile.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    prisma.userProfile.findUnique.mockResolvedValue(null);

    expect(await service.touch('u1', NOW)).toBe(true);
    expect(profiles.getOrCreate).toHaveBeenCalledWith('u1');
  });

  it('never lets a bookkeeping failure reach the caller', async () => {
    prisma.userProfile.updateMany.mockRejectedValue(new Error('connection lost'));

    expect(() => service.record('u1', NOW)).not.toThrow();
    // Let the detached promise settle so an unhandled rejection would surface.
    await new Promise((resolve) => setImmediate(resolve));
  });
});
