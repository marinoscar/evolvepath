import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { TestThrottle } from '../../ai/gateway/test-throttle';
import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { MediaCheckService } from './media-check.service';

export const formCheckRequestSchema = z.object({
  storageObjectId: z.string().uuid(),
  exerciseId: z.string().uuid(),
  setNumber: z.number().int().min(1).max(12).optional(),
});

export class FormCheckRequestDto extends createZodDto(formCheckRequestSchema) {}

export const equipmentCheckRequestSchema = z.object({
  storageObjectId: z.string().uuid(),
  programId: z.string().uuid().optional(),
});

export class EquipmentCheckRequestDto extends createZodDto(equipmentCheckRequestSchema) {}

/**
 * Looking at what the user filmed (PRD §45, §81; VISION §14).
 *
 * Throttled because each call sends images — a video arrives as several frames
 * — under the user's own key.
 */
@ApiTags('Workouts')
@Controller('workouts')
export class WorkoutMediaController {
  constructor(
    private readonly media: MediaCheckService,
    private readonly throttle: TestThrottle,
  ) {}

  @Post('sessions/:id/form-check')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Ask the coach to look at a set',
    description:
      'Observations, up to three cues, and risk flags from a closed list. **A flagged risk, or a ' +
      'session already carrying discomfort, withholds the cues entirely** and answers with the ' +
      'PRD §45 copy: the moment a body is the question, coaching is the wrong answer. Always 200 ' +
      '— a provider failure is `{ ok: false }` (PRD §120), because this is a screen somebody is ' +
      'standing in front of.',
  })
  @ApiResponse({ status: 200, description: '`{ ok, result | error }`' })
  @ApiResponse({ status: 409, description: '`MEDIA_NOT_READY`' })
  @ApiResponse({ status: 429, description: 'Ten media checks a minute' })
  async formCheck(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) sessionId: string,
    @Body() dto: FormCheckRequestDto,
  ) {
    this.assertAllowed(userId);

    return this.media.formCheck(userId, sessionId, dto);
  }

  @Post('equipment-check')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Ask the coach what this room can train',
    description:
      'Detected equipment plus, for an active program, the movements it cannot do and what the ' +
      'catalog offers instead. The substitutions become a `WORKOUT` plan-change proposal — the ' +
      'check itself changes nothing (PRD §15).',
  })
  @ApiResponse({ status: 200, description: '`{ ok, result | error }`' })
  async equipmentCheck(
    @CurrentUser('id') userId: string,
    @Body() dto: EquipmentCheckRequestDto,
  ) {
    this.assertAllowed(userId);

    return this.media.equipmentCheck(userId, dto);
  }

  private assertAllowed(userId: string): void {
    const decision = this.throttle.check('media_check', userId);

    if (!decision.allowed) {
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message: 'That is a lot of photographs. Try again shortly.',
          retryAfterSeconds: decision.retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
