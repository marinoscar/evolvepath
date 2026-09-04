import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestUser } from '../auth/interfaces/authenticated-user.interface';
import { PERMISSIONS } from '../common/constants/roles.constants';
import { AI_PERSONAS } from './ai-personas';
import { AiAdminTestService } from './ai-admin-test.service';
import { AiSettingsService } from './ai-settings.service';
import { AiModelCatalogService } from './model-catalog/ai-model-catalog.service';
import { TestThrottle, type ThrottleBucket } from './gateway/test-throttle';
import { AiModelsResponseDto } from './dto/ai-models-response.dto';
import { AiPersonaDto } from './dto/ai-persona.dto';
import { AiSettingsResponseDto } from './dto/ai-settings-response.dto';
import { AiTestResultDto } from './dto/ai-test-result.dto';
import { UpdateAiSettingsDto } from './dto/update-ai-settings.dto';

// =============================================================================
// AiSettingsController (issue #24, epic #20)
// =============================================================================
//
// The HTTP surface behind `/admin/settings/ai`. Five operations, gated as the
// `ADMIN_SECTIONS` card declares:
//
//   GET  /api/ai-settings           system_settings:read
//   PUT  /api/ai-settings           system_settings:write
//   GET  /api/ai-settings/personas  system_settings:read
//   GET  /api/ai-settings/models    system_settings:read
//   POST /api/ai-settings/test      system_settings:write
//
// `system_settings:*` rather than a new `ai_settings:*` pair, for the reason
// `EmailSettingsController` gives: the permission set is seeded, a new string
// means a migration plus a re-seed plus updating every existing Admin role, and
// this page is administering system configuration by any reading.
//
// THE TEST ENDPOINT IS GATED ON WRITE, NOT READ. It spends the platform key's
// tokens; `:read` is held by anyone who may look at settings, and looking is
// not spending. `/models` is on read because a catalog listing costs nothing
// and the read-only view needs it to render the stored selection meaningfully.
// =============================================================================

/**
 * `?refresh=true` on the models endpoint.
 *
 * `z.stringbool()` rather than `z.coerce.boolean()`, deliberately:
 * `Boolean('false')` is `true`, so the coercing form would make
 * `?refresh=false` bypass the cache — the exact opposite of what it says.
 */
const aiModelsQuerySchema = z.object({
  refresh: z.stringbool().optional().default(false),
});

export class AiModelsQueryDto extends createZodDto(aiModelsQuerySchema) {}

@ApiTags('AI Settings')
@Controller('ai-settings')
export class AiSettingsController {
  constructor(
    private readonly settings: AiSettingsService,
    private readonly catalog: AiModelCatalogService,
    private readonly adminTest: AiAdminTestService,
    private readonly throttle: TestThrottle,
  ) {}

  @Get()
  @Auth({ permissions: [PERMISSIONS.SYSTEM_SETTINGS_READ] })
  @ApiOperation({
    summary: 'Get AI settings (Admin only)',
    description:
      'Returns the AI configuration together with `platformKeyStatus`, a masked, ' +
      'non-secret description of the stored platform API key. **The key itself is never ' +
      'returned by this or any other endpoint** — it is held in the encrypted credential ' +
      'store. Submitting the key field empty on `PUT` preserves the stored value.\n\n' +
      'A stored row that no longer validates does not fail this request: the defaults ' +
      'are returned with `settingsError` set, so the page that repairs the row can ' +
      'still render.',
  })
  @ApiResponse({
    status: 200,
    description: 'AI settings and stored-key status',
    type: AiSettingsResponseDto,
  })
  async getSettings() {
    return this.settings.describeForAdmin();
  }

