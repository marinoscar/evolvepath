import { ApiProperty } from '@nestjs/swagger';

/**
 * Role information
 */
export class RoleDto {
  @ApiProperty({
    example: 'admin',
    description: 'Role name',
  })
  name!: string;
}

/**
 * Whether this user has stored an OpenAI API key (#25, epic #20).
 *
 * Carried on `GET /api/auth/me` because the web app gates its whole shell on
 * it (#29) and a second request on boot would be a waterfall in front of every
 * page load. `hint` is the credential store's own mask — the key itself is
 * never returned by any endpoint.
 */
export class AiKeySummaryDto {
  @ApiProperty({
    example: true,
    description: 'Whether an OpenAI API key is stored for this user',
  })
  configured!: boolean;

  // `type` is explicit because `string | null` erases to `Object` in the
  // emitted design-time metadata.
  @ApiProperty({
    type: String,
    example: '••••0000',
    description: "The credential store's non-secret mask. Null when no key is stored.",
    nullable: true,
  })
  hint!: string | null;
}

/**
 * Current authenticated user information
 */
export class CurrentUserDto {
  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'User ID',
  })
  id!: string;

  @ApiProperty({
    example: 'user@example.com',
    description: 'User email address',
  })
  email!: string;

  // `type` is explicit because `string | null` erases to `Object` in the
  // emitted design-time metadata, so without it the property publishes as an
  // object — a client generator would produce the wrong type for the field.
  @ApiProperty({
    type: String,
    example: 'John Doe',
    description: 'Display name (computed from override or provider)',
    nullable: true,
  })
  displayName!: string | null;

  @ApiProperty({
    type: String,
    example: 'https://example.com/avatar.jpg',
    description: 'Profile image URL (computed from override or provider)',
    nullable: true,
  })
  profileImageUrl!: string | null;

  @ApiProperty({
    example: true,
    description: 'Whether the user account is active',
  })
  isActive!: boolean;

  @ApiProperty({
    type: [RoleDto],
    description: 'User roles',
  })
  roles!: RoleDto[];

  @ApiProperty({
    type: [String],
    example: ['system_settings:read', 'users:write'],
    description: 'User permissions (aggregated from roles)',
  })
  permissions!: string[];

  @ApiProperty({
    type: AiKeySummaryDto,
    description:
      "Whether this user has stored an OpenAI API key. The key itself is never returned.",
  })
  aiKey!: AiKeySummaryDto;
}

/**
 * JWT token response
 */
export class TokenResponseDto {
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    description: 'JWT access token',
  })
  accessToken!: string;

  @ApiProperty({
    example: 900,
    description: 'Token expiration time in seconds',
  })
  expiresIn!: number;
}
