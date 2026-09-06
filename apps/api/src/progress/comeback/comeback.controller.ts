import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ComebackService } from './comeback.service';
import type { ComebackCompletion, ComebackStatus } from './comeback.schema';
import { ChooseComebackDomainDto, CompleteComebackDto } from './dto/comeback.dto';
import { ComebackCompletionDto, ComebackStatusDto } from './dto/comeback-response.dto';

/**
 * Returning after a pause (issue #112, epic E11).
 *
 * There is no route here that lists what the user missed, and there never
 * should be. PRD §109: overdue items do not flood Today. The sweep turns stale
 * intentions into history and this controller offers exactly one small thing to
 * do next.
 */
@ApiTags('Comeback')
@Controller('comeback')
export class ComebackController {
  constructor(private readonly comeback: ComebackService) {}

  @Get()
  @Auth()
  @ApiOperation({
    summary: 'The open comeback offer, if there is one',
    description:
      'When `state` is `NONE` everything but `state` and `planReviewSuggested` is null or ' +
      'empty. `closedCount` is how many stale intentions the sweep turned into history — a ' +
      'count, never a list.',
  })
  @ApiResponse({ status: 200, type: ComebackStatusDto })
  async get(@CurrentUser('id') userId: string): Promise<ComebackStatus> {
    return this.comeback.getStatus(userId);
  }

  @Post('choose')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Restart in a different part of life',
    description:
      'Cancels the offered restart through the transition matrix and creates one for the ' +
      'named domain. 409 `NO_COMEBACK_OFFER` when nothing is open; 400 when that domain has ' +
      'no active routine to rebuild from.',
  })
  @ApiResponse({ status: 200, type: ComebackStatusDto })
  async choose(
    @CurrentUser('id') userId: string,
    @Body() dto: ChooseComebackDomainDto,
  ): Promise<ComebackStatus> {
    return this.comeback.choose(userId, dto.domain);
  }

  @Post('start')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Take the restart',
    description:
      'Marks the loop `IN_PROGRESS`; the client then navigates to `/start/<restart.id>`, ' +
      'which is the ordinary execution screen. There is no comeback-specific timer.',
  })
  @ApiResponse({ status: 200, type: ComebackStatusDto })
  async start(@CurrentUser('id') userId: string): Promise<ComebackStatus> {
    return this.comeback.start(userId);
  }

  @Post('complete')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Record the return',
    description:
      'Completes the restart commitment through the ordinary action service — so it earns the ' +
      'same `completed` evidence any other completion does — and then writes one `recovery` ' +
      'row of its own. Idempotent by refusal: a second call answers 409 `NO_COMEBACK_OFFER`.',
  })
  @ApiResponse({ status: 200, type: ComebackCompletionDto })
  async complete(
    @CurrentUser('id') userId: string,
    @Body() dto: CompleteComebackDto,
  ): Promise<ComebackCompletion> {
    return this.comeback.complete(userId, dto.notes);
  }

  @Post('dismiss')
  @Auth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Decline the offer',
    description:
      'PRD §127: the user is allowed to decline being helped. Cancels the restart row and ' +
      'closes the loop; the next sweep may offer again.',
  })
  @ApiResponse({ status: 204, description: 'The offer is closed' })
  async dismiss(@CurrentUser('id') userId: string): Promise<void> {
    return this.comeback.dismiss(userId);
  }
}
