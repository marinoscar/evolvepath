import {
  Body,
  Controller,
  Delete,
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
import { RoutinesService } from './routines.service';
import { CreateRoutineDto } from './dto/create-routine.dto';
import { UpdateRoutineDto } from './dto/update-routine.dto';
import { RoutineQueryDto } from './dto/routine-query.dto';
import { RoutineResponseDto } from './dto/routine-response.dto';

@ApiTags('Routines')
@Controller('routines')
export class RoutinesController {
  constructor(private readonly routines: RoutinesService) {}

  @Get()
  @Auth()
  @ApiOperation({
    summary: 'List the routines of one plan version',
    description:
      '`planVersionId` is required: routines are only meaningful inside one version, and a ' +
      "cross-version listing would mix a superseded plan's behaviours with the live one's.",
  })
  @ApiResponse({ status: 200, type: [RoutineResponseDto] })
  async list(
    @CurrentUser('id') userId: string,
    @Query() query: RoutineQueryDto,
  ): Promise<RoutineResponseDto[]> {
    return this.routines.list(userId, query);
  }

  @Post()
  @Auth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Add a routine to a plan version',
    description:
      "`domain` defaults to the outcome's. 409 if the version is SUPERSEDED or REJECTED.",
  })
  @ApiResponse({ status: 201, type: RoutineResponseDto })
  @ApiResponse({ status: 409, description: 'The plan version is read-only' })
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateRoutineDto,
  ): Promise<RoutineResponseDto> {
    return this.routines.create(userId, dto);
  }

  @Get(':id')
  @Auth()
  @ApiOperation({ summary: 'Get one routine' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, type: RoutineResponseDto })
  async get(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RoutineResponseDto> {
    return this.routines.get(userId, id);
  }

  @Patch(':id')
  @Auth()
  @ApiOperation({
    summary: 'Update a routine',
    description:
      'The cross-field rules are checked against the MERGED routine, so a patch that sets only ' +
      '`minimumDurationMin` above the existing `estimatedDurationMin` is rejected. 409 if the ' +
      'version is SUPERSEDED or REJECTED — its routines are the record of what the plan used to say.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, type: RoutineResponseDto })
  @ApiResponse({ status: 409, description: 'The plan version is read-only, or the merge is invalid' })
  async update(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoutineDto,
  ): Promise<RoutineResponseDto> {
    return this.routines.update(userId, id, dto);
  }

  @Delete(':id')
  @Auth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a routine' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse({ status: 409, description: 'The plan version is read-only' })
  async remove(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.routines.remove(userId, id);
  }
}
