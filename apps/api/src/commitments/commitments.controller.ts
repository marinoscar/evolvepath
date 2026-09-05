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
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CommitmentsService } from './commitments.service';
import { CreateCommitmentDto } from './dto/create-commitment.dto';
import { UpdateCommitmentDto } from './dto/update-commitment.dto';
import { CommitmentQueryDto } from './dto/commitment-query.dto';
import { TransitionCommitmentDto } from './dto/transition-commitment.dto';
import {
  CommitmentDetailDto,
  CommitmentResponseDto,
  TransitionResultDto,
} from './dto/commitment-response.dto';

@ApiTags('Commitments')
@Controller('commitments')
export class CommitmentsController {
  constructor(private readonly commitments: CommitmentsService) {}

  @Get()
  @Auth()
  @ApiOperation({
    summary: "List the caller's commitments in a time window",
    description:
      '`from` and `to` are both required and the window is capped at 62 days: an unbounded ' +
      'commitment listing grows without limit for an active user, and no screen wants one.',
  })
  @ApiResponse({ status: 200, type: [CommitmentResponseDto] })
  async list(
    @CurrentUser('id') userId: string,
    @Query() query: CommitmentQueryDto,
  ): Promise<CommitmentResponseDto[]> {
    return this.commitments.list(userId, query);
  }

  @Post()
  @Auth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a commitment',
    description:
      'Creates no evidence: a commitment is a plan, and PRD §10.9 forbids the product from ' +
      'treating a planned item as evidence that anything happened. Foreign ids must be owned ' +
      'by the caller AND consistent with each other.',
  })
  @ApiResponse({ status: 201, type: CommitmentResponseDto })
  @ApiResponse({ status: 409, description: 'The plan version is superseded or rejected' })
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateCommitmentDto,
  ): Promise<CommitmentResponseDto> {
    return this.commitments.create(userId, dto);
  }

  @Get(':id')
  @Auth()
  @ApiOperation({ summary: 'One commitment, with its evidence and reflections' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, type: CommitmentDetailDto })
  async get(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CommitmentDetailDto> {
    return this.commitments.get(userId, id);
  }

  @Patch(':id')
  @Auth()
  @ApiOperation({
    summary: 'Edit a commitment',
    description:
      '`status` is not a field here — it is reached through `/transition`, which validates the ' +
      'matrix. A terminal commitment is a record of a day that already happened and answers 409.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, type: CommitmentResponseDto })
  @ApiResponse({ status: 409, description: 'The commitment is in a terminal status' })
  async update(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCommitmentDto,
  ): Promise<CommitmentResponseDto> {
    return this.commitments.update(userId, id, dto);
  }

  @Post(':id/transition')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Move a commitment to another status',
    description:
      'The only way a status changes. A move the matrix forbids answers 409 with ' +
      '`details.reason = "INVALID_TRANSITION"`. A reschedule closes this commitment and opens a ' +
      'new PLANNED one at the new time, carrying the reschedule count forward.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, type: TransitionResultDto })
  @ApiResponse({ status: 409, description: 'The transition is not allowed from the current status' })
  async transition(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransitionCommitmentDto,
  ): Promise<TransitionResultDto> {
    return this.commitments.transition(userId, id, dto);
  }
}
