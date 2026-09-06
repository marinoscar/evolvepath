import { ConfigService } from '@nestjs/config';
import { PayloadTooLargeException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService } from '../../../test/mocks/prisma.mock';
import { StorageQuotaService } from './storage-quota.service';

function build(quotaBytes: number, usedBytes: bigint) {
  const prisma = createMockPrismaService();
  (prisma.storageObject.aggregate as jest.Mock).mockResolvedValue({
    _sum: { size: usedBytes },
  });

  const config = {
    get: jest.fn((key: string, fallback?: unknown) =>
      key === 'storage.userQuotaBytes' ? quotaBytes : fallback,
    ),
  } as unknown as ConfigService;

  return {
    service: new StorageQuotaService(prisma as unknown as PrismaService, config),
    prisma,
  };
}

describe('StorageQuotaService', () => {
  it('sums only the statuses whose bytes are actually held', async () => {
    // An in-flight upload counts: a quota that only sees finished uploads is a
    // quota you walk past by never calling `complete`. `failed` does not — that
    // object's bytes are the deployment's to clean up, not the user's to pay
    // for.
    const { service, prisma } = build(1000, BigInt(400));

    await service.usedBytes('user-1');

    expect(prisma.storageObject.aggregate).toHaveBeenCalledWith({
      _sum: { size: true },
      where: {
        uploadedById: 'user-1',
        status: { in: ['pending', 'uploading', 'processing', 'ready'] },
      },
    });
  });

  it('reports zero for a user with nothing stored', async () => {
    const prisma = createMockPrismaService();
    (prisma.storageObject.aggregate as jest.Mock).mockResolvedValue({
      _sum: { size: null },
    });
    const config = {
      get: jest.fn((_k: string, fallback?: unknown) => fallback),
    } as unknown as ConfigService;

    const service = new StorageQuotaService(
      prisma as unknown as PrismaService,
      config,
    );

    expect(await service.usedBytes('user-1')).toBe(BigInt(0));
  });

  it('allows an upload landing exactly on the quota', async () => {
    // A limit you cannot reach is a different limit, and an off-by-one refusal
    // at a round number gets reported as "it says 2 GB and won't take 2 GB".
    const { service } = build(1000, BigInt(400));

    await expect(service.assertCanStore('user-1', 600)).resolves.toBeUndefined();
  });

  it('refuses one byte past it', async () => {
    const { service } = build(1000, BigInt(400));

    await expect(service.assertCanStore('user-1', 601)).rejects.toBeInstanceOf(
      PayloadTooLargeException,
    );
  });

  it('names used and quota in the message', async () => {
    const { service } = build(1000, BigInt(400));

    await expect(service.assertCanStore('user-1', 900)).rejects.toThrow(
      'Storage quota exceeded: 400 of 1000 bytes used',
    );
  });

  it('is disabled entirely at 0, and never queries', async () => {
    const { service, prisma } = build(0, BigInt(999999));

    await expect(
      service.assertCanStore('user-1', 999999999),
    ).resolves.toBeUndefined();
    expect(prisma.storageObject.aggregate).not.toHaveBeenCalled();
  });

  it('describes null quota and remaining when disabled', async () => {
    // null rather than a very large number, so a client renders "unlimited"
    // instead of a meaningless progress bar.
    const { service } = build(0, BigInt(1234));

    expect(await service.describe('user-1')).toEqual({
      usedBytes: '1234',
      quotaBytes: null,
      remainingBytes: null,
    });
  });

  it('describes used, quota and remaining as strings', async () => {
    const { service } = build(1000, BigInt(400));

    expect(await service.describe('user-1')).toEqual({
      usedBytes: '400',
      quotaBytes: '1000',
      remainingBytes: '600',
    });
  });

  it('clamps remaining at zero for a user already over quota', async () => {
    // Reachable whenever an operator lowers the ceiling. "-4 bytes remaining"
    // is not a thing to render.
    const { service } = build(1000, BigInt(1500));

    expect((await service.describe('user-1')).remainingBytes).toBe('0');
  });
});
