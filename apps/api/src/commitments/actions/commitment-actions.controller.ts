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
import type { CommitmentCard } from '../commitment-card.schema';
import {
  ApplyDecompositionDto,
  type DecompositionProposal,
} from '../decomposition/decomposition.schema';
import {
  CompleteActionDto,
  ContinueActionDto,
  DecomposeActionDto,
  FallbackActionDto,
  RescheduleActionDto,
  SkipActionDto,
  StartActionDto,
} from '../dto/commitment-action.dtos';
import {
  CommitmentCardDto,
  DecompositionProposalDto,
  StartContextDto,
} from '../dto/commitment-card.dto';
import type { StartContext } from '../commitment-card.schema';
import { CommitmentActionsService } from './commitment-actions.service';

/**
 * The verbs (issue #40, epic E05).
 *
 * Shares E02's `Commitments` tag: to a reader of the reference these are the
 * same resource, and a separate section would suggest a separate thing.
 *
 * Every route answers **404** for an id that is not the caller's — identical to
 * one that never existed, because a 403 would confirm the id is real.
 */
@ApiTags('Commitments')
@Controller('commitments/:id/actions')
@ApiParam({ name: 'id', type: String, format: 'uuid' })
@ApiResponse({ status: 404, description: 'No such commitment for this user' })
export class CommitmentActionsController {
  constructor(private readonly actions: CommitmentActionsService) {}

  @Get()
  @Auth()
  @ApiOperation({
    summary: 'The card, plus why this matters',
    description:
      'What an execution screen needs and nothing else: the same `CommitmentCard` every action ' +
      'below returns, plus the outcome’s motivation. Separate from `GET /commitments/{id}`, ' +
      'which is the RECORD — every column, its evidence and its reflections. Two shapes on one ' +
      'screen is how a UI drifts from an API, so the Start flow reads exactly one.',
  })
  @ApiResponse({ status: 200, type: StartContextDto })
  async getCard(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StartContext> {
    return this.actions.getCard(userId, id);
  }

  @Post('start')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Start the timer',
    description:
      'Records the start as evidence in its own right (PRD P4). A start on a paused ' +
      'commitment resumes it rather than erroring — to a user there is one button. Any other ' +
      'timer the user left running is paused first: one running timer per user.',
  })
  @ApiResponse({ status: 200, type: CommitmentCardDto })
  @ApiResponse({ status: 409, description: 'INVALID_TRANSITION — the commitment is closed' })
  async start(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StartActionDto,
  ): Promise<CommitmentCard> {
    return this.actions.start(userId, id, dto);
  }

  @Post('pause')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Pause the timer',
    description:
      'Banks the running time. The status stays STARTED — paused is STARTED with no ' +
      '`activeSince`, because PRD §10.7 owns the status enum and has no PAUSED member.',
  })
  @ApiResponse({ status: 200, type: CommitmentCardDto })
  async pause(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CommitmentCard> {
    return this.actions.pause(userId, id);
  }

  @Post('continue')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resume the timer, optionally adding minutes',
    description: '`extraMinutes` is the "Continue another 15?" prompt; it extends the target.',
  })
  @ApiResponse({ status: 200, type: CommitmentCardDto })
  async continue(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ContinueActionDto,
  ): Promise<CommitmentCard> {
    return this.actions.continue(userId, id, dto);
  }

  @Post('complete')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark it done',
    description:
      'Legal without ever starting: most of what a user does happens away from the app, and ' +
      'the alternative is manufacturing a start the product never observed. `minutesSpent` ' +
      "defaults to the timer's active seconds.",
  })
  @ApiResponse({ status: 200, type: CommitmentCardDto })
  async complete(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteActionDto,
  ): Promise<CommitmentCard> {
    return this.actions.complete(userId, id, dto);
  }

  @Post('partial')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark it partly done',
    description: 'A different fact from completion, and PRD §101 wants it recorded as one.',
  })
  @ApiResponse({ status: 200, type: CommitmentCardDto })
  async partial(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteActionDto,
  ): Promise<CommitmentCard> {
    return this.actions.partial(userId, id, dto);
  }

  @Post('fallback')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Switch to the short or minimum version',
    description:
      'No status change — the user has told the product which size they are attempting, and ' +
      'PRD §101 wants that decision recorded at the moment it is made.',
  })
  @ApiResponse({ status: 200, type: CommitmentCardDto })
  @ApiResponse({ status: 400, description: 'VERSION_NOT_DEFINED — that size was never declared' })
  async fallback(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FallbackActionDto,
  ): Promise<CommitmentCard> {
    return this.actions.fallback(userId, id, dto);
  }

  @Post('reschedule')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Move it',
    description:
      'Returns the card of a **new** commitment. RESCHEDULED is terminal, so the original ' +
      'closes as history and a fresh PLANNED row carries the intention forward with ' +
      '`rescheduleCount + 1`. Use the returned id from here on — the original is now terminal.',
  })
  @ApiResponse({ status: 200, type: CommitmentCardDto })
  @ApiResponse({ status: 409, description: 'ALREADY_STARTED — complete it or skip it instead' })
  async reschedule(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RescheduleActionDto,
  ): Promise<CommitmentCard> {
    return this.actions.reschedule(userId, id, dto);
  }

  @Post('skip')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Skip it, with a reason',
    description:
      'Writes a reflection, not evidence: a skip is not execution. The reason becomes a ' +
      'friction tag (PRD P5 — a failed plan is information).',
  })
  @ApiResponse({ status: 200, type: CommitmentCardDto })
  async skip(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SkipActionDto,
  ): Promise<CommitmentCard> {
    return this.actions.skip(userId, id, dto);
  }

  @Post('decompose')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Ask the coach to break it into smaller steps',
    description:
      'MUTATES NOTHING. Returns a proposal the user accepts, edits or ignores (PRD §15). ' +
      'Answers 200 with `source: "template"` when the coach is unavailable — PRD §120 ' +
      'requires the deterministic path to keep working.',
  })
  @ApiResponse({ status: 200, type: DecompositionProposalDto })
  async decompose(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecomposeActionDto,
  ): Promise<DecompositionProposal> {
    return this.actions.propose(userId, id, dto.hint);
  }

  @Post('decompose/apply')
  @Auth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Accept a decomposition',
    description:
      "Creates a new commitment from the proposal's first step, linked by `decomposedFromId`. " +
      'The original is left alone: it is still in the plan, and the small one is today’s move.',
  })
  @ApiResponse({ status: 201, type: CommitmentCardDto })
  async applyDecomposition(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApplyDecompositionDto,
  ): Promise<CommitmentCard> {
    return this.actions.applyDecomposition(userId, id, dto);
  }
}
