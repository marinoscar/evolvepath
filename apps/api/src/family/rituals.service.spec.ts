import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { Ritual } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { createMockPrismaService, MockPrismaService } from '../../test/mocks/prisma.mock';
import { CommitmentsService } from '../commitments/commitments.service';
import { RoutinesService } from '../path/routines/routines.service';
import { BehaviourLintService } from './behaviour-lint.service';
import { RitualMaterializerService } from './ritual-materializer.service';
import { RitualsService } from './rituals.service';

const USER = 'user-1';
const RITUAL_ID = '22222222-2222-4222-8222-222222222222';
const MEMBER_ID = '11111111-1111-4111-8111-111111111111';
const OUTCOME_ID = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-06-01T15:00:00.000Z');

const RECURRENCE = { weekdays: [2, 4, 0], time: '18:30', everyNWeeks: 1 };

function ritual(over: Partial<Ritual> = {}): Ritual {
  return {
    id: RITUAL_ID,
    userId: USER,
    title: 'Phone-free dinner',
    purpose: null,
    familyMemberId: null,
    recurrence: RECURRENCE,
    idealMinutes: 45,
    minimumMinutes: 10,
    fallbackBehavior: null,
    active: true,
    lastMaterializedThrough: null,
    routineId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  } as Ritual;
}

const validBody = {
  title: 'Phone-free dinner',
  recurrence: RECURRENCE,
  idealMinutes: 45,
  minimumMinutes: 10,
};

