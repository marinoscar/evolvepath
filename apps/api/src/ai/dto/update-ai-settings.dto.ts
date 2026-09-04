import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { aiSettingsSchema } from '../ai-settings.schema';

// =============================================================================
// PUT /api/ai-settings — request body (issue #24, epic #20)
// =============================================================================
//
// DERIVED FROM `aiSettingsSchema`, NOT RESTATED, so a rule that changes there
// changes here in the same edit. `email/dto/update-email-settings.dto.ts`
// explains the `blankable`/`unset` technique and the blank-preserves contract
// at length; the same reasoning applies verbatim and is summarised below.
//
// `platformApiKey` EXISTS ON THE REQUEST AND ON NOTHING ELSE. It is not in
// `aiSettingsSchema` (which carries a compile-time proof of its absence), not
// in the persisted blob (the service parses with `aiSettingsSchema`, and Zod
// drops unknown keys), and not in the response DTO (which carries its own
// proof). Its whole lifetime is: request body → service →
// `CredentialsService.setSecret` → AES-GCM ciphertext.
//
// BLANK PRESERVES. The admin form renders the key box empty because the stored
// value is unreadable by design, so an empty submission means "keep what is
// stored" and can never mean "erase it". Do not add `.trim()`, `.min(1)` or a
// default here — each of those breaks that contract in a way that looks like
// tidying up.
// =============================================================================

/**
 * Length ceiling on the submitted key.
 *
 * Not a security control — a bound on what a paste accident can push into an
 * encrypted column, generous enough for any real OpenAI key including the long
 * project-scoped form.
 */
const MAX_PLATFORM_API_KEY_LENGTH = 512;

/** A settings field an admin left empty: a cleared input, or a reset control. */
const unset = z.union([z.literal(''), z.null()]);

/** `aiSettingsSchema`'s rule for one field, plus the two "empty box" forms. */
function blankable<T extends z.ZodTypeAny>(inner: T) {
  return z.union([unset, inner]);
}

export const updateAiSettingsSchema = aiSettingsSchema.extend({
  // The one optional settings field, widened to tolerate an emptied control.
  // The URL rule itself still comes from `aiSettingsSchema.shape`.
  baseUrl: blankable(aiSettingsSchema.shape.baseUrl),

  /**
   * The platform OpenAI key. WRITE-ONLY — see the header.
   *
   * Blank (absent, `null` or `''`) preserves whatever is stored. Erasing it is
   * `CredentialsService.deleteSecret`, and is deliberately not expressible
   * through this field.
   */
  platformApiKey: z.string().max(MAX_PLATFORM_API_KEY_LENGTH).nullish(),
});

/** The parsed PUT body, key included. */
export type UpdateAiSettingsInput = z.infer<typeof updateAiSettingsSchema>;

export class UpdateAiSettingsDto extends createZodDto(updateAiSettingsSchema) {}
