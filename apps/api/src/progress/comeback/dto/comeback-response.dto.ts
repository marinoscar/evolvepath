import { ApiProperty } from '@nestjs/swagger';

import { CommitmentCardDto } from '../../../commitments/dto/commitment-card.dto';

// The Zod schemas in `comeback.schema.ts` are the contract; these classes exist
// only so the API reference renders a shape.

export class RestartAlternativeDto {
  @ApiProperty({ enum: ['WORK', 'FAMILY', 'HEALTH'] }) domain!: string;
  @ApiProperty() title!: string;
  @ApiProperty() minutes!: number;
}

export class ComebackRecommendationDto {
  @ApiProperty({ enum: ['WORK', 'FAMILY', 'HEALTH'] }) domain!: string;
  @ApiProperty({ description: 'Why this one, in the user’s own terms' })
  reason!: string;
}

export class ComebackWordingDto {
  @ApiProperty({ example: 'No catching up. We start from today.' }) note!: string;
}

export class ComebackStatusDto {
  @ApiProperty({ enum: ['NONE', 'OFFERED', 'IN_PROGRESS'] }) state!: string;
  @ApiProperty({ enum: ['INACTIVITY', 'REPEATED_MISSES'], nullable: true })
  trigger!: string | null;
  @ApiProperty({ nullable: true }) offeredAt!: string | null;
  @ApiProperty({ nullable: true }) idleDays!: number | null;

  @ApiProperty({
    description:
      'How many stale intentions became history. A COUNT — the rows themselves ' +
      'are never listed back at the user (PRD §109).',
  })
  closedCount!: number;

  @ApiProperty() planReviewSuggested!: boolean;
  @ApiProperty({ type: CommitmentCardDto, nullable: true })
  restart!: CommitmentCardDto | null;
  @ApiProperty({ type: ComebackRecommendationDto, nullable: true })
  recommendation!: ComebackRecommendationDto | null;
  @ApiProperty({ type: [RestartAlternativeDto] })
  alternatives!: RestartAlternativeDto[];
  @ApiProperty({ type: ComebackWordingDto }) wording!: ComebackWordingDto;
}

export class ComebackCelebrationDto {
  @ApiProperty({ example: 'Back on Path.' }) title!: string;
  @ApiProperty() body!: string;
}

export class ComebackCompletionDto {
  @ApiProperty({ type: ComebackCelebrationDto })
  celebration!: ComebackCelebrationDto;
  @ApiProperty() evidenceId!: string;
  @ApiProperty({ nullable: true, description: 'Filled by epic E11-03' })
  milestone!: unknown;
  @ApiProperty({ type: CommitmentCardDto, nullable: true })
  nextCommitment!: CommitmentCardDto | null;
  @ApiProperty() planReviewSuggested!: boolean;
}
