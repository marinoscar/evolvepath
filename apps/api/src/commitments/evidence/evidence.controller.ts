import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { EvidenceService } from './evidence.service';
import { CreateEvidenceDto } from './dto/create-evidence.dto';
import { EvidenceQueryDto } from './dto/evidence-query.dto';
import { EvidenceResponseDto } from './dto/evidence-response.dto';

@ApiTags('Evidence')
@Controller('evidence')
export class EvidenceController {
  constructor(private readonly evidence: EvidenceService) {}

  @Get()
  @Auth()
  @ApiOperation({
    summary: 'List evidence in a time window',
    description: '`from` and `to` are required; the window is capped at 93 days.',
  })
  @ApiResponse({ status: 200, type: [EvidenceResponseDto] })
  async list(
    @CurrentUser('id') userId: string,
    @Query() query: EvidenceQueryDto,
  ): Promise<EvidenceResponseDto[]> {
    return this.evidence.list(userId, query);
  }

  @Post()
  @Auth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Log what happened',
    description:
      "`source` must be `USER_LOG`. TIMER, WORKOUT_LOG and APP_FLOW mean \"the system observed " +
      'this", and a client able to claim them could manufacture observations — PRD §10.9.',
  })
  @ApiResponse({ status: 201, type: EvidenceResponseDto })
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateEvidenceDto,
  ): Promise<EvidenceResponseDto> {
    return this.evidence.create(userId, dto);
  }

  @Delete(':id')
  @Auth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an evidence row (PRD §127 user control)' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  async remove(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.evidence.remove(userId, id);
  }
}
