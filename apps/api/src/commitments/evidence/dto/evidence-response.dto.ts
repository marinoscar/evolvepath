import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class EvidenceResponseDto {
  @ApiProperty({ description: 'Evidence ID (UUID)' })
  id!: string;

  @ApiPropertyOptional({
    description:
      'The commitment this evidence is about. Null once that commitment is deleted — evidence ' +
      'outlives it (PRD §103).',
  })
  commitmentId!: string | null;

  @ApiProperty({ description: "Free label: 'completion', 'partial', 'start', 'timer', …" })
  evidenceType!: string;

  @ApiProperty({
    description: 'Where this fact came from. Only USER_LOG can be written through the API.',
    enum: ['USER_LOG', 'TIMER', 'WORKOUT_LOG', 'APP_FLOW'],
  })
  source!: string;

  @ApiProperty({ description: 'ISO 8601 timestamp of when it happened' })
  occurredAt!: string;

  @ApiPropertyOptional({ description: 'A measured amount, if there was one' })
  quantitativeValue!: number | null;

  @ApiPropertyOptional({ description: 'The unit of that amount' })
  quantitativeUnit!: string | null;

  @ApiPropertyOptional({ description: "What the user said about it, in their words" })
  qualitativeValue!: string | null;

  @ApiPropertyOptional({ description: 'How sure this fact is, 0-1' })
  confidence!: number | null;

  @ApiProperty({ description: 'ISO 8601 creation timestamp' })
  createdAt!: string;
}
