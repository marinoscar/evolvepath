import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { BehaviourLintService } from './behaviour-lint.service';
import { RitualsService, type RitualWithUpcoming } from './rituals.service';
import {
  CreateRitualDto,
  RitualQueryDto,
  RitualResponseDto,
  UpdateRitualDto,
} from './dto/ritual.dto';
import { LintResultDto, LintTitleDto, MaterializeResultDto } from './dto/lint.dto';

@ApiTags('Family')
@Controller('family')
export class RitualsController {
  constructor(
    private readonly rituals: RitualsService,
    private readonly lint: BehaviourLintService,
  ) {}

  @Get('rituals')
  @Auth()
  @ApiOperation({
    summary: 'List your rituals',
    description: 'Active first, then alphabetically, so a paused ritual never leads the list.',
  })
  @ApiResponse({ status: 200, type: [RitualResponseDto] })
  async list(
    @CurrentUser('id') userId: string,
    @Query() query: RitualQueryDto,
  ): Promise<RitualResponseDto[]> {
    return this.rituals.list(userId, query);
  }

  @Post('rituals')
  @Auth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a ritual',
    description:
      'The behaviour lint runs BEFORE any write: a title describing someone else’s feelings or ' +
      'conduct is refused with 400 and leaves nothing behind. On success the next seven days of ' +
      'occurrences are materialized synchronously, so they are on Today before the response ' +
      'returns.',
  })
  @ApiResponse({ status: 201, type: RitualResponseDto })
  @ApiResponse({
    status: 400,
    description: '`BEHAVIOUR_TARGETS_OTHER_PERSON` or `MINIMUM_EXCEEDS_IDEAL` in `details.reason`',
  })
  @ApiResponse({ status: 404, description: 'The family member or outcome is not yours' })
  @ApiResponse({ status: 409, description: 'The outcome has no active plan version' })
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateRitualDto,
  ): Promise<RitualResponseDto> {
    return this.rituals.create(userId, dto);
  }

  @Get('rituals/:id')
  @Auth()
  @ApiOperation({
    summary: 'Get one ritual with its next seven days',
    description: '`upcoming` carries the same commitment cards the Today screen renders.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, type: RitualResponseDto })
  @ApiResponse({ status: 404, description: 'No such ritual, or not yours' })
  async get(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RitualWithUpcoming> {
    return this.rituals.get(userId, id);
  }

  @Patch('rituals/:id')
  @Auth()
  @ApiOperation({
    summary: 'Update a ritual',
    description:
      'Changing the title, recurrence, durations or fallback CANCELS the future `PLANNED` and ' +
      '`READY` occurrences through the transition matrix and materializes the new ones. Rows ' +
      'the user has already touched — started, moved, completed, skipped — are never rewritten, ' +
      'and nothing is deleted. `active: false` cancels the future occurrences and stops the ' +
      'nightly materializer for this ritual.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, type: RitualResponseDto })
  @ApiResponse({ status: 400, description: 'Lint refusal or `MINIMUM_EXCEEDS_IDEAL`' })
  @ApiResponse({ status: 404, description: 'No such ritual, or not yours' })
  async update(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRitualDto,
  ): Promise<RitualResponseDto> {
    return this.rituals.update(userId, id, dto);
  }

  @Delete('rituals/:id')
  @Auth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a ritual',
    description:
      'Future occurrences are cancelled; past ones keep their place on the record with ' +
      '`ritualId` set to null. A linked routine stays on the Path — it is what the plan used ' +
      'to say.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  async remove(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.rituals.remove(userId, id);
  }

  @Post('rituals/:id/materialize')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Create any missing occurrences now',
    description:
      'Idempotent. The unique `(ritual_id, scheduled_start)` index turns a repeat into ' +
      '`skipped`, so calling this twice is safe and calling it after the nightly run is a no-op.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, type: MaterializeResultDto })
  async materialize(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MaterializeResultDto> {
    return this.rituals.materialize(userId, id);
  }

  @Post('lint')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Check a commitment title, and offer a rewrite',
    description:
      'Always 200 — this is a check, not a refusal. The verdict is deterministic (PRD §32) and ' +
      'never depends on AI; `suggestion` is a rephrase the user may accept, is re-linted before ' +
      'being offered, and is `null` with `source: "none"` whenever the provider is unavailable.',
  })
  @ApiResponse({ status: 200, type: LintResultDto })
  async lintTitle(
    @CurrentUser('id') userId: string,
    @Body() dto: LintTitleDto,
  ): Promise<LintResultDto> {
    return this.lint.checkWithSuggestion(userId, dto.title);
  }
}
