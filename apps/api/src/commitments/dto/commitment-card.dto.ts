import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { COMMITMENT_ACTIONS } from '../commitment-actions';

// =============================================================================
// OpenAPI shapes for the commitment card (issue #40, epic E05)
// =============================================================================
//
// The Zod schema in `commitment-card.schema.ts` is the CONTRACT — it is what
// validates, what infers `CommitmentCard`, and what the tests parse responses
// against. These classes exist only so the reference renders the shape instead
// of an untyped object; they are documentation, not a second source of truth.
// =============================================================================

export class CommitmentVersionDto {
  @ApiProperty({ description: 'What this size of the intention is called' })
  title!: string;

  @ApiProperty({ description: 'How long it takes, in minutes' })
  minutes!: number;
}

export class CommitmentVersionsDto {
  @ApiProperty({ type: CommitmentVersionDto, description: 'Always present' })
  full!: CommitmentVersionDto;

  @ApiProperty({
    type: CommitmentVersionDto,
    nullable: true,
    description: 'Null unless a shorter version was actually declared',
  })
  short!: CommitmentVersionDto | null;

  @ApiProperty({
    type: CommitmentVersionDto,
    nullable: true,
    description: 'The smallest version that still counts (PRD §57)',
  })
  minimum!: CommitmentVersionDto | null;
}

export class CommitmentTimerDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'When the current run began. Null while paused.',
  })
  activeSince!: string | null;

  @ApiProperty({ description: 'Active time banked up to the last pause, in seconds' })
  activeSeconds!: number;

  @ApiProperty({
    description:
      'Total active seconds as of this response — what a reloaded Start screen resumes from',
  })
  elapsedSeconds!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'The chosen target. Null for an open-ended session.',
  })
  timerMinutes!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Seconds left against the target. Null when there is no target.',
  })
  remainingSeconds!: number | null;
}

export class CommitmentCardDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ enum: ['WORK', 'FAMILY', 'HEALTH'] }) domain!: string;
  @ApiProperty() status!: string;
  @ApiProperty() scheduledStart!: string;
  @ApiProperty({ type: String, nullable: true }) scheduledEnd!: string | null;

  @ApiProperty({ description: "The full version's cost in minutes" })
  durationMinutes!: number;

  @ApiProperty({ type: CommitmentVersionsDto })
  versions!: CommitmentVersionsDto;

  @ApiProperty({ description: 'How much this matters, 1-5' }) importance!: number;
  @ApiProperty({ description: 'How many times this intention has been moved' })
  rescheduleCount!: number;

  @ApiProperty({ type: String, nullable: true }) startedAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) completedAt!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    enum: ['FULL', 'SHORT', 'MINIMUM'],
    description: 'Which size was actually done',
  })
  versionUsed!: string | null;

  @ApiProperty({ type: Number, nullable: true }) minutesSpent!: number | null;
  @ApiProperty({ type: String, nullable: true }) outcomeId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Set when this is the small version of a bigger commitment',
  })
  decomposedFromId!: string | null;

  @ApiPropertyOptional({
    type: [CommitmentVersionDto],
    nullable: true,
    description: 'Steps from an applied decomposition',
  })
  steps!: CommitmentVersionDto[] | null;

  @ApiProperty({
    type: CommitmentTimerDto,
    nullable: true,
    description: 'Server-derived. Null for a commitment nobody has started.',
  })
  timer!: CommitmentTimerDto | null;

  @ApiProperty({
    type: [String],
    enum: COMMITMENT_ACTIONS,
    description:
      'What the server will accept next. The client renders this list rather than computing ' +
      'one — a client running an older bundle would otherwise offer a move this API refuses.',
  })
  availableActions!: string[];
}

export class DecompositionStepDto {
  @ApiProperty() title!: string;
  @ApiProperty() minutes!: number;
}

export class DecompositionProposalDto {
  @ApiProperty({ type: [DecompositionStepDto], description: '1 to 5 steps, in order' })
  steps!: DecompositionStepDto[];

  @ApiProperty({
    type: DecompositionStepDto,
    description: 'At most 15 minutes — the whole point is to make starting cheap',
  })
  firstStep!: DecompositionStepDto;

  @ApiProperty({ description: 'One sentence to the user. Never persisted.' })
  message!: string;

  @ApiProperty({
    enum: ['ai', 'template'],
    description: '`template` means the coach was unavailable and this is the deterministic path',
  })
  source!: string;
}
