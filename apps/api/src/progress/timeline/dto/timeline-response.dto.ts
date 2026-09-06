import { ApiProperty } from '@nestjs/swagger';

// The builder's types are the contract; these classes exist only so the API
// reference renders a shape.

export class TimelineEventDto {
  @ApiProperty() id!: string;
  @ApiProperty() at!: string;

  @ApiProperty({
    enum: [
      'completed',
      'completed_fallback',
      'partially_completed',
      'started_after_postpone',
      'family_kept',
      'returned_after_miss',
      'plan_change_accepted',
      'comeback_completed',
      'milestone',
    ],
  })
  kind!: string;

  @ApiProperty({
    enum: ['ordinary', 'notable', 'milestone'],
    description:
      'How loudly to render it (PRD §77). A property of the payload rather than of ' +
      'the API, so "significant" has one definition instead of one per screen.',
  })
  significance!: string;

  @ApiProperty({ enum: ['WORK', 'FAMILY', 'HEALTH'], nullable: true })
  domain!: string | null;
  @ApiProperty() title!: string;
  @ApiProperty({ nullable: true }) detail!: string | null;
  @ApiProperty({ nullable: true }) commitmentId!: string | null;
  @ApiProperty({ nullable: true }) milestoneId!: string | null;
}

export class TimelineResponseDto {
  @ApiProperty({ type: [TimelineEventDto] }) items!: TimelineEventDto[];
  @ApiProperty({ nullable: true }) nextCursor!: string | null;
}
