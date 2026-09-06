import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { WorkSummaryQueryDto } from './dto/work-summary-query.dto';
import { WorkSummaryService } from './work-summary.service';
import type { WorkWeeklySummary } from './work-summary.aggregator';

@ApiTags('Work')
@Controller('work')
export class WorkSummaryController {
  constructor(private readonly summary: WorkSummaryService) {}

  @Get('summary')
  @Auth()
  @ApiOperation({
    summary: "The work week, as numbers (PRD §29)",
    description:
      'Deterministic and AI-free. E10\'s weekly reviewer reads these counts, which is why they ' +
      'are computed here: a provider outage must change the words and never the numbers. Rates ' +
      'are `null` rather than 0 when nothing was planned — "nothing planned" and "nothing done" ' +
      'are different weeks.',
  })
  @ApiQuery({
    name: 'weekStart',
    required: false,
    description: "The user's local Monday as YYYY-MM-DD. Defaults to the current week.",
  })
  @ApiResponse({ status: 200, description: 'The week' })
  @ApiResponse({
    status: 400,
    description: '`WEEK_START_NOT_MONDAY` or `INVALID_WEEK_START`',
  })
  async week(
    @CurrentUser('id') userId: string,
    @Query() query: WorkSummaryQueryDto,
  ): Promise<WorkWeeklySummary> {
    return this.summary.getWeek(userId, query.weekStart);
  }
}
