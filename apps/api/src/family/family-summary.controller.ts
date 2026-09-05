import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { FamilySummaryService } from './family-summary.service';
import { FamilySummaryDto, FamilySummaryQueryDto } from './dto/family-summary.dto';
import type { FamilySummary } from './family-summary.schema';

@ApiTags('Family')
@Controller('family/summary')
export class FamilySummaryController {
  constructor(private readonly summary: FamilySummaryService) {}

  @Get()
  @Auth()
  @ApiOperation({
    summary: 'Planned versus kept, per ritual, per week',
    description:
      'PRD §35 permits "Planned family commitments: 4 / Kept: 3" and nothing more. The payload ' +
      'is integers: there is no ratio, no percentage and no streak, because a "kept %" sorts, ' +
      'can go down, and invites a colour scale — which is the gamified judgement PRD §35 rules ' +
      'out. A consumer that wants the ratio can divide.',
  })
  @ApiResponse({ status: 200, type: FamilySummaryDto })
  @ApiResponse({
    status: 400,
    description: '`details.reason = "WEEK_START_NOT_MONDAY"` when `weekStart` is not a Monday',
  })
  async get(
    @CurrentUser('id') userId: string,
    @Query() query: FamilySummaryQueryDto,
  ): Promise<FamilySummary> {
    return this.summary.getSummary(userId, query);
  }
}
