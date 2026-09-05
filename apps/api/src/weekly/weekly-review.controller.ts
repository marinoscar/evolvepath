import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { TestThrottle } from '../ai/gateway/test-throttle';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  GenerateReviewDto,
  ReviewQueryDto,
  WeeklyReviewDetailDto,
  WeeklyReviewSummaryDto,
} from './dto/weekly-review.dtos';
import { WeeklyReviewService } from './weekly-review.service';

/**
 * The week, compared against its plan (epic E10).
 *
 * Generation is throttled because it costs the user's own key and clicking
 * "Regenerate" twice cannot produce a materially different week.
 */
@ApiTags('Weekly Review')
@Controller('weekly/reviews')
export class WeeklyReviewController {
  constructor(
    private readonly reviews: WeeklyReviewService,
    private readonly throttle: TestThrottle,
  ) {}

  @Post('generate')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Prepare the review for one week',
    description:
      'Aggregates the week deterministically, then asks the coach to read those numbers back ' +
      'as the six PRD §14.6 outputs. **Always produces a review**: when the provider is ' +
      'unreachable or the user has no key, `aiSummary.source` is `"template"` and the numbers ' +
      'are unchanged (PRD §120). Any plan change the coach proposes becomes a ' +
      '`plan_change_proposals` row — this endpoint never writes a plan version (PRD §15). ' +
      'Omitting `weekStart` reviews last week on Monday and Tuesday and the week in progress ' +
      'from Wednesday onward.',
  })
  @ApiResponse({ status: 200, type: WeeklyReviewDetailDto })
  @ApiResponse({ status: 400, description: '`INVALID_WEEK_START` — not a Monday' })
  @ApiResponse({
    status: 409,
    description: '`WEEKLY_REVIEW_APPROVED` or `WEEKLY_REVIEW_IN_PROGRESS`',
  })
  @ApiResponse({ status: 429, description: 'Five generations per hour per user' })
  async generate(
    @CurrentUser('id') userId: string,
    @Body() dto: GenerateReviewDto,
  ): Promise<WeeklyReviewDetailDto> {
    const decision = this.throttle.check('weekly_review', userId);

    if (!decision.allowed) {
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message: 'This week was reviewed recently. Try again shortly.',
          retryAfterSeconds: decision.retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return this.reviews.generate(userId, { weekStart: dto.weekStart, trigger: 'manual' });
  }

  @Get()
  @Auth()
  @ApiOperation({ summary: 'Your reviews, newest week first' })
  @ApiResponse({ status: 200, type: [WeeklyReviewSummaryDto] })
  async list(
    @CurrentUser('id') userId: string,
    @Query() query: ReviewQueryDto,
  ): Promise<{ items: WeeklyReviewSummaryDto[] }> {
    return { items: await this.reviews.list(userId, query) };
  }

  @Get('current')
  @Auth()
  @ApiOperation({
    summary: 'The most recent review, or null',
    description: 'Null rather than 404 for a user who has never had one — an empty screen is a state, not an error.',
  })
  @ApiResponse({ status: 200, type: WeeklyReviewDetailDto })
  async current(@CurrentUser('id') userId: string): Promise<WeeklyReviewDetailDto | null> {
    return this.reviews.current(userId);
  }

  @Get(':id')
  @Auth()
  @ApiOperation({
    summary: 'One review',
    description: "Another user's review id answers 404, indistinguishable from one that never existed.",
  })
  @ApiResponse({ status: 200, type: WeeklyReviewDetailDto })
  @ApiResponse({ status: 404, description: 'Not yours, or not there' })
  async get(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WeeklyReviewDetailDto> {
    return this.reviews.get(userId, id);
  }

  @Post(':id/skip')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Skip this week',
    description:
      'A week the user chooses not to review is a legitimate answer, and recording it is how ' +
      'the product avoids nagging about a review that is never coming.',
  })
  @ApiResponse({ status: 200, type: WeeklyReviewSummaryDto })
  @ApiResponse({ status: 409, description: '`WEEKLY_REVIEW_NOT_SKIPPABLE`' })
  async skip(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WeeklyReviewSummaryDto> {
    return this.reviews.skip(userId, id);
  }
}
