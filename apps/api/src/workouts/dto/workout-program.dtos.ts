import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// =============================================================================
// The workout builder's wire shapes (issue #77, epic E09)
// =============================================================================
//
// `generationInput` is NOT on any response class. It holds the free-text
// limitations the user typed about their body, and while it is their own data,
// echoing it back on every program read would put it in browser caches, screen
// recordings and support screenshots for no feature that needs it.
// =============================================================================

export const equipmentEnum = z.enum([
  'BODYWEIGHT',
  'DUMBBELL',
  'BARBELL',
  'MACHINE',
  'CABLE',
  'KETTLEBELL',
  'BAND',
  'BENCH',
]);

/** `HH:MM`, 24-hour. Same rule as `user_profiles.quiet_hours_*`. */
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

/**
 * PRD §37's inputs.
 *
 * The wizard prefills these from `user_profiles.health_baseline`; the API does
 * NOT merge the baseline in. A request that is half a form and half a stored
 * profile is a request nobody can reproduce from the audit row.
 */
export const generateProgramSchema = z.object({
  goal: z.string().min(3).max(200),
  experience: z.enum(['BEGINNER', 'INTERMEDIATE']),
  daysPerWeek: z.number().int().min(2).max(5),
  minutesPerSession: z.number().int().min(20).max(75),
  equipment: z.array(equipmentEnum).min(1),
  preferences: z.string().max(500).optional(),
  limitations: z.string().max(500).optional(),
  /** Skip the model entirely and take the deterministic program. */
  useStarter: z.boolean().optional(),
});

export class GenerateProgramDto extends createZodDto(generateProgramSchema) {}

export type GenerateProgramRequest = z.infer<typeof generateProgramSchema>;

export const approveProgramSchema = z.object({
  preferredTime: hhmm.optional(),
  startDate: isoDate.optional(),
});

export class ApproveProgramDto extends createZodDto(approveProgramSchema) {}

export const programQuerySchema = z.object({
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional(),
});

export class ProgramQueryDto extends createZodDto(programQuerySchema) {}

export const exerciseQuerySchema = z.object({
  q: z.string().max(80).optional(),
  group: z.string().max(40).optional(),
});

export class ExerciseQueryDto extends createZodDto(exerciseQuerySchema) {}

// -----------------------------------------------------------------------------
// Responses
// -----------------------------------------------------------------------------

export class ExerciseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ isArray: true, enum: equipmentEnum.options }) equipment!: string[];
  @ApiProperty() movementPattern!: string;
  @ApiProperty() instructions!: string;
  @ApiProperty({ isArray: true, type: String }) contraindicationTags!: string[];
  @ApiProperty() substitutionGroup!: string;
  @ApiProperty() isCustom!: boolean;
}

export class TemplateExerciseDto {
  @ApiProperty() id!: string;
  @ApiProperty() exerciseId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() order!: number;
  @ApiProperty() sets!: number;
  @ApiProperty() repMin!: number;
  @ApiProperty() repMax!: number;
  @ApiProperty() restSeconds!: number;
  @ApiPropertyOptional({ nullable: true }) notes!: string | null;
}

export class WorkoutTemplateDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['FULL', 'SHORT', 'MINIMUM'] }) variant!: string;
  @ApiProperty() targetMinutes!: number;
  @ApiPropertyOptional({ nullable: true }) routineId!: string | null;
  @ApiProperty({ type: [TemplateExerciseDto] }) exercises!: TemplateExerciseDto[];
}

export class WeeklyStructureEntryDto {
  @ApiProperty({ description: '0 = Sunday … 6 = Saturday' }) weekday!: number;
  @ApiProperty() templateId!: string;
}

export class WorkoutProgramSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['DRAFT', 'ACTIVE', 'ARCHIVED'] }) status!: string;
  @ApiProperty() durationWeeks!: number;
  @ApiProperty({ type: [WeeklyStructureEntryDto] }) weeklyStructure!: WeeklyStructureEntryDto[];
  @ApiPropertyOptional({ nullable: true }) planId!: string | null;
  @ApiProperty() createdAt!: string;
}

export class WorkoutProgramDto extends WorkoutProgramSummaryDto {
  @ApiPropertyOptional({ nullable: true }) rationale!: string | null;
  @ApiProperty({ type: [WorkoutTemplateDto] }) templates!: WorkoutTemplateDto[];
  @ApiProperty({
    description: 'Named alternatives per movement, resolved to catalog ids.',
    type: 'array',
    items: { type: 'object' },
  })
  substitutions!: Array<{ exerciseId: string; alternativeExerciseIds: string[] }>;
}

export class GenerateProgramResponseDto {
  @ApiProperty({ type: WorkoutProgramDto }) program!: WorkoutProgramDto;
  @ApiProperty({
    enum: ['ai', 'starter'],
    description: "`starter` means the deterministic fallback ran — see `reason` (PRD §120).",
  })
  source!: 'ai' | 'starter';
  @ApiPropertyOptional({
    nullable: true,
    enum: ['invalid_output', 'ai_unavailable', 'safety_redirect', 'requested'],
  })
  reason!: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'One sentence for the user.' })
  message!: string | null;
}

export class ApproveProgramResponseDto {
  @ApiProperty({ type: WorkoutProgramDto }) program!: WorkoutProgramDto;
  @ApiProperty() planVersionId!: string;
  @ApiProperty({ isArray: true, type: String }) commitmentIds!: string[];
}
