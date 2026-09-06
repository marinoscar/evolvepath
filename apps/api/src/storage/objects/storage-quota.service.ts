import { Injectable, Logger, PayloadTooLargeException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../prisma/prisma.service';

/**
 * Storage statuses that COUNT against a quota.
 *
 * An in-flight upload counts: the bytes are (or are about to be) on the
 * bucket, and a quota that only sees finished uploads is a quota you can walk
 * past by never calling `complete`. `failed` does not count — that object's
 * bytes are the deployment's problem to clean up, not the user's to pay for.
 */
const LIVE_STATUSES = ['pending', 'uploading', 'processing', 'ready'] as const;

@Injectable()
export class StorageQuotaService {
  private readonly logger = new Logger(StorageQuotaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Configured ceiling in bytes, or `null` when quotas are disabled. */
  quotaBytes(): bigint | null {
    const configured = this.config.get<number>(
      'storage.userQuotaBytes',
      2147483648,
    );
    return configured > 0 ? BigInt(configured) : null;
  }

  /**
   * Bytes this user currently holds.
   *
   * Includes DERIVED objects — sampled video frames, normalized AI variants.
   * They exist because the user uploaded something, they are stored under the
   * user's id, and excluding them would let a quota be exceeded by a factor of
   * nine by uploading videos.
   */
  async usedBytes(userId: string): Promise<bigint> {
    const result = await this.prisma.storageObject.aggregate({
      _sum: { size: true },
      where: { uploadedById: userId, status: { in: [...LIVE_STATUSES] } },
    });

    return result?._sum?.size ?? BigInt(0);
  }

  /** `{ usedBytes, quotaBytes, remainingBytes }`, all as strings or null. */
  async describe(userId: string): Promise<{
    usedBytes: string;
    quotaBytes: string | null;
    remainingBytes: string | null;
  }> {
    const used = await this.usedBytes(userId);
    const quota = this.quotaBytes();

    return {
      usedBytes: used.toString(),
      quotaBytes: quota?.toString() ?? null,
      // Clamped at zero: "-4 bytes remaining" is not a thing to render, and a
      // user can legitimately be over quota after an operator lowers it.
      remainingBytes:
        quota === null
          ? null
          : (quota > used ? quota - used : BigInt(0)).toString(),
    };
  }

  /**
   * Refuse an upload that would take this user past their quota.
   *
   * `used + incoming === quota` is ALLOWED. A limit you cannot reach is a
   * different limit, and off-by-one refusals at a round number are the kind of
   * bug a user reports as "it says I have 2 GB and it won't take 2 GB".
   */
  async assertCanStore(userId: string, incomingBytes: number): Promise<void> {
    const quota = this.quotaBytes();
    if (quota === null) return;

    const used = await this.usedBytes(userId);
    const incoming = BigInt(Math.max(0, incomingBytes));

    if (used + incoming > quota) {
      this.logger.warn(
        `Quota rejection: userId=${userId} used=${used} incoming=${incoming} quota=${quota}`,
      );
      throw new PayloadTooLargeException(
        `Storage quota exceeded: ${used} of ${quota} bytes used`,
      );
    }
  }
}
