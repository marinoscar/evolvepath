import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService, MockPrismaService } from '../../../test/mocks/prisma.mock';
import { UserProfileService } from '../../user-profile/user-profile.service';
import { DayReflectionService } from './day-reflection.service';

const EVENING = new Date('2026-03-02T23:30:00.000Z');

describe('DayReflectionService (#43)', () => {
  let service: DayReflectionService;
  let prisma: MockPrismaService;
  let userProfile: { find: jest.Mock };

  const userId = 'user-123';

  const row = (over: Record<string, unknown> = {}) =>
    ({
      id: 'r1',
      userId,
      relatedType: 'day',
      relatedId: null,
      commitmentId: null,
      userText: 'evenings are chaos',
      frictionTags: ['BAD_TIMING'],
      mood: null,
      perceivedDifficulty: null,
      satisfaction: null,
      aiSummary: null,
      createdAt: EVENING,
      updatedAt: EVENING,
      ...over,
    }) as never;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    userProfile = { find: jest.fn().mockResolvedValue(null) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DayReflectionService,
        { provide: PrismaService, useValue: prisma },
        { provide: UserProfileService, useValue: userProfile },
      ],
    }).compile();

    service = module.get(DayReflectionService);
    prisma.auditEvent.create.mockResolvedValue({ id: 'audit-1' } as never);
  });

  describe('create', () => {
    it('stores the quick option as the only friction tag', async () => {
      prisma.reflection.create.mockResolvedValue(row());

      await service.create(userId, { quickOption: 'BAD_TIMING', text: 'evenings are chaos' }, EVENING);

      expect(prisma.reflection.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId,
          relatedType: 'day',
          relatedId: null,
          commitmentId: null,
          userText: 'evenings are chaos',
          frictionTags: ['BAD_TIMING'],
        }),
      });
    });

    // E10's weekly review groups on these; a date marker smuggled in here would
    // corrupt every one of those groupings.
    it('never puts anything but the option in frictionTags', async () => {
      prisma.reflection.create.mockResolvedValue(row());

      await service.create(userId, { quickOption: 'TOO_MUCH' }, EVENING);

      const data = prisma.reflection.create.mock.calls[0][0].data as { frictionTags: string[] };
      expect(data.frictionTags).toEqual(['TOO_MUCH']);
    });

    it('stores no text when the user gave none', async () => {
      prisma.reflection.create.mockResolvedValue(row({ userText: null }));

      await service.create(userId, { quickOption: 'PLAN_WORKED' }, EVENING);

      const data = prisma.reflection.create.mock.calls[0][0].data as { userText: string | null };
      expect(data.userText).toBeNull();
    });

    it('reports the day in the user’s own timezone', async () => {
      userProfile.find.mockResolvedValue({ timezone: 'America/Costa_Rica' });
      prisma.reflection.create.mockResolvedValue(row());

      const result = await service.create(userId, { quickOption: 'TOO_MUCH' }, EVENING);

      expect(result.dateLocal).toBe('2026-03-02');
    });

    it('audits the option and the day, never the note', async () => {
      prisma.reflection.create.mockResolvedValue(row());

      await service.create(
        userId,
        { quickOption: 'AVOIDED', text: 'I did not want to face it' },
        EVENING,
      );

      const audited = JSON.stringify(prisma.auditEvent.create.mock.calls[0][0]);
      expect(audited).toContain('today:reflection');
      expect(audited).toContain('AVOIDED');
      expect(audited).not.toContain('face it');
    });
  });

  describe('getLatest', () => {
    it('is null when the user has said nothing today', async () => {
      prisma.reflection.findFirst.mockResolvedValue(null as never);

      await expect(service.getLatest(userId, EVENING)).resolves.toBeNull();
    });

    // Several per day are allowed — a user may come back with more to say.
    it('asks for the newest inside the user’s own day bounds', async () => {
      userProfile.find.mockResolvedValue({ timezone: 'America/Costa_Rica' });
      prisma.reflection.findFirst.mockResolvedValue(row());

      await service.getLatest(userId, EVENING);

      const args = prisma.reflection.findFirst.mock.calls[0][0] as {
        where: { userId: string; relatedType: string; createdAt: { gte: Date; lt: Date } };
        orderBy: { createdAt: string };
      };
      expect(args.where.userId).toBe(userId);
      expect(args.where.relatedType).toBe('day');
      expect(args.where.createdAt.gte.toISOString()).toBe('2026-03-02T06:00:00.000Z');
      expect(args.where.createdAt.lt.toISOString()).toBe('2026-03-03T06:00:00.000Z');
      expect(args.orderBy.createdAt).toBe('desc');
    });

    it('reads the option back off the tags', async () => {
      prisma.reflection.findFirst.mockResolvedValue(row({ frictionTags: ['LOW_ENERGY'] }));

      await expect(service.getLatest(userId, EVENING)).resolves.toMatchObject({
        quickOption: 'LOW_ENERGY',
      });
    });
  });
});
