import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { PlanVersionSummaryDto } from './plan-response.dto';
import { RoutineResponseDto } from '../../routines/dto/routine-response.dto';

/** A version in full: its summary plus the behaviours it prescribes. */
export class PlanVersionResponseDto extends PlanVersionSummaryDto {
  @ApiProperty({ description: 'The plan this version belongs to' })
  planId!: string;

  @ApiPropertyOptional({ description: 'Minutes per week this version expects to cost' })
  expectedWeeklyLoad!: number | null;

  @ApiPropertyOptional({ description: 'What to do when the week goes wrong' })
  fallbackStrategy!: string | null;

  @ApiProperty({ description: 'The routines this version prescribes', type: [RoutineResponseDto] })
  routines!: RoutineResponseDto[];
}
