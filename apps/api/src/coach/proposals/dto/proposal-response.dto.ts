import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import type { ApplyError, DiffEntry } from '../apply-changes';
import type { PlanChange } from '../plan-change.schema';

/** The plan a proposal is about, as much of it as a list row needs. */
export class ProposalPlanDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() outcomeTitle!: string;
  @ApiProperty({ enum: ['WORK', 'FAMILY', 'HEALTH'] }) domain!: string;
}

export class ProposalSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) planId!: string;
  @ApiProperty({ enum: ['COACH', 'WEEKLY_REVIEW', 'WORKOUT', 'PATTERN'] })
  sourceKind!: string;
  @ApiProperty({
    enum: ['PROPOSED', 'ACCEPTED', 'EDITED', 'REJECTED', 'EXPIRED'],
  })
  status!: string;
  @ApiProperty({ description: 'One sentence the user reads before the diff' })
  summary!: string;
  @ApiProperty() changeCount!: number;
  @ApiProperty({ description: 'Whether the user has rewritten the coach’s changes' })
  edited!: boolean;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
  @ApiProperty({ format: 'date-time', nullable: true }) decidedAt!: string | null;
  @ApiProperty({ nullable: true }) decisionReason!: string | null;
  @ApiProperty({ format: 'uuid', nullable: true })
  appliedPlanVersionId!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: ProposalPlanDto }) plan!: ProposalPlanDto;
}

export class ProposalPreviewDto {
  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description:
      'What accepting would change, computed by the same pure function accept uses',
  })
  diff!: DiffEntry[];

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description:
      'Why it cannot be applied to the plan as it stands now. Non-empty means accept would answer 422.',
  })
  errors!: ApplyError[];
}

export class ProposalDetailDto extends ProposalSummaryDto {
  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } })
  changes!: PlanChange[];

  @ApiPropertyOptional({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    nullable: true,
    description: 'What the coach actually proposed, kept from the first edit onward',
  })
  originalChanges!: PlanChange[] | null;

  @ApiProperty({ type: ProposalPreviewDto }) preview!: ProposalPreviewDto;

  @ApiProperty({ nullable: true, type: 'object', additionalProperties: true })
  activeVersion!: { id: string; version: number } | null;
}
