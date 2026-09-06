import { ApiProperty } from '@nestjs/swagger';

/**
 * What `GET /api/account/data-summary` returns: what a reset would take, and
 * what the caller must type to authorise it.
 *
 * `counts` is keyed by the snake_case DATABASE table name, not the Prisma
 * accessor — see `ACCOUNT_RESET_TABLES`' own comment for why the two are
 * frozen apart. It is an open record rather than a fixed set of properties
 * deliberately: the set of tables a reset touches is `ACCOUNT_RESET_TABLES`'
 * to declare, and restating it as thirty-one DTO properties would create a
 * second list that could disagree with the first.
 */
export class AccountResetPhrasesDto {
  @ApiProperty({
    description: 'What to type to erase your data and keep your OpenAI key',
    example: 'DELETE MY DATA',
  })
  data!: string;

  @ApiProperty({
    description: 'What to type to erase your data AND your stored OpenAI key',
    example: 'DELETE EVERYTHING',
  })
  data_and_key!: string;
}

export class AccountDataSummaryDto {
  @ApiProperty({
    description:
      'Row counts a reset would erase, keyed by database table name. Includes ' +
      '`storage_objects` and `media_attachments`, which are removed through the ' +
      'storage service rather than by a plain delete. Tables that cascade from ' +
      'one of these (`coach_messages`, `set_logs`, `workout_templates`, ' +
      '`storage_object_chunks`) are deliberately not listed separately: they ' +
      'would double-count deletions from the reader\'s point of view.',
    example: { commitments: 42, outcomes: 3, evidence_items: 118, storage_objects: 2 },
    additionalProperties: { type: 'number' },
    type: 'object',
  })
  counts!: Record<string, number>;

  @ApiProperty({
    description:
      'The exact phrase each scope requires, served here so a client renders ' +
      'the same string the server will check rather than a copy that can drift.',
    type: AccountResetPhrasesDto,
  })
  phrases!: AccountResetPhrasesDto;
}

/** The service-side shape, without the Swagger decoration. */
export interface AccountDataSummary {
  counts: Record<string, number>;
  phrases: { data: string; data_and_key: string };
}
