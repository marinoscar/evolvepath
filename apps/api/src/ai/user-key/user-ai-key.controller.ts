import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Put,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';

import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { TestThrottle } from '../gateway/test-throttle';
import { AiTestResultDto } from '../dto/ai-test-result.dto';
import { SetUserAiKeyDto } from './dto/set-user-ai-key.dto';
import { UserAiKeyStatusDto } from './dto/user-ai-key-status.dto';
import { UserAiKeyService } from './user-ai-key.service';

// =============================================================================
// UserAiKeyController (issue #25, epic #20)
// =============================================================================
//
// The caller's OWN OpenAI key. Four operations, all `@Auth()` with no
// permission: this is an own-resource surface, exactly like `PatController`.
//
//   GET    /api/me/ai-key        status: configured, hint, last test, platform
//   PUT    /api/me/ai-key        set or replace (write-only)
//   DELETE /api/me/ai-key        remove, idempotent
//   POST   /api/me/ai-key/test   probe it, 200 always, 5/min
//
// THERE IS NO `:userId` PARAMETER ANYWHERE, and that is the security design
// rather than a stylistic choice: every handler reads `@CurrentUser('id')`, so
// there is no route on which one user can address another's key and therefore
// no ownership check that can be forgotten. Adding a path parameter here would
// be a visible signature change, not a one-word edit.
//
// No `user_ai_key:*` permissions are introduced. A Viewer — the least
// privileged role in this product — must be able to save, test and remove their
// own key, because without one they cannot use the application at all.
// =============================================================================

@ApiTags('AI Key')
@Controller('me/ai-key')
export class UserAiKeyController {
  constructor(
    private readonly userAiKey: UserAiKeyService,
    private readonly throttle: TestThrottle,
  ) {}

  @Get()
  @Auth()
  @ApiOperation({
    summary: 'Get the status of your OpenAI API key',
    description:
      'Whether a key is stored, its non-secret mask, the outcome of the most recent ' +
      'test, and enough about the platform configuration to explain a skipped generate ' +
      'probe. **The key itself is never returned.**',
  })
  @ApiResponse({ status: 200, type: UserAiKeyStatusDto })
  async getStatus(@CurrentUser('id') userId: string) {
    return this.userAiKey.status(userId);
  }

  @Put()
  @Auth()
  @ApiOperation({
    summary: 'Save or replace your OpenAI API key',
    description:
      'Stores the key encrypted. It is never returned by this or any other endpoint, ' +
      'and it is not logged or written to an audit row. Replacing a key overwrites the ' +
      'stored one; there is no history.',
  })
  @ApiResponse({ status: 200, type: UserAiKeyStatusDto })
  @ApiResponse({ status: 400, description: 'The key is too short, too long, or contains whitespace' })
  async setKey(
    @Body() dto: SetUserAiKeyDto,
    @CurrentUser('id') userId: string,
  ) {
    await this.userAiKey.set(userId, dto.apiKey);
    return this.userAiKey.status(userId);
  }

  @Delete()
  @Auth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove your OpenAI API key',
    description:
      'Idempotent: removing a key that is not there succeeds. After this you will be ' +
      'asked for a key again before you can use the application.',
  })
  @ApiResponse({ status: 204, description: 'Removed, or there was nothing to remove' })
  async deleteKey(@CurrentUser('id') userId: string): Promise<void> {
    await this.userAiKey.deleteForUser(userId);
  }

  @Post('test')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Test your OpenAI API key',
    description:
      'Runs a catalog listing with your key and, when the administrator has chosen a ' +
      'default model, a 16-token structured generation against it.\n\n' +
      '**This returns HTTP 200 even when the test failed.** Read `success`, and show ' +
      '`error`, which carries OpenAI’s own message with any credential redacted. ' +
      '`checks.generate` is `"skipped"` — not failed — when no default model is ' +
      'configured; that is the administrator’s to fix, not yours. Throttled to 5 ' +
      'attempts per minute.',
  })
  @ApiResponse({ status: 200, type: AiTestResultDto })
  @ApiResponse({ status: 429, description: 'Too many test attempts' })
  async testKey(
    @CurrentUser('id') userId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const decision = this.throttle.check('user_test', userId);

    if (!decision.allowed) {
      // A real 4xx, unlike the provider failures this endpoint reports as 200:
      // the request was refused rather than attempted, so there is no diagnosis
      // to return and nothing is recorded.
      reply.header('Retry-After', String(decision.retryAfterSeconds));

      throw new HttpException(
        {
          message: `Too many test attempts. Try again in ${decision.retryAfterSeconds} s.`,
          details: { retryAfterSeconds: decision.retryAfterSeconds },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return this.userAiKey.test(userId);
  }
}
