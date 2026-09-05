import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { WorkoutAdaptationService } from './workout-adaptation.service';

export const dislikeSchema = z.object({ disliked: z.boolean() });

export class DislikeDto extends createZodDto(dislikeSchema) {}

/**
 * PRD §43's adaptation, exposed for the user's own program only.
 *
 * `run` exists as a route because the detector is deterministic and cheap, and
 * because "check now" is what a user does after a bad fortnight — waiting for
 * tomorrow's cron to notice would be the product being slower than the person.
 */
@ApiTags('Workouts')
@Controller('workouts')
export class WorkoutAdaptationController {
  constructor(private readonly adaptation: WorkoutAdaptationService) {}

  @Post('adaptation/run')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Look for adaptations now',
    description:
      'Deterministic. Creates at most one proposal per template per fortnight and writes nothing ' +
      'to any workout table — the plan changes only when the user accepts (PRD §15).',
  })
  @ApiResponse({ status: 200, description: '`{ created, proposalIds }`' })
  async run(
    @CurrentUser('id') userId: string,
  ): Promise<{ created: number; proposalIds: string[] }> {
    return this.adaptation.run(userId);
  }

  @Get('adaptation/candidates')
  @Auth()
  @ApiOperation({
    summary: 'What a run would propose',
    description: 'The explain view. Reads only; creates nothing.',
  })
  @ApiResponse({ status: 200, description: 'The candidates, with their detector and changes.' })
  async candidates(@CurrentUser('id') userId: string): Promise<{ items: unknown[] }> {
    return { items: await this.adaptation.candidates(userId) };
  }

  @Post('templates/:templateId/exercises/:id/dislike')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '"Not this one"',
    description:
      'Records a timestamp rather than a flag: "disliked" is something that happened on a day, ' +
      'and the detector asks when. The swap itself is a proposal on the next run — nothing is ' +
      'changed here.',
  })
  @ApiResponse({ status: 200, description: '`{ dislikedAt }`' })
  async dislike(
    @CurrentUser('id') userId: string,
    @Param('templateId', ParseUUIDPipe) templateId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DislikeDto,
  ): Promise<{ dislikedAt: string | null }> {
    return this.adaptation.setDisliked(userId, templateId, id, dto.disliked);
  }
}
