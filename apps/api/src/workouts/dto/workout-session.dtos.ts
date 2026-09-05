import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { equipmentEnum } from './workout-program.dtos';

// =============================================================================
// The runner's wire shapes (issue #81, epic E09)
// =============================================================================
//
// `clientId` IS PART OF THE CONTRACT, not an implementation detail. PRD §121
// has the phone queueing sets it could not send and replaying the queue on
// reconnect; the id it minted is what lets the server tell a replay from a
// second set. A server-generated id could not: the client has nothing to
// compare against when it never saw the response.
// =============================================================================

const uuid = z.string().uuid();

export const workoutVariantEnum = z.enum(['FULL', 'SHORT', 'MINIMUM']);
export const discomfortEnum = z.enum(['NONE', 'MILD', 'SHARP_PAIN']);

export const startSessionSchema = z
  .object({
    commitmentId: uuid.optional(),
    templateId: uuid.optional(),
    variant: workoutVariantEnum.default('FULL'),
  })
  .refine(
    (value) => Boolean(value.commitmentId) !== Boolean(value.templateId),
    'Provide exactly one of commitmentId or templateId',
  );

export class StartSessionDto extends createZodDto(startSessionSchema) {}

export const logSetSchema = z.object({
  /** Minted by the client. The whole of the offline-replay guarantee. */
  clientId: uuid,
  exerciseId: uuid,
  setNumber: z.number().int().min(1).max(12),
  /** Kilograms, in 0.25 steps — the smallest plate pair anybody owns. */
  weightKg: z.number().min(0).max(500).multipleOf(0.25).nullish(),
  reps: z.number().int().min(0).max(100),
  rpe: z.number().int().min(1).max(10).nullish(),
  discomfort: discomfortEnum.default('NONE'),
  /** When the set actually happened. Bounded server-side; see the service. */
  loggedAt: z.string().datetime({ offset: true }).optional(),
});

export class LogSetDto extends createZodDto(logSetSchema) {}

export const logSetBatchSchema = z.object({
  sets: z.array(logSetSchema).min(1).max(50),
});

export class LogSetBatchDto extends createZodDto(logSetBatchSchema) {}

export const switchVariantSchema = z.object({ variant: workoutVariantEnum });

export class SwitchVariantDto extends createZodDto(switchVariantSchema) {}

export const finishSessionSchema = z.object({
  status: z.enum(['COMPLETED', 'ABANDONED']),
  notes: z.string().trim().max(1000).nullish(),
});

export class FinishSessionDto extends createZodDto(finishSessionSchema) {}

export const sessionQuerySchema = z.object({
  status: z.enum(['IN_PROGRESS', 'COMPLETED', 'ABANDONED']).optional(),
  templateId: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export class SessionQueryDto extends createZodDto(sessionQuerySchema) {}

// -----------------------------------------------------------------------------
// Responses
// -----------------------------------------------------------------------------

export class SetLogDto {
  @ApiProperty() id!: string;
  @ApiProperty() clientId!: string;
  @ApiProperty() exerciseId!: string;
  @ApiProperty() setNumber!: number;
  @ApiPropertyOptional({ nullable: true, description: 'Kilograms, as a number.' })
  weightKg!: number | null;
  @ApiProperty() reps!: number;
  @ApiPropertyOptional({ nullable: true }) rpe!: number | null;
  @ApiProperty({ enum: discomfortEnum.options }) discomfort!: string;
  @ApiProperty() loggedAt!: string;
}

export class LastTimeDto {
  @ApiProperty({ description: 'When that session was, ISO.' }) sessionDate!: string;
  @ApiProperty({ type: [SetLogDto] }) sets!: SetLogDto[];
}

export class SessionExerciseDto {
  @ApiProperty() order!: number;
  @ApiProperty() exerciseId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ isArray: true, enum: equipmentEnum.options }) equipment!: string[];
  @ApiProperty() instructions!: string;
  @ApiProperty() sets!: number;
  @ApiProperty() repMin!: number;
  @ApiProperty() repMax!: number;
  @ApiProperty() restSeconds!: number;
  @ApiPropertyOptional({ nullable: true }) notes!: string | null;
  @ApiPropertyOptional({ type: LastTimeDto, nullable: true }) lastTime!: LastTimeDto | null;
  @ApiPropertyOptional({
    nullable: true,
    description: 'The deterministic progression suggestion (E09-04). Null until it lands.',
  })
  progression!: unknown | null;
  @ApiProperty({ type: [SetLogDto] }) logged!: SetLogDto[];
}

export class SessionHeaderDto {
  @ApiProperty({ example: 'Upper A' }) title!: string;
  @ApiProperty({ example: 3 }) sessionIndex!: number;
  @ApiProperty({ example: 18 }) sessionTotal!: number;
}

export class WorkoutSessionSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['IN_PROGRESS', 'COMPLETED', 'ABANDONED'] }) status!: string;
  @ApiProperty({ enum: workoutVariantEnum.options }) variant!: string;
  @ApiProperty() templateId!: string;
  @ApiProperty() templateName!: string;
  @ApiProperty() startedAt!: string;
  @ApiPropertyOptional({ nullable: true }) finishedAt!: string | null;
  @ApiProperty() discomfortFlag!: boolean;
  @ApiPropertyOptional({ nullable: true }) commitmentId!: string | null;
  @ApiProperty() setCount!: number;
}

export class WorkoutSessionViewDto extends WorkoutSessionSummaryDto {
  @ApiProperty({ type: 'object', additionalProperties: true }) program!: {
    id: string;
    name: string;
  };
  @ApiProperty({ type: 'object', additionalProperties: true }) template!: {
    id: string;
    name: string;
    variant: string;
    targetMinutes: number;
  };
  @ApiProperty({ type: SessionHeaderDto }) header!: SessionHeaderDto;
  @ApiProperty({ isArray: true, enum: workoutVariantEnum.options })
  availableVariants!: string[];
  @ApiProperty({ type: [SessionExerciseDto] }) exercises!: SessionExerciseDto[];
  @ApiProperty({
    type: [SetLogDto],
    description: 'Sets logged for movements the current variant does not include.',
  })
  alsoLogged!: SetLogDto[];
  @ApiPropertyOptional({ nullable: true, type: 'object', additionalProperties: true })
  safety!: { copy: string } | null;
}

export class LogSetResponseDto {
  @ApiProperty({ type: SetLogDto }) set!: SetLogDto;
  @ApiPropertyOptional({ nullable: true, type: 'object', additionalProperties: true })
  safety!: { copy: string; action: string } | null;
}

export class LogSetBatchResponseDto {
  @ApiProperty({ type: [SetLogDto] }) accepted!: SetLogDto[];
  @ApiProperty({ isArray: true, type: String }) duplicates!: string[];
  @ApiProperty({ type: 'array', items: { type: 'object' } })
  rejected!: Array<{ clientId: string; reason: string }>;
}

export class SessionSummaryDto {
  @ApiProperty() sets!: number;
  @ApiProperty({ description: 'Σ weight × reps, in kilograms.' }) volumeKg!: number;
  @ApiProperty() minutes!: number;
  @ApiProperty() exercisesCompleted!: number;
  @ApiProperty() exercisesPlanned!: number;
}

export class FinishSessionResponseDto {
  @ApiProperty({ type: WorkoutSessionSummaryDto }) session!: WorkoutSessionSummaryDto;
  @ApiProperty({ type: SessionSummaryDto }) summary!: SessionSummaryDto;
  @ApiPropertyOptional({
    nullable: true,
    description: 'What the attached commitment became, when there was one.',
  })
  commitmentStatus!: string | null;
}
