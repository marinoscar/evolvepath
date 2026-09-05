import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const lintTitleSchema = z.object({
  title: z.string().trim().min(1).max(120),
});

export class LintTitleDto extends createZodDto(lintTitleSchema) {}

export class LintResultDto {
  @ApiProperty({ description: 'Whether the title describes the user’s own behaviour' })
  ok!: boolean;

  @ApiPropertyOptional({
    description: 'Why it was refused',
    enum: ['TARGETS_OTHER_PERSON'],
  })
  code!: string | null;

  @ApiPropertyOptional({ description: 'The offending substring, so the UI can point at it' })
  match!: string | null;

  @ApiPropertyOptional({
    description:
      'A rewrite the user may accept. Never applied automatically, and itself re-linted before ' +
      'being offered.',
  })
  suggestion!: string | null;

  @ApiProperty({
    description: '`none` when AI is unavailable — the verdict above never depends on it',
    enum: ['ai', 'none'],
  })
  source!: string;
}

export class MaterializeResultDto {
  @ApiProperty({ description: 'Occurrences inserted by this run' })
  created!: number;

  @ApiProperty({
    description: 'Occurrences that already existed. Repeats land here, never as duplicates.',
  })
  skipped!: number;

  @ApiProperty({ description: 'The local date the ritual is now covered through (YYYY-MM-DD)' })
  through!: string;
}
