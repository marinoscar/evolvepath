import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { hhmm, isoDate } from '../weekly.schema';

// =============================================================================
// The weekly review's wire shapes (issue #73, epic E10)
// =============================================================================
//
// `invocationId` is DELIBERATELY ABSENT from every response class below. It is
// the id of an `ai_invocations` row — an internal log pointer — and a client
// that could read it could correlate a user's coaching against telemetry it has
// no business seeing. It is written to the review row and to the audit meta,
// and it stops there.
// =============================================================================

export const generateReviewSchema = z.object({
  /** Defaults to `defaultReviewWeek` — Mon/Tue look back, Wed–Sun review now. */
  weekStart: isoDate.optional(),
});

export class GenerateReviewDto extends createZodDto(generateReviewSchema) {}

export const reviewQuerySchema = z.object({
  weekStart: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(52).default(12),
});

export class ReviewQueryDto extends createZodDto(reviewQuerySchema) {}

export const updateWeeklySettingsSchema = z.object({
  /** 0 = Sunday … 6 = Saturday, matching `user_profiles.weekly_review_weekday`. */
  weeklyReviewWeekday: z.number().int().min(0).max(6),
  weeklyReviewTime: hhmm,
});

export class UpdateWeeklySettingsDto extends createZodDto(updateWeeklySettingsSchema) {}

export class DomainPlannedCountsDto {
  @ApiProperty({ example: 5 }) planned!: number;
  @ApiProperty({ example: 4 }) completed!: number;
}

export class WeeklyReviewSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: '2026-08-31' }) weekStart!: string;
  @ApiProperty({ enum: ['GENERATING', 'READY', 'APPROVED', 'SKIPPED'] }) status!: string;

  @ApiProperty({
    description: 'Planned and completed per domain — enough for a list row, not the whole week.',
    type: 'object',
    additionalProperties: { type: 'object' },
  })
  counts!: Record<string, DomainPlannedCountsDto>;

  @ApiPropertyOptional({ nullable: true }) generatedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) approvedAt!: string | null;
  @ApiProperty() createdAt!: string;
}

export class WeeklyReviewDetailDto extends WeeklyReviewSummaryDto {
  @ApiProperty({ description: 'The deterministic numbers. `weekAggregatesSchema`.' })
  aggregates!: unknown;

  @ApiPropertyOptional({
    nullable: true,
    description:
      "The coach's six outputs, or the numbers read back with `source: 'template'` " +
      'when the provider was unavailable (PRD §120).',
  })
  aiSummary!: unknown;

  @ApiProperty({ description: 'The plan-change proposals this review raised, resolved.' })
  proposals!: unknown[];

  @ApiPropertyOptional({
    nullable: true,
    description: "The following week's plan, when one exists.",
  })
  plan!: { id: string; status: string } | null;
}

export class WeeklySettingsDto {
  @ApiProperty({ example: 5, description: '0 = Sunday … 6 = Saturday' })
  weeklyReviewWeekday!: number;

  @ApiProperty({ example: '16:00' }) weeklyReviewTime!: string;
  @ApiProperty({ example: 'America/Costa_Rica' }) timezone!: string;

  @ApiProperty({
    example: '2026-09-11T22:00:00.000Z',
    description: 'The next local occurrence of that day and hour, as an instant.',
  })
  nextReviewAt!: string;
}
