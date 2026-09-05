import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** The caller's Best Self profile (PRD §10.2). */
export class BestSelfResponseDto {
  @ApiProperty({ description: 'Profile ID (UUID)' })
  id!: string;

  @ApiPropertyOptional({ description: 'Who the user is trying to become, in one sentence' })
  identityStatement!: string | null;

  @ApiPropertyOptional({ description: 'Identity statement scoped to Work' })
  workIdentity!: string | null;

  @ApiPropertyOptional({ description: 'Identity statement scoped to Family' })
  familyIdentity!: string | null;

  @ApiPropertyOptional({ description: 'Identity statement scoped to Health' })
  healthIdentity!: string | null;

  @ApiPropertyOptional({ description: 'What the next six months look like if this goes well' })
  sixMonthVision!: string | null;

  @ApiProperty({ description: 'What drives the user, in their words', type: [String] })
  motivations!: string[];

  @ApiProperty({ description: 'Why this matters to them, in their words', type: [String] })
  reasons!: string[];

  @ApiPropertyOptional({ description: 'ISO 8601 timestamp of the last replacement, null if never saved' })
  lastReviewedAt!: string | null;

  @ApiProperty({ description: 'ISO 8601 creation timestamp' })
  createdAt!: string;

  @ApiProperty({ description: 'ISO 8601 last-update timestamp' })
  updatedAt!: string;
}
