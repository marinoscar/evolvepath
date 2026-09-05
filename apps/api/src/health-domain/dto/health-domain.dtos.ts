import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { NUTRITION_BEHAVIOR_KEYS } from '../nutrition/nutrition-behaviors';

// =============================================================================
// Nutrition and weight, on the wire (issue #113, epic E09)
// =============================================================================
//
// `BodyWeightLogDto` and `WeightTrendDto` carry NO per-day classification —
// no "good", no "over", no direction arrow, no goal. PRD §47 forbids judging a
// day from one measurement, and the way to keep that promise is for the field
// not to exist: a client cannot render a red day it was never given.
// `body-weight.service.spec.ts` snapshots the key list for exactly that reason.
// =============================================================================

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const commitBehaviourSchema = z.object({
  scheduledStart: z.string().datetime({ offset: true }).optional(),
  /** How many consecutive days to put it on. One is a try; five is a week. */
  repeatDays: z.number().int().min(1).max(7).default(1),
});

export class CommitBehaviourDto extends createZodDto(commitBehaviourSchema) {}

export const putWeightSchema = z.object({
  dateLocal: isoDate,
  /** Kilograms, to a tenth. A scale that reads finer than that is reading noise. */
  weightKg: z.number().min(20).max(400).multipleOf(0.1),
});

export class PutWeightDto extends createZodDto(putWeightSchema) {}

export const weightQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export class WeightQueryDto extends createZodDto(weightQuerySchema) {}

export const nutritionBehaviorKeySchema = z.enum(NUTRITION_BEHAVIOR_KEYS);

export class NutritionBehaviourDto {
  @ApiProperty() key!: string;
  @ApiProperty() title!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ enum: ['MORNING', 'MIDDAY', 'EVENING'] }) defaultTime!: string;
  @ApiProperty({ type: 'object', additionalProperties: true })
  fullVersion!: { title: string; minutes: number };
  @ApiProperty({ type: 'object', additionalProperties: true })
  minimumVersion!: { title: string; minutes: number };
}

export class BodyWeightLogDto {
  @ApiProperty({ example: '2026-09-05' }) dateLocal!: string;
  @ApiProperty({ example: 82.4 }) weightKg!: number;
}

export class TrendPointDto {
  @ApiProperty() dateLocal!: string;
  @ApiPropertyOptional({
    nullable: true,
    description: 'Null where fewer than two readings fall in the seven-day window.',
  })
  rolling7Kg!: number | null;
}

export class WeightTrendDto {
  @ApiProperty({ type: [BodyWeightLogDto] }) items!: BodyWeightLogDto[];
  @ApiProperty({ type: [TrendPointDto] }) trend!: TrendPointDto[];
  @ApiPropertyOptional({
    nullable: true,
    description:
      'Null until there is enough to say anything. Deliberately carries no ' +
      'per-day judgment — PRD §47.',
    type: 'object',
    additionalProperties: true,
  })
  summary!: { first: number; last: number; deltaKg: number; days: number } | null;
}
