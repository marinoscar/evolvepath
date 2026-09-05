import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

// =============================================================================
// Where a media coaching answer is kept (issue #92, epic E09)
// =============================================================================
//
// On the STORAGE OBJECT's `metadata`, under one namespaced key, and this is a
// deliberate seam rather than the final home.
//
// E03 (epic #67) introduces `media_attachments` with `purpose`, a polymorphic
// target and an `ai_summary` column, and that is where these belong. It has not
// landed, and inventing the table here would fork a schema another epic owns —
// so the summary lives beside `_processing`, which is the same pattern the
// video-frame sampler already uses on the same column.
//
// The swap is one method: when `MediaAttachmentsService.storeSummary` exists,
// this service delegates to it and nothing above changes.
// =============================================================================

/** The metadata key. Namespaced with an underscore, like `_processing`. */
export const COACHING_SUMMARY_KEY = '_coaching';

export type MediaSummaryKind = 'form_check' | 'equipment_check' | 'meal_check';

export interface MediaSummary {
  kind: MediaSummaryKind;
  askedAt: string;
  invocationId: string | null;
  promptVersion: string;
  result: unknown;
  context?: Record<string, unknown>;
}

@Injectable()
export class MediaSummaryService {
  private readonly logger = new Logger(MediaSummaryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Replace the coaching summary on one object.
   *
   * Scoped by `uploadedById` as well as by id: the caller has already resolved
   * ownership through `ObjectsService`, and repeating it here is the difference
   * between one check and one check plus a write that trusts it.
   */
  async store(objectId: string, userId: string, summary: MediaSummary): Promise<void> {
    const object = await this.prisma.storageObject.findFirst({
      where: { id: objectId, uploadedById: userId },
      select: { metadata: true },
    });

    if (!object) return;

    const metadata =
      object.metadata && typeof object.metadata === 'object' && !Array.isArray(object.metadata)
        ? (object.metadata as Record<string, unknown>)
        : {};

    await this.prisma.storageObject.update({
      where: { id: objectId },
      data: {
        metadata: {
          ...metadata,
          [COACHING_SUMMARY_KEY]: summary as unknown as Prisma.InputJsonValue,
        } as Prisma.InputJsonValue,
      },
    });
  }

  async read(objectId: string, userId: string): Promise<MediaSummary | null> {
    const object = await this.prisma.storageObject.findFirst({
      where: { id: objectId, uploadedById: userId },
      select: { metadata: true },
    });

    const metadata = object?.metadata as Record<string, unknown> | null | undefined;
    const summary = metadata?.[COACHING_SUMMARY_KEY];

    return summary ? (summary as MediaSummary) : null;
  }
}