  @Put()
  @Auth({ permissions: [PERMISSIONS.SYSTEM_SETTINGS_WRITE] })
  @ApiOperation({
    summary: 'Replace AI settings (Admin only)',
    description:
      'Replaces the AI configuration. `platformApiKey` is **write-only**: send it to set ' +
      'or rotate the platform key, and **omit it or send it empty to keep the stored ' +
      'one**. Every named model must be GPT 5.4 or newer, and in production `baseUrl` ' +
      'must use https.',
  })
  @ApiHeader({
    name: 'If-Match',
    description:
      'Expected `version` for optimistic concurrency. Use `0` to assert that nothing is ' +
      'stored yet. Omit to overwrite unconditionally.',
    required: false,
  })
  @ApiResponse({ status: 200, type: AiSettingsResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error, or an unsupported model' })
  @ApiResponse({ status: 409, description: 'Version conflict' })
  async replaceSettings(
    @Body() dto: UpdateAiSettingsDto,
    @CurrentUser('id') userId: string,
    @Headers('if-match') ifMatch?: string,
  ) {
    // `Number.isInteger` rather than a bare `parseInt`, copied from
    // `EmailSettingsController`: `parseInt('abc')` is NaN and `NaN !== version`
    // is always true, so a malformed header would turn every save into a 409
    // that no amount of reloading fixes. Unparseable is treated as absent,
    // matching the header's own "omit to overwrite unconditionally".
    const parsed = ifMatch !== undefined ? Number.parseInt(ifMatch, 10) : NaN;
    const expectedVersion = Number.isInteger(parsed) ? parsed : undefined;

    const view = await this.settings.update(dto, userId, expectedVersion);

    // A save can change the key or the base URL, after which the cached
    // catalog describes a different account.
    this.catalog.invalidate();

    return view;
  }

  @Get('personas')
  @Auth({ permissions: [PERMISSIONS.SYSTEM_SETTINGS_READ] })
  @ApiOperation({
    summary: 'List AI personas (Admin only)',
    description:
      'The logical AI responsibilities an administrator can assign a model to, in ' +
      'registry order. The web app reads this rather than keeping its own copy, so the ' +
      'two cannot drift.',
  })
  @ApiResponse({ status: 200, type: [AiPersonaDto] })
  getPersonas(): AiPersonaDto[] {
    return AI_PERSONAS.map((persona) => ({
      key: persona.key,
      label: persona.label,
      description: persona.description,
      tier: persona.tier,
      capabilities: persona.capabilities,
    }));
  }

  @Get('models')
  @Auth({ permissions: [PERMISSIONS.SYSTEM_SETTINGS_READ] })
  @ApiQuery({
    name: 'refresh',
    required: false,
    description:
      'Bypass the 5-minute cache and ask the provider now. Throttled to 10 per minute ' +
      'per user.',
  })
  @ApiOperation({
    summary: 'List selectable models (Admin only)',
    description:
      'The models the stored platform key can reach, filtered to GPT 5.4 or newer and ' +
      'sorted newest first.\n\n' +
      '**This returns HTTP 200 even when the provider could not be reached.** Read ' +
      '`success`; on failure `error` carries the provider’s message and `models` may ' +
      'still hold the last known catalog with `source: "cache"`.',
  })
  @ApiResponse({ status: 200, type: AiModelsResponseDto })
  @ApiResponse({ status: 429, description: 'Too many refreshes' })
  async getModels(
    @Query() query: AiModelsQueryDto,
    @CurrentUser('id') userId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    // Only the bypass is throttled. A cached read costs nothing and must stay
    // available — otherwise a throttled administrator cannot render the page at
    // all, which is a worse outcome than a stale list.
    if (query.refresh) {
      this.enforceThrottle('models_refresh', userId, reply);
    }

    return this.catalog.list({ refresh: query.refresh });
  }

  @Post('test')
  @Auth({ permissions: [PERMISSIONS.SYSTEM_SETTINGS_WRITE] })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Test the platform AI connection (Admin only)',
    description:
      'Runs two probes with the stored platform key: a catalog listing (validates the ' +
      'key) and, when a default model is configured, a 16-token structured generation ' +
      '(validates the key against that model).\n\n' +
      '**This returns HTTP 200 even when the connection failed.** A refused connection ' +
      'is a successful diagnosis, and it is why this endpoint exists — read `success`, ' +
      'and show `error`, which carries the provider’s actual message with any credential ' +
      'redacted. Throttled to 5 attempts per minute per user.',
  })
  @ApiResponse({ status: 200, type: AiTestResultDto })
  @ApiResponse({ status: 429, description: 'Too many test attempts' })
  async testConnection(
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    this.enforceThrottle('admin_test', user.id, reply);

    return this.adminTest.testConnection({ id: user.id, email: user.email });
  }

  /**
   * 429 with `Retry-After` when the caller has spent their allowance.
   *
   * A REAL 4xx, unlike the provider failures these endpoints report as 200
   * payloads: the request was REFUSED rather than attempted, so there is no
   * diagnosis to return and nothing is audited. Fastify, not Express —
   * `reply.header()`, never `res.set()`.
   */
  private enforceThrottle(
    bucket: ThrottleBucket,
    userId: string,
    reply: FastifyReply,
  ): void {
    const decision = this.throttle.check(bucket, userId);
    if (decision.allowed) return;

    reply.header('Retry-After', String(decision.retryAfterSeconds));

    throw new HttpException(
      {
        message: `Too many test attempts. Try again in ${decision.retryAfterSeconds} s.`,
        details: { retryAfterSeconds: decision.retryAfterSeconds },
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
