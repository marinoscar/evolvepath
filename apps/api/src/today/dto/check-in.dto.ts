import { ApiProperty } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { checkInFeelSchema } from '../today.schema';

/**
 * "How does today feel?" (PRD §73, issue #43).
 *
 * ONE FIELD. PRD §73 also says to avoid "daily emotional interrogation", and
 * the guard against that is structural: there is nowhere in this body to put a
 * follow-up question.
 */
export const upsertCheckInSchema = z.object({ feel: checkInFeelSchema });

export class UpsertCheckInDto extends createZodDto(upsertCheckInSchema) {}

export class CheckInResponseDto {
  @ApiProperty({ example: '2026-03-02', description: "The user's local calendar date" })
  dateLocal!: string;

  @ApiProperty({ enum: ['NORMAL', 'PACKED', 'LOW_ENERGY', 'UNEXPECTED_PROBLEM'] })
  feel!: string;

  @ApiProperty() updatedAt!: string;
}
