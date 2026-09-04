import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { aiSettingsSchema } from '../ai-settings.schema';

// =============================================================================
// GET/PUT /api/ai-settings — response body (issue #24, epic #20)
// =============================================================================
//
// The settings themselves plus the three things the admin page cannot derive:
// whether a platform key is stored (and roughly which one), why a stored row
// would not parse, and the version/provenance metadata. Structurally the same
// as `email/dto/email-settings-response.dto.ts`, which explains each of those
// at length; the reasoning is identical and is not repeated here.
//
// WHAT IS NOT HERE: the platform key, in any shape. `platformKeyStatus` is
// built from `CredentialsService.describe`, whose return type carries its own
// compile-time proof that it cannot hold secret material and whose query does
// not select the ciphertext column at all. There is a proof at the bottom of
// this file for the extension, because an extension is exactly where a
// convenience field ("send the key back so the form can prefill it") would
// land.
// =============================================================================

export const aiPlatformKeyStatusSchema = z.object({
  /** Is a key stored at `(purpose 'ai:openai', name 'platform')`? */
  configured: z.boolean(),

  /** The store's non-secret mask, e.g. `••••0000`. Null when nothing is stored. */
  hint: z.string().nullable(),

  updatedAt: z.iso.datetime().nullable(),

  updatedByUserId: z.uuid().nullable(),
});

export const aiSettingsResponseSchema = aiSettingsSchema.extend({
  platformKeyStatus: aiPlatformKeyStatusSchema,

  /**
   * Why the stored configuration could not be read, when it could not be.
   *
   * `AiSettingsService.get()` throws on a stored-but-invalid row, which is
   * right for the gateway's read path. It is the wrong answer for this
   * endpoint and only this one: a 500 here would make the broken row take down
   * the single screen capable of repairing it. FIELD PATHS ONLY, never values.
   */
  settingsError: z.string().nullable(),

  /** Bumped on every write; pass back as `If-Match` on PUT. */
  version: z.number().int(),

  updatedAt: z.iso.datetime().nullable(),

  updatedBy: z.object({ id: z.uuid(), email: z.email() }).nullable(),
});

/** The GET/PUT response body (inside the global `{ data }` envelope). */
export type AiSettingsResponse = z.infer<typeof aiSettingsResponseSchema>;

export class AiSettingsResponseDto extends createZodDto(
  aiSettingsResponseSchema,
) {}

// -----------------------------------------------------------------------------
// Compile-time proof that the response grew no secret-bearing field
// -----------------------------------------------------------------------------

type SecretFieldNames =
  | 'apiKey'
  | 'platformApiKey'
  | 'secret'
  | 'password'
  | 'token'
  | 'ciphertext';

export type AiSettingsResponseCarriesNoSecret =
  Extract<keyof AiSettingsResponse, SecretFieldNames> extends never
    ? true
    : never;

export const AI_SETTINGS_RESPONSE_CARRIES_NO_SECRET: AiSettingsResponseCarriesNoSecret =
  true;
