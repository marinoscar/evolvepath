import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ApplySessionPlanDto, PlanSessionsDto } from './dto/plan-sessions.dto';
import {
  WorkSessionPlanningService,
  type AppliedSessionPlan,
  type OutcomeWorkPlanView,
  type WorkSessionPlanProposalView,
} from './work-session-planning.service';

// =============================================================================
// `/outcomes/:id/plan-sessions*` (issue #108, epic E07)
// =============================================================================
//
// Four routes, and the split between the first two is the point: `plan-sessions`
// calls the model, `plan-sessions/template` never can. A single route with a
// `useAi: false` flag would put the decision in a request body, where a client
// bug turns "the coach is down" into "the coach silently got worse".
// =============================================================================

@ApiTags('Work')
@Controller('outcomes/:id')
export class WorkSessionPlanningController {
  constructor(private readonly planning: WorkSessionPlanningService) {}

  @Post('plan-sessions')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Ask the coach to break a work outcome into dated focus sessions',
    description:
      'Writes ONE `work_session_plan_proposals` row and nothing else — no commitment, ' +
      'milestone, routine or plan version exists until `apply` (PRD §15). Any previous ' +
      'pending proposal for the outcome is discarded.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'The proposal, with its id and expiry' })
  @ApiResponse({ status: 400, description: '`OUTCOME_NOT_WORK` or `TARGET_DATE_PAST`' })
  @ApiResponse({ status: 404, description: 'Not found (unknown or not owned by the caller)' })
  @ApiResponse({ status: 412, description: '`AI_KEY_REQUIRED` — bring your own key first' })
  @ApiResponse({
    status: 503,
    description: '`AI_UNAVAILABLE` with `details.retryable`; use the template route instead',
  })
  async propose(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) outcomeId: string,
    @Body() dto: PlanSessionsDto,
  ): Promise<WorkSessionPlanProposalView> {
    return this.planning.propose(userId, outcomeId, dto);
  }

  @Post('plan-sessions/template')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'A standard weekday plan, with no model involved',
    description:
      'PRD §120: the deterministic path. Evenly spaced weekday sessions at 09:00 local up ' +
      'to the target date. Applied exactly like an AI proposal, and recorded as ' +
      '`source: TEMPLATE`.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'The proposal, with its id and expiry' })
  @ApiResponse({ status: 400, description: '`OUTCOME_NOT_WORK` or `TARGET_DATE_PAST`' })
  async proposeTemplate(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) outcomeId: string,
    @Body() dto: PlanSessionsDto,
  ): Promise<WorkSessionPlanProposalView> {
    return this.planning.proposeTemplate(userId, outcomeId, dto);
  }

  @Post('plan-sessions/apply')
  @Auth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Apply a proposed session plan',
    description:
      'The PRD §15 approval step, and the only path that turns a proposal into milestones, ' +
      'a routine and commitments. Atomic. An edited `proposal` is re-validated against the ' +
      'same guardrails the model was held to.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 201, description: 'The ids that were created' })
  @ApiResponse({ status: 400, description: '`PROPOSAL_INVALID` with `details.rules[]`' })
  @ApiResponse({ status: 404, description: 'Unknown outcome or proposal' })
  @ApiResponse({ status: 409, description: '`PROPOSAL_NOT_PENDING` — applied, discarded or expired' })
  async apply(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) outcomeId: string,
    @Body() dto: ApplySessionPlanDto,
  ): Promise<AppliedSessionPlan> {
    return this.planning.apply(userId, outcomeId, dto);
  }

  @Get('work-plan')
  @Auth()
  @ApiOperation({
    summary: "A work outcome's milestones, planned sessions and implementation intention",
    description:
      'The intention and the review cadence are read from the plan the user APPLIED, not ' +
      'the one that was proposed — an edited "when" is the one they agreed to.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Milestones in order, with their sessions' })
  @ApiResponse({ status: 400, description: '`OUTCOME_NOT_WORK`' })
  @ApiResponse({ status: 404, description: 'Not found (unknown or not owned by the caller)' })
  async workPlan(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) outcomeId: string,
  ): Promise<OutcomeWorkPlanView> {
    return this.planning.getWorkPlan(userId, outcomeId);
  }
}
