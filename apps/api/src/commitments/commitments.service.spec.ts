import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';

import { CommitmentsService } from './commitments.service';
import { createCommitmentSchema } from './dto/create-commitment.dto';
import { updateCommitmentSchema } from './dto/update-commitment.dto';
import { PrismaService } from '../prisma/prisma.service';
import { createMockPrismaService, MockPrismaService } from '../../test/mocks/prisma.mock';

describe('CommitmentsService', () => {
  let service: CommitmentsService;
  let prisma: MockPrismaService;

  const userId = 'user-123';
  const commitmentId = '55555555-5555-4555-8555-555555555555';
  const start = new Date('2026-02-10T06:30:00.000Z');
  const end = new Date('2026-02-10T07:15:00.000Z');

  const commitment = (over: Record<string, unknown> = {}) => ({
    id: commitmentId,
    userId,
    domain: 'HEALTH',
    title: 'Upper A',
    outcomeId: null,
    planVersionId: null,
    routineId: null,
    scheduledStart: start,
    scheduledEnd: end,
    importance: 4,
    commitmentType: null,
    fullVersion: null,
    shortVersion: null,
    minimumVersion: '10-minute circuit',
    status: 'PLANNED',
    rescheduleCount: 0,
    rescheduledFromId: null,
    skipReason: null,
    userConfirmed: false,
    startedAt: null,
    completedAt: null,
    createdAt: start,
    updatedAt: start,
    _count: { evidence: 0 },
    rescheduledTo: [],
    ...over,
  });

  const runTransaction = () =>
    prisma.$transaction.mockImplementation(async (arg: unknown) =>
      typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : arg,
    );

  beforeEach(async () => {
    prisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [CommitmentsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<CommitmentsService>(CommitmentsService);
    prisma.auditEvent.create.mockResolvedValue({ id: 'audit-1' } as never);
  });

  describe('create', () => {
    const dto: Record<string, unknown> = {
      domain: 'HEALTH',
      title: 'Upper A',
      scheduledStart: start.toISOString(),
      scheduledEnd: end.toISOString(),
      importance: 4,
      userConfirmed: false,
    };

    // PRD §10.9: the product must not treat a planned item as evidence that
    // anything happened.
    it('never writes evidence', async () => {
      prisma.commitment.create.mockResolvedValue(commitment() as never);

      await service.create(userId, dto as never);

      expect(prisma.evidence.create).not.toHaveBeenCalled();
    });

    it('reports the transitions the matrix allows from PLANNED', async () => {
      prisma.commitment.create.mockResolvedValue(commitment() as never);

      const created = await service.create(userId, dto as never);

      expect(created.allowedTransitions).toEqual([
        'READY',
        'STARTED',
        // COMPLETED / PARTIALLY_COMPLETED reachable from PLANNED since #40:
        // most of what a user does happens away from the app.
        'COMPLETED',
        'PARTIALLY_COMPLETED',
        'RESCHEDULED',
        'SKIPPED',
        'MISSED',
        'CANCELLED',
      ]);
    });

    it('rejects a routine that belongs to a different plan version', async () => {
      prisma.planVersion.findFirst.mockResolvedValue({
        id: 'pv-1',
        planId: 'plan-1',
        status: 'ACTIVE',
      } as never);
      prisma.routine.findFirst.mockResolvedValue({
        id: 'r-1',
        planVersionId: 'pv-other',
      } as never);

      await expect(
        service.create(userId, { ...dto, planVersionId: 'pv-1', routineId: 'r-1' } as never),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.commitment.create).not.toHaveBeenCalled();
    });

    it('rejects a routine with no plan version to belong to', async () => {
      prisma.routine.findFirst.mockResolvedValue({ id: 'r-1', planVersionId: 'pv-1' } as never);

      await expect(
        service.create(userId, { ...dto, routineId: 'r-1' } as never),
      ).rejects.toThrow(BadRequestException);
    });

    // A commitment derived from a superseded plan is work the user already
    // decided to stop doing.
    it('refuses to hang a commitment off a superseded plan version', async () => {
      prisma.planVersion.findFirst.mockResolvedValue({
        id: 'pv-1',
        planId: 'plan-1',
        status: 'SUPERSEDED',
      } as never);

      await expect(
        service.create(userId, { ...dto, planVersionId: 'pv-1' } as never),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects a plan version belonging to a different outcome', async () => {
      prisma.outcome.findFirst.mockResolvedValue({
        id: 'o-1',
        plan: { id: 'plan-other' },
      } as never);
      prisma.planVersion.findFirst.mockResolvedValue({
        id: 'pv-1',
        planId: 'plan-1',
        status: 'ACTIVE',
      } as never);

      await expect(
        service.create(userId, { ...dto, outcomeId: 'o-1', planVersionId: 'pv-1' } as never),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('transition', () => {
    it('sets startedAt on the first start', async () => {
      prisma.commitment.findFirst.mockResolvedValue(commitment() as never);
      runTransaction();
      prisma.commitment.update.mockResolvedValue(commitment({ status: 'STARTED' }) as never);

      await service.transition(userId, commitmentId, { to: 'STARTED' } as never);

      const { data } = prisma.commitment.update.mock.calls[0]?.[0] ?? { data: {} };
      expect(data.startedAt).toBeInstanceOf(Date);
    });

    // A second start would rewrite when the user actually began.
    it('does not move startedAt if it is already set', async () => {
      prisma.commitment.findFirst.mockResolvedValue(
        commitment({ status: 'READY', startedAt: start }) as never,
      );
      runTransaction();
      prisma.commitment.update.mockResolvedValue(commitment({ status: 'STARTED' }) as never);

      await service.transition(userId, commitmentId, { to: 'STARTED' } as never);

      const { data } = prisma.commitment.update.mock.calls[0]?.[0] ?? { data: {} };
      expect(data.startedAt).toBeUndefined();
    });

    // Completion is a STATUS. Evidence is what the user chose to log about it.
    it('creates no evidence when completing without any', async () => {
      prisma.commitment.findFirst.mockResolvedValue(commitment({ status: 'STARTED' }) as never);
      runTransaction();
      prisma.commitment.update.mockResolvedValue(commitment({ status: 'COMPLETED' }) as never);

      const result = await service.transition(userId, commitmentId, { to: 'COMPLETED' } as never);

      expect(prisma.evidence.create).not.toHaveBeenCalled();
      expect(result.evidence).toBeNull();
      const { data } = prisma.commitment.update.mock.calls[0]?.[0] ?? { data: {} };
      expect(data.completedAt).toBeInstanceOf(Date);
    });

    it('creates exactly one USER_LOG row when the user logs something', async () => {
      prisma.commitment.findFirst.mockResolvedValue(commitment({ status: 'STARTED' }) as never);
      runTransaction();
      prisma.evidence.create.mockResolvedValue({
        id: 'ev-1',
        commitmentId,
        evidenceType: 'completion',
        source: 'USER_LOG',
        occurredAt: start,
        quantitativeValue: null,
        quantitativeUnit: null,
        qualitativeValue: 'Finished all sets',
        confidence: null,
        createdAt: start,
      } as never);
      prisma.commitment.update.mockResolvedValue(commitment({ status: 'COMPLETED' }) as never);

      const result = await service.transition(userId, commitmentId, {
        to: 'COMPLETED',
        evidence: { qualitativeValue: 'Finished all sets' },
      } as never);

      expect(prisma.evidence.create).toHaveBeenCalledTimes(1);
      const { data } = prisma.evidence.create.mock.calls[0]?.[0] ?? { data: {} };
      expect(data.source).toBe('USER_LOG');
      expect(data.evidenceType).toBe('completion');
      expect(result.evidence?.source).toBe('USER_LOG');
    });

    it("labels a partial completion's evidence 'partial'", async () => {
      prisma.commitment.findFirst.mockResolvedValue(commitment({ status: 'STARTED' }) as never);
      runTransaction();
      prisma.evidence.create.mockResolvedValue({
        id: 'ev-1',
        source: 'USER_LOG',
        evidenceType: 'partial',
        occurredAt: start,
        createdAt: start,
        commitmentId,
        quantitativeValue: null,
        quantitativeUnit: null,
        qualitativeValue: null,
        confidence: null,
      } as never);
      prisma.commitment.update.mockResolvedValue(
        commitment({ status: 'PARTIALLY_COMPLETED' }) as never,
      );

      await service.transition(userId, commitmentId, {
        to: 'PARTIALLY_COMPLETED',
        evidence: {},
      } as never);

      const { data } = prisma.evidence.create.mock.calls[0]?.[0] ?? { data: {} };
      expect(data.evidenceType).toBe('partial');
    });

    it('records the skip reason', async () => {
      prisma.commitment.findFirst.mockResolvedValue(commitment() as never);
      runTransaction();
      prisma.commitment.update.mockResolvedValue(commitment({ status: 'SKIPPED' }) as never);

      await service.transition(userId, commitmentId, {
        to: 'SKIPPED',
        reason: 'Travelling',
      } as never);

      const { data } = prisma.commitment.update.mock.calls[0]?.[0] ?? { data: {} };
      expect(data.skipReason).toBe('Travelling');
    });

    describe('reschedule', () => {
      const rescheduleTo = new Date('2026-02-12T06:30:00.000Z');

      it('opens a new PLANNED commitment carrying the count forward', async () => {
        prisma.commitment.findFirst.mockResolvedValue(commitment() as never);
        runTransaction();
        prisma.commitment.create.mockResolvedValue(
          commitment({ id: 'new-1', rescheduleCount: 1, rescheduledFromId: commitmentId }) as never,
        );
        prisma.commitment.update.mockResolvedValue(commitment({ status: 'RESCHEDULED' }) as never);

        const result = await service.transition(userId, commitmentId, {
          to: 'RESCHEDULED',
          rescheduleTo: rescheduleTo.toISOString(),
        } as never);

        const { data } = prisma.commitment.create.mock.calls[0]?.[0] ?? { data: {} };
        expect(data).toMatchObject({
          status: 'PLANNED',
          rescheduledFromId: commitmentId,
          rescheduleCount: 1,
          title: 'Upper A',
          minimumVersion: '10-minute circuit',
        });
        expect(result.rescheduledTo?.rescheduleCount).toBe(1);
        expect(result.commitment.status).toBe('RESCHEDULED');
      });

      it('preserves the original duration at the new time', async () => {
        prisma.commitment.findFirst.mockResolvedValue(commitment() as never);
        runTransaction();
        prisma.commitment.create.mockResolvedValue(commitment({ id: 'new-1' }) as never);
        prisma.commitment.update.mockResolvedValue(commitment({ status: 'RESCHEDULED' }) as never);

        await service.transition(userId, commitmentId, {
          to: 'RESCHEDULED',
          rescheduleTo: rescheduleTo.toISOString(),
        } as never);

        const { data } = prisma.commitment.create.mock.calls[0]?.[0] ?? { data: {} };
        // 45 minutes, same as the original.
        expect((data.scheduledEnd as Date).getTime() - (data.scheduledStart as Date).getTime()).toBe(
          45 * 60 * 1000,
        );
      });

      it('leaves the end open when the original had none', async () => {
        prisma.commitment.findFirst.mockResolvedValue(commitment({ scheduledEnd: null }) as never);
        runTransaction();
        prisma.commitment.create.mockResolvedValue(commitment({ id: 'new-1' }) as never);
        prisma.commitment.update.mockResolvedValue(commitment({ status: 'RESCHEDULED' }) as never);

        await service.transition(userId, commitmentId, {
          to: 'RESCHEDULED',
          rescheduleTo: rescheduleTo.toISOString(),
        } as never);

        const { data } = prisma.commitment.create.mock.calls[0]?.[0] ?? { data: {} };
        expect(data.scheduledEnd).toBeNull();
      });

      it('increments an existing count rather than resetting it', async () => {
        prisma.commitment.findFirst.mockResolvedValue(commitment({ rescheduleCount: 1 }) as never);
        runTransaction();
        prisma.commitment.create.mockResolvedValue(commitment({ id: 'new-2' }) as never);
        prisma.commitment.update.mockResolvedValue(commitment({ status: 'RESCHEDULED' }) as never);

        await service.transition(userId, commitmentId, {
          to: 'RESCHEDULED',
          rescheduleTo: rescheduleTo.toISOString(),
        } as never);

        const { data } = prisma.commitment.create.mock.calls[0]?.[0] ?? { data: {} };
        expect(data.rescheduleCount).toBe(2);
      });
    });

    it('refuses a move the matrix forbids, and says which', async () => {
      prisma.commitment.findFirst.mockResolvedValue(commitment({ status: 'COMPLETED' }) as never);

      await expect(
        service.transition(userId, commitmentId, { to: 'STARTED' } as never),
      ).rejects.toMatchObject({
        status: 409,
        response: {
          message: 'Cannot move a COMPLETED commitment to STARTED',
          details: { reason: 'INVALID_TRANSITION', from: 'COMPLETED', to: 'STARTED' },
        },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses a no-op transition to the same status', async () => {
      prisma.commitment.findFirst.mockResolvedValue(commitment() as never);

      await expect(
        service.transition(userId, commitmentId, { to: 'PLANNED' } as never),
      ).rejects.toThrow(ConflictException);
    });
  });

  // #52: the three sizes are only useful if the smaller ones are actually
  // smaller. A "short version" that takes longer than the full one is a typo the
  // sizer would happily offer to someone who just said they were depleted.
  describe('version minutes ordering', () => {
    const base = {
      domain: 'HEALTH',
      title: 'Upper A',
      scheduledStart: start.toISOString(),
      importance: 4,
      userConfirmed: false,
    };

    it('accepts minimum <= short <= full', () => {
      expect(
        createCommitmentSchema.safeParse({
          ...base,
          fullMinutes: 38,
          shortMinutes: 20,
          minimumMinutes: 10,
        }).success,
      ).toBe(true);
    });

    it('rejects a short version longer than the full one', () => {
      const result = createCommitmentSchema.safeParse({
        ...base,
        fullMinutes: 20,
        shortMinutes: 38,
      });

      expect(result.success).toBe(false);
      expect(result.error?.issues[0].path).toEqual(['shortMinutes']);
    });

    it('rejects a minimum longer than the short version', () => {
      const result = createCommitmentSchema.safeParse({
        ...base,
        fullMinutes: 38,
        shortMinutes: 10,
        minimumMinutes: 20,
      });

      expect(result.success).toBe(false);
      expect(result.error?.issues[0].path).toEqual(['minimumMinutes']);
    });

    it('compares the minimum against the full one when no short version exists', () => {
      expect(
        createCommitmentSchema.safeParse({ ...base, fullMinutes: 10, minimumMinutes: 20 })
          .success,
      ).toBe(false);
    });

    // A PATCH that touches one size must not be rejected for a size it never
    // mentioned.
    it('ignores a pair the patch does not mention', () => {
      expect(updateCommitmentSchema.safeParse({ shortMinutes: 45 }).success).toBe(true);
    });

    it('rejects a zero-minute or eight-hour size', () => {
      expect(createCommitmentSchema.safeParse({ ...base, fullMinutes: 0 }).success).toBe(false);
      expect(createCommitmentSchema.safeParse({ ...base, fullMinutes: 481 }).success).toBe(
        false,
      );
    });
  });

  describe('update', () => {
    it('refuses to edit a terminal commitment', async () => {
      prisma.commitment.findFirst.mockResolvedValue(commitment({ status: 'COMPLETED' }) as never);

      await expect(
        service.update(userId, commitmentId, { title: 'Renamed' } as never),
      ).rejects.toThrow(ConflictException);
      expect(prisma.commitment.update).not.toHaveBeenCalled();
    });

    // The DTO sees only the patch: moving the start past an unchanged end is
    // invalid, and nothing but the merged shape can tell.
    it('checks the merged schedule, not just the patch', async () => {
      prisma.commitment.findFirst.mockResolvedValue(commitment() as never);

      await expect(
        service.update(userId, commitmentId, {
          scheduledStart: '2026-02-10T08:00:00.000Z',
        } as never),
      ).rejects.toThrow(ConflictException);
    });

    it('accepts a patch that is valid once merged', async () => {
      prisma.commitment.findFirst.mockResolvedValue(commitment() as never);
      prisma.commitment.update.mockResolvedValue(commitment({ importance: 5 }) as never);

      const updated = await service.update(userId, commitmentId, { importance: 5 } as never);

      expect(updated.importance).toBe(5);
    });
  });

  describe('list', () => {
    it('bounds the query by the requested window and the caller', async () => {
      prisma.commitment.findMany.mockResolvedValue([] as never);

      await service.list(userId, {
        from: '2026-02-01T00:00:00.000Z',
        to: '2026-02-28T00:00:00.000Z',
        status: ['PLANNED', 'READY'],
      } as never);

      expect(prisma.commitment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId,
            scheduledStart: {
              gte: new Date('2026-02-01T00:00:00.000Z'),
              lte: new Date('2026-02-28T00:00:00.000Z'),
            },
            status: { in: ['PLANNED', 'READY'] },
          },
          orderBy: { scheduledStart: 'asc' },
        }),
      );
    });
  });
});
