import { ApiProperty } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * PRD §74's quick options for "anything EvolvePath should learn from today?".
 *
 * DELIBERATELY NOT `SkipReason` (#40), even though five of the seven overlap.
 * `PLAN_WORKED` is a real answer about a day and is not a reason to skip
 * anything, and merging the two enums would either smuggle it into the skip menu
 * or lose it here. Stable keys, never the sentence shown to the user: E10's
 * weekly review groups on these.
 */
export const REFLECTION_QUICK_OPTIONS = [
  'PLAN_WORKED',
  'TOO_MUCH',
  'BAD_TIMING',
  'UNEXPECTED_CONFLICT',
  'LOW_ENERGY',
  'AVOIDED',
  'OTHER',
] as const;

export const reflectionQuickOptionSchema = z.enum(REFLECTION_QUICK_OPTIONS);
export type ReflectionQuickOption = z.infer<typeof reflectionQuickOptionSchema>;

export const createDayReflectionSchema = z.object({
  quickOption: reflectionQuickOptionSchema,
  /** The user's own words. Never written to an audit row or a log line. */
  text: z.string().trim().max(1000).nullish(),
});

export class CreateDayReflectionDto extends createZodDto(createDayReflectionSchema) {}

export class DayReflectionResponseDto {
  @ApiProperty() id!: string;

  @ApiProperty({ example: '2026-03-02', description: 'The local day this is about' })
  dateLocal!: string;

  @ApiProperty({ enum: REFLECTION_QUICK_OPTIONS })
  quickOption!: string;

  @ApiProperty({ type: String, nullable: true })
  text!: string | null;

  @ApiProperty() createdAt!: string;
}
