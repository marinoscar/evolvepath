import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RoutineResponseDto {
  @ApiProperty({ description: 'Routine ID (UUID)' })
  id!: string;

  @ApiProperty({ description: 'The plan version this routine belongs to' })
  planVersionId!: string;

  @ApiProperty({ description: 'What the user will actually do' })
  title!: string;

  @ApiProperty({ description: 'Life domain', enum: ['WORK', 'FAMILY', 'HEALTH'] })
  domain!: string;

  @ApiProperty({ description: 'What starts it', enum: ['TIME', 'EVENT'] })
  triggerType!: string;

  @ApiPropertyOptional({
    description: 'HH:mm for a TIME trigger; the event itself for an EVENT trigger',
  })
  triggerValue!: string | null;

  @ApiProperty({
    description: 'How often',
    enum: ['DAILY', 'WEEKDAYS', 'WEEKENDS', 'WEEKLY', 'CUSTOM'],
  })
  frequency!: string;

  @ApiProperty({ description: '0 = Sunday … 6 = Saturday; only set for CUSTOM', type: [Number] })
  daysOfWeek!: number[];

  @ApiPropertyOptional({ description: 'Preferred local time as HH:mm' })
  preferredTime!: string | null;

  @ApiProperty({ description: 'Minutes the full version takes' })
  estimatedDurationMin!: number;

  @ApiProperty({ description: 'Minutes the minimum version takes — the bad-day path' })
  minimumDurationMin!: number;

  @ApiPropertyOptional({ description: 'What to do instead when the full version is impossible' })
  fallbackBehavior!: string | null;

  @ApiProperty({ description: 'Whether this routine is currently in force' })
  active!: boolean;

  @ApiProperty({ description: 'Display order within the version' })
  sortOrder!: number;

  @ApiProperty({ description: 'ISO 8601 creation timestamp' })
  createdAt!: string;

  @ApiProperty({ description: 'ISO 8601 last-update timestamp' })
  updatedAt!: string;
}
