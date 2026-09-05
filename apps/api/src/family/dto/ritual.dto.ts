import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { ritualRecurrenceSchema } from '../family.schema';

/**
 * The writable fields of a ritual, before the cross-field rule.
 *
 * `minimumMinutes <= idealMinutes` is NOT expressed here, for the same reason
 * `routineFieldsSchema` keeps its rules out of the base: a `.partial()` of this
 * shape is the update body, and a refinement written on the base would either
 * be dropped by `.partial()` or fire on a patch that supplies only one of the
 * two. The rule lives in `refineRitualFields` below, shared by both.
 */
export const ritualFieldsSchema = z.object({
  title: z.string().trim().min(1).max(120),
  purpose: z.string().trim().max(300).nullish(),
  /** Optional context, never an axis of measurement (PRD §33). */
  familyMemberId: z.string().uuid().nullish(),
  recurrence: ritualRecurrenceSchema,
  /** What the ritual is worth when the evening goes well. */
  idealMinutes: z.number().int().min(5).max(240),
  /** The bad-day path. Never longer than the ideal — see `refineRitualFields`. */
  minimumMinutes: z.number().int().min(1).max(240),
  fallbackBehavior: z.string().trim().max(200).nullish(),
  /** Links the ritual to a Path outcome, which makes it visible as a routine. */
  outcomeId: z.string().uuid().nullish(),
});

type RitualFields = z.infer<typeof ritualFieldsSchema>;

/**
 * The one rule that needs two fields.
 *
 * Checked against the MERGED ritual by the update path, so a patch that raises
 * only `minimumMinutes` above the stored `idealMinutes` is still rejected.
 */
export function refineRitualFields(
  value: Partial<RitualFields>,
  ctx: z.RefinementCtx,
): void {
  if (
    value.minimumMinutes !== undefined &&
    value.idealMinutes !== undefined &&
    value.minimumMinutes > value.idealMinutes
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['minimumMinutes'],
      message: 'The minimum version cannot be longer than the ideal one',
    });
  }
}

export const createRitualSchema = ritualFieldsSchema.superRefine(refineRitualFields);

export const updateRitualSchema = ritualFieldsSchema
  .partial()
  .extend({ active: z.boolean().optional() })
  .superRefine(refineRitualFields);

export const ritualQuerySchema = z.object({
  active: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .optional(),
});

export class CreateRitualDto extends createZodDto(createRitualSchema) {}
export class UpdateRitualDto extends createZodDto(updateRitualSchema) {}
export class RitualQueryDto extends createZodDto(ritualQuerySchema) {}

export class RitualRecurrenceDto {
  @ApiProperty({
    description: '0 = Sunday … 6 = Saturday. At least one, no duplicates.',
    type: [Number],
  })
  weekdays!: number[];

  @ApiProperty({ description: "HH:mm in the user's timezone" })
  time!: string;

  @ApiProperty({ description: 'Cadence, anchored to the creation week', enum: [1, 2, 4] })
  everyNWeeks!: number;
}

export class RitualResponseDto {
  @ApiProperty({ description: 'Ritual ID (UUID)' })
  id!: string;

  @ApiProperty({ description: "What the user will do — their own behaviour, never someone else's" })
  title!: string;

  @ApiPropertyOptional({ description: 'Why it matters' })
  purpose!: string | null;

  @ApiPropertyOptional({ description: 'Who it is with' })
  familyMemberId!: string | null;

  @ApiProperty({ description: 'When it comes round', type: RitualRecurrenceDto })
  recurrence!: RitualRecurrenceDto;

  @ApiProperty({ description: 'Minutes the full version takes' })
  idealMinutes!: number;

  @ApiProperty({ description: 'Minutes the minimum version takes' })
  minimumMinutes!: number;

  @ApiPropertyOptional({ description: 'The smallest version that still counts' })
  fallbackBehavior!: string | null;

  @ApiProperty({ description: 'Whether occurrences are still being materialized' })
  active!: boolean;

  @ApiPropertyOptional({
    description: 'The last local date the materializer has covered (YYYY-MM-DD)',
  })
  lastMaterializedThrough!: string | null;

  @ApiPropertyOptional({ description: 'The routine that shows this ritual on the Path' })
  routineId!: string | null;

  @ApiProperty({ description: 'ISO 8601 creation timestamp' })
  createdAt!: string;

  @ApiProperty({ description: 'ISO 8601 last-update timestamp' })
  updatedAt!: string;
}
