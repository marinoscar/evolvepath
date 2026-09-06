import { ApiProperty } from '@nestjs/swagger';

import { MOMENTUM_STATES } from '../momentum/momentum-engine';

// The Zod schema in `progress.schema.ts` is the contract; these classes exist
// only so the API reference renders a shape instead of an untyped object.

export class MomentumSignalsDto {
  @ApiProperty() planned!: number;
  @ApiProperty() completed!: number;
  @ApiProperty() partial!: number;
  @ApiProperty({ description: 'Completions done at the short or minimum size' })
  fallback!: number;
  @ApiProperty() missed!: number;
  @ApiProperty() skipped!: number;
  @ApiProperty() consecutiveMisses!: number;
  @ApiProperty() rescheduledTwice!: number;
  @ApiProperty({ nullable: true }) lastCompletionAt!: string | null;
  @ApiProperty({ nullable: true }) lastMissAt!: string | null;
  @ApiProperty({ nullable: true }) returnedAfterIdleDays!: number | null;
}

export class TrendPointDto {
  @ApiProperty() weekStart!: string;
  @ApiProperty() planned!: number;
  @ApiProperty() completed!: number;
}

export class MomentumDto {
  @ApiProperty({ enum: ['WORK', 'FAMILY', 'HEALTH'] }) domain!: string;
  @ApiProperty({ enum: MOMENTUM_STATES as unknown as string[] }) state!: string;

  @ApiProperty({
    type: [String],
    description:
      'At most three sentences made of counts — "5 of 6 planned workouts completed". ' +
      'Never a percentage (PRD §54).',
  })
  evidence!: string[];

  @ApiProperty({ type: MomentumSignalsDto }) signals!: MomentumSignalsDto;
  @ApiProperty({ type: [TrendPointDto], description: 'The last four weeks' })
  trend!: TrendPointDto[];
}

export class MomentumByDomainDto {
  @ApiProperty({ type: MomentumDto }) WORK!: MomentumDto;
  @ApiProperty({ type: MomentumDto }) FAMILY!: MomentumDto;
  @ApiProperty({ type: MomentumDto }) HEALTH!: MomentumDto;
}

export class WeekStatDto {
  @ApiProperty({ description: 'The Monday, YYYY-MM-DD, in the user timezone' })
  weekStart!: string;
  @ApiProperty() planned!: number;
  @ApiProperty() completed!: number;
  @ApiProperty() success!: boolean;
  @ApiProperty({ description: 'A missed week the run forgave' }) graced!: boolean;
  @ApiProperty({ description: 'The week in progress — reported, never counted' })
  current!: boolean;
}

export class ConsistencyRunDto {
  @ApiProperty({ description: 'Consecutive counted weeks, not days' }) weeks!: number;
  @ApiProperty() graceUsed!: number;
  @ApiProperty({ type: [WeekStatDto] }) weekly!: WeekStatDto[];
}

export class RecoveryDto {
  @ApiProperty({ nullable: true, description: 'Median days from a miss to the next completion' })
  medianDays!: number | null;
  @ApiProperty() samples!: number;
}

export class IndependenceDto {
  @ApiProperty({
    nullable: true,
    description:
      'Share of completions that followed no reminder. Null until E12 records ' +
      'notification interactions — the UI says so rather than showing a zero.',
  })
  ratio!: number | null;
  @ApiProperty() completedWithoutReminder!: number;
  @ApiProperty() sampleSize!: number;
}

export class MilestoneDto {
  @ApiProperty() id!: string;
  @ApiProperty() kind!: string;
  @ApiProperty() title!: string;
  @ApiProperty() achievedAt!: string;
}

export class ProgressInsightDto {
  @ApiProperty() id!: string;
  @ApiProperty() category!: string;
  @ApiProperty() statement!: string;
}

export class ProgressResponseDto {
  @ApiProperty() generatedAt!: string;
  @ApiProperty({ example: 28 }) windowDays!: number;
  @ApiProperty({ type: MomentumByDomainDto }) momentum!: MomentumByDomainDto;
  @ApiProperty({ type: ConsistencyRunDto }) consistencyRun!: ConsistencyRunDto;
  @ApiProperty({ type: RecoveryDto }) recovery!: RecoveryDto;
  @ApiProperty({ type: IndependenceDto }) independence!: IndependenceDto;
  @ApiProperty({ type: [MilestoneDto] }) milestones!: MilestoneDto[];
  @ApiProperty({ type: [ProgressInsightDto] }) insights!: ProgressInsightDto[];
}
