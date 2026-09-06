import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApproveOnboardingDto } from './dto/approve-onboarding.dto';
import { ConfidenceDto } from './dto/confidence.dto';
import { PatchAnswersDto } from './dto/patch-answers.dto';
import { StartOnboardingDto } from './dto/start-onboarding.dto';
import { OnboardingService } from './onboarding.service';
import type {
  ApprovedPath,
  ConfidenceResponse,
  OnboardingState,
  ProposalResponse,
} from './onboarding.types';

// =============================================================================
// `/onboarding` (issue #101, epic E04)
// =============================================================================
//
// SEVEN ROUTES, ALL PLAIN `@Auth()`. There is no permission to check: the row
// is the caller's own, addressed by the id on their token and never by a body
// field, so there is no such thing as somebody else's onboarding to protect.
//
// `propose` and `skip-ai` are separate routes for the reason E07's planner is:
// a `useAi: false` flag in a body puts "should the coach have been asked?" into
// a client, where a bug turns "the provider is down" into "the coach silently
// got worse".
// =============================================================================

@ApiTags('Onboarding')
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get()
  @Auth()
  @ApiOperation({
    summary: 'The onboarding state this user resumes from',
    description:
      'The saved answers, the step the client was last on, and the pending proposal if the ' +
      'user has asked for one. Safe to call on every boot of the wizard.',
  })
  @ApiResponse({ status: 200, description: 'The state' })
  async getState(@CurrentUser('id') userId: string): Promise<OnboardingState> {
    return this.onboarding.getState(userId);
  }

  @Post('start')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Begin onboarding, recording the timezone everything is scheduled in',
  })
  @ApiResponse({ status: 200, description: 'The state, now on `VISION`' })
  @ApiResponse({ status: 400, description: '`INVALID_TIMEZONE`' })
  @ApiResponse({ status: 409, description: '`ONBOARDING_ALREADY_COMPLETED`' })
  async start(
    @CurrentUser('id') userId: string,
    @Body() dto: StartOnboardingDto,
  ): Promise<OnboardingState> {
    return this.onboarding.start(userId, dto);
  }

  @Patch('answers')
  @Auth()
  @ApiOperation({
    summary: 'Save one step of answers',
    description:
      'A merge patch: an absent key is left alone. `step` records where the client now is; ' +
      "`DONE` is rejected because completion is approve's to declare. Unknown keys are a 400.",
  })
  @ApiResponse({ status: 200, description: 'The merged state' })
  @ApiResponse({ status: 400, description: 'An unknown key or an invalid answer' })
  @ApiResponse({ status: 409, description: '`ONBOARDING_ALREADY_COMPLETED`' })
  async patchAnswers(
    @CurrentUser('id') userId: string,
    @Body() dto: PatchAnswersDto,
  ): Promise<OnboardingState> {
    return this.onboarding.patchAnswers(userId, dto);
  }

  @Post('propose')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Ask the coach for a first Path',
    description:
      'Stores the proposal on the profile and NOWHERE ELSE — `outcomes`, `plans`, `routines` ' +
      'and `commitments` gain no rows until approve (PRD §15).',
  })
  @ApiResponse({ status: 200, description: 'The proposal, with `source: "ai"`' })
  @ApiResponse({ status: 400, description: '`ONBOARDING_INCOMPLETE`' })
  @ApiResponse({ status: 409, description: '`ONBOARDING_ALREADY_COMPLETED`' })
  @ApiResponse({ status: 412, description: '`AI_KEY_REQUIRED` — bring your own key first' })
  @ApiResponse({
    status: 503,
    description: '`AI_UNAVAILABLE` with `details.retryable`; use `skip-ai` instead',
  })
  async propose(@CurrentUser('id') userId: string): Promise<ProposalResponse> {
    return this.onboarding.propose(userId);
  }

  @Post('skip-ai')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'A starting Path with no model involved',
    description:
      'PRD §120: the flow completes with the provider down. Deterministic, held to the same ' +
      'guardrails the model is, and honest in its own rationale about being a template.',
  })
  @ApiResponse({ status: 200, description: 'The proposal, with `source: "template"`' })
  @ApiResponse({ status: 400, description: '`ONBOARDING_INCOMPLETE` or `PROPOSAL_INVALID`' })
  @ApiResponse({ status: 409, description: '`ONBOARDING_ALREADY_COMPLETED`' })
  async skipAi(@CurrentUser('id') userId: string): Promise<ProposalResponse> {
    return this.onboarding.skipAi(userId);
  }

  @Post('confidence')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Answer "could you do this in a difficult week?"',
    description:
      'PRD §72. 1 or 2 replaces the pending proposal with a smaller one — re-proposed by the ' +
      'coach when the plan came from the coach, reduced arithmetically when it came from the ' +
      'template. 3 and above stores the score and changes nothing.',
  })
  @ApiResponse({ status: 200, description: 'The proposal and whether it was replaced' })
  @ApiResponse({ status: 400, description: '`NO_PENDING_PROPOSAL`' })
  @ApiResponse({ status: 409, description: '`ONBOARDING_ALREADY_COMPLETED`' })
  @ApiResponse({ status: 412, description: '`AI_KEY_REQUIRED`' })
  @ApiResponse({ status: 503, description: '`AI_UNAVAILABLE`' })
  async confidence(
    @CurrentUser('id') userId: string,
    @Body() dto: ConfidenceDto,
  ): Promise<ConfidenceResponse> {
    return this.onboarding.confidence(userId, dto.score);
  }

  @Post('approve')
  @Auth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Approve the plan and build the Path',
    description:
      'The PRD §15 approval step, and the only path that turns this proposal into rows. One ' +
      'transaction: Best Self, one outcome + plan + ACTIVE v1 per domain, the routines, the ' +
      "first week's commitments, GROW domain modes, and the profile marked done.",
  })
  @ApiResponse({ status: 201, description: 'The ids that were created' })
  @ApiResponse({ status: 400, description: '`PROPOSAL_INVALID` with `details.rules[]`' })
  @ApiResponse({ status: 409, description: '`ONBOARDING_ALREADY_COMPLETED`' })
  async approve(
    @CurrentUser('id') userId: string,
    @Body() dto: ApproveOnboardingDto,
  ): Promise<ApprovedPath> {
    return this.onboarding.approve(userId, dto.proposal);
  }
}
