import { ApiProperty } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const MEMORY_INSIGHT_CATEGORIES = [
  'IDENTITY',
  'WORK',
  'FAMILY',
  'HEALTH',
  'COACHING_PREFERENCE',
  'NOTIFICATION_PREFERENCE',
  'PATTERN',
] as const;

export const createMemoryInsightSchema = z.object({
  category: z.enum(MEMORY_INSIGHT_CATEGORIES),
  statement: z.string().trim().min(1).max(280),
});

export class CreateMemoryInsightDto extends createZodDto(
  createMemoryInsightSchema,
) {}

export const updateMemoryInsightSchema = z.object({
  statement: z.string().trim().min(1).max(280),
});

export class UpdateMemoryInsightDto extends createZodDto(
  updateMemoryInsightSchema,
) {}

export const setDoNotUseSchema = z.object({ doNotUse: z.boolean() });

export class SetDoNotUseDto extends createZodDto(setDoNotUseSchema) {}

export class MemoryInsightDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: MEMORY_INSIGHT_CATEGORIES }) category!: string;
  @ApiProperty() statement!: string;
  @ApiProperty() evidenceCount!: number;
  @ApiProperty({ description: '0–1' }) confidence!: number;

  @ApiProperty({ description: 'The user says this is true. The coach uses only confirmed insights.' })
  userConfirmed!: boolean;

  @ApiProperty({
    description:
      'The user says never bring this up. A different question from userConfirmed — an insight can be both true and forbidden.',
  })
  doNotUse!: boolean;

  @ApiProperty({ format: 'date-time', nullable: true }) expiresAt!: string | null;
  @ApiProperty({ enum: ['AI', 'USER'] }) source!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class MemoryInsightListDto {
  @ApiProperty({ type: [MemoryInsightDto] }) items!: MemoryInsightDto[];
}

export class ProposeInsightsResponseDto {
  @ApiProperty({ type: [MemoryInsightDto] }) created!: MemoryInsightDto[];

  @ApiProperty({
    nullable: true,
    enum: ['insufficient_data', 'ai_unavailable'],
    description:
      'Why nothing was created. Never an error: a proposer that cannot run is not a broken screen.',
  })
  skipped!: string | null;
}
