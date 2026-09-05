import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UpdateWeeklySettingsDto, WeeklySettingsDto } from './dto/weekly-review.dtos';
import { WeeklySettingsService } from './weekly-settings.service';

@ApiTags('Weekly Review')
@Controller('weekly/settings')
export class WeeklySettingsController {
  constructor(private readonly settings: WeeklySettingsService) {}

  @Get()
  @Auth()
  @ApiOperation({
    summary: 'When your weekly review is prepared',
    description:
      'The day and hour the review is generated, the timezone it is generated in, and the ' +
      'next instant that falls on. Own profile only — there is no user id in the path.',
  })
  @ApiResponse({ status: 200, type: WeeklySettingsDto })
  async get(@CurrentUser('id') userId: string): Promise<WeeklySettingsDto> {
    return this.settings.get(userId);
  }

  @Put()
  @Auth()
  @ApiOperation({
    summary: 'Choose the day and time',
    description:
      'Weekday 0 (Sunday) to 6 (Saturday) and an `HH:mm` local time. **The sweep runs hourly**, ' +
      'so a review set for 17:30 is prepared in the 17:00 pass — the minutes are recorded ' +
      'faithfully but are not a promise.',
  })
  @ApiResponse({ status: 200, type: WeeklySettingsDto })
  async update(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateWeeklySettingsDto,
  ): Promise<WeeklySettingsDto> {
    return this.settings.update(userId, dto);
  }
}
