import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AvoidanceService } from './avoidance.service';
import { AnswerFrictionDto } from './dto/answer-friction.dto';
import { FrictionService, type FrictionAnswerResult } from './friction.service';
import type { AvoidanceAssessment } from './avoidance-detector';

// =============================================================================
// `/commitments/:id/friction` and `/commitments/:id/avoidance` (issue #116)
// =============================================================================
//
// Both hang off a commitment because that is what the user is looking at. They
// live in `WorkModule` rather than `CommitmentsModule` because the ladder is a
// Work-domain judgement — Family and Health commitments carry `avoidance: null`
// and always will.
// =============================================================================

@ApiTags('Work')
@Controller('commitments/:id')
export class FrictionController {
  constructor(
    private readonly friction: FrictionService,
    private readonly avoidance: AvoidanceService,
  ) {}

  @Post('friction')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Answer \"what's making it hard to start?\"",
    description:
      'VISION §9. Writes one reflection tagged with the answer and one obstacle row (whose ' +
      '`observedCount` grows on repeats), then returns the intervention the answer routes to. ' +
      'The intervention type is decided server-side from the answer — never from the body, and ' +
      'never from what the model claims. Free text goes through the safety layer first: a ' +
      'redirect returns professional-care copy and writes nothing.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'The level, the rows written, and the intervention' })
  @ApiResponse({ status: 400, description: '`COMMITMENT_NOT_WORK`, or `TEXT_REQUIRED` for OTHER' })
  @ApiResponse({ status: 404, description: 'Not found (unknown or not owned by the caller)' })
  async answer(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) commitmentId: string,
    @Body() dto: AnswerFrictionDto,
  ): Promise<FrictionAnswerResult> {
    return this.friction.answer(userId, commitmentId, dto);
  }

  @Get('avoidance')
  @Auth()
  @ApiOperation({
    summary: 'Where this commitment sits on the intervention ladder',
    description:
      'Derived on every read from a batched query — there is deliberately no stored ' +
      '`avoidanceLevel` column, because the signals move overnight and a persisted level would ' +
      'contradict `GET /today` within hours.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'level, interventionType, signals, rationale, suggestedAction' })
  @ApiResponse({ status: 400, description: '`COMMITMENT_NOT_WORK`' })
  @ApiResponse({ status: 404, description: 'Not found (unknown or not owned by the caller)' })
  async assess(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) commitmentId: string,
  ): Promise<AvoidanceAssessment> {
    return this.avoidance.assessOne(userId, commitmentId);
  }
}
