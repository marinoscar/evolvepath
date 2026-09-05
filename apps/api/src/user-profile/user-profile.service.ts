import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type UserProfile } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

/**
 * The fields a caller may write. `userId` is not among them — a profile is
 * addressed by the caller's own id and never by a body field.
 */
export type UserProfilePatch = Omit<
  Prisma.UserProfileUncheckedUpdateInput,
  'id' | 'userId' | 'createdAt' | 'updatedAt' | 'user'
>;

/**
 * Owner of `user_profiles` (issue #100, epic E04).
 *
 * Rows are created lazily. `getOrCreate` is for write paths that need a row to
 * exist; every read path uses `isOnboardingComplete` or `find`, which never
 * write — `GET /auth/me` runs on every application boot and an upsert there
 * would turn a page load into a write on the hot path.
 */
@Injectable()
export class UserProfileService {
  private readonly logger = new Logger(UserProfileService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The row for this user, creating the default one if it is missing.
   *
   * Idempotent, and safe under a race: two concurrent first-writes both attempt
   * the insert, the unique index rejects one of them (P2002), and the loser
   * re-reads what the winner created.
   */
  async getOrCreate(userId: string): Promise<UserProfile> {
    try {
      return await this.prisma.userProfile.upsert({
        where: { userId },
        create: { userId },
        update: {},
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.prisma.userProfile.findUnique({ where: { userId } });
        if (existing) return existing;
      }
      throw error;
    }
  }

  /** The row, or null. Never writes. */
  async find(userId: string): Promise<UserProfile | null> {
    return this.prisma.userProfile.findUnique({ where: { userId } });
  }

  /**
   * Whether onboarding has finished.
   *
   * `onboardingCompletedAt`, not `onboardingStep === 'DONE'`: a user can walk
   * back into a step to change an answer, and doing so must not un-complete
   * their account.
   */
  async isOnboardingComplete(userId: string): Promise<boolean> {
    const row = await this.prisma.userProfile.findUnique({
      where: { userId },
      select: { onboardingCompletedAt: true },
    });

    return row?.onboardingCompletedAt != null;
  }

  /** Partial write. Creates the row first when the user has never had one. */
  async update(userId: string, patch: UserProfilePatch): Promise<UserProfile> {
    await this.getOrCreate(userId);

    return this.prisma.userProfile.update({ where: { userId }, data: patch });
  }
}
