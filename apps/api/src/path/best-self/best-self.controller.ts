import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { BestSelfService } from './best-self.service';
import { UpsertBestSelfDto } from './dto/upsert-best-self.dto';
import { BestSelfResponseDto } from './dto/best-self-response.dto';

@ApiTags('Best Self')
@Controller('me/best-self')
export class BestSelfController {
  constructor(private readonly bestSelfService: BestSelfService) {}

  @Get()
  @Auth()
  @ApiOperation({
    summary: "Get the calling user's Best Self profile",
    description:
      'Answers 200 with `data: null` until the profile has been saved once — an unsaved ' +
      'profile is an empty card on the Path screen, not a missing resource.',
  })
  @ApiResponse({ status: 200, type: BestSelfResponseDto })
  async get(@CurrentUser('id') userId: string): Promise<BestSelfResponseDto | null> {
    return this.bestSelfService.get(userId);
  }

  @Put()
  @Auth()
  @ApiOperation({
    summary: 'Replace the calling user\'s Best Self profile',
    description:
      'Replaces the profile whole and stamps `lastReviewedAt`. Omitted fields are cleared, ' +
      'not preserved — this is a PUT.',
  })
  @ApiResponse({ status: 200, type: BestSelfResponseDto })
  async upsert(
    @CurrentUser('id') userId: string,
    @Body() dto: UpsertBestSelfDto,
  ): Promise<BestSelfResponseDto> {
    return this.bestSelfService.upsert(userId, dto);
  }
}
