import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { PlansService } from './plans.service';
import { PlanVersionsService } from './plan-versions.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { CreatePlanVersionDto } from './dto/create-plan-version.dto';
import { UpdatePlanVersionDto } from './dto/update-plan-version.dto';
import { RejectPlanVersionDto } from './dto/reject-plan-version.dto';
import { PlanResponseDto, PlanVersionSummaryDto } from './dto/plan-response.dto';
import { PlanVersionResponseDto } from './dto/plan-version-response.dto';

/** The two plan routes that hang off an outcome. */
@ApiTags('Plans')
@Controller('outcomes/:outcomeId/plans')
export class OutcomePlansController {
  constructor(private readonly plans: PlansService) {}

  @Post()
  @Auth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create the plan for an outcome',
    description:
      'Creates the plan, its v1 (ACTIVE and approved — a first plan that landed as a draft ' +
      'would ask the user to approve what they just wrote) and any inline routines, in one ' +
      'transaction. 409 if the outcome already has a plan or is archived.',
  })
  @ApiParam({ name: 'outcomeId', type: String, format: 'uuid' })
  @ApiResponse({ status: 201, type: PlanResponseDto })
  @ApiResponse({ status: 409, description: 'The outcome already has a plan, or is archived' })
  async create(
    @CurrentUser('id') userId: string,
    @Param('outcomeId', ParseUUIDPipe) outcomeId: string,
    @Body() dto: CreatePlanDto,
  ): Promise<PlanResponseDto> {
    return this.plans.createForOutcome(userId, outcomeId, dto);
  }

  @Get()
  @Auth()
  @ApiOperation({
    summary: "List an outcome's plans",
    description:
      'Zero or one element today. The array shape is deliberate: allowing several plans later ' +
      'becomes a data change rather than a breaking response change.',
  })
  @ApiParam({ name: 'outcomeId', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, type: [PlanResponseDto] })
  async list(
    @CurrentUser('id') userId: string,
    @Param('outcomeId', ParseUUIDPipe) outcomeId: string,
  ): Promise<PlanResponseDto[]> {
    return this.plans.listForOutcome(userId, outcomeId);
  }
}

@ApiTags('Plans')
@Controller('plans')
export class PlansController {
  constructor(
    private readonly plans: PlansService,
    private readonly versions: PlanVersionsService,
  ) {}

  @Get(':id')
  @Auth()
  @ApiOperation({ summary: 'Get a plan and its active version' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, type: PlanResponseDto })
  async get(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PlanResponseDto> {
    return this.plans.get(userId, id);
  }

  @Get(':id/versions')
  @Auth()
  @ApiOperation({
    summary: "A plan's full history",
    description:
      'Newest first. Every version stays readable, including superseded and rejected ones — ' +
      'PRD §103 requires the user to be able to inspect why the plan changed, which needs both ' +
      'sides of every change.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, type: [PlanVersionSummaryDto] })
  async listVersions(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PlanVersionSummaryDto[]> {
    return this.versions.list(userId, id);
  }

  @Get(':id/versions/:version')
  @Auth()
  @ApiOperation({ summary: 'One version in full, with its routines' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  // The integer version number, not the version's uuid: "v2" is what the user
  // sees, and the uuid is an internal link target for `previousVersionId`.
  @ApiParam({ name: 'version', type: Number, description: 'The version number, e.g. 2' })
  @ApiResponse({ status: 200, type: PlanVersionResponseDto })
  async getVersion(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('version', ParseIntPipe) version: number,
  ): Promise<PlanVersionResponseDto> {
    return this.versions.get(userId, id, version);
  }

  @Post(':id/versions')
  @Auth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Draft the next version',
    description:
      '`rationale` is required: PRD §80 wants "why it changed" renderable for every change, and ' +
      'the moment the user knew why has passed by the time anybody notices it is missing. ' +
      'Routines are cloned from the active version by default. One draft at a time (409).',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 201, type: PlanVersionResponseDto })
  @ApiResponse({ status: 409, description: 'A draft already exists for this plan' })
  async createVersion(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePlanVersionDto,
  ): Promise<PlanVersionResponseDto> {
    // `createdBy` is deliberately not taken from the body — see createDraft.
    return this.versions.createDraft(userId, id, dto);
  }

  @Patch(':id/versions/:version')
  @Auth()
  @ApiOperation({
    summary: 'Edit a draft version',
    description: '409 unless the version is still DRAFT — a version that has been in force is history.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiParam({ name: 'version', type: Number })
  @ApiResponse({ status: 200, type: PlanVersionResponseDto })
  @ApiResponse({ status: 409, description: 'The version is not a draft' })
  async updateVersion(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('version', ParseIntPipe) version: number,
    @Body() dto: UpdatePlanVersionDto,
  ): Promise<PlanVersionResponseDto> {
    return this.versions.update(userId, id, version, dto);
  }

  @Post(':id/versions/:version/activate')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Put a draft version in force',
    description:
      'Supersedes the current active version and activates this one atomically. Both stay ' +
      'readable afterwards. 409 unless the target is a DRAFT, and 409 (not 500) if another ' +
      'activation raced this one.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiParam({ name: 'version', type: Number })
  @ApiResponse({ status: 200, type: PlanVersionResponseDto })
  @ApiResponse({ status: 409, description: 'The version is not a draft, or an activation raced' })
  async activateVersion(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('version', ParseIntPipe) version: number,
  ): Promise<PlanVersionResponseDto> {
    return this.versions.activate(userId, id, version);
  }

  @Post(':id/versions/:version/reject')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reject a draft version',
    description:
      'The rationale is kept: a rejected version is part of the record of what the user ' +
      'considered and decided against. 409 unless the target is a DRAFT.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiParam({ name: 'version', type: Number })
  @ApiResponse({ status: 200, type: PlanVersionResponseDto })
  async rejectVersion(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('version', ParseIntPipe) version: number,
    @Body() dto: RejectPlanVersionDto,
  ): Promise<PlanVersionResponseDto> {
    return this.versions.reject(userId, id, version, dto);
  }
}
