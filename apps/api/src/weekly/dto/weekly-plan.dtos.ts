import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import {
  extraCommitmentSchema,
  isoDate,
  weeklyDomainModesSchema,
  weeklyPlanConstraintsSchema,
  type LoadWarning,
  type WeeklyDomainModes,
  type WeeklyPlanConstraints,
  type WeeklyPlanProposal,
} from '../weekly.schema';

export const createWeeklyPlanSchema = z.object({
  /** Defaults to next Monday in the user's own timezone. */
  weekStart: isoDate.optional(),
});

export class CreateWeeklyPlanDto extends createZodDto(createWeeklyPlanSchema) {}

/**
 * Strict: an unknown key is a client that thinks it is setting something.
 *
 * `constraints` is replaced whole (removing a travel day has to be expressible,
 * and a merge patch cannot delete an array element); `domainModes` is merged
 * (naming FAMILY means "leave the other two alone").
 */
export const updateWeeklyPlanSchema = z
  .object({
    constraints: weeklyPlanConstraintsSchema.optional(),
    primaryFocus: z.string().trim().max(200).nullable().optional(),
    domainModes: weeklyDomainModesSchema.optional(),
  })
  .strict();

export class UpdateWeeklyPlanDto extends createZodDto(updateWeeklyPlanSchema) {}

export const proposeWeeklyPlanSchema = z.object({
  extras: z.array(extraCommitmentSchema).max(20).default([]),
});

export class ProposeWeeklyPlanDto extends createZodDto(proposeWeeklyPlanSchema) {}

export const approveWeeklyPlanSchema = z.object({
  /**
   * "I have read the load warning", not "the software agrees". PRD §48's
   * warning is a recommendation, so approve refuses only until the user has
   * seen it — never because the week is heavy.
   */
  acknowledgeWarnings: z.boolean().default(false),
});

export class ApproveWeeklyPlanDto extends createZodDto(approveWeeklyPlanSchema) {}

export class WeeklyPlanSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: '2026-09-07' }) weekStart!: string;
  @ApiProperty({ enum: ['DRAFT', 'APPROVED'] }) status!: string;
  @ApiProperty({ nullable: true }) primaryFocus!: string | null;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: "The previous week's review this plan was made from, when there was one.",
  })
  reviewId!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true }) approvedAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class WeeklyPlanDetailDto extends WeeklyPlanSummaryDto {
  @ApiProperty({ description: 'Travel days, fixed events and free-text notes.' })
  constraints!: WeeklyPlanConstraints;

  @ApiProperty({ description: 'The postures intended for next week; partial by design.' })
  domainModes!: WeeklyDomainModes;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'The materialised week, its load summary and any warnings. Null until `propose` ' +
      'has run, and cleared again by any change to the constraints, focus or modes.',
  })
  proposal!: WeeklyPlanProposal | null;

  @ApiPropertyOptional({ nullable: true })
  review!: { id: string; weekStart: string; status: string } | null;
}

export class ApproveWeeklyPlanResultDto {
  @ApiProperty({ type: WeeklyPlanDetailDto }) plan!: WeeklyPlanDetailDto;

  @ApiProperty({
    type: [String],
    description: 'One per included item that was not already on the calendar.',
  })
  createdCommitmentIds!: string[];

  @ApiProperty({
    description: 'Occurrences that already existed, so a retry creates no duplicates.',
  })
  skippedExisting!: number;

  @ApiProperty({ description: 'The warnings the user acknowledged, kept on the response.' })
  warnings!: LoadWarning[];
}
