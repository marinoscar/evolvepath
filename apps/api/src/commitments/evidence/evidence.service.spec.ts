import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';

import { EvidenceService } from './evidence.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService, MockPrismaService } from '../../../test/mocks/prisma.mock';
import { createEvidenceSchema } from './dto/create-evidence.dto';

describe('evidence validation', () => {
  const base = { evidenceType: 'completion', source: 'USER_LOG' };

  it('accepts a user log', () => {
    expect(createEvidenceSchema.safeParse(base).success).toBe(true);
  });

  // PRD §10.9: TIMER, WORKOUT_LOG and APP_FLOW mean "the system observed
  // this". A client able to claim them could manufacture observations.
  it.each([['TIMER'], ['WORKOUT_LOG'], ['APP_FLOW']])(
    'refuses a client-claimed %s source',
    (source) => {
      expect(createEvidenceSchema.safeParse({ ...base, source }).success).toBe(false);
    },
  );

  it('rejects a confidence outside 0-1', () => {
    expect(createEvidenceSchema.safeParse({ ...base, confidence: 1.5 }).success).toBe(false);
  });
});

describe('EvidenceService', () => {
  let service: EvidenceService;
  let prisma: MockPrismaService;

  const userId = 'user-123';
  const evidenceId = '66666666-6666-4666-8666-666666666666';
  const commitmentId = '55555555-5555-4555-8555-555555555555';
  const at = new Date('2026-02-10T07:15:00.000Z');

  const row = (over: Record<string, unknown> = {}) => ({
    id: evidenceId,
    userId,
    commitmentId,
    evidenceType: 'completion',
    source: 'USER_LOG',
    occurredAt: at,
    quantitativeValue: null,
    quantitativeUnit: null,
    qualitativeValue: 'Finished all sets',
    confidence: null,
    createdAt: at,
    updatedAt: at,
    ...over,
  });

  beforeEach(async () => {
    prisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [EvidenceService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<EvidenceService>(EvidenceService);
    prisma.auditEvent.create.mockResolvedValue({ id: 'audit-1' } as never);
  });

  it("answers 404 for another user's commitment", async () => {
    prisma.commitment.findFirst.mockResolvedValue(null as never);

    await expect(
      service.create(userId, { commitmentId, evidenceType: 'completion', source: 'USER_LOG' } as never),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.evidence.create).not.toHaveBeenCalled();
  });

  it('writes USER_LOG regardless of what reached the service', async () => {
    prisma.evidence.create.mockResolvedValue(row() as never);

    await service.create(userId, {
      evidenceType: 'completion',
      source: 'TIMER',
    } as never);

    const { data } = prisma.evidence.create.mock.calls[0]?.[0] ?? { data: {} };
    expect(data.source).toBe('USER_LOG');
  });

  // The one path that may claim a system observation, reachable from no route.
  it('lets a server flow write a TIMER row', async () => {
    prisma.evidence.create.mockResolvedValue(row({ source: 'TIMER' }) as never);

    const created = await service.createFromFlow(userId, {
      commitmentId,
      evidenceType: 'timer',
      source: 'TIMER',
      quantitativeValue: 45,
      quantitativeUnit: 'minutes',
    });

    expect(created.source).toBe('TIMER');
    const { data } = prisma.evidence.create.mock.calls[0]?.[0] ?? { data: {} };
    expect(data.userId).toBe(userId);
  });

  it('filters a domain listing through the commitment', async () => {
    prisma.evidence.findMany.mockResolvedValue([] as never);

    await service.list(userId, {
      from: '2026-02-01T00:00:00.000Z',
      to: '2026-02-28T00:00:00.000Z',
      domain: 'HEALTH',
    } as never);

    expect(prisma.evidence.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId, commitment: { domain: 'HEALTH' } }),
        orderBy: { occurredAt: 'desc' },
      }),
    );
  });

  describe('remove', () => {
    it("refuses to delete another user's evidence", async () => {
      prisma.evidence.findFirst.mockResolvedValue(null as never);

      await expect(service.remove(userId, evidenceId)).rejects.toThrow(NotFoundException);
      expect(prisma.evidence.delete).not.toHaveBeenCalled();
    });

    it('deletes the caller\'s own row and audits it', async () => {
      prisma.evidence.findFirst.mockResolvedValue(row() as never);
      prisma.evidence.delete.mockResolvedValue(row() as never);

      await service.remove(userId, evidenceId);

      expect(prisma.evidence.delete).toHaveBeenCalledWith({ where: { id: evidenceId } });
      const { data } = prisma.auditEvent.create.mock.calls[0]?.[0] ?? { data: {} };
      expect(data.action).toBe('evidence:delete');
    });
  });
});
