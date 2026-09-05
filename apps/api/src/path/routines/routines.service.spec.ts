import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';

import { RoutinesService } from './routines.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService, MockPrismaService } from '../../../test/mocks/prisma.mock';
import { createRoutineSchema } from './dto/create-routine.dto';
import { updateRoutineSchema } from './dto/update-routine.dto';

describe('routine validation', () => {
  const base = {
    planVersionId: '33333333-3333-4333-8333-333333333333',
    title: 'Morning workout',
    estimatedDurationMin: 45,
    minimumDurationMin: 10,
  };

  const failsAt = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
    result.success ? [] : result.error!.issues.map((issue) => issue.path.join('.'));

  it('requires HH:mm for a TIME trigger', () => {
    const result = createRoutineSchema.safeParse({
      ...base,
      triggerType: 'TIME',
      triggerValue: 'morning',
    });

    expect(failsAt(result)).toContain('triggerValue');
  });

  it('accepts a well-formed TIME trigger', () => {
    expect(
      createRoutineSchema.safeParse({ ...base, triggerType: 'TIME', triggerValue: '06:30' })
        .success,
    ).toBe(true);
  });

  // An EVENT trigger with no event is an implementation intention with no
  // "when" — the one thing VISION Part VI §25 says a routine must have.
  it('requires the event for an EVENT trigger', () => {
    const result = createRoutineSchema.safeParse({ ...base, triggerType: 'EVENT' });

    expect(failsAt(result)).toContain('triggerValue');
  });

  it('requires at least one day for a CUSTOM frequency', () => {
    const result = createRoutineSchema.safeParse({ ...base, frequency: 'CUSTOM' });

    expect(failsAt(result)).toContain('daysOfWeek');
  });

  it('rejects days on a non-CUSTOM frequency', () => {
    const result = createRoutineSchema.safeParse({
      ...base,
      frequency: 'WEEKDAYS',
      daysOfWeek: [1, 3],
    });

    expect(failsAt(result)).toContain('daysOfWeek');
  });

  it('rejects a repeated day', () => {
    const result = createRoutineSchema.safeParse({
      ...base,
      frequency: 'CUSTOM',
      daysOfWeek: [1, 1],
    });

    expect(failsAt(result)).toContain('daysOfWeek');
  });

  // The minimum version is the bad-day path (PRD §57). A minimum longer than
  // the ideal makes the bad day the harder one.
  it('rejects a minimum longer than the full version', () => {
    const result = createRoutineSchema.safeParse({
      ...base,
      estimatedDurationMin: 20,
      minimumDurationMin: 45,
    });

    expect(failsAt(result)).toContain('minimumDurationMin');
  });

  it('rejects an empty patch', () => {
    expect(updateRoutineSchema.safeParse({}).success).toBe(false);
  });

  it('accepts a one-field patch', () => {
    expect(updateRoutineSchema.safeParse({ active: false }).success).toBe(true);
  });
});

