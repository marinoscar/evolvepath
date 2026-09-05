import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { EvidenceResponseDto } from '../evidence/dto/evidence-response.dto';
import { ReflectionResponseDto } from '../reflections/dto/reflection-response.dto';

export class CommitmentResponseDto {
  @ApiProperty({ description: 'Commitment ID (UUID)' })
  id!: string;

  @ApiProperty({ description: 'Life domain', enum: ['WORK', 'FAMILY', 'HEALTH'] })
  domain!: string;

  @ApiProperty({ description: 'What the user intends to do' })
  title!: string;

  @ApiPropertyOptional({ description: 'The outcome this serves' })
  outcomeId!: string | null;

  @ApiPropertyOptional({ description: 'The plan version this came from' })
  planVersionId!: string | null;

  @ApiPropertyOptional({ description: 'The routine this instantiates' })
  routineId!: string | null;

  @ApiProperty({ description: 'ISO 8601 scheduled start' })
  scheduledStart!: string;

  @ApiPropertyOptional({ description: 'ISO 8601 scheduled end' })
  scheduledEnd!: string | null;

  @ApiProperty({ description: 'How much this matters, 1-5' })
  importance!: number;

  @ApiPropertyOptional({ description: 'A free label for the kind of commitment' })
  commitmentType!: string | null;

  @ApiPropertyOptional({ description: 'The full version of the intention' })
  fullVersion!: string | null;

  @ApiPropertyOptional({ description: 'A shorter version for a tight day' })
  shortVersion!: string | null;

  @ApiPropertyOptional({ description: 'The smallest version that still counts (PRD §57)' })
  minimumVersion!: string | null;

  @ApiPropertyOptional({ description: 'How long the full version takes, in minutes' })
  fullMinutes!: number | null;

  @ApiPropertyOptional({ description: 'How long the short version takes, in minutes' })
  shortMinutes!: number | null;

  @ApiPropertyOptional({ description: 'How long the minimum version takes, in minutes' })
  minimumMinutes!: number | null;

  @ApiProperty({
    description: 'Lifecycle state',
    enum: [
      'PLANNED',
      'READY',
      'STARTED',
      'COMPLETED',
      'PARTIALLY_COMPLETED',
      'RESCHEDULED',
      'SKIPPED',
      'MISSED',
      'CANCELLED',
    ],
  })
  status!: string;

  @ApiProperty({
    description:
      'The statuses this commitment may move to next, from the transition matrix. The UI ' +
      'renders exactly these, so it can never offer a move the API refuses.',
    type: [String],
  })
  allowedTransitions!: string[];

  @ApiProperty({ description: 'How many times this intention has been moved' })
  rescheduleCount!: number;

  @ApiPropertyOptional({ description: 'The commitment this one was moved from' })
  rescheduledFromId!: string | null;

  @ApiPropertyOptional({ description: 'The commitment this one was moved to' })
  rescheduledToId!: string | null;

  @ApiPropertyOptional({ description: 'Why it was skipped' })
  skipReason!: string | null;

  @ApiProperty({ description: 'Whether the user confirmed this commitment' })
  userConfirmed!: boolean;

  @ApiPropertyOptional({ description: 'ISO 8601 timestamp the user started' })
  startedAt!: string | null;

  @ApiPropertyOptional({ description: 'ISO 8601 timestamp the user finished' })
  completedAt!: string | null;

  @ApiProperty({ description: 'How many evidence rows are attached' })
  evidenceCount!: number;

  @ApiProperty({ description: 'ISO 8601 creation timestamp' })
  createdAt!: string;

  @ApiProperty({ description: 'ISO 8601 last-update timestamp' })
  updatedAt!: string;
}

export class CommitmentDetailDto extends CommitmentResponseDto {
  @ApiProperty({ description: 'What actually happened', type: [EvidenceResponseDto] })
  evidence!: EvidenceResponseDto[];

  @ApiProperty({ description: 'What the user made of it', type: [ReflectionResponseDto] })
  reflections!: ReflectionResponseDto[];
}

export class TransitionResultDto {
  @ApiProperty({ description: 'The commitment after the transition', type: CommitmentResponseDto })
  commitment!: CommitmentResponseDto;

  @ApiPropertyOptional({
    description:
      'The new commitment a reschedule opened at the new time, null for every other transition',
    type: CommitmentResponseDto,
  })
  rescheduledTo!: CommitmentResponseDto | null;

  @ApiPropertyOptional({
    description: 'The evidence row the user logged with this transition, if any',
    type: EvidenceResponseDto,
  })
  evidence!: EvidenceResponseDto | null;
}
