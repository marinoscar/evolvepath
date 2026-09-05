import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';

import {
  createFamilyMemberSchema,
  updateFamilyMemberSchema,
} from '../family.schema';

/**
 * The whole family member record.
 *
 * Five properties, and PRD §33 is why there is no sixth. Adding one here means
 * adding it to `familyMemberResponseSchema` and to
 * `FAMILY_MEMBER_RESPONSE_KEYS`, and `family.mapper.spec.ts` compares the
 * mapper's key set against that list by equality — so the decision cannot be
 * made by accident.
 */
export class FamilyMemberResponseDto {
  @ApiProperty({ description: 'Family member ID (UUID)' })
  id!: string;

  @ApiProperty({ description: 'What the user calls them. Max 40 characters.' })
  nickname!: string;

  @ApiProperty({
    description: 'How the user describes the relationship',
    enum: ['PARTNER', 'CHILD', 'PARENT', 'SIBLING', 'FRIEND', 'OTHER'],
  })
  relationship!: string;

  @ApiPropertyOptional({
    description:
      'Calendar date as YYYY-MM-DD. The year may be the 1900 placeholder when the user does ' +
      'not know it; every consumer ignores the year.',
  })
  birthday!: string | null;

  @ApiProperty({ description: 'ISO 8601 creation timestamp' })
  createdAt!: string;
}

export class CreateFamilyMemberDto extends createZodDto(createFamilyMemberSchema) {}
export class UpdateFamilyMemberDto extends createZodDto(updateFamilyMemberSchema) {}
