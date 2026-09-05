import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { MemoryInsightCategory } from '@prisma/client';

import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { TestThrottle } from '../../ai/gateway/test-throttle';
import { MemoryInsightsService } from './memory-insights.service';
import { PatternAnalysisService } from './pattern-analysis.service';
import {
  CreateMemoryInsightDto,
  MemoryInsightDto,
  MemoryInsightListDto,
  ProposeInsightsResponseDto,
  SetDoNotUseDto,
  UpdateMemoryInsightDto,
} from './dto/memory-insight.dto';

/**
 * PRD §85's three controls, as routes: Edit, Forget, Don't use for coaching.
 *
 * Everything here is the user's own data and nobody else's — an id that is not
 * yours answers 404, the same as one that never existed.
 */
@ApiTags('Memory Insights')
@Controller('memory-insights')
export class MemoryInsightsController {
  constructor(
    private readonly insights: MemoryInsightsService,
    private readonly analysis: PatternAnalysisService,
    private readonly throttle: TestThrottle,
  ) {}

  @Get()
  @Auth()
  @ApiOperation({
    summary: 'What the coach remembers about you',
    description:
      'Ordered by category, then confirmed first, then confidence. Excluded insights are ' +
      'hidden unless you ask for them — they still exist, and the settings page shows them.',
  })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'includeDoNotUse', required: false, type: Boolean })
  @ApiResponse({ status: 200, type: MemoryInsightListDto })
  async list(
    @CurrentUser('id') userId: string,
    @Query('category') category?: MemoryInsightCategory,
    @Query('includeDoNotUse') includeDoNotUse?: string,
  ): Promise<MemoryInsightListDto> {
    return {
      items: await this.insights.list(userId, {
        category,
        includeDoNotUse: includeDoNotUse === 'true',
      }),
    };
  }

  @Post()
  @Auth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Tell the coach something about yourself',
    description:
      'Stored confirmed, at full confidence and with no evidence count: something the user ' +
      'typed about themselves is confirmed by having been typed.',
  })
  @ApiResponse({ status: 201, type: MemoryInsightDto })
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateMemoryInsightDto,
  ): Promise<MemoryInsightDto> {
    return this.insights.create(userId, dto);
  }

  @Patch(':id')
  @Auth()
  @ApiOperation({
    summary: 'Reword an insight (PRD §85 Edit)',
    description:
      'Editing an AI guess is how a user says "this, but in my words" — so it confirms it. ' +
      'Leaving it unconfirmed would mean the coach still ignored the sentence they just wrote.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, type: MemoryInsightDto })
  async update(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMemoryInsightDto,
  ): Promise<MemoryInsightDto> {
    return this.insights.update(userId, id, dto.statement);
  }

  @Post(':id/confirm')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Yes, that is true about me',
    description: 'The coach uses confirmed insights and no others (PRD §10.12).',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, type: MemoryInsightDto })
  async confirm(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MemoryInsightDto> {
    return this.insights.confirm(userId, id);
  }

  @Post(':id/do-not-use')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Don't use this for coaching",
    description:
      'A different question from confirmation: an insight can be both true and something ' +
      'the user does not want coached on. It stays visible here and leaves every prompt.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, type: MemoryInsightDto })
  async setDoNotUse(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetDoNotUseDto,
  ): Promise<MemoryInsightDto> {
    return this.insights.setDoNotUse(userId, id, dto.doNotUse);
  }

  @Delete(':id')
  @Auth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Forget this (PRD §85, §127)',
    description:
      'A hard delete. The audit row records the category and nothing else — the user asked ' +
      'us to forget the sentence, and copying it into an audit table is not forgetting it.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Forgotten' })
  async remove(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.insights.remove(userId, id);
  }

  @Post('propose')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Ask the coach what it has noticed',
    description:
      'Reads 28 days of aggregated counts — no titles, no text, no names — and proposes at ' +
      'most five unconfirmed insights. Always a 200: too little history is `insufficient_data` ' +
      'and a provider outage is `ai_unavailable`, and neither is a broken screen.',
  })
  @ApiResponse({ status: 200, type: ProposeInsightsResponseDto })
  @ApiResponse({ status: 429, description: 'One run per ten minutes per user' })
  async propose(
    @CurrentUser('id') userId: string,
  ): Promise<ProposeInsightsResponseDto> {
    const decision = this.throttle.check('memory_propose', userId);

    if (!decision.allowed) {
      // Clicking it twice cannot produce a different answer, so the bound is
      // about the cost of the run rather than the pace of the UI.
      throw new HttpException(
        {
          code: 'too_many_requests',
          message: 'Insights were proposed recently. Try again shortly.',
          retryAfterSeconds: decision.retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return this.analysis.proposeInsights(userId);
  }
}