describe('RoutinesService', () => {
  let service: RoutinesService;
  let prisma: MockPrismaService;

  const userId = 'user-123';
  const routineId = '44444444-4444-4444-8444-444444444444';
  const planVersionId = '33333333-3333-4333-8333-333333333333';

  const planVersion = (status = 'ACTIVE') => ({
    id: planVersionId,
    userId,
    planId: 'plan-1',
    version: 1,
    status,
  });

  const routine = (over: Record<string, unknown> = {}) => ({
    id: routineId,
    userId,
    planVersionId,
    title: 'Morning workout',
    domain: 'HEALTH',
    triggerType: 'EVENT',
    triggerValue: 'after morning coffee',
    frequency: 'WEEKDAYS',
    daysOfWeek: [],
    preferredTime: '06:30',
    estimatedDurationMin: 45,
    minimumDurationMin: 10,
    fallbackBehavior: null,
    active: true,
    sortOrder: 0,
    createdAt: new Date('2026-02-01T10:00:00.000Z'),
    updatedAt: new Date('2026-02-01T10:00:00.000Z'),
    ...over,
  });

  beforeEach(async () => {
    prisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [RoutinesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<RoutinesService>(RoutinesService);
    prisma.auditEvent.create.mockResolvedValue({ id: 'audit-1' } as never);
  });

  describe('list', () => {
    it('hides inactive routines unless asked', async () => {
      prisma.planVersion.findFirst.mockResolvedValue(planVersion() as never);
      prisma.routine.findMany.mockResolvedValue([] as never);

      await service.list(userId, { planVersionId, includeInactive: false } as never);

      expect(prisma.routine.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId, planVersionId, active: true } }),
      );
    });

    it('answers 404 for a version the caller does not own', async () => {
      prisma.planVersion.findFirst.mockResolvedValue(null as never);

      await expect(
        service.list(userId, { planVersionId, includeInactive: false } as never),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it("defaults the domain to the outcome's", async () => {
      prisma.planVersion.findFirst.mockResolvedValue(planVersion() as never);
      prisma.plan.findUniqueOrThrow.mockResolvedValue({
        outcome: { domain: 'WORK' },
      } as never);
      prisma.routine.create.mockResolvedValue(routine({ domain: 'WORK' }) as never);

      await service.create(userId, {
        planVersionId,
        title: 'Deep work block',
        triggerType: 'TIME',
        triggerValue: '09:00',
        frequency: 'WEEKDAYS',
        daysOfWeek: [],
        estimatedDurationMin: 90,
        minimumDurationMin: 25,
        sortOrder: 0,
      } as never);

      const { data } = prisma.routine.create.mock.calls[0]?.[0] ?? { data: {} };
      expect(data.domain).toBe('WORK');
      // The owner is the caller, never a value from the body.
      expect(data.userId).toBe(userId);
    });

    it('refuses to add a routine to a superseded version', async () => {
      prisma.planVersion.findFirst.mockResolvedValue(planVersion('SUPERSEDED') as never);

      await expect(
        service.create(userId, {
          planVersionId,
          title: 'x',
          triggerType: 'TIME',
          frequency: 'DAILY',
          daysOfWeek: [],
          estimatedDurationMin: 10,
          minimumDurationMin: 5,
          sortOrder: 0,
        } as never),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it.each([['SUPERSEDED'], ['REJECTED']])(
      'refuses to edit a routine on a %s version — that is history',
      async (status) => {
        prisma.routine.findFirst.mockResolvedValue(routine() as never);
        prisma.planVersion.findFirst.mockResolvedValue(planVersion(status) as never);

        await expect(service.update(userId, routineId, { title: 'New' } as never)).rejects.toThrow(
          ConflictException,
        );
        expect(prisma.routine.update).not.toHaveBeenCalled();
      },
    );

    // The DTO sees only the patch. A minimum of 90 is fine in isolation and
    // wrong against a 45-minute routine, so the merged shape is checked too.
    it('checks the cross-field rules against the merged routine, not the patch', async () => {
      prisma.routine.findFirst.mockResolvedValue(routine() as never);
      prisma.planVersion.findFirst.mockResolvedValue(planVersion() as never);

      await expect(
        service.update(userId, routineId, { minimumDurationMin: 90 } as never),
      ).rejects.toThrow(
        new ConflictException('The minimum version cannot be longer than the full one'),
      );
    });

    it('accepts a patch that is valid once merged', async () => {
      prisma.routine.findFirst.mockResolvedValue(routine() as never);
      prisma.planVersion.findFirst.mockResolvedValue(planVersion() as never);
      prisma.routine.update.mockResolvedValue(routine({ active: false }) as never);

      const dto = await service.update(userId, routineId, { active: false } as never);

      expect(dto.active).toBe(false);
    });

    it('rejects a frequency change to CUSTOM with no days supplied', async () => {
      prisma.routine.findFirst.mockResolvedValue(routine() as never);
      prisma.planVersion.findFirst.mockResolvedValue(planVersion() as never);

      await expect(
        service.update(userId, routineId, { frequency: 'CUSTOM' } as never),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('remove', () => {
    it('refuses to delete a routine on a superseded version', async () => {
      prisma.routine.findFirst.mockResolvedValue(routine() as never);
      prisma.planVersion.findFirst.mockResolvedValue(planVersion('SUPERSEDED') as never);

      await expect(service.remove(userId, routineId)).rejects.toThrow(ConflictException);
      expect(prisma.routine.delete).not.toHaveBeenCalled();
    });

    it('deletes from an active version', async () => {
      prisma.routine.findFirst.mockResolvedValue(routine() as never);
      prisma.planVersion.findFirst.mockResolvedValue(planVersion() as never);
      prisma.routine.delete.mockResolvedValue(routine() as never);

      await service.remove(userId, routineId);

      expect(prisma.routine.delete).toHaveBeenCalledWith({ where: { id: routineId } });
    });
  });
});
