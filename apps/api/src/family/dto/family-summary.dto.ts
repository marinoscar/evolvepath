import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const familySummaryQuerySchema = z.object({
  /** A Monday in the caller's timezone. Defaults to the current local week. */
  weekStart: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD')
    .optional(),
  /** Counting backwards from `weekStart`, inclusive. */
  weeks: z.coerce.number().int().min(1).max(12).optional(),
});

export class FamilySummaryQueryDto extends createZodDto(familySummaryQuerySchema) {}

export class RitualWeekCountsDto {
  @ApiPropertyOptional({ description: 'Null groups the ad-hoc family commitments' })
  ritualId!: string | null;

  @ApiProperty({ description: 'The ritual’s own title' })
  title!: string;

  @ApiProperty({ description: 'Every row scheduled in the week, in any status except CANCELLED' })
  planned!: number;

  @ApiProperty({ description: 'COMPLETED' })
  kept!: number;

  @ApiProperty({ description: 'PARTIALLY_COMPLETED' })
  partial!: number;

  @ApiProperty({ description: 'RESCHEDULED, counted in the week it was originally due' })
  moved!: number;

  @ApiProperty({ description: 'SKIPPED' })
  skipped!: number;

  @ApiProperty({ description: 'MISSED' })
  missed!: number;

  @ApiProperty({ description: 'PLANNED, READY or STARTED — the week is not over yet' })
  open!: number;
}

export class FamilySummaryWeekDto {
  @ApiProperty({ description: 'The Monday this week starts on (YYYY-MM-DD)' })
  weekStart!: string;

  @ApiProperty({ type: [RitualWeekCountsDto] })
  rituals!: RitualWeekCountsDto[];

  @ApiProperty({ description: 'The week’s totals across every ritual' })
  totals!: Omit<RitualWeekCountsDto, 'ritualId' | 'title'>;
}

export class CoachNoteDto {
  @ApiProperty({ description: 'One or two sentences, with the real counts in them' })
  text!: string;

  @ApiProperty({
    description: '`template` when the coach was unavailable, or its rephrase changed a number',
    enum: ['ai', 'template'],
  })
  source!: string;
}

/**
 * Planned versus kept, per ritual, per week.
 *
 * There is no ratio, percentage, streak or grade in this response, and adding
 * one is not a small change — see `family-summary.schema.ts` for why, and
 * `no-score.guard.spec.ts` for the test that enforces it.
 */
export class FamilySummaryDto {
  @ApiProperty({ description: 'The zone the weeks were computed in' })
  timezone!: string;

  @ApiProperty({ description: 'Newest first', type: [FamilySummaryWeekDto] })
  weeks!: FamilySummaryWeekDto[];

  @ApiPropertyOptional({
    description: 'PRD §35’s sentence, or null below two displaced commitments',
    type: CoachNoteDto,
  })
  coachNote!: CoachNoteDto | null;
}
