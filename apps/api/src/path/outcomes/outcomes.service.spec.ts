import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';

import { OutcomesService } from './outcomes.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService, MockPrismaService } from '../../../test/mocks/prisma.mock';
import { OutcomeQueryDto } from './dto/outcome-query.dto';

describe('OutcomesService', () => {
  let service: OutcomesService;
  let prisma: MockPrismaService;

  const userId = 'user-123';
  const outcomeId = '11111111-1111-4111-8111-111111111111';

  const row = {
    id: outcomeId,
    userId,
    domain: 'HEALTH',
    title: 'Three strength workouts per week',
    description: null,
    targetDate: null,
    importance: 4,
    motivation: null,
    state: 'ACTIVE',
    successDefinition: null,
    userConfidence: null,
    archivedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    plan: null,
  };

  const query = (over: Partial<OutcomeQueryDto> = {}): OutcomeQueryDto =>
    ({ includeArchived: false, ...over }) as OutcomeQueryDto;

  beforeEach(async () => {
    prisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [OutcomesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<OutcomesService>(OutcomesService);
    prisma.auditEvent.create.mockResolvedValue({ id: 'audit-1' } as never);
  });

  describe('list', () => {
    it('excludes archived outcomes by default', async () => {
      prisma.outcome.findMany.mockResolvedValue([] as never);

      await service.list(userId, query());

      expect(prisma.outcome.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId, state: { not: 'ARCHIVED' } },
        }),
      );
    });

    it('includes archived outcomes when asked', async () => {
      prisma.outcome.findMany.mockResolvedValue([] as never);

      await service.list(userId, query({ includeArchived: true }));

      expect(prisma.outcome.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId } }),
      );
    });

    // An explicit state=ARCHIVED is itself the request to see them; requiring
    // includeArchived too would answer an empty list to a clear question.
    it('honours an explicit state=ARCHIVED without includeArchived', async () => {
      prisma.outcome.findMany.mockResolvedValue([] as never);

      await service.list(userId, query({ state: 'ARCHIVED' }));

      expect(prisma.outcome.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId, state: 'ARCHIVED' } }),
      );
    });

    it('scopes every list to the caller', async () => {
      prisma.outcome.findMany.mockResolvedValue([] as never);

      await service.list(userId, query({ domain: 'WORK' }));

      expect(prisma.outcome.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId }) }),
      );
    });

    it('renders a target date as YYYY-MM-DD, not an instant', async () => {
      prisma.outcome.findMany.mockResolvedValue([
        { ...row, targetDate: new Date('2026-03-14T00:00:00.000Z') },
      ] as never);

      const [dto] = await service.list(userId, query());

      expect(dto.targetDate).toBe('2026-03-14');
    });
  });

  describe('get', () => {
    it('always looks up by id AND userId', async () => {
      prisma.outcome.findFirst.mockResolvedValue(row as never);

      await service.get(userId, outcomeId);

      expect(prisma.outcome.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: outcomeId, userId } }),
      );
    });

    it('answers 404 for an outcome the caller does not own', async () => {
      // The scoped query returns nothing for someone else's row — the service
      // never sees it, so it cannot leak a 403.
      prisma.outcome.findFirst.mockResolvedValue(null as never);

      await expect(service.get(userId, outcomeId)).rejects.toThrow(NotFoundException);
    });

    it('surfaces the active plan version when there is one', async () => {
      prisma.outcome.findFirst.mockResolvedValue({
        ...row,
        plan: { id: 'plan-1', versions: [{ id: 'pv-2', version: 2 }] },
      } as never);

      const dto = await service.get(userId, outcomeId);

      expect(dto.planId).toBe('plan-1');
      expect(dto.activePlanVersion).toEqual({ id: 'pv-2', version: 2 });
    });

    it('reports no active version when the plan has only drafts', async () => {
      prisma.outcome.findFirst.mockResolvedValue({
        ...row,
        plan: { id: 'plan-1', versions: [] },
      } as never);

      const dto = await service.get(userId, outcomeId);

      expect(dto.planId).toBe('plan-1');
      expect(dto.activePlanVersion).toBeNull();
    });
  });

  describe('create', () => {
    it('audits the domain and importance, never the title', async () => {
      prisma.outcome.create.mockResolvedValue(row as never);

      await service.create(userId, {
        domain: 'HEALTH',
        title: 'Three strength workouts per week',
        importance: 4,
      } as never);

      expect(prisma.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: userId,
          action: 'outcome:create',
          targetType: 'outcome',
          meta: { domain: 'HEALTH', importance: 4 },
        }),
      });
    });

    it('stores a target date at UTC midnight so it cannot shift a day', async () => {
      prisma.outcome.create.mockResolvedValue(row as never);

      await service.create(userId, {
        domain: 'HEALTH',
        title: 'x',
        importance: 3,
        targetDate: '2026-03-14',
      } as never);

      const { data } = prisma.outcome.create.mock.calls[0][0];
      expect(data.targetDate).toEqual(new Date('2026-03-14T00:00:00.000Z'));
    });
  });

  describe('update', () => {
    it('refuses to edit an archived outcome', async () => {
      prisma.outcome.findFirst.mockResolvedValue({ ...row, state: 'ARCHIVED' } as never);

      await expect(service.update(userId, outcomeId, { title: 'New' } as never)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.outcome.update).not.toHaveBeenCalled();
    });

    it('audits which fields changed, not their values', async () => {
      prisma.outcome.findFirst.mockResolvedValue(row as never);
      prisma.outcome.update.mockResolvedValue({ ...row, title: 'New' } as never);

      await service.update(userId, outcomeId, { title: 'New', importance: 5 } as never);

      expect(prisma.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'outcome:update',
          meta: { changed: ['title', 'importance'] },
        }),
      });
    });

    it('distinguishes clearing a field from omitting it', async () => {
      prisma.outcome.findFirst.mockResolvedValue(row as never);
      prisma.outcome.update.mockResolvedValue(row as never);

      await service.update(userId, outcomeId, { motivation: null } as never);

      const { data } = prisma.outcome.update.mock.calls[0][0];
      expect(data).toEqual({ motivation: null });
    });
  });

  describe('archive', () => {
    it('sets state and archivedAt on the first call', async () => {
      prisma.outcome.findFirst.mockResolvedValue(row as never);
      prisma.outcome.update.mockResolvedValue({
        ...row,
        state: 'ARCHIVED',
        archivedAt: new Date(),
      } as never);

      const dto = await service.archive(userId, outcomeId);

      expect(dto.state).toBe('ARCHIVED');
      expect(dto.archivedAt).not.toBeNull();
    });

    // A double-tap on a phone must not write a second audit row or move
    // archivedAt forward.
    it('is a no-op the second time, writing no audit row', async () => {
      prisma.outcome.findFirst.mockResolvedValue({
        ...row,
        state: 'ARCHIVED',
        archivedAt: new Date('2026-02-02T00:00:00.000Z'),
      } as never);

      const dto = await service.archive(userId, outcomeId);

      expect(dto.state).toBe('ARCHIVED');
      expect(prisma.outcome.update).not.toHaveBeenCalled();
      expect(prisma.auditEvent.create).not.toHaveBeenCalled();
    });
  });
});
