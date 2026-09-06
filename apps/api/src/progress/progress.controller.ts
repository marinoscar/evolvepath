import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ProgressResponseDto } from './dto/progress-response.dto';
import { ProgressService } from './progress.service';
import type { ProgressResponse } from './progress.schema';

/**
 * The Progress screen's API (issue #98, epic E11).
 *
 * Own data only, and there is no id in the path — a user reads their own
 * evolution or nobody's.
 */
@ApiTags('Progress')
@Controller('progress')
export class ProgressController {
  constructor(private readonly progress: ProgressService) {}

  @Get()
  @Auth()
  @ApiOperation({
    summary: 'Momentum per domain, the consistency run, recovery and insights',
    description:
      'Deterministic and AI-free (PRD §53, §120): the same data produces the same states, and ' +
      'the screen renders with the provider down. Every number is a COUNT — there is no score, ' +
      'no percentage and no `/100` anywhere in this payload (PRD P13, §54). The engine compares ' +
      'ratios internally to detect a trend and deliberately does not serialise them.',
  })
  @ApiResponse({ status: 200, type: ProgressResponseDto })
  async getProgress(@CurrentUser('id') userId: string): Promise<ProgressResponse> {
    return this.progress.getProgress(userId);
  }
}
