import { ApiProperty } from '@nestjs/swagger';

import { CommitmentCardDto } from '../../commitments/dto/commitment-card.dto';
import { INTERVENTION_MODES } from '../nba/intervention-mode';

// The Zod schema in `today.schema.ts` is the contract; these classes exist only
// so the reference renders a shape instead of an untyped object.

export class NextBestActionFallbackDto {
  @ApiProperty() title!: string;
  @ApiProperty() durationMinutes!: number;
}

export class NextBestActionDto {
  @ApiProperty() commitmentId!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ enum: ['WORK', 'FAMILY', 'HEALTH'] }) domain!: string;
  @ApiProperty() durationMinutes!: number;

  @ApiProperty({
    enum: ['full', 'short', 'minimum'],
    description: 'Which of the three sizes is being recommended right now',
  })
  version!: string;

  @ApiProperty({
    description:
      'One deterministic sentence explaining why this one. Never AI — the screen must read ' +
      'correctly with the provider down (PRD §120).',
  })
  rationale!: string;

  @ApiProperty({
    type: NextBestActionFallbackDto,
    description: 'The smaller thing to offer beside it, so a bad day is never a zero',
  })
  fallback!: NextBestActionFallbackDto;

  @ApiProperty({ enum: INTERVENTION_MODES, description: 'The coaching posture today calls for' })
  interventionMode!: string;

  @ApiProperty({ description: 'The gap between first and second place, clamped to 0.2–0.95' })
  confidence!: number;
}

export class TodayDomainDto {
  @ApiProperty({ enum: ['WORK', 'FAMILY', 'HEALTH'] }) domain!: string;

  @ApiProperty({
    enum: ['GROW', 'MAINTAIN', 'RECOVER', 'PAUSE'],
    description: 'A missing DomainMode row means GROW; the API synthesises it',
  })
  mode!: string;

  @ApiProperty({ type: [CommitmentCardDto] })
  commitments!: CommitmentCardDto[];
}

export class TodayCheckInDto {
  @ApiProperty({ enum: ['NORMAL', 'PACKED', 'LOW_ENERGY', 'UNEXPECTED_PROBLEM'] })
  feel!: string;
}

export class TodayResponseDto {
  @ApiProperty({ example: 'morning', enum: ['morning', 'afternoon', 'evening'] })
  greeting!: string;

  @ApiProperty({ example: '3 commitments today. Health is in maintenance mode this week.' })
  stateLine!: string;

  @ApiProperty({ example: '2026-03-02', description: "The user's local calendar date" })
  dateLocal!: string;

  @ApiProperty({ example: 'America/Costa_Rica', description: 'The zone dateLocal was resolved in' })
  timeZone!: string;

  @ApiProperty({
    type: TodayCheckInDto,
    nullable: true,
    description: 'Null until the user taps a check-in chip today',
  })
  checkIn!: TodayCheckInDto | null;

  @ApiProperty({
    type: NextBestActionDto,
    nullable: true,
    description: 'Null when there is nothing to recommend — an empty day is not a failure',
  })
  nextBestAction!: NextBestActionDto | null;

  @ApiProperty({
    type: [TodayDomainDto],
    description: 'Always three, in canonical order, including the empty and the paused',
  })
  domains!: TodayDomainDto[];

  @ApiProperty({ type: 'null', description: 'Reserved for E11' })
  momentum!: null;

  @ApiProperty({
    type: 'null',
    description: 'Always null. Fetch `GET /today/insight` separately — see that route.',
  })
  coachInsight!: null;
}

export class TodayInsightDto {
  @ApiProperty({ description: 'One sentence, at most 280 characters' })
  text!: string;

  @ApiProperty({
    enum: ['ai', 'template'],
    description: '`template` means the coach was unavailable and this is the deterministic path',
  })
  source!: string;

  @ApiProperty() generatedAt!: string;
}
