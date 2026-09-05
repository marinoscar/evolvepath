import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** The active version of an outcome's plan, if it has one. */
export class ActivePlanVersionSummaryDto {
  @ApiProperty({ description: 'Plan version ID (UUID)' })
  id!: string;

  @ApiProperty({ description: 'Monotonic version number, starting at 1' })
  version!: number;
}

export class OutcomeResponseDto {
  @ApiProperty({ description: 'Outcome ID (UUID)' })
  id!: string;

  @ApiProperty({ description: 'Life domain', enum: ['WORK', 'FAMILY', 'HEALTH'] })
  domain!: string;

  @ApiProperty({ description: 'What the user is trying to achieve' })
  title!: string;

  @ApiPropertyOptional({ description: 'Longer description' })
  description!: string | null;

  @ApiPropertyOptional({ description: 'Target date as YYYY-MM-DD, null if open-ended' })
  targetDate!: string | null;

  @ApiProperty({ description: 'How much this matters, 1-5' })
  importance!: number;

  @ApiPropertyOptional({ description: 'Why it matters, in the user\'s words' })
  motivation!: string | null;

  @ApiProperty({
    description: 'Lifecycle state',
    enum: ['ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED'],
  })
  state!: string;

  @ApiPropertyOptional({ description: 'What "done" looks like' })
  successDefinition!: string | null;

  @ApiPropertyOptional({ description: 'How confident the user feels, 1-5' })
  userConfidence!: number | null;

  @ApiPropertyOptional({ description: 'ISO 8601 archive timestamp, null unless archived' })
  archivedAt!: string | null;

  @ApiPropertyOptional({ description: 'ID of this outcome\'s plan, null until one is created' })
  planId!: string | null;

  @ApiPropertyOptional({
    description: 'The plan\'s currently active version, null if none is active',
    type: ActivePlanVersionSummaryDto,
  })
  activePlanVersion!: ActivePlanVersionSummaryDto | null;

  @ApiProperty({ description: 'ISO 8601 creation timestamp' })
  createdAt!: string;

  @ApiProperty({ description: 'ISO 8601 last-update timestamp' })
  updatedAt!: string;
}
