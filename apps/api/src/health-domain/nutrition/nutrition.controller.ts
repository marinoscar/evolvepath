import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { CommitBehaviourDto, NutritionBehaviourDto } from '../dto/health-domain.dtos';
import { NutritionService } from './nutrition.service';

/** PRD §46's behaviours. No calories, no macros, no food database — by design. */
@ApiTags('Health Domain')
@Controller('nutrition')
export class NutritionController {
  constructor(private readonly nutrition: NutritionService) {}

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
}
