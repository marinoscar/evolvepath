import { ApiProperty } from '@nestjs/swagger';

import type { AccountResetScope } from '../account-reset.constants';

/**
 * What `POST /api/account/reset` returns: what was actually deleted.
 *
 * The same shape and the same keys as `AccountDataSummaryDto.counts`, so the
 * confirmation screen and the screen that preceded it read the identical
 * structure — and so a caller can diff the two if they want to.
 *
 * These are the numbers that also land in the `account:reset` audit row.
 * Counts and table names, never a row's content.
 */
export class AccountResetResultDto {
  @ApiProperty({
    description: 'Which scope was applied',
    enum: ['data', 'data_and_key'],
  })
  scope!: AccountResetScope;

  @ApiProperty({
    description: 'Rows actually deleted, keyed by database table name',
    example: { commitments: 42, outcomes: 3, storage_objects: 2 },
    additionalProperties: { type: 'number' },
    type: 'object',
  })
  deleted!: Record<string, number>;

  @ApiProperty({
    description:
      'Whether your stored OpenAI key was removed. True only for ' +
      '`data_and_key`. Your key at OpenAI itself is untouched.',
  })
  aiKeyRemoved!: boolean;
}

/** The service-side shape, without the Swagger decoration. */
export interface AccountResetResult {
  scope: AccountResetScope;
  deleted: Record<string, number>;
  aiKeyRemoved: boolean;
}