describe('RitualsService', () => {
  let service: RitualsService;
  let prisma: MockPrismaService;
  let materializer: {
    materialize: jest.Mock;
    desiredOccurrences: jest.Mock;
    contentFor: jest.Mock;
  };
  let commitments: { transition: jest.Mock };
  let routines: { create: jest.Mock; update: jest.Mock };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    materializer = {
      materialize: jest.fn().mockResolvedValue({ created: 3, skipped: 0, through: '2026-06-08' }),
      // The edit path asks "what should exist?" and refreshes the rows the new
      // rule still wants; both come from the real service.
      desiredOccurrences: jest.fn().mockResolvedValue({
        zone: 'America/Costa_Rica',
        throughLocal: '2026-06-08',
        starts: [],
      }),
      contentFor: jest.fn().mockReturnValue({ title: 'Phone-free dinner' }),
    };
    commitments = { transition: jest.fn().mockResolvedValue({}) };
    routines = {
      create: jest.fn().mockResolvedValue({ id: 'routine-1' }),
      update: jest.fn().mockResolvedValue({ id: 'routine-1' }),
    };

    const module = await Test.createTestingModule({
      providers: [
        RitualsService,
        { provide: PrismaService, useValue: prisma },
        // The REAL lint: it is pure, and stubbing it would let these specs pass
        // against a PRD §32 rule that never ran.
        { provide: BehaviourLintService, useValue: new BehaviourLintService(null as never, null as never) },
        { provide: RitualMaterializerService, useValue: materializer },
        { provide: CommitmentsService, useValue: commitments },
        { provide: RoutinesService, useValue: routines },
      ],
    }).compile();

    service = module.get(RitualsService);
    prisma.auditEvent.create.mockResolvedValue({ id: 'audit' } as never);
    prisma.userProfile.findUnique.mockResolvedValue({ timezone: 'America/Costa_Rica' } as never);
    prisma.commitment.findMany.mockResolvedValue([] as never);
  });

  const audits = () => prisma.auditEvent.create.mock.calls.map((call) => (call[0] as any).data);

  describe('create', () => {
    beforeEach(() => {
      prisma.ritual.create.mockResolvedValue(ritual() as never);
      prisma.ritual.findFirst.mockResolvedValue(ritual() as never);
    });

    it('materializes the first week synchronously', async () => {
      await service.create(USER, validBody as never, NOW);

      expect(prisma.ritual.create).toHaveBeenCalled();
      expect(materializer.materialize).toHaveBeenCalledWith(USER, expect.objectContaining({ id: RITUAL_ID }), NOW);
    });

    // The lint runs BEFORE any write: a refused title leaves nothing behind.
    it('refuses a title that legislates another person, before writing anything', async () => {
      await expect(
        service.create(USER, { ...validBody, title: 'Make Mia happier' } as never, NOW),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.ritual.create).not.toHaveBeenCalled();
      expect(prisma.auditEvent.create).not.toHaveBeenCalled();
      expect(routines.create).not.toHaveBeenCalled();
      expect(materializer.materialize).not.toHaveBeenCalled();
    });

    it('names the offending substring in the error', async () => {
      await service
        .create(USER, { ...validBody, title: 'Make Mia happier' } as never, NOW)
        .catch((error: BadRequestException) => {
          expect((error.getResponse() as any).details).toMatchObject({
            reason: 'BEHAVIOUR_TARGETS_OTHER_PERSON',
            match: 'Make Mia happier',
          });
        });

      expect.assertions(1);
    });

    it('answers 404 for a family member that is not the caller’s', async () => {
      prisma.familyMember.findFirst.mockResolvedValue(null as never);

      await expect(
        service.create(USER, { ...validBody, familyMemberId: MEMBER_ID } as never, NOW),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.ritual.create).not.toHaveBeenCalled();
    });

    it('creates a routine under the outcome’s active plan version and stores its id', async () => {
      prisma.outcome.findFirst.mockResolvedValue({
        id: OUTCOME_ID,
        plan: { versions: [{ id: 'version-1' }] },
      } as never);

      await service.create(USER, { ...validBody, outcomeId: OUTCOME_ID } as never, NOW);

      expect(routines.create).toHaveBeenCalledWith(
        USER,
        expect.objectContaining({
          planVersionId: 'version-1',
          domain: 'FAMILY',
          title: 'Phone-free dinner',
          triggerType: 'TIME',
          preferredTime: '18:30',
          frequency: 'CUSTOM',
          daysOfWeek: [0, 2, 4],
          estimatedDurationMin: 45,
          minimumDurationMin: 10,
        }),
      );
      expect((prisma.ritual.create.mock.calls[0][0] as any).data.routineId).toBe('routine-1');
    });

    it('describes an every-day ritual as DAILY rather than CUSTOM', async () => {
      prisma.outcome.findFirst.mockResolvedValue({
        id: OUTCOME_ID,
        plan: { versions: [{ id: 'version-1' }] },
      } as never);

      await service.create(
        USER,
        { ...validBody, outcomeId: OUTCOME_ID, recurrence: { ...RECURRENCE, weekdays: [0, 1, 2, 3, 4, 5, 6] } } as never,
        NOW,
      );

      expect(routines.create.mock.calls[0][1]).toMatchObject({ frequency: 'DAILY' });
    });

    it('refuses to link an outcome with no active plan version', async () => {
      prisma.outcome.findFirst.mockResolvedValue({ id: OUTCOME_ID, plan: { versions: [] } } as never);

      await expect(
        service.create(USER, { ...validBody, outcomeId: OUTCOME_ID } as never, NOW),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('audits the shape of the ritual, never the member’s identity', async () => {
      prisma.familyMember.findFirst.mockResolvedValue({ id: MEMBER_ID } as never);
      prisma.ritual.create.mockResolvedValue(ritual({ familyMemberId: MEMBER_ID }) as never);

      await service.create(USER, { ...validBody, familyMemberId: MEMBER_ID } as never, NOW);

      expect(audits()[0]).toMatchObject({
        action: 'ritual:create',
        targetType: 'ritual',
        meta: { idealMinutes: 45, minimumMinutes: 10, hasMember: true, routineId: null },
      });
      expect(JSON.stringify(audits()[0].meta)).not.toContain(MEMBER_ID);
    });
  });

  describe('update', () => {
    /**
     * A stateful stand-in for the row, because the service RE-READS the ritual
     * after materializing it — `lastMaterializedThrough` moved, and the response
     * has to show where it moved to. A `findFirst` frozen at the pre-update
     * value would let `syncRoutine` assertions pass against stale data.
     */
    let stored: Ritual;

    const store = (next: Ritual) => {
      stored = next;
      prisma.ritual.findFirst.mockResolvedValue(next as never);
      return next;
    };

    beforeEach(() => {
      store(ritual());
      prisma.ritual.update.mockImplementation((async (args: any) =>
        store(ritual({ ...stored, ...args.data }))) as never);
    });

    it('cancels future PLANNED and READY occurrences through the matrix', async () => {
      prisma.commitment.findMany.mockResolvedValue([
        { id: 'c1', scheduledStart: new Date('2026-06-03T00:30:00.000Z') },
        { id: 'c2', scheduledStart: new Date('2026-06-05T00:30:00.000Z') },
      ] as never);

      await service.update(USER, RITUAL_ID, { recurrence: { ...RECURRENCE, weekdays: [2, 4] } } as never, NOW);

      // NO STATUS IS EVER WRITTEN BY A RAW updateMany. The matrix is what
      // protects a row the user already touched, so a withdrawal goes through
      // it; the only bulk write here refreshes CONTENT on rows the new rule
      // still wants.
      for (const call of prisma.commitment.updateMany.mock.calls) {
        expect((call[0] as any).data).not.toHaveProperty('status');
      }
      expect(commitments.transition).toHaveBeenCalledTimes(2);
      expect(commitments.transition).toHaveBeenCalledWith(USER, 'c1', { to: 'CANCELLED' });
    });

    // The bug E08's e2e (#53) caught. Cancelling every future row and
    // re-materializing looks right and fails silently: the unique
    // `(ritual_id, scheduled_start)` index turns each re-created slot into a
    // `skipped`, so unticking Sunday would leave Tuesday and Thursday cancelled
    // and never rebuilt.
    it('keeps the occurrences the new rule still wants', async () => {
      const tuesday = new Date('2026-06-03T00:30:00.000Z');
      const sunday = new Date('2026-06-08T00:30:00.000Z');

      prisma.commitment.findMany.mockResolvedValue([
        { id: 'tue', scheduledStart: tuesday },
        { id: 'sun', scheduledStart: sunday },
      ] as never);
      materializer.desiredOccurrences.mockResolvedValue({
        zone: 'America/Costa_Rica',
        throughLocal: '2026-06-08',
        starts: [tuesday],
      });

      await service.update(USER, RITUAL_ID, { recurrence: { ...RECURRENCE, weekdays: [2, 4] } } as never, NOW);

      // Only the dropped weekday is withdrawn.
      expect(commitments.transition).toHaveBeenCalledTimes(1);
      expect(commitments.transition).toHaveBeenCalledWith(USER, 'sun', { to: 'CANCELLED' });
    });

    it('refreshes the kept occurrences with the new title and durations', async () => {
      const tuesday = new Date('2026-06-03T00:30:00.000Z');
      materializer.desiredOccurrences.mockResolvedValue({
        zone: 'America/Costa_Rica',
        throughLocal: '2026-06-08',
        starts: [tuesday],
      });
      materializer.contentFor.mockReturnValue({ title: 'Phone-free supper', fullMinutes: 60 });

      await service.update(USER, RITUAL_ID, { idealMinutes: 60 } as never, NOW);

      expect(prisma.commitment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            ritualId: RITUAL_ID,
            scheduledStart: { gt: NOW, in: [tuesday] },
            status: { in: ['PLANNED', 'READY'] },
          }),
          data: { title: 'Phone-free supper', fullMinutes: 60 },
        }),
      );
    });

    it('keeps nothing when the ritual is paused', async () => {
      prisma.commitment.findMany.mockResolvedValue([
        { id: 'tue', scheduledStart: new Date('2026-06-03T00:30:00.000Z') },
      ] as never);

      await service.update(USER, RITUAL_ID, { active: false } as never, NOW);

      // A pause withdraws everything ahead, so the desired set is never asked
      // for and nothing is refreshed.
      expect(materializer.desiredOccurrences).not.toHaveBeenCalled();
      expect(prisma.commitment.updateMany).not.toHaveBeenCalled();
      expect(commitments.transition).toHaveBeenCalledWith(USER, 'tue', { to: 'CANCELLED' });
    });

    it('only ever selects future rows in a cancellable status', async () => {
      await service.update(USER, RITUAL_ID, { idealMinutes: 60 } as never, NOW);

      expect((prisma.commitment.findMany.mock.calls[0][0] as any).where).toEqual({
        userId: USER,
        ritualId: RITUAL_ID,
        scheduledStart: { gt: NOW },
        status: { in: ['PLANNED', 'READY'] },
      });
    });

    it('resets the horizon and re-materializes after a material change', async () => {
      await service.update(USER, RITUAL_ID, { idealMinutes: 60 } as never, NOW);

      expect((prisma.ritual.update.mock.calls[0][0] as any).data.lastMaterializedThrough).toBeNull();
      expect(materializer.materialize).toHaveBeenCalled();
    });

    it('leaves occurrences alone when only the purpose changed', async () => {
      await service.update(USER, RITUAL_ID, { purpose: 'Be present at the table' } as never, NOW);

      expect(commitments.transition).not.toHaveBeenCalled();
      expect(materializer.materialize).not.toHaveBeenCalled();
      expect((prisma.ritual.update.mock.calls[0][0] as any).data.lastMaterializedThrough).toBeUndefined();
    });

    it('leaves occurrences alone when a field is set to the value it already had', async () => {
      await service.update(USER, RITUAL_ID, { idealMinutes: 45, recurrence: RECURRENCE } as never, NOW);

      expect(commitments.transition).not.toHaveBeenCalled();
    });

    it('cancels but does not re-materialize when the ritual is paused', async () => {
      prisma.commitment.findMany.mockResolvedValue([
        { id: 'c1', scheduledStart: new Date('2026-06-03T00:30:00.000Z') },
      ] as never);

      await service.update(USER, RITUAL_ID, { active: false } as never, NOW);

      expect(commitments.transition).toHaveBeenCalledTimes(1);
      expect(materializer.materialize).not.toHaveBeenCalled();
    });

    it('re-materializes when the ritual is resumed', async () => {
      store(ritual({ active: false }));

      await service.update(USER, RITUAL_ID, { active: true } as never, NOW);

      expect(materializer.materialize).toHaveBeenCalled();
    });

    it('rejects a patch that raises the minimum above the stored ideal', async () => {
      await expect(
        service.update(USER, RITUAL_ID, { minimumMinutes: 60 } as never, NOW),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.ritual.update).not.toHaveBeenCalled();
    });

    it('lints a new title', async () => {
      await expect(
        service.update(USER, RITUAL_ID, { title: "Fix Dad's attitude" } as never, NOW),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.ritual.update).not.toHaveBeenCalled();
    });

    it('keeps a linked routine in step', async () => {
      store(ritual({ routineId: 'routine-1' }));

      await service.update(USER, RITUAL_ID, { idealMinutes: 60 } as never, NOW);

      expect(routines.update).toHaveBeenCalledWith(
        USER,
        'routine-1',
        expect.objectContaining({ estimatedDurationMin: 60 }),
      );
    });

    it('survives a routine on a read-only plan version', async () => {
      store(ritual({ routineId: 'routine-1' }));
      routines.update.mockRejectedValue(new ConflictException('Plan version is SUPERSEDED'));

      await expect(
        service.update(USER, RITUAL_ID, { idealMinutes: 60 } as never, NOW),
      ).resolves.toBeDefined();
    });

    it('records what changed, what was cancelled and what was created', async () => {
      prisma.commitment.findMany.mockResolvedValue([
        { id: 'c1', scheduledStart: new Date('2026-06-03T00:30:00.000Z') },
      ] as never);

      await service.update(USER, RITUAL_ID, { idealMinutes: 60 } as never, NOW);

      expect(audits()[0]).toMatchObject({
        action: 'ritual:update',
        meta: { changed: ['idealMinutes'], cancelled: 1, created: 3 },
      });
    });

    it('answers 404 for another user’s ritual', async () => {
      prisma.ritual.findFirst.mockResolvedValue(null as never);

      await expect(
        service.update(USER, RITUAL_ID, { idealMinutes: 60 } as never, NOW),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('remove', () => {
    it('cancels the future occurrences and then deletes the rule', async () => {
      prisma.ritual.findFirst.mockResolvedValue(ritual() as never);
      prisma.commitment.findMany.mockResolvedValue([
        { id: 'c1', scheduledStart: new Date('2026-06-03T00:30:00.000Z') },
      ] as never);
      prisma.ritual.delete.mockResolvedValue(ritual() as never);

      await service.remove(USER, RITUAL_ID, NOW);

      expect(commitments.transition).toHaveBeenCalledWith(USER, 'c1', { to: 'CANCELLED' });
      expect(prisma.ritual.delete).toHaveBeenCalledWith({ where: { id: RITUAL_ID } });
      expect(audits()[0]).toMatchObject({ action: 'ritual:delete', meta: { cancelled: 1 } });
    });

    it('answers 404 for another user’s ritual', async () => {
      prisma.ritual.findFirst.mockResolvedValue(null as never);

      await expect(service.remove(USER, RITUAL_ID, NOW)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.ritual.delete).not.toHaveBeenCalled();
    });
  });

  describe('list, get and materialize', () => {
    it('filters by active only when asked', async () => {
      prisma.ritual.findMany.mockResolvedValue([] as never);

      await service.list(USER, {} as never);
      expect((prisma.ritual.findMany.mock.calls[0][0] as any).where).toEqual({ userId: USER });

      await service.list(USER, { active: true } as never);
      expect((prisma.ritual.findMany.mock.calls[1][0] as any).where).toEqual({
        userId: USER,
        active: true,
      });
    });

    it('returns the next seven days as commitment cards', async () => {
      prisma.ritual.findFirst.mockResolvedValue(ritual() as never);
      prisma.commitment.findMany.mockResolvedValue([
        {
          id: 'c1',
          userId: USER,
          domain: 'FAMILY',
          title: 'Phone-free dinner',
          status: 'PLANNED',
          scheduledStart: new Date('2026-06-03T00:30:00.000Z'),
          scheduledEnd: null,
          importance: 4,
          fullVersion: null,
          shortVersion: null,
          minimumVersion: null,
          fullMinutes: 45,
          shortMinutes: null,
          minimumMinutes: 10,
          rescheduleCount: 0,
          startedAt: null,
          completedAt: null,
          activeSince: null,
          activeSeconds: 0,
          timerMinutes: null,
          versionUsed: null,
          minutesSpent: null,
          steps: null,
          outcomeId: null,
          decomposedFromId: null,
          ritualId: RITUAL_ID,
          familyMemberId: null,
        },
      ] as never);

      const result = await service.get(USER, RITUAL_ID, NOW);

      expect(result.upcoming).toHaveLength(1);
      expect(result.upcoming[0]).toMatchObject({ id: 'c1', ritualId: RITUAL_ID });
    });

    it('answers 404 before materializing another user’s ritual', async () => {
      prisma.ritual.findFirst.mockResolvedValue(null as never);

      await expect(service.materialize(USER, RITUAL_ID, NOW)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(materializer.materialize).not.toHaveBeenCalled();
    });

    it('answers 404 for another user’s ritual on get', async () => {
      prisma.ritual.findFirst.mockResolvedValue(null as never);

      await expect(service.get(USER, RITUAL_ID, NOW)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
