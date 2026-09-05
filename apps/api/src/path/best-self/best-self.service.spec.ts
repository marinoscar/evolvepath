import { Test, TestingModule } from '@nestjs/testing';

import { BestSelfService } from './best-self.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService, MockPrismaService } from '../../../test/mocks/prisma.mock';

describe('BestSelfService', () => {
  let service: BestSelfService;
  let prisma: MockPrismaService;

  const userId = 'user-123';

  const profile = {
    id: 'profile-1',
    userId,
    identityStatement: 'Focused, present, healthy',
    workIdentity: null,
    familyIdentity: null,
    healthIdentity: null,
    sixMonthVision: null,
    motivations: ['family'],
    reasons: [],
    lastReviewedAt: new Date('2026-02-01T10:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-02-01T10:00:00.000Z'),
  };

  beforeEach(async () => {
    prisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [BestSelfService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<BestSelfService>(BestSelfService);
    prisma.auditEvent.create.mockResolvedValue({ id: 'audit-1' } as never);
  });

  describe('get', () => {
    it('answers null before the profile has ever been saved', async () => {
      prisma.bestSelfProfile.findUnique.mockResolvedValue(null as never);

      await expect(service.get(userId)).resolves.toBeNull();
    });

    it('scopes the lookup to the caller', async () => {
      prisma.bestSelfProfile.findUnique.mockResolvedValue(profile as never);

      await service.get(userId);

      expect(prisma.bestSelfProfile.findUnique).toHaveBeenCalledWith({ where: { userId } });
    });
  });

  describe('upsert', () => {
    const dto = {
      identityStatement: 'Focused, present, healthy',
      motivations: ['family'],
      reasons: [],
    } as never;

    it('stamps lastReviewedAt on every replacement', async () => {
      prisma.bestSelfProfile.upsert.mockResolvedValue(profile as never);

      await service.upsert(userId, dto);

      const call = prisma.bestSelfProfile.upsert.mock.calls[0]?.[0];
      expect(call?.update.lastReviewedAt).toBeInstanceOf(Date);
      expect(call?.create.lastReviewedAt).toBeInstanceOf(Date);
    });

    // audit_events is admin-readable, and an identity statement is the most
    // personal sentence in this product. The audit records that it changed and
    // which parts were filled in — never a word of what was written.
    it('audits field names only, never the prose', async () => {
      prisma.bestSelfProfile.upsert.mockResolvedValue(profile as never);

      await service.upsert(userId, dto);

      const { data } = prisma.auditEvent.create.mock.calls[0]?.[0] ?? { data: {} };
      expect(data.action).toBe('best_self:replace');
      expect(data.targetType).toBe('best_self_profile');
      expect(data.meta).toEqual({ fields: ['identityStatement', 'motivations'] });
      expect(JSON.stringify(data.meta)).not.toContain('Focused');
    });

    it('reports an empty array as an absent field rather than a present one', async () => {
      prisma.bestSelfProfile.upsert.mockResolvedValue(profile as never);

      await service.upsert(userId, { motivations: [], reasons: [] } as never);

      const { data } = prisma.auditEvent.create.mock.calls[0]?.[0] ?? { data: {} };
      expect(data.meta).toEqual({ fields: [] });
    });

    it('clears omitted fields — this is a PUT, not a PATCH', async () => {
      prisma.bestSelfProfile.upsert.mockResolvedValue(profile as never);

      await service.upsert(userId, { motivations: [], reasons: [] } as never);

      const call = prisma.bestSelfProfile.upsert.mock.calls[0]?.[0];
      expect(call?.update.identityStatement).toBeNull();
      expect(call?.update.sixMonthVision).toBeNull();
    });
  });
});
