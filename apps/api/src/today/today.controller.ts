import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { TodayInsightService } from './insight/today-insight.service';
import { TodayService } from './today.service';
import type { TodayInsight, TodayResponse } from './today.schema';
import { TodayInsightDto, TodayResponseDto } from './dto/today-response.dto';

/**
 * The signed-in user's day (issue #38, epic E05).
 *
 * Two routes rather than one, and the split is the design: `GET /today` never
 * touches the AI provider, so the whole screen renders when the provider is
 * down. The coach's sentence is a second, optional request.
 */
@ApiTags('Today')
@Controller('today')
export class TodayController {
  constructor(
    private readonly today: TodayService,
    private readonly insight: TodayInsightService,
  ) {}

  @Get()
  @Auth()
  @ApiOperation({
    summary: "The day: next best action, domain cards and today's check-in",
    description:
      'Deterministic and reproducible: two calls with the same data return the same ' +
      'recommendation (PRD §13). **Makes no AI call at all** — PRD §120 requires this screen ' +
      'to work with the provider down, and the guarantee is structural rather than a timeout. ' +
      '`domains` always has three entries in canonical order, including any that are empty or ' +
      'paused; a domain in PAUSE is never the next best action but still gets its card.',
  })
  @ApiResponse({ status: 200, type: TodayResponseDto })
  async getToday(@CurrentUser('id') userId: string): Promise<TodayResponse> {
    return this.today.getToday(userId);
  }

  @Get('insight')
  @Auth()
  @ApiOperation({
    summary: "The coach's sentence about today",
    description:
      'Always **200**. When the coach is unavailable — no key, provider down, a response that ' +
      'fails the schema — this returns a deterministic sentence with `source: "template"` ' +
      'rather than an error, because a coaching card is the wrong place to learn about an ' +
      'expired API key. Cached per user per local day, in process; a check-in invalidates it.',
  })
  @ApiResponse({ status: 200, type: TodayInsightDto })
  async getInsight(@CurrentUser('id') userId: string): Promise<TodayInsight> {
    return this.insight.getInsight(userId);
  }
}
