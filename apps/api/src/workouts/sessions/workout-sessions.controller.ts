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
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import {
  FinishSessionDto,
  FinishSessionResponseDto,
  LogSetBatchDto,
  LogSetBatchResponseDto,
  LogSetDto,
  LogSetResponseDto,
  SessionQueryDto,
  StartSessionDto,
  SwitchVariantDto,
  WorkoutSessionSummaryDto,
  WorkoutSessionViewDto,
} from '../dto/workout-session.dtos';
import { WorkoutSessionsService } from './workout-sessions.service';

/** The full-screen runner's API (PRD §41, §44, §45, §121). */
@ApiTags('Workouts')
@Controller('workouts/sessions')
export class WorkoutSessionsController {
  constructor(private readonly sessions: WorkoutSessionsService) {}

  @Post()
  @Auth()
  @ApiOperation({
    summary: 'Start a workout',
    description:
      'Provide exactly one of `commitmentId` (the scheduled day) or `templateId` (an ad-hoc ' +
      'session). A commitment-backed start goes through the ordinary commitment `start` action, ' +
      'so the timer, the transition matrix and the evidence stay in one place.',
  })
  @ApiResponse({ status: 201, type: WorkoutSessionViewDto })
  @ApiResponse({
    status: 409,
    description: '`SESSION_IN_PROGRESS` — `details.sessionId` is the open one',
  })
  async start(
    @CurrentUser('id') userId: string,
    @Body() dto: StartSessionDto,
  ): Promise<WorkoutSessionViewDto> {
    return this.sessions.start(userId, dto);
  }

  @Get()
  @Auth()
  @ApiOperation({ summary: 'Your sessions, newest first' })
  @ApiResponse({ status: 200, type: [WorkoutSessionSummaryDto] })
  async list(
    @CurrentUser('id') userId: string,
    @Query() query: SessionQueryDto,
  ): Promise<{ items: WorkoutSessionSummaryDto[] }> {
    return { items: await this.sessions.list(userId, query) };
  }

  @Get(':id')
  @Auth()
  @ApiOperation({
    summary: 'The runner view',
    description:
      'The exercise list for the current variant, every set logged so far, and `lastTime` per ' +
      'movement — the most recent COMPLETED session for it, in any template.',
  })
  @ApiResponse({ status: 200, type: WorkoutSessionViewDto })
  @ApiResponse({ status: 404, description: 'Not yours, or not there' })
  async get(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WorkoutSessionViewDto> {
    return this.sessions.get(userId, id);
  }

  @Get(':id/exercises/:exerciseId/explain')
  @Auth()
  @ApiOperation({
    summary: "One sentence about a movement's progression suggestion",
    description:
      'PRD §42: the rule decides, the coach explains. The number comes from the deterministic ' +
      'rule before this runs, and a sentence naming any other load is discarded in favour of ' +
      'the template — so `source` is `template` whenever the provider is down, the user has no ' +
      'key, or the model wrote something we will not show.',
  })
  @ApiResponse({ status: 200, description: "`{ sentence, source: 'ai' | 'template' }`" })
  async explain(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('exerciseId', ParseUUIDPipe) exerciseId: string,
  ): Promise<{ sentence: string; source: string }> {
    return this.sessions.explain(userId, id, exerciseId);
  }

  @Post(':id/sets')
  @Auth()
  @ApiOperation({
    summary: 'Log one set',
    description:
      'Idempotent on `clientId`: the same id twice is a replay, and the second call returns the ' +
      'row that already exists. The same `(exercise, setNumber)` under a NEW `clientId` is a ' +
      'correction and overwrites. `discomfort: SHARP_PAIN` flags the session and returns the ' +
      'PRD §45 copy — no model is called and no programming advice is given.',
  })
  @ApiResponse({ status: 201, type: LogSetResponseDto })
  @ApiResponse({ status: 409, description: '`SESSION_NOT_OPEN`' })
  async logSet(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LogSetDto,
  ): Promise<LogSetResponseDto> {
    return this.sessions.logSet(userId, id, dto);
  }

  @Post(':id/sets/batch')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Replay a queue of sets',
    description:
      'The offline entry point (PRD §121). Per item, never all-or-nothing: one bad set must not ' +
      'cost the user the twenty-nine good ones they actually performed.',
  })
  @ApiResponse({ status: 200, type: LogSetBatchResponseDto })
  async logSets(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LogSetBatchDto,
  ): Promise<LogSetBatchResponseDto> {
    return this.sessions.logSets(userId, id, dto.sets);
  }

  @Post(':id/switch-variant')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Drop to the short or minimum version',
    description:
      'Re-derives the exercise list from the sibling template. Sets already logged for movements ' +
      'the new variant does not include are kept and returned under `alsoLogged` — they really ' +
      'happened.',
  })
  @ApiResponse({ status: 200, type: WorkoutSessionViewDto })
  @ApiResponse({ status: 400, description: '`VARIANT_NOT_DEFINED`' })
  async switchVariant(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SwitchVariantDto,
  ): Promise<WorkoutSessionViewDto> {
    return this.sessions.switchVariant(userId, id, dto);
  }

  @Post(':id/finish')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Finish or abandon',
    description:
      'Writes one `WORKOUT_LOG` evidence row and settles the attached commitment through the ' +
      'ordinary actions: a full variant with every movement logged completes it, anything else ' +
      'with work in it is partial, and abandoning with nothing logged leaves it open.',
  })
  @ApiResponse({ status: 200, type: FinishSessionResponseDto })
  @ApiResponse({ status: 409, description: '`SESSION_NOT_OPEN`' })
  async finish(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FinishSessionDto,
  ): Promise<FinishSessionResponseDto> {
    return this.sessions.finish(userId, id, dto);
  }
}
