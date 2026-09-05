import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import {
  NotificationMetricsDto,
  NotificationMetricsQueryDto,
} from './dto/notification-metrics.dto';
import type { NotificationMetrics } from './notification-metrics';
import { NotificationMetricsService } from './notification-metrics.service';

@ApiTags('Coaching Notifications')
@Controller('notifications/metrics')
export class NotificationMetricsController {
  constructor(private readonly metrics: NotificationMetricsService) {}

  @Get()
  @Auth()
  @ApiOperation({
    summary: 'What the coach has learned about its own messages',
    description:
      'Per-category sends, opens, actions, dismissals and suppressions with their reasons; ' +
      'the independence metric (PRD §65 — completions that needed no reminder); the ' +
      'month-by-month reminder trend; and up to three deterministic sentences drawn from ' +
      'them. Read in the direction of "can we stop?", not "how do we get more clicks?" — ' +
      'a coach that is working needs to say less over time (VISION §38).',
  })
  @ApiResponse({ status: 200, type: NotificationMetricsDto })
  async get(
    @CurrentUser('id') userId: string,
    @Query() query: NotificationMetricsQueryDto,
  ): Promise<NotificationMetrics> {
    return this.metrics.get(userId, { days: query.days });
  }
}
