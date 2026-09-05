import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReflectionResponseDto {
  @ApiProperty({ description: 'Reflection ID (UUID)' })
  id!: string;

  @ApiProperty({
    description: 'What this reflection is about',
    enum: ['commitment', 'outcome', 'plan_version', 'day'],
  })
  relatedType!: string;

  @ApiPropertyOptional({ description: 'The row it is about; null for a whole day' })
  relatedId!: string | null;

  @ApiPropertyOptional({ description: 'What the user wrote' })
  userText!: string | null;

  @ApiPropertyOptional({ description: 'An AI summary, when one has been made (E06)' })
  aiSummary!: string | null;

  @ApiProperty({ description: 'What got in the way, as short tags', type: [String] })
  frictionTags!: string[];

  @ApiPropertyOptional({ description: 'Mood, 1-5' })
  mood!: number | null;

  @ApiPropertyOptional({ description: 'How hard it felt, 1-5' })
  perceivedDifficulty!: number | null;

  @ApiPropertyOptional({ description: 'How satisfied they were, 1-5' })
  satisfaction!: number | null;

  @ApiProperty({ description: 'ISO 8601 creation timestamp' })
  createdAt!: string;
}
