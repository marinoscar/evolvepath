import {
  Controller,
  Post,
  Body,
  UseGuards,
  Res,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { FastifyReply } from 'fastify';
import { Public } from '../auth/decorators/public.decorator';
import { TestEnvironmentGuard } from './guards/test-environment.guard';
import { TestAuthService } from './test-auth.service';
import { TestLoginDto } from './dto/test-login.dto';
import { RunJobDto } from './dto/run-job.dto';
import { SimulateIdleDto } from './dto/simulate-idle.dto';
import { Auth } from '../auth/decorators/auth.decorator';
import { CoachingNotificationsService } from '../coaching-notifications/coaching-notifications.service';
import { ComebackSweepTask } from '../progress/comeback/comeback-sweep.task';

const REFRESH_TOKEN_COOKIE = 'refresh_token';
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/api/auth',
  maxAge: 14 * 24 * 60 * 60, // 14 days in seconds
};

@ApiTags('Test Authentication')
@Controller('auth/test')
export class TestAuthController {
  private readonly logger = new Logger(TestAuthController.name);

  constructor(
    private readonly testAuthService: TestAuthService,
    private readonly configService: ConfigService,
    private readonly coachingNotifications: CoachingNotificationsService,
    private readonly comebackSweep: ComebackSweepTask,
  ) {}

  /**
   * POST /auth/test/login
   * Test authentication endpoint - bypasses OAuth for E2E testing
   */
  @Public()
  @Post('login')
  @UseGuards(TestEnvironmentGuard)
  @ApiOperation({
    summary: 'Test login (non-production only)',
    description:
      'Authenticate as any user for testing purposes. Only available in non-production environments.',
  })
  @ApiResponse({
    status: 302,
    description: 'Redirects to /auth/callback with access token',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - only available in non-production environments',
  })
  async testLogin(
    @Body() dto: TestLoginDto,
    @Res() res: FastifyReply,
  ): Promise<void> {
    this.logger.log(`Test login request for: ${dto.email}`);

    const result = await this.testAuthService.loginAsTestUser(dto);

    // Set refresh token in HttpOnly cookie
    res.setCookie(REFRESH_TOKEN_COOKIE, result.refreshToken, COOKIE_OPTIONS);

    // Redirect to frontend with access token
    const appUrl = this.configService.get<string>('appUrl');
    const redirectUrl = new URL('/auth/callback', appUrl);
    redirectUrl.searchParams.set('token', result.accessToken);
    redirectUrl.searchParams.set('expiresIn', result.expiresIn.toString());

    this.logger.log(`Test login successful, redirecting to: ${redirectUrl.toString()}`);
    return res.status(302).redirect(redirectUrl.toString());
  }

  /**
   * Run a background job on demand (issue #59, epic E12).
   *
   * The coaching engine's cron fires every five minutes, which is right for
   * production and useless for a test: a suite cannot wait, and an e2e that
   * seeded a commitment twenty minutes out would either sleep or assert
   * nothing. This route runs exactly the same `runOnce` the scheduler calls —
   * not a test double of it — with an optional simulated clock.
   *
   * `@Auth()`, unlike `login` above: the job acts on real data across all
   * users, so it needs a caller. It stays behind `TestEnvironmentGuard` and the
   * module is not registered in production at all, so there are two independent
   * reasons it cannot exist there.
   *
   * ONE ROUTE, ONE ENUM. Later epics add their jobs to `RunJobDto`'s enum
   * rather than adding a second route, so a test harness learns one shape.
   */
  @Post('run-job')
  @Auth()
  @UseGuards(TestEnvironmentGuard)
  @ApiOperation({
    summary: 'Run a background job on demand (non-production only)',
    description:
      'Runs the named job synchronously and returns its counts. `now` simulates the clock, ' +
      'so a test can seed data relative to a fixed instant instead of waiting for one.',
  })
  @ApiResponse({ status: 201, description: 'The job ran; counts are in the body' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - only available in non-production environments',
  })
  async runJob(@Body() dto: RunJobDto): Promise<Record<string, unknown>> {
    const now = dto.now ? new Date(dto.now) : undefined;
    this.logger.log(`Running job '${dto.job}'${dto.now ? ` at ${dto.now}` : ''}`);

    if (dto.job === 'comeback') {
      // Per-user rather than the whole sweep: a test asserting on one user's
      // offer must not race with the same job writing offers for every other
      // seeded account.
      const userId = await this.testAuthService.userIdForEmail(
        dto.email ?? '',
      );
      const result = await this.comebackSweep.runForUser(userId, now);

      return { job: dto.job, ...result };
    }

    return { job: dto.job, ...(await this.coachingNotifications.runOnce(now)) };
  }

  /**
   * Make a user look idle (issue #112, epic E11).
   *
   * `@Public()` like `login` above, and for the same reason: it names the user
   * by email so an e2e can call it before it has a token. Behind
   * `TestEnvironmentGuard`, in a module that is not registered in production at
   * all — two independent reasons it cannot exist there.
   */
  @Public()
  @Post('simulate-idle')
  @UseGuards(TestEnvironmentGuard)
  @ApiOperation({
    summary: 'Shift a user’s history backwards (non-production only)',
    description:
      'Moves `last_active_at` and every one of the user’s commitment and evidence timestamps ' +
      'back by the same number of days, so a freshly seeded history reads as “idle for N days” ' +
      'without a global clock seam. The sweep then runs against the real clock.',
  })
  @ApiResponse({ status: 201, description: 'The user’s history was shifted' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - only available in non-production environments',
  })
  async simulateIdle(@Body() dto: SimulateIdleDto): Promise<{
    userId: string;
    shiftedCommitments: number;
    shiftedEvidence: number;
    lastActiveAt: string;
  }> {
    return this.testAuthService.simulateIdle(dto);
  }
}
