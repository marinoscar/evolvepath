import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { TestThrottle } from '../../ai/gateway/test-throttle';
import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { MediaCheckService } from '../../workouts/media/media-check.service';
import { CommitBehaviourDto, NutritionBehaviourDto } from '../dto/health-domain.dtos';
import { NutritionService } from './nutrition.service';

export const mealCheckRequestSchema = z.object({
  storageObjectId: z.string().uuid(),
  question: z.string().max(300).optional(),
});

export class MealCheckRequestDto extends createZodDto(mealCheckRequestSchema) {}

/** PRD §46's behaviours. No calories, no macros, no food database — by design. */
@ApiTags('Health Domain')
@Controller('nutrition')
export class NutritionController {
  constructor(
    private readonly nutrition: NutritionService,
    private readonly media: MediaCheckService,
    private readonly throttle: TestThrottle,
  ) {}

  @Get('behaviors')
  @Auth()
  @ApiOperation({
    summary: 'The nutrition behaviours this product knows about',
    description:
      'A static registry in registry order. Nothing here is per-user: a behaviour becomes ' +
      'personal when it is committed to, and that produces an ordinary HEALTH commitment.',
  })
  @ApiResponse({ status: 200, type: [NutritionBehaviourDto] })
  list(): { items: NutritionBehaviourDto[] } {
    return { items: this.nutrition.list() };
  }

  @Post('behaviors/:key/commit')
  @Auth()
  @ApiOperation({
    summary: 'Put a behaviour on the schedule',
    description:
      'Creates `repeatDays` consecutive HEALTH commitments through the ordinary commitments ' +
      'service, carrying the registry’s full and minimum versions. Defaults to the behaviour’s ' +
      'natural time of day in the caller’s own timezone.',
  })
  @ApiResponse({ status: 201, description: '`{ commitmentIds }`' })
  @ApiResponse({ status: 404, description: 'No such behaviour' })
  async commit(
    @CurrentUser('id') userId: string,
    @Param('key') key: string,
    @Body() dto: CommitBehaviourDto,
  ): Promise<{ commitmentIds: string[] }> {
    return this.nutrition.commit(userId, key, dto);
  }

  @Post('meal-check')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Ask the coach to look at a meal',
    description:
      'Behaviour-level observations and up to three behaviours from the registry. **Never a ' +
      'calorie, a macro or a gram** (PRD §46, VISION §16) — an answer containing any of them is ' +
      'rejected whole rather than edited, because a stripped sentence reads as an omission and ' +
      'the rest of that reply had already ignored its instructions. Always 200.',
  })
  @ApiResponse({ status: 200, description: '`{ ok, result | error }`' })
  async mealCheck(@CurrentUser('id') userId: string, @Body() dto: MealCheckRequestDto) {
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

    return this.media.mealCheck(userId, dto);
  }
}
