import { ApiProperty } from '@nestjs/swagger';

export class MilestoneDto {
  @ApiProperty() id!: string;

  @ApiProperty({
    enum: [
      'FIRST_FULL_WEEK',
      'FOUR_WEEKS',
      'TEN_WORKOUTS',
      'FIRST_COMEBACK',
      'REDUCED_REMINDERS',
      'FIRST_START_AFTER_POSTPONE',
    ],
  })
  kind!: string;

  @ApiProperty({ description: 'The n-th of a repeatable kind; 1 for one-off kinds' })
  sequence!: number;

  @ApiProperty({ enum: ['WORK', 'FAMILY', 'HEALTH'], nullable: true })
  domain!: string | null;
  @ApiProperty() achievedAt!: string;
  @ApiProperty({ nullable: true, description: 'Null until the user has seen it' })
  acknowledgedAt!: string | null;
  @ApiProperty() title!: string;
  @ApiProperty() body!: string;
  @ApiProperty({ description: 'Ids and counts only — never free text' })
  meta!: Record<string, unknown>;
}

export class MilestoneListDto {
  @ApiProperty({ type: [MilestoneDto] }) items!: MilestoneDto[];
}
