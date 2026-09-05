import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  ApproveWeeklyPlanDto,
  ApproveWeeklyPlanResultDto,
  CreateWeeklyPlanDto,
  ProposeWeeklyPlanDto,
  UpdateWeeklyPlanDto,
  WeeklyPlanDetailDto,
  WeeklyPlanSummaryDto,
} from './dto/weekly-plan.dtos';
import { WeeklyPlanService } from './weekly-plan.service';

/**
 * PRD §50's seven-step flow, as a draft row that is patched step by step
 * (epic E10).
 *
 * Deterministic throughout: no route in this controller calls a model.
 */
@ApiTags('Weekly Planning')
@Controller('weekly/plans')
export class WeeklyPlanController {
  constructor(private readonly plans: WeeklyPlanService) {}

  @Post()
  @ApiOperation({
    summary: 'Start (or resume) next week',
    description:
      'Idempotent: a second call returns the existing DRAFT rather than a second one, because ' +
      'the wizard calls this on mount and a refresh must not fork the week. **201** for a new ' +
      'draft, **200** when an existing one is returned. `domainModes` opens on the postures the ' +
      'user is in today, so changing nothing keeps what they had.',
  })
  @ApiResponse({ status: 201, type: WeeklyPlanDetailDto })
  @ApiResponse({ status: 400, description: '`INVALID_WEEK_START` — not a Monday, or in the past' })
  @ApiResponse({ status: 409, description: '`WEEKLY_PLAN_APPROVED`' })
  @Auth()
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateWeeklyPlanDto,
    @Res({ passthrough: true }) reply: { status: (code: number) => unknown },
  ): Promise<WeeklyPlanDetailDto> {
    const { plan, created } = await this.plans.create(userId, dto);

    reply.status(created ? HttpStatus.CREATED : HttpStatus.OK);

    return plan;
  }

  @Get()
  @Auth()
  @ApiOperation({ summary: 'Your weekly plans, newest week first' })
  @ApiResponse({ status: 200, type: [WeeklyPlanSummaryDto] })
  async list(
    @CurrentUser('id') userId: string,
    @Query('weekStart') weekStart?: string,
  ): Promise<{ items: WeeklyPlanSummaryDto[] }> {
    return { items: await this.plans.list(userId, { weekStart }) };
  }

  @Get(':id')
  @Auth()
  @ApiOperation({
    summary: 'One plan, with its proposal and the review it came from',
    description: "Another user's plan id answers 404, never 403.",
  })
  @ApiResponse({ status: 200, type: WeeklyPlanDetailDto })
  async get(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WeeklyPlanDetailDto> {
    return this.plans.get(userId, id);
  }

  @Patch(':id')
  @Auth()
  @ApiOperation({
    summary: 'Save one step of the flow',
    description:
      'Constraints are replaced whole (removing a travel day has to be expressible); ' +
      'domain modes are merged (naming FAMILY means "leave the other two alone"). Any of ' +
      'these **clears the previous proposal**, which now describes a week nobody asked for.',
  })
  @ApiResponse({ status: 200, type: WeeklyPlanDetailDto })
  @ApiResponse({ status: 409, description: '`WEEKLY_PLAN_NOT_EDITABLE`' })
  async update(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWeeklyPlanDto,
  ): Promise<WeeklyPlanDetailDto> {
    return this.plans.update(userId, id, dto);
  }

  @Post(':id/propose')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'What next week would look like',
    description:
      'Materialises every active routine across the week, applies the constraints and the ' +
      'paused domains, appends the user’s extras, and runs the PRD §48 load check. **No model ' +
      'is called.** An occurrence dropped for a travel day, a colliding fixed event or a paused ' +
      'domain is returned with `include: false` and an `excludedBy` reason rather than omitted: ' +
      'a silently missing Wednesday is indistinguishable from one the product forgot.',
  })
  @ApiResponse({ status: 200, type: WeeklyPlanDetailDto })
  async propose(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ProposeWeeklyPlanDto,
  ): Promise<WeeklyPlanDetailDto> {
    return this.plans.propose(userId, id, dto);
  }

  @Post(':id/approve')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve next week',
    description:
      "Creates one PLANNED commitment per included item, applies the domain modes that " +
      "actually changed, and closes the previous week's review — all in one transaction. " +
      'Idempotent against a retry: an occurrence that already exists is skipped and counted. ' +
      '**422 `LOAD_WARNINGS_UNACKNOWLEDGED`** while warnings are outstanding — the request is ' +
      'well-formed and the state is legal, and what is missing is that the user has read them.',
  })
  @ApiResponse({ status: 200, type: ApproveWeeklyPlanResultDto })
  @ApiResponse({ status: 409, description: '`WEEKLY_PLAN_NOT_EDITABLE` / `WEEKLY_PLAN_NOT_PROPOSED`' })
  @ApiResponse({ status: 422, description: '`LOAD_WARNINGS_UNACKNOWLEDGED`' })
  async approve(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveWeeklyPlanDto,
  ): Promise<ApproveWeeklyPlanResultDto> {
    return this.plans.approve(userId, id, dto);
  }
}
