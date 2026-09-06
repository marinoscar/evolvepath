import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TestLoginDto } from './dto/test-login.dto';
import { SimulateIdleDto } from './dto/simulate-idle.dto';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { DEFAULT_USER_SETTINGS } from '../common/types/settings.types';
import { UserAiKeyService } from '../ai/user-key/user-ai-key.service';

export interface TestAuthTokenResponse {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    displayName: string | null;
    roles: string[];
  };
}

@Injectable()
export class TestAuthService {
  private readonly logger = new Logger(TestAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly userAiKey: UserAiKeyService,
  ) {}

  /**
   * Move a user's history backwards so they read as idle (issue #112, epic E11).
   *
   * Shifts `last_active_at`, every commitment timestamp and every evidence
   * timestamp by the same number of days — the whole of the user's past moves
   * together, so relative distances (which miss came before which completion)
   * survive and the sweep sees a coherent history rather than a doctored one.
   *
   * Raw SQL because Prisma has no column-relative update, and a read-modify-
   * write over a seeded month would be hundreds of round trips. The interval is
   * bound as an integer, never interpolated.
   */
  async simulateIdle(dto: SimulateIdleDto): Promise<{
    userId: string;
    shiftedCommitments: number;
    shiftedEvidence: number;
    lastActiveAt: string;
  }> {
    const email = dto.email.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });

    if (!user) {
      throw new NotFoundException(`No test user with email ${email}`);
    }

    const days = dto.idleDays;
    const lastActiveAt = new Date(Date.now() - days * 24 * 3_600_000);

    const shiftedCommitments = await this.prisma.$executeRaw`
      UPDATE commitments SET
        scheduled_start = scheduled_start - make_interval(days => ${days}),
        scheduled_end   = scheduled_end   - make_interval(days => ${days}),
        started_at      = started_at      - make_interval(days => ${days}),
        completed_at    = completed_at    - make_interval(days => ${days})
      WHERE user_id = ${user.id}::uuid`;

    const shiftedEvidence = await this.prisma.$executeRaw`
      UPDATE evidence_items SET
        occurred_at = occurred_at - make_interval(days => ${days})
      WHERE user_id = ${user.id}::uuid`;

    await this.prisma.userProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, lastActiveAt },
      update: { lastActiveAt },
    });

    this.logger.log(`Simulated ${days} idle days for ${email}`);

    return {
      userId: user.id,
      shiftedCommitments,
      shiftedEvidence,
      lastActiveAt: lastActiveAt.toISOString(),
    };
  }

  /** Resolve an email to a user id for the per-user jobs. */
  async userIdForEmail(email: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true },
    });

    if (!user) throw new NotFoundException(`No test user with email ${email}`);

    return user.id;
  }

  /**
   * Login as test user - bypass OAuth and allowlist for testing
   */
  async loginAsTestUser(dto: TestLoginDto): Promise<TestAuthTokenResponse> {
    this.logger.log(`Test login for email: ${dto.email} with role: ${dto.role}`);

    const email = dto.email.toLowerCase();

    // Find or create user
    let user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        userRoles: {
          include: {
            role: true,
          },
        },
      },
    });

    if (!user) {
      // Create new user
      const displayName = dto.displayName || email.split('@')[0];

      user = await this.prisma.user.create({
        data: {
          email,
          displayName,
          isActive: true,
          // Create default user settings
          userSettings: {
            create: {
              value: DEFAULT_USER_SETTINGS as any,
            },
          },
        },
        include: {
          userRoles: {
            include: {
              role: true,
            },
          },
        },
      });

      this.logger.log(`Created test user: ${email}`);
    }

    // Assign specified role (replace existing roles)
    const targetRole = await this.prisma.role.findUnique({
      where: { name: dto.role || 'viewer' },
    });

    if (!targetRole) {
      throw new Error(`Role ${dto.role} not found`);
    }

    // Remove all existing roles and assign the specified role
    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({
        where: { userId: user.id },
      }),
      this.prisma.userRole.create({
        data: {
          userId: user.id,
          roleId: targetRole.id,
        },
      }),
    ]);

    // Reload user with updated roles
    user = await this.prisma.user.findUnique({
      where: { id: user.id },
      include: {
        userRoles: {
          include: {
            role: true,
          },
        },
      },
    });

    if (!user) {
      throw new Error('Failed to reload user after role assignment');
    }

    // Generate JWT tokens
    const roles = user.userRoles.map((ur) => ur.role.name);

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      roles,
    };

    const accessTtlMinutes = this.configService.get<number>(
      'jwt.accessTtlMinutes',
      15,
    );

    const accessToken = this.jwtService.sign(payload);

    // Create refresh token
    const refreshToken = await this.createRefreshToken(user.id);

    // Seed an OpenAI key so the login lands on the app rather than the setup
    // gate (#25/#29). Test-only by construction: this whole module is not
    // registered when NODE_ENV is production. The value is recognisable as
    // synthetic so a key found in a database can be told apart from a real one.
    //
    // NOTE: this requires SECRETS_ENCRYPTION_KEY to be set — `setSecret`
    // cannot encrypt without it. The Compose overlay for e2e (#30) supplies a
    // test-only default for exactly this reason.
    if (dto.withAiKey) {
      await this.userAiKey.set(
        user.id,
        `sk-test-e2e-${randomBytes(12).toString('hex')}`,
      );
    }

    this.logger.log(`Test login successful for user: ${user.email} with roles: ${roles.join(', ')}`);

    return {
      accessToken,
      expiresIn: accessTtlMinutes * 60, // Convert to seconds
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        roles,
      },
    };
  }

  /**
   * Create a new refresh token (copied from AuthService)
   */
  private async createRefreshToken(userId: string): Promise<string> {
    const refreshTtlDays = this.configService.get<number>(
      'jwt.refreshTtlDays',
      14,
    );
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + refreshTtlDays);

    // Generate random token
    const token = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(token);

    // Store hashed token in database
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
      },
    });

    this.logger.debug(`Created refresh token for user: ${userId}`);

    return token;
  }

  /**
   * Hash token for storage
   */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
