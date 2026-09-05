import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { ProposalStatus } from '@prisma/client';

import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { EditProposalDto } from './dto/edit-proposal.dto';
import { RejectProposalDto } from './dto/reject-proposal.dto';
import { ProposalDetailDto, ProposalSummaryDto } from './dto/proposal-response.dto';
import { ProposalsService } from './proposals.service';

/**
 * The user's half of PRD §15's mutation protocol.
 *
 * THERE IS NO `POST /proposals`. A proposal is created by whatever produced it
 * — the coach, weekly review, workout adaptation — never by a client, because
 * a route that accepts a change set from the browser is a route that lets a
 * client author a plan version and label it `AI`.
 */
@ApiTags('Plan Proposals')
@Controller('proposals')
export class ProposalsController {
  constructor(private readonly proposals: ProposalsService) {}

  @Get()
  @Auth()
  @ApiOperation({
    summary: 'List your plan-change proposals',
    description:
      'Newest first. Reading a proposal past its 7-day life marks it EXPIRED — expiry is lazy, ' +
      'so there is no sweeper rewriting user data on a schedule.',
  })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'planId', required: false, type: String, format: 'uuid' })
  @ApiResponse({ status: 200, type: [ProposalSummaryDto] })
  async list(
    @CurrentUser('id') userId: string,
    @Query('status') status?: ProposalStatus,
    @Query('planId') planId?: string,
  ): Promise<ProposalSummaryDto[]> {
    return this.proposals.list(userId, { status, planId });
  }

  @Get(':id')
  @Auth()
  @ApiOperation({
    summary: 'Read one proposal, with the diff accepting it would produce',
    description:
      '`preview.diff` is computed by the same pure function accept applies, so what the user ' +
      'reads and what accept does cannot drift apart.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, type: ProposalDetailDto })
  @ApiResponse({ status: 404, description: 'No such proposal of yours' })
  async get(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProposalDetailDto> {
    return this.proposals.get(userId, id);
  }

  @Post(':id/accept')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept a proposal and activate the plan version it produces',
    description:
      'The ONLY code path in the product that turns AI output into a PlanVersion (PRD §89, §107). ' +
      'Atomic: the new version, its routines, the effects on future commitments and the ' +
      'proposal itself all commit together or not at all.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'The decided proposal and the new version' })
  @ApiResponse({ status: 409, description: 'proposal_not_actionable / proposal_expired' })
  @ApiResponse({ status: 422, description: 'invalid_changes, with a per-index error list' })
  async accept(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.proposals.accept(userId, id);
  }

  @Post(':id/edit')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rewrite a proposal before deciding on it',
    description:
      'Keeps what the coach originally proposed in `originalChanges`, and an accept after an ' +
      'edit is attributed to the user — attribution follows who wrote the content.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, type: ProposalDetailDto })
  @ApiResponse({ status: 409, description: 'proposal_not_actionable / proposal_expired' })
  @ApiResponse({ status: 422, description: 'invalid_changes' })
  async edit(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditProposalDto,
  ): Promise<ProposalDetailDto> {
    return this.proposals.edit(userId, id, dto.changes);
  }

  @Post(':id/reject')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Keep the current plan',
    description: 'Touches no plan and no version. The reason is kept for the coach to read back.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, type: ProposalSummaryDto })
  @ApiResponse({ status: 409, description: 'proposal_not_actionable / proposal_expired' })
  async reject(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectProposalDto,
  ): Promise<ProposalSummaryDto> {
    return this.proposals.reject(userId, id, dto.reason);
  }
}
