import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DomainModeResponseDto {
  @ApiProperty({ description: 'Life domain', enum: ['WORK', 'FAMILY', 'HEALTH'] })
  domain!: string;

  @ApiProperty({
    description: 'Current posture. GROW is the default for a domain never set.',
    enum: ['GROW', 'MAINTAIN', 'RECOVER', 'PAUSE'],
  })
  mode!: string;

  @ApiPropertyOptional({ description: 'Why the user chose this posture' })
  reason!: string | null;

  @ApiPropertyOptional({
    description: 'ISO 8601 timestamp the current mode took effect, null while never set',
  })
  effectiveFrom!: string | null;
}
