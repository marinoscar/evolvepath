import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';

import { PlansService } from './plans.service';
import { OutcomesService } from '../outcomes/outcomes.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService, MockPrismaService } from '../../../test/mocks/prisma.mock';

describe('PlansService', () => {
  let service: PlansService;
  let prisma: MockPrismaService;
  let outcomes: { findOwned: jest.Mock };

  const userId = 'user-123';
  const outcomeId = '11111111-1111-4111-8111-111111111111';
  const planId = '22222222-2222-4222-8222-222222222222';

  const outcome = (over: Record<string, unknown> = {}) => ({
    id: outcomeId,
    userId,
    domain: 'HEALTH',
    state: 'ACTIVE',
    plan: null,
    ...over,
  });

  const planRow = {
    id: planId,
    userId,
    outcomeId,
    createdAt: new Date('2026-02-01T10:00:00.000Z'),
    updatedAt: new Date('2026-02-01T10:00:00.000Z'),
    versions: [
      {
        id: 'pv-1',
        planId,
        version: 1,
        status: 'ACTIVE',
        rationale: 'Start with mornings',
        createdBy: 'USER',
        userApproved: true,
        previousVersionId: null,
        activeFrom: new Date('2026-02-01T10:00:00.000Z'),
        activeUntil: null,
        createdAt: new Date('2026-02-01T10:00:00.000Z'),
        _count: { routines: 1 },
      },
    ],
  };

  /** Runs the interactive transaction callback against the same mock client. */
  const runTransaction = () =>
    prisma.$transaction.mockImplementation(async (arg: unknown) =>
      typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : arg,
    );

  beforeEach(async () => {
    prisma = createMockPrismaService();
    outcomes = { findOwned: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlansService,
        { provide: PrismaService, useValue: prisma },
        { provide: OutcomesService, useValue: outcomes },
      ],
    }).compile();

    service = module.get<PlansService>(PlansService);
    prisma.auditEvent.create.mockResolvedValue({ id: 'audit-1' } as never);
  });

  describe('createForOutcome', () => {
    it('creates v1 as ACTIVE and approved, inside one transaction', async () => {
      outcomes.findOwned.mockResolvedValue(outcome());
      runTransaction();
      prisma.plan.create.mockResolvedValue({ id: planId } as never);
      prisma.planVersion.create.mockResolvedValue({ id: 'pv-1' } as never);
      prisma.plan.findUniqueOrThrow.mockResolvedValue(planRow as never);

      const dto = await service.createForOutcome(userId, outcomeId, { routines: [] } as never);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const { data } = prisma.planVersion.create.mock.calls[0]?.[0] ?? { data: {} };
      expect(data).toMatchObject({
        version: 1,
        status: 'ACTIVE',
        userApproved: true,
        createdBy: 'USER',
      });
      expect(data.activeFrom).toBeInstanceOf(Date);
      expect(dto.activeVersion?.version).toBe(1);
      expect(dto.versionCount).toBe(1);
    });

    it("gives an inline routine the outcome's domain when it names none", async () => {
      outcomes.findOwned.mockResolvedValue(outcome({ domain: 'FAMILY' }));
      runTransaction();
      prisma.plan.create.mockResolvedValue({ id: planId } as never);
      prisma.planVersion.create.mockResolvedValue({ id: 'pv-1' } as never);
      prisma.plan.findUniqueOrThrow.mockResolvedValue(planRow as never);

      await service.createForOutcome(userId, outcomeId, {
        routines: [
          {
            title: 'Friday pizza night',
            triggerType: 'TIME',
            frequency: 'WEEKLY',
            daysOfWeek: [],
            estimatedDurationMin: 90,
            minimumDurationMin: 30,
            sortOrder: 0,
          },
        ],
      } as never);

      const { data } = prisma.routine.createMany.mock.calls[0]?.[0] ?? { data: [] };
      const created = (Array.isArray(data) ? data : [data]) as Array<Record<string, unknown>>;
      expect(created[0]?.domain).toBe('FAMILY');
      expect(created[0]?.userId).toBe(userId);
    });

    it('refuses a second plan for the same outcome', async () => {
      outcomes.findOwned.mockResolvedValue(outcome({ plan: { id: planId, versions: [] } }));

      await expect(
        service.createForOutcome(userId, outcomeId, { routines: [] } as never),
      ).rejects.toThrow(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses to plan an archived outcome', async () => {
      outcomes.findOwned.mockResolvedValue(outcome({ state: 'ARCHIVED' }));

      await expect(
        service.createForOutcome(userId, outcomeId, { routines: [] } as never),
      ).rejects.toThrow(ConflictException);
    });

    // Side effects belong after the commit, not inside it.
    it('writes its audit row outside the transaction', async () => {
      outcomes.findOwned.mockResolvedValue(outcome());
      runTransaction();
      prisma.plan.create.mockResolvedValue({ id: planId } as never);
      prisma.planVersion.create.mockResolvedValue({ id: 'pv-1' } as never);
      prisma.plan.findUniqueOrThrow.mockResolvedValue(planRow as never);

      await service.createForOutcome(userId, outcomeId, { routines: [] } as never);

      const auditOrder = prisma.auditEvent.create.mock.invocationCallOrder[0];
      const txOrder = prisma.$transaction.mock.invocationCallOrder[0];
      expect(auditOrder).toBeGreaterThan(txOrder);
      expect(prisma.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'plan:create', targetType: 'plan' }),
      });
    });
  });

  describe('get', () => {
    it('reports no active version while the plan has only drafts', async () => {
      prisma.plan.findFirst.mockResolvedValue({
        ...planRow,
        versions: [{ ...planRow.versions[0], status: 'DRAFT' }],
      } as never);

      const dto = await service.get(userId, planId);

      expect(dto.activeVersion).toBeNull();
      expect(dto.versionCount).toBe(1);
    });

    it('scopes the lookup to the caller', async () => {
      prisma.plan.findFirst.mockResolvedValue(planRow as never);

      await service.get(userId, planId);

      expect(prisma.plan.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: planId, userId } }),
      );
    });
  });
});
