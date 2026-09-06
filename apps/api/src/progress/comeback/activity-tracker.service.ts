import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { UserProfileService } from '../../user-profile/user-profile.service';

// =============================================================================
// When did this person last DO something? (issue #112, epic E11)
// =============================================================================
//
// OPENING THE APP IS NOT ACTIVITY. PRD §57 counts behaviour — a commitment
// acted on, evidence logged, a check-in, a coaching turn — because a person who
// opens the app every morning and does nothing has not been active in any sense
// worth protecting them from a comeback offer over.
//
// Every call site is detached and post-commit: this write must never join a
// caller's transaction, never delay their response and never be the reason an
// action fails. A missed touch costs at most one wrongly-offered comeback,
// which is a kind sentence; a failed completion costs the user their work.
// =============================================================================

/** At most one write per user per this interval. */
export const ACTIVITY_WRITE_INTERVAL_MS = 5 * 60_000;

@Injectable()
export class ActivityTrackerService {
  private readonly logger = new Logger(ActivityTrackerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: UserProfileService,
  ) {}

  /**
   * Record that the user did something.
   *
   * `updateMany` with the staleness test in the WHERE clause rather than a
   * read-then-write: it is one statement, it is race-free, and it costs nothing
   * when the row is already fresh — which is the common case on a screen where
   * somebody completes three things in a row.
   */
  async touch(userId: string, at: Date = new Date()): Promise<boolean> {
    const staleBefore = new Date(at.getTime() - ACTIVITY_WRITE_INTERVAL_MS);

    const { count } = await this.prisma.userProfile.updateMany({
      where: {
        userId,
        OR: [{ lastActiveAt: null }, { lastActiveAt: { lt: staleBefore } }],
      },
      data: { lastActiveAt: at },
    });

    if (count > 0) return true;

    // No row updated means either "already fresh" or "no profile yet". Only the
    // second is worth a write, and only for a user who has none.
    const profile = await this.prisma.userProfile.findUnique({
      where: { userId },
      select: { lastActiveAt: true },
    });

    if (profile) return false;

    await this.profiles.getOrCreate(userId);
    await this.prisma.userProfile.updateMany({
      where: { userId },
      data: { lastActiveAt: at },
    });

    return true;
  }

  /**
   * Fire-and-forget. The ONLY form call sites should use.
   *
   * Swallowing the error here rather than at each site is the point: a caller
   * that had to remember `.catch()` would eventually forget, and the failure
   * would surface as a 500 on a completed workout.
   */
  record(userId: string, at: Date = new Date()): void {
    void this.touch(userId, at).catch((error: unknown) => {
      this.logger.warn(
        `activity touch failed for ${userId}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    });
  }
}
