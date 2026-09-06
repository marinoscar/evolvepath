import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ProgressResponseDto } from './dto/progress-response.dto';
import { ProgressService } from './progress.service';
import type { ProgressResponse } from './progress.schema';
import { MilestoneDto, MilestoneListDto } from './milestones/dto/milestone-response.dto';
import { MilestonesService, type MilestoneView } from './milestones/milestones.service';
import { TimelineQueryDto } from './timeline/dto/timeline-query.dto';
import { TimelineResponseDto } from './timeline/dto/timeline-response.dto';
import { TimelineService } from './timeline/timeline.service';
import type { TimelineEvent } from './timeline/timeline-builder';

/**
 * The Progress screen's API (issue #98, epic E11).
 *
 * Own data only, and there is no id in the path — a user reads their own
 * evolution or nobody's.
 */
@ApiTags('Progress')
@Controller('progress')
export class ProgressController {
  constructor(
    private readonly progress: ProgressService,
    private readonly timeline: TimelineService,
    private readonly milestones: MilestonesService,
  ) {}

  @Get()
  @Auth()
  @ApiOperation({
    summary: 'Momentum per domain, the consistency run, recovery and insights',
    description:
      'Deterministic and AI-free (PRD §53, §120): the same data produces the same states, and ' +
      'the screen renders with the provider down. Every number is a COUNT — there is no score, ' +
      'no percentage and no `/100` anywhere in this payload (PRD P13, §54). The engine compares ' +
      'ratios internally to detect a trend and deliberately does not serialise them.',
  })
  @ApiResponse({ status: 200, type: ProgressResponseDto })
  async getProgress(@CurrentUser('id') userId: string): Promise<ProgressResponse> {
    return this.progress.getProgress(userId);
  }

  @Get('timeline')
  @Auth()
  @ApiOperation({
    summary: 'What actually happened, newest first',
    description:
      'MEANINGFUL events only (PRD §76). The evidence table also records pauses, continues, ' +
      'reschedules and fallback selections; a timeline that showed them would be a log rather ' +
      'than a story, so the mapping is a whitelist and a row with no rule produces no event. ' +
      'A range over 186 days is a 400 rather than a silent truncation.',
  })
  @ApiResponse({ status: 200, type: TimelineResponseDto })
  async getTimeline(
    @CurrentUser('id') userId: string,
    @Query() query: TimelineQueryDto,
  ): Promise<{ items: TimelineEvent[]; nextCursor: string | null }> {
    return this.timeline.getTimeline(userId, query);
  }

  @Get('milestones')
  @Auth()
  @ApiOperation({
    summary: 'What this user has reached',
    description:
      'Newest first, at most 50. `unacknowledged=true` returns only what the user has not been ' +
      'shown yet — PRD §77 celebrates once, not on every load.',
  })
  @ApiResponse({ status: 200, type: MilestoneListDto })
  async getMilestones(
    @CurrentUser('id') userId: string,
    @Query('unacknowledged') unacknowledged?: string,
  ): Promise<{ items: MilestoneView[] }> {
    return {
      items: await this.milestones.list(userId, {
        unacknowledged: unacknowledged === 'true',
      }),
    };
  }

  @Post('milestones/:id/ack')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark a milestone as seen',
    description:
      'Idempotent. A foreign or unknown id answers 404 — identical answers, deliberately.',
  })
  @ApiResponse({ status: 200, type: MilestoneDto })
  async acknowledge(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MilestoneView> {
    return this.milestones.acknowledge(userId, id);
  }
}
