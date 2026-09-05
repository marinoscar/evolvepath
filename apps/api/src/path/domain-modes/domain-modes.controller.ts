import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';

import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { DomainModesService } from './domain-modes.service';
import { domainSchema, DomainValue } from '../domain.schema';
import { SetDomainModeDto } from './dto/set-domain-mode.dto';
import { DomainModeResponseDto } from './dto/domain-mode-response.dto';

@ApiTags('Domain Modes')
@Controller('me/domain-modes')
export class DomainModesController {
  constructor(private readonly domainModesService: DomainModesService) {}

  @Get()
  @Auth()
  @ApiOperation({
    summary: "List the calling user's per-domain postures",
    description:
      'Always exactly three entries, in the order WORK, FAMILY, HEALTH. A domain never set ' +
      'is reported as GROW with a null `effectiveFrom`; no row is created for it.',
  })
  @ApiResponse({ status: 200, type: [DomainModeResponseDto] })
  async list(@CurrentUser('id') userId: string): Promise<DomainModeResponseDto[]> {
    return this.domainModesService.list(userId);
  }

  @Put(':domain')
  @Auth()
  @ApiOperation({
    summary: 'Set the posture for one domain',
    description:
      '`effectiveFrom` moves only when the mode actually changes, so re-saving the same mode ' +
      'with a new reason does not reset "since when".',
  })
  @ApiParam({ name: 'domain', enum: ['WORK', 'FAMILY', 'HEALTH'] })
  @ApiResponse({ status: 200, type: DomainModeResponseDto })
  @ApiResponse({ status: 400, description: 'Unknown domain' })
  async set(
    @CurrentUser('id') userId: string,
    // The path segment is validated by the same schema as a body enum, so an
    // unknown domain is a 400 with a field path rather than a 404 that would
    // read as "you have no such domain".
    @Param('domain', new ZodValidationPipe(domainSchema)) domain: DomainValue,
    @Body() dto: SetDomainModeDto,
  ): Promise<DomainModeResponseDto> {
    return this.domainModesService.set(userId, domain, dto);
  }
}
