import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ReflectionsService } from './reflections.service';
import { CreateReflectionDto } from './dto/create-reflection.dto';
import { ReflectionQueryDto } from './dto/reflection-query.dto';
import { ReflectionResponseDto } from './dto/reflection-response.dto';

@ApiTags('Reflections')
@Controller('reflections')
export class ReflectionsController {
  constructor(private readonly reflections: ReflectionsService) {}

  @Get()
  @Auth()
  @ApiOperation({ summary: 'List reflections, newest first (max 200)' })
  @ApiResponse({ status: 200, type: [ReflectionResponseDto] })
  async list(
    @CurrentUser('id') userId: string,
    @Query() query: ReflectionQueryDto,
  ): Promise<ReflectionResponseDto[]> {
    return this.reflections.list(userId, query);
  }

  @Post()
  @Auth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Write a reflection',
    description:
      "`relatedId` is required for every type but `day`, and must be the caller's row. A " +
      'reflection with no note, no friction tag and no score is rejected.',
  })
  @ApiResponse({ status: 201, type: ReflectionResponseDto })
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateReflectionDto,
  ): Promise<ReflectionResponseDto> {
    return this.reflections.create(userId, dto);
  }
}
