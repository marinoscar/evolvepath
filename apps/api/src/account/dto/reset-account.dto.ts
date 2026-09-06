import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { ACCOUNT_RESET_SCOPES } from '../account-reset.constants';

/**
 * The body of `POST /api/account/reset`.
 *
 * ---------------------------------------------------------------------------
 * THIS SCHEMA VALIDATES THE SHAPE. THE SERVICE VALIDATES THE CONTENT.
 * ---------------------------------------------------------------------------
 *
 * Two different layers enforce two different things here, on purpose. This
 * schema answers "is this a real scope, and is `confirmationPhrase` a non-empty
 * string?" — a transport concern. Whether the phrase is THE RIGHT ONE is
 * checked in `AccountResetService.reset`, against `ACCOUNT_RESET_PHRASES`,
 * because that comparison is a security control and belongs next to the thing
 * it protects rather than in the layer that parses JSON.
 *
 * Folding the content check in here would also make the failure the wrong
 * shape: a 400 from this schema means "your request was malformed", while a
 * mismatched phrase means "your request was well-formed and I refused it", and
 * a caller debugging their own client benefits from being able to tell those
 * apart.
 *
 * `scope` is derived from `ACCOUNT_RESET_SCOPES` rather than re-spelled, so a
 * third scope cannot be added to the phrase table and silently rejected here.
 */
export const resetAccountSchema = z.object({
  scope: z.enum(ACCOUNT_RESET_SCOPES),
  confirmationPhrase: z.string().min(1).max(200),
});

export class ResetAccountDto extends createZodDto(resetAccountSchema) {}
