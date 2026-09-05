import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import {
  BodyWeightLogDto,
  PutWeightDto,
  WeightQueryDto,
  WeightTrendDto,
} from '../dto/health-domain.dtos';
import { BodyWeightService } from './body-weight.service';

/**
 * Optional weight tracking (PRD §47).
 *
 * `health/weight` deliberately shares a URL prefix with the liveness probe and
 * shares nothing else: those routes are `@Public()` and these are not. There is
 * no path-based auth exemption for `/health*` anywhere in `auth/` — the probe
 * is public because its handlers say so, one decorator at a time.
 */
@ApiTags('Health Domain')
@Controller('health/weight')
export class BodyWeightController {
  constructor(private readonly weight: BodyWeightService) {}

  @Put()
  @Auth()
  @ApiOperation({
    summary: 'Log a weight for one day',
    description:
      'Upserts on the local date: weighing yourself twice is normal, and two rows for one ' +
      'morning would make the trend depend on which the query reached first. A future date is ' +
      'refused — it would sit at the end of every chart and drag the trend towards a number ' +
      'nobody has stood on a scale for.',
  })
  @ApiResponse({ status: 200, type: BodyWeightLogDto })
  @ApiResponse({ status: 400, description: '`WEIGHT_DATE_IN_FUTURE` / `WEIGHT_DATE_TOO_OLD`' })
  async put(
    @CurrentUser('id') userId: string,
    @Body() dto: PutWeightDto,
  ): Promise<BodyWeightLogDto> {
    return this.weight.put(userId, dto);
  }

  @Get()
  @Auth()
  @ApiOperation({
    summary: 'The last 30 days, and the trend through them',
    description:
      'Points, a rolling seven-day mean (null where fewer than two readings fall in the ' +
      'window), and a summary delta. There is deliberately no per-day judgment field: PRD §47 ' +
      'forbids calling one measurement a bad day, and the way to keep that promise is for the ' +
      'field not to exist.',
  })
  @ApiResponse({ status: 200, type: WeightTrendDto })
  async list(
    @CurrentUser('id') userId: string,
    @Query() query: WeightQueryDto,
  ): Promise<WeightTrendDto> {
    return this.weight.list(userId, query);
  }

  @Delete(':dateLocal')
  @Auth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove one day',
    description: 'Idempotent — deleting a day that was never logged is not an error.',
  })
  @ApiResponse({ status: 204, description: 'Gone' })
  async remove(
    @CurrentUser('id') userId: string,
    @Param('dateLocal') dateLocal: string,
  ): Promise<void> {
    await this.weight.remove(userId, dateLocal);
  }
}
