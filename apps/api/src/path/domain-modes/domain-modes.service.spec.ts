import { Test, TestingModule } from '@nestjs/testing';

import { DomainModesService } from './domain-modes.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService, MockPrismaService } from '../../../test/mocks/prisma.mock';

describe('DomainModesService', () => {
  let service: DomainModesService;
  let prisma: MockPrismaService;

  const userId = 'user-123';

  const healthRow = {
    id: 'dm-1',
    userId,
    domain: 'HEALTH',
    mode: 'RECOVER',
    reason: 'Back strain',
    effectiveFrom: new Date('2026-02-01T10:00:00.000Z'),
    createdAt: new Date('2026-02-01T10:00:00.000Z'),
    updatedAt: new Date('2026-02-01T10:00:00.000Z'),
  };

  beforeEach(async () => {
    prisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [DomainModesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<DomainModesService>(DomainModesService);
    prisma.auditEvent.create.mockResolvedValue({ id: 'audit-1' } as never);
  });

  describe('list', () => {
    // A brand-new account has no rows at all. Three entries still come back,
    // synthesised — absent means default, and nothing is seeded at sign-up.
    it('returns three entries in order for a user with no rows', async () => {
      prisma.domainMode.findMany.mockResolvedValue([] as never);

      await expect(service.list(userId)).resolves.toEqual([
        { domain: 'WORK', mode: 'GROW', reason: null, effectiveFrom: null },
        { domain: 'FAMILY', mode: 'GROW', reason: null, effectiveFrom: null },
        { domain: 'HEALTH', mode: 'GROW', reason: null, effectiveFrom: null },
      ]);
      expect(prisma.domainMode.create).not.toHaveBeenCalled();
    });

    it('merges stored rows into the synthesised three', async () => {
      prisma.domainMode.findMany.mockResolvedValue([healthRow] as never);

      const modes = await service.list(userId);

      expect(modes).toHaveLength(3);
      expect(modes[2]).toEqual({
        domain: 'HEALTH',
        mode: 'RECOVER',
        reason: 'Back strain',
        effectiveFrom: '2026-02-01T10:00:00.000Z',
      });
    });
  });

  describe('set', () => {
    it('records the transition it made, from the synthesised default', async () => {
      prisma.domainMode.findUnique.mockResolvedValue(null as never);
      prisma.domainMode.upsert.mockResolvedValue(healthRow as never);

      await service.set(userId, 'HEALTH', { mode: 'RECOVER' } as never);

      const { data } = prisma.auditEvent.create.mock.calls[0]?.[0] ?? { data: {} };
      expect(data.action).toBe('domain_mode:set');
      expect(data.meta).toEqual({ domain: 'HEALTH', from: 'GROW', to: 'RECOVER' });
    });

    // "Since when have you been in RECOVER?" is the question this column
    // answers, so editing the reason must not reset the clock.
    it('leaves effectiveFrom alone when only the reason changes', async () => {
      prisma.domainMode.findUnique.mockResolvedValue(healthRow as never);
      prisma.domainMode.upsert.mockResolvedValue(healthRow as never);

      await service.set(userId, 'HEALTH', { mode: 'RECOVER', reason: 'Still sore' } as never);

      const call = prisma.domainMode.upsert.mock.calls[0]?.[0];
      expect(call?.update.effectiveFrom).toEqual(healthRow.effectiveFrom);
    });

    it('moves effectiveFrom when the mode actually changes', async () => {
      prisma.domainMode.findUnique.mockResolvedValue(healthRow as never);
      prisma.domainMode.upsert.mockResolvedValue(healthRow as never);

      await service.set(userId, 'HEALTH', { mode: 'GROW' } as never);

      const call = prisma.domainMode.upsert.mock.calls[0]?.[0];
      expect(call?.update.effectiveFrom).not.toEqual(healthRow.effectiveFrom);
    });
  });
});
