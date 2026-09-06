import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import { MilestonesService } from './milestones.service';

// =============================================================================
// Awarding a milestone (issue #115, epic E11)
// =============================================================================
//
// This runs after every start, every completion, every comeback and once a day.
// So the properties that matter are: it deduplicates at the DATABASE, it audits
// what it awarded without saying anything about the plan, and it can never be
// the reason a completed workout returns a 500.
// =============================================================================

const NOW = new Date('2026-03-06T12:00:00.000Z');

describe('MilestonesService (#115)', () => {
  let service: MilestonesService;
  let prisma: any;

  const milestoneRow = (over: Record<string, unknown> = {}) => ({
    id: '11111111-1111-4111-8111-111111111111',
    userId: 'u1',
    kind: 'FIRST_COMEBACK',
    sequence: 1,
    domain: null,
    achievedAt: NOW,
    acknowledgedAt: null,
    meta: {},
    createdAt: NOW,
    ...over,
  });

  beforeEach(async () => {
    prisma = {
      milestone: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockImplementation(async ({ data }: any) =>
          milestoneRow({ acknowledgedAt: data.acknowledgedAt }),
        ),
      },
      userProfile: { findUnique: jest.fn().mockResolvedValue({ timezone: 'UTC' }) },
      commitment: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      evidence: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      auditEvent: { create: jest.fn().mockResolvedValue({ id: 'a1' }) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [MilestonesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(MilestonesService);
  });

  describe('evaluate', () => {
    it('writes nothing when there is nothing to award', async () => {
      expect(await service.evaluate('u1', NOW)).toEqual([]);
      expect(prisma.milestone.createMany).not.toHaveBeenCalled();
    });

    it('leans on the unique index rather than on a read-then-write', async () => {
      prisma.evidence.count.mockResolvedValue(1);
      prisma.milestone.findMany
        .mockResolvedValueOnce([]) // existing
        .mockResolvedValueOnce([milestoneRow()]); // created

      const created = await service.evaluate('u1', NOW);

      expect(prisma.milestone.createMany).toHaveBeenCalledWith(
        expect.objectContaining({ skipDuplicates: true }),
      );
      expect(created).toHaveLength(1);
    });

    it('audits each award with its kind and sequence, and nothing else', async () => {
      prisma.evidence.count.mockResolvedValue(1);
      prisma.milestone.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([milestoneRow()]);

      await service.evaluate('u1', NOW);

      expect(prisma.auditEvent.create).toHaveBeenCalledWith({
        data: {
          actorUserId: 'u1',
          action: 'milestone:achieved',
          targetType: 'milestone',
          targetId: milestoneRow().id,
          meta: { kind: 'FIRST_COMEBACK', sequence: 1 },
        },
      });
    });

    it('never awards REDUCED_REMINDERS — E12 has not measured anything yet', async () => {
      prisma.commitment.count.mockResolvedValue(500);
      prisma.milestone.findMany.mockResolvedValue([]);

      await service.evaluate('u1', NOW);

      const written = prisma.milestone.createMany.mock.calls[0]?.[0]?.data ?? [];
      expect(written.map((row: any) => row.kind)).not.toContain('REDUCED_REMINDERS');
    });
  });

  describe('afterAction', () => {
    it('never throws, whatever the database does', async () => {
      prisma.milestone.findMany.mockRejectedValue(new Error('connection lost'));

      expect(() => service.afterAction('u1', NOW)).not.toThrow();
      await new Promise((resolve) => setImmediate(resolve));
    });
  });

  describe('acknowledge', () => {
    it('is a 404 for another user’s milestone, identical to an unknown id', async () => {
      await expect(service.acknowledge('u1', 'someone-elses')).rejects.toThrow(
        'Milestone not found',
      );
    });

    it('is idempotent — a second acknowledgement writes nothing', async () => {
      prisma.milestone.findFirst.mockResolvedValue(
        milestoneRow({ acknowledgedAt: NOW }),
      );

      const result = await service.acknowledge('u1', milestoneRow().id);

      expect(result.acknowledgedAt).toBe(NOW.toISOString());
      expect(prisma.milestone.update).not.toHaveBeenCalled();
    });

    it('stamps it and audits the acknowledgement', async () => {
      prisma.milestone.findFirst.mockResolvedValue(milestoneRow());

      const result = await service.acknowledge('u1', milestoneRow().id);

      expect(result.acknowledgedAt).not.toBeNull();
      expect(prisma.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'milestone:acknowledge' }),
        }),
      );
    });
  });

  describe('forProgress', () => {
    it('keeps an old unacknowledged milestone that the recent list would drop', async () => {
      const old = milestoneRow({
        id: '22222222-2222-4222-8222-222222222222',
        achievedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      prisma.milestone.findMany
        .mockResolvedValueOnce([milestoneRow()]) // ten most recent
        .mockResolvedValueOnce([old]); // unacknowledged

      const result = await service.forProgress('u1');

      expect(result.map((row) => row.id)).toEqual([milestoneRow().id, old.id]);
    });
  });

  describe('the view', () => {
    it('renders the copy PRD §77 asks for — a fact, not a cheer', async () => {
      prisma.milestone.findMany.mockResolvedValue([
        milestoneRow({ kind: 'TEN_WORKOUTS', domain: 'HEALTH', meta: { count: 20 } }),
      ]);

      const [row] = await service.list('u1');

      expect(row.title).toBe('20 workouts completed');
      expect(row.title).not.toContain('!');
    });
  });
});
