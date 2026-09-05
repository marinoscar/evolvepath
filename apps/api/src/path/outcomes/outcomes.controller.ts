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

import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { OutcomesService } from './outcomes.service';
import { CreateOutcomeDto } from './dto/create-outcome.dto';
import { UpdateOutcomeDto } from './dto/update-outcome.dto';
import { OutcomeQueryDto } from './dto/outcome-query.dto';
import { OutcomeResponseDto } from './dto/outcome-response.dto';

@ApiTags('Outcomes')
@Controller('outcomes')
export class OutcomesController {
  constructor(private readonly outcomesService: OutcomesService) {}

  @Get()
  @Auth()
  @ApiOperation({
    summary: "List the calling user's outcomes",
    description:
      'Ordered by domain, then importance (descending), then creation time. Archived outcomes ' +
      'are excluded unless `includeArchived=true` or `state=ARCHIVED` is passed.',
  })
  @ApiResponse({ status: 200, type: [OutcomeResponseDto] })
  async list(
    @CurrentUser('id') userId: string,
    @Query() query: OutcomeQueryDto,
  ): Promise<OutcomeResponseDto[]> {
    return this.outcomesService.list(userId, query);
  }

  @Post()
  @Auth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an outcome' })
  @ApiResponse({ status: 201, type: OutcomeResponseDto })
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateOutcomeDto,
  ): Promise<OutcomeResponseDto> {
    return this.outcomesService.create(userId, dto);
  }

  @Get(':id')
  @Auth()
  @ApiOperation({
    summary: 'Get one outcome',
    description:
      "Another user's outcome answers 404, byte-identical to an unknown id — a 403 would " +
      'confirm the id exists.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, type: OutcomeResponseDto })
  @ApiResponse({ status: 404, description: 'Not found (unknown or not owned by the caller)' })
  async get(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OutcomeResponseDto> {
    return this.outcomesService.get(userId, id);
  }

  @Patch(':id')
  @Auth()
  @ApiOperation({
    summary: 'Update an outcome',
    description:
      '`domain` is immutable after creation. `state` accepts ACTIVE, PAUSED or COMPLETED; ' +
      'archiving goes through `POST /outcomes/:id/archive`.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, type: OutcomeResponseDto })
  @ApiResponse({ status: 409, description: 'The outcome is archived and cannot be edited' })
  async update(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOutcomeDto,
  ): Promise<OutcomeResponseDto> {
    return this.outcomesService.update(userId, id, dto);
  }

  @Post(':id/archive')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Archive an outcome',
    description: 'Idempotent — archiving an already-archived outcome answers 200 and writes nothing.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, type: OutcomeResponseDto })
  async archive(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OutcomeResponseDto> {
    return this.outcomesService.archive(userId, id);
  }
}
