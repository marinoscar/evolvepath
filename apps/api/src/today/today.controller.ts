import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CheckInService } from './check-in/check-in.service';
import { DayReflectionService } from './reflection/day-reflection.service';
import { TodayInsightService } from './insight/today-insight.service';
import { TodayService } from './today.service';
import type { TodayInsight, TodayResponse } from './today.schema';
import { CheckInResponseDto, UpsertCheckInDto } from './dto/check-in.dto';
import {
  CreateDayReflectionDto,
  DayReflectionResponseDto,
} from './dto/day-reflection.dto';
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
    private readonly checkIns: CheckInService,
    private readonly reflections: DayReflectionService,
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

  @Post('check-in')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Record how today feels',
    description:
      'One tap, one field (PRD §73). **Upsert, not insert**: the question is asked once a day ' +
      'and the answer can change — a morning that started fine can become a packed afternoon — ' +
      "so a history of taps would be noise. Filed under the user's own local date, and it " +
      "invalidates today's cached coach insight.",
  })
  @ApiResponse({ status: 200, type: CheckInResponseDto })
  async upsertCheckIn(
    @CurrentUser('id') userId: string,
    @Body() dto: UpsertCheckInDto,
  ): Promise<CheckInResponseDto> {
    return this.checkIns.upsert(userId, dto.feel);
  }

  @Get('check-in')
  @Auth()
  @ApiOperation({
    summary: "Today's check-in, or null",
    description: 'Null until the user taps a chip today. Not an error — most days start here.',
  })
  @ApiResponse({ status: 200, type: CheckInResponseDto })
  async getCheckIn(@CurrentUser('id') userId: string): Promise<CheckInResponseDto | null> {
    return this.checkIns.get(userId);
  }

  @Post('reflection')
  @Auth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Note what the day taught (PRD §74)',
    description:
      'A quick option plus optional text, stored as a `Reflection` with `relatedType: "day"`. ' +
      'The option is the structured half — it is what the weekly review groups on — and the ' +
      'text is the user’s own words, which never reach an audit row or a log line. Several per ' +
      'day are allowed; a user may come back with more to say.',
  })
  @ApiResponse({ status: 201, type: DayReflectionResponseDto })
  async createReflection(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateDayReflectionDto,
  ): Promise<DayReflectionResponseDto> {
    return this.reflections.create(userId, dto);
  }

  @Get('reflection')
  @Auth()
  @ApiOperation({ summary: "Today's latest day reflection, or null" })
  @ApiResponse({ status: 200, type: DayReflectionResponseDto })
  async getReflection(
    @CurrentUser('id') userId: string,
  ): Promise<DayReflectionResponseDto | null> {
    return this.reflections.getLatest(userId);
  }
}
