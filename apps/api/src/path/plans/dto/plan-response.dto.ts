import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** One row of a plan's history. Enough to render the version list. */
export class PlanVersionSummaryDto {
  @ApiProperty({ description: 'Plan version ID (UUID)' })
  id!: string;

  @ApiProperty({ description: 'Monotonic version number within the plan, starting at 1' })
  version!: number;

  @ApiProperty({
    description: 'Lifecycle state',
    enum: ['DRAFT', 'ACTIVE', 'SUPERSEDED', 'REJECTED'],
  })
  status!: string;

  @ApiPropertyOptional({ description: 'Why this version exists — PRD §80\'s "why it changed"' })
  rationale!: string | null;

  @ApiProperty({ description: 'Who authored it', enum: ['USER', 'AI'] })
  createdBy!: string;

  @ApiProperty({ description: 'Whether the user approved this version' })
  userApproved!: boolean;

  @ApiPropertyOptional({ description: 'The version this one replaced, null for v1' })
  previousVersionId!: string | null;

  @ApiPropertyOptional({ description: 'ISO 8601 timestamp it became active' })
  activeFrom!: string | null;

  @ApiPropertyOptional({ description: 'ISO 8601 timestamp it stopped being active' })
  activeUntil!: string | null;

  @ApiProperty({ description: 'How many routines this version carries' })
  routineCount!: number;

  @ApiProperty({ description: 'ISO 8601 creation timestamp' })
  createdAt!: string;
}

export class PlanResponseDto {
  @ApiProperty({ description: 'Plan ID (UUID)' })
  id!: string;

  @ApiProperty({ description: 'The outcome this plan serves' })
  outcomeId!: string;

  @ApiPropertyOptional({
    description: 'The currently active version, null while the plan has only drafts',
    type: PlanVersionSummaryDto,
  })
  activeVersion!: PlanVersionSummaryDto | null;

  @ApiProperty({ description: 'How many versions exist, including rejected ones' })
  versionCount!: number;

  @ApiProperty({ description: 'ISO 8601 creation timestamp' })
  createdAt!: string;
}
