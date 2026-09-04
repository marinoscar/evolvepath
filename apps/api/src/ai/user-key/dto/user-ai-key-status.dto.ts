import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { AI_PROVIDER_KINDS } from '../../ai-settings.schema';

// =============================================================================
// GET/PUT /api/me/ai-key — response body (issue #25, epic #20)
// =============================================================================
//
// Everything the key page (#28) and the setup page (#29) render, in one
// request. The three groups exist because each answers a question the user
// genuinely has and cannot answer any other way:
//
//   configured/hint/updatedAt — "is a key saved, and is it the one I think?"
//   lastTest                  — "did it work last time I checked?"
//   platform                  — "if the test skipped the generate probe, is
//                                that my problem or the administrator's?"
//
// The last one matters more than it looks. Without it, a user whose test says
// `generate: 'skipped'` has no way to tell whether their key is half-working or
// whether nobody has chosen a model yet — and the second is not theirs to fix.
//
// THE KEY IS NOT HERE, in any shape. `hint` is the credential store's own mask,
// derived on write by code that already held the plaintext. There is a
// compile-time proof at the bottom of this file.
// =============================================================================

export const userAiKeyStatusSchema = z.object({
  /** Is a key stored at `(purpose 'ai:openai:user', name '<your id>')`? */
  configured: z.boolean(),

  /** The store's non-secret mask, e.g. `••••0000`. Null when nothing is stored. */
  hint: z.string().nullable(),

  updatedAt: z.iso.datetime().nullable(),

  /**
   * The most recent test of this key, derived from `ai_invocations`.
   *
   * DERIVED RATHER THAN STORED. A `lastTestedAt` column on the credential would
   * be a second source of truth for something the telemetry table already
   * records in more detail, and the two would drift the first time a test was
   * recorded and the column write failed.
   */
  lastTest: z
    .object({
      attemptedAt: z.iso.datetime(),
      success: z.boolean(),
      model: z.string().nullable(),
      /** The provider's redacted message, when it failed. */
      error: z.string().nullable(),
    })
    .nullable(),

  /**
   * What the administrator has configured, as far as this user needs to know.
   *
   * Three booleans' worth of information and nothing else — no base URL, no
   * platform key status, no persona map. A user is entitled to know why their
   * key cannot be fully exercised; they are not entitled to the deployment's
   * configuration.
   */
  platform: z.object({
    provider: z.enum(AI_PROVIDER_KINDS).nullable(),
    enabled: z.boolean(),
    hasDefaultModel: z.boolean(),
  }),
});

export type UserAiKeyStatus = z.infer<typeof userAiKeyStatusSchema>;

export class UserAiKeyStatusDto extends createZodDto(userAiKeyStatusSchema) {}

// -----------------------------------------------------------------------------
// Compile-time proof that the status grew no secret-bearing field
// -----------------------------------------------------------------------------

type SecretFieldNames = 'apiKey' | 'key' | 'secret' | 'password' | 'token';

export type UserAiKeyStatusCarriesNoSecret =
  Extract<keyof UserAiKeyStatus, SecretFieldNames> extends never ? true : never;

export const USER_AI_KEY_STATUS_CARRIES_NO_SECRET: UserAiKeyStatusCarriesNoSecret =
  true;
