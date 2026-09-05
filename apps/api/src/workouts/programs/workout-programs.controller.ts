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
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import {
  ApproveProgramDto,
  ApproveProgramResponseDto,
  GenerateProgramDto,
  GenerateProgramResponseDto,
  ProgramQueryDto,
  WorkoutProgramDto,
  WorkoutProgramSummaryDto,
} from '../dto/workout-program.dtos';
import { WorkoutProgramGeneratorService } from './workout-program-generator.service';
import { WorkoutProgramsService } from './workout-programs.service';

/**
 * The program builder (PRD §37, §38).
 *
 * `generate` answers 201 for an AI program and 200 for the deterministic
 * starter, so a client can tell "we made you something" from "we fell back"
 * without reading the body — and both are successes.
 */
@ApiTags('Workouts')
@Controller('workouts/programs')
export class WorkoutProgramsController {
  constructor(
    private readonly programs: WorkoutProgramsService,
    private readonly generator: WorkoutProgramGeneratorService,
  ) {}

  @Post('generate')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Draft a workout program',
    description:
      'Runs the safety pre-check, asks the workout programmer, then checks the answer against ' +
      'the deterministic safety and time-budget rules. A rejected proposal, an unreachable ' +
      'provider or a safety redirect all return the starter program with a `reason` (PRD §120). ' +
      'Writes `workout_programs` rows only — no plan, no routines, no commitments until approve.',
  })
  @ApiResponse({ status: 200, type: GenerateProgramResponseDto })
  @ApiResponse({ status: 412, description: '`AI_KEY_REQUIRED` — bring your own key first' })
  async generate(
    @CurrentUser('id') userId: string,
    @Body() dto: GenerateProgramDto,
  ): Promise<GenerateProgramResponseDto> {
    const result = await this.generator.generate(userId, dto);

    return this.programs.toGenerateResponse(result);
  }

  @Get()
  @Auth()
  @ApiOperation({ summary: 'Your programs, newest first' })
  @ApiResponse({ status: 200, type: [WorkoutProgramSummaryDto] })
  async list(
    @CurrentUser('id') userId: string,
    @Query() query: ProgramQueryDto,
  ): Promise<{ items: WorkoutProgramSummaryDto[] }> {
    return { items: await this.programs.list(userId, query) };
  }

  @Get(':id')
  @Auth()
  @ApiOperation({
    summary: 'One program with its templates',
    description: "Another user's id answers 404, indistinguishable from one that never existed.",
  })
  @ApiResponse({ status: 200, type: WorkoutProgramDto })
  @ApiResponse({ status: 404, description: 'Not yours, or not there' })
  async get(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WorkoutProgramDto> {
    return this.programs.get(userId, id);
  }

  @Post(':id/approve')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve a draft and put it on the schedule',
    description:
      'The only path that turns a generated program into a plan (PRD §15). One transaction: the ' +
      'Health outcome and plan, a user-approved plan version, one routine per FULL template, the ' +
      'previous program archived, and the next fourteen days of commitments.',
  })
  @ApiResponse({ status: 200, type: ApproveProgramResponseDto })
  @ApiResponse({ status: 409, description: '`PROGRAM_NOT_DRAFT`' })
  async approve(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveProgramDto,
  ): Promise<ApproveProgramResponseDto> {
    return this.programs.approve(userId, id, dto);
  }

  @Post(':id/archive')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Retire a program',
    description: 'Cancels its future PLANNED days. Past sessions and evidence are untouched.',
  })
  @ApiResponse({ status: 200, type: WorkoutProgramDto })
  async archive(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WorkoutProgramDto> {
    return this.programs.archive(userId, id);
  }

  @Delete(':id')
  @Auth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Discard a draft',
    description: 'Drafts only. A live program is archived, never deleted — it has history on it.',
  })
  @ApiResponse({ status: 204, description: 'Gone' })
  @ApiResponse({ status: 409, description: '`PROGRAM_NOT_DRAFT`' })
  async remove(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.programs.remove(userId, id);
  }
}
