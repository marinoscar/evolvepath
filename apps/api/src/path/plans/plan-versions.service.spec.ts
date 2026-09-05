import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PlanVersionsService } from './plan-versions.service';
import { PlansService } from './plans.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService, MockPrismaService } from '../../../test/mocks/prisma.mock';

describe('PlanVersionsService', () => {
  let service: PlanVersionsService;
  let prisma: MockPrismaService;
  let plans: { findOwned: jest.Mock };

  const userId = 'user-123';
  const planId = '22222222-2222-4222-8222-222222222222';

  const version = (over: Record<string, unknown> = {}) => ({
    id: 'pv-1',
    userId,
    planId,
    version: 1,
    status: 'ACTIVE',
    rationale: 'Start with mornings',
    expectedWeeklyLoad: 120,
    fallbackStrategy: null,
    userApproved: true,
    createdBy: 'USER',
    previousVersionId: null,
    activeFrom: new Date('2026-02-01T10:00:00.000Z'),
    activeUntil: null,
    createdAt: new Date('2026-02-01T10:00:00.000Z'),
    updatedAt: new Date('2026-02-01T10:00:00.000Z'),
    routines: [],
    ...over,
  });

  const sourceRoutine = {
    id: 'r-1',
    userId,
    planVersionId: 'pv-1',
    title: 'Morning workout',
    domain: 'HEALTH',
    triggerType: 'EVENT',
    triggerValue: 'after morning coffee',
    frequency: 'WEEKDAYS',
    daysOfWeek: [],
    preferredTime: '06:30',
    estimatedDurationMin: 45,
    minimumDurationMin: 10,
    fallbackBehavior: '10-minute circuit',
    active: true,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const runTransaction = () =>
    prisma.$transaction.mockImplementation(async (arg: unknown) =>
      typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : arg,
    );

  beforeEach(async () => {
    prisma = createMockPrismaService();
    plans = { findOwned: jest.fn().mockResolvedValue({ id: planId, userId }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlanVersionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: PlansService, useValue: plans },
      ],
    }).compile();

    service = module.get<PlanVersionsService>(PlanVersionsService);
    prisma.auditEvent.create.mockResolvedValue({ id: 'audit-1' } as never);
  });

  describe('createDraft', () => {
    const dto = { rationale: 'Evenings kept slipping', copyRoutinesFrom: 'active' } as never;

    it('numbers max+1 and links back to the ACTIVE version', async () => {
      prisma.planVersion.findMany.mockResolvedValue([version()] as never);
      runTransaction();
      prisma.planVersion.create.mockResolvedValue({ id: 'pv-2' } as never);
      prisma.routine.findMany.mockResolvedValue([] as never);
      prisma.planVersion.findUniqueOrThrow.mockResolvedValue(
        version({ id: 'pv-2', version: 2, status: 'DRAFT', previousVersionId: 'pv-1' }) as never,
      );

      const dtoOut = await service.createDraft(userId, planId, dto);

      const { data } = prisma.planVersion.create.mock.calls[0]?.[0] ?? { data: {} };
      expect(data).toMatchObject({
        version: 2,
        status: 'DRAFT',
        previousVersionId: 'pv-1',
        createdBy: 'USER',
        userApproved: false,
      });
      expect(dtoOut.version).toBe(2);
    });

    // Cloned, not moved: v1 must keep its routines or the "why did this
    // change?" comparison loses its before side.
    it('clones the routines with new ids and preserved fields', async () => {
      prisma.planVersion.findMany.mockResolvedValue([version()] as never);
      runTransaction();
      prisma.planVersion.create.mockResolvedValue({ id: 'pv-2' } as never);
      prisma.routine.findMany.mockResolvedValue([sourceRoutine] as never);
      prisma.planVersion.findUniqueOrThrow.mockResolvedValue(
        version({ id: 'pv-2', version: 2, status: 'DRAFT', routines: [sourceRoutine] }) as never,
      );

      await service.createDraft(userId, planId, dto);

      const { data } = prisma.routine.createMany.mock.calls[0]?.[0] ?? { data: [] };
      const cloned = (Array.isArray(data) ? data : [data]) as Array<Record<string, unknown>>;
      expect(cloned[0]).toMatchObject({
        planVersionId: 'pv-2',
        title: 'Morning workout',
        triggerValue: 'after morning coffee',
        estimatedDurationMin: 45,
        minimumDurationMin: 10,
        active: true,
      });
      // No id is carried over — the clone is a new row, not a moved one.
      expect(cloned[0]).not.toHaveProperty('id');
    });

    it('copies nothing when asked for none', async () => {
      prisma.planVersion.findMany.mockResolvedValue([version()] as never);
      runTransaction();
      prisma.planVersion.create.mockResolvedValue({ id: 'pv-2' } as never);
      prisma.planVersion.findUniqueOrThrow.mockResolvedValue(
        version({ id: 'pv-2', version: 2, status: 'DRAFT' }) as never,
      );

      await service.createDraft(userId, planId, {
        rationale: 'Fresh start',
        copyRoutinesFrom: 'none',
      } as never);

      expect(prisma.routine.createMany).not.toHaveBeenCalled();
    });

    it('refuses a second draft, naming the one in the way', async () => {
      prisma.planVersion.findMany.mockResolvedValue([
        version({ id: 'pv-2', version: 2, status: 'DRAFT' }),
        version(),
      ] as never);

      await expect(service.createDraft(userId, planId, dto)).rejects.toThrow(
        new ConflictException('Plan already has a draft (v2); activate or reject it first'),
      );
    });

    // The hook E06 needs. No route reaches it — `createdBy` is never taken
    // from a request body.
    it('accepts an AI author through the parameter, not the body', async () => {
      prisma.planVersion.findMany.mockResolvedValue([version()] as never);
      runTransaction();
      prisma.planVersion.create.mockResolvedValue({ id: 'pv-2' } as never);
      prisma.routine.findMany.mockResolvedValue([] as never);
      prisma.planVersion.findUniqueOrThrow.mockResolvedValue(
        version({ id: 'pv-2', version: 2, status: 'DRAFT', createdBy: 'AI' }) as never,
      );

      await service.createDraft(userId, planId, dto, 'AI');

      const { data } = prisma.planVersion.create.mock.calls[0]?.[0] ?? { data: {} };
      expect(data.createdBy).toBe('AI');
    });

    it('falls back to the newest version for lineage when nothing is active', async () => {
      prisma.planVersion.findMany.mockResolvedValue([
        version({ id: 'pv-1', version: 1, status: 'REJECTED' }),
      ] as never);
      runTransaction();
      prisma.planVersion.create.mockResolvedValue({ id: 'pv-2' } as never);
      prisma.routine.findMany.mockResolvedValue([] as never);
      prisma.planVersion.findUniqueOrThrow.mockResolvedValue(
        version({ id: 'pv-2', version: 2, status: 'DRAFT' }) as never,
      );

      await service.createDraft(userId, planId, dto);

      const { data } = prisma.planVersion.create.mock.calls[0]?.[0] ?? { data: {} };
      expect(data.previousVersionId).toBe('pv-1');
    });
  });

  describe('activate', () => {
    beforeEach(() => {
      prisma.planVersion.findFirst.mockImplementation((async (args: any) =>
        args?.where?.status === 'ACTIVE'
          ? version()
          : version({ id: 'pv-2', version: 2, status: 'DRAFT' })) as never);
    });

    it('supersedes then activates, in that order, in one transaction', async () => {
      runTransaction();
      prisma.planVersion.update.mockResolvedValue(
        version({ id: 'pv-2', version: 2, status: 'ACTIVE' }) as never,
      );

      await service.activate(userId, planId, 2);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.planVersion.update).toHaveBeenCalledTimes(2);

      const [supersede, activate] = prisma.planVersion.update.mock.calls;
      expect(supersede?.[0]).toMatchObject({
        where: { id: 'pv-1' },
        data: expect.objectContaining({ status: 'SUPERSEDED' }),
      });
      expect(supersede?.[0].data.activeUntil).toBeInstanceOf(Date);
      expect(activate?.[0]).toMatchObject({
        where: { id: 'pv-2' },
        data: expect.objectContaining({ status: 'ACTIVE', userApproved: true }),
      });
      expect(activate?.[0].data.activeFrom).toBeInstanceOf(Date);
    });

    // Inside the transaction the partial unique index never fires under normal
    // use. A P2002 that escapes it means a genuine race with another
    // activation — someone else changed the plan, which is a 409, not a 500.
    it('maps a racing P2002 from the partial index to 409', async () => {
      prisma.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }) as never,
      );

      await expect(service.activate(userId, planId, 2)).rejects.toThrow(ConflictException);
    });

    it('lets an unrelated failure surface rather than disguising it as a conflict', async () => {
      prisma.$transaction.mockRejectedValue(new Error('connection lost') as never);

      await expect(service.activate(userId, planId, 2)).rejects.toThrow('connection lost');
    });

    it('refuses to activate a version that is not a draft', async () => {
      prisma.planVersion.findFirst.mockResolvedValue(version({ version: 1 }) as never);

      await expect(service.activate(userId, planId, 1)).rejects.toThrow(
        new ConflictException('v1 is ACTIVE and cannot be activated'),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('activates the first version of a plan with nothing active yet', async () => {
      prisma.planVersion.findFirst.mockImplementation((async (args: any) =>
        args?.where?.status === 'ACTIVE'
          ? null
          : version({ id: 'pv-1', version: 1, status: 'DRAFT' })) as never);
      runTransaction();
      prisma.planVersion.update.mockResolvedValue(
        version({ id: 'pv-1', version: 1, status: 'ACTIVE' }) as never,
      );

      await service.activate(userId, planId, 1);

      expect(prisma.planVersion.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('update', () => {
    it('refuses to edit a version that has been in force', async () => {
      prisma.planVersion.findFirst.mockResolvedValue(version() as never);

      await expect(
        service.update(userId, planId, 1, { rationale: 'rewritten' } as never),
      ).rejects.toThrow(new ConflictException('v1 is ACTIVE and cannot be edited'));
    });

    it('edits a draft', async () => {
      prisma.planVersion.findFirst.mockResolvedValue(
        version({ id: 'pv-2', version: 2, status: 'DRAFT' }) as never,
      );
      prisma.planVersion.update.mockResolvedValue(
        version({ id: 'pv-2', version: 2, status: 'DRAFT' }) as never,
      );

      await service.update(userId, planId, 2, { rationale: 'Clearer reason' } as never);

      expect(prisma.planVersion.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { rationale: 'Clearer reason' } }),
      );
    });
  });

  describe('reject', () => {
    it('refuses to reject anything but a draft', async () => {
      prisma.planVersion.findFirst.mockResolvedValue(version() as never);

      await expect(service.reject(userId, planId, 1, {} as never)).rejects.toThrow(
        ConflictException,
      );
    });

    // The rationale survives rejection: it is the record of what the user
    // considered and decided against, and E06 reads it.
    it('keeps the rationale and records only whether a reason was given', async () => {
      prisma.planVersion.findFirst.mockResolvedValue(
        version({ id: 'pv-2', version: 2, status: 'DRAFT' }) as never,
      );
      prisma.planVersion.update.mockResolvedValue(
        version({ id: 'pv-2', version: 2, status: 'REJECTED' }) as never,
      );

      const dto = await service.reject(userId, planId, 2, { reason: 'Too much' } as never);

      expect(prisma.planVersion.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'REJECTED' } }),
      );
      expect(dto.rationale).toBe('Start with mornings');
      const { data } = prisma.auditEvent.create.mock.calls[0]?.[0] ?? { data: {} };
      expect(data.meta).toEqual({ planId, version: 2, hasReason: true });
    });
  });
});
