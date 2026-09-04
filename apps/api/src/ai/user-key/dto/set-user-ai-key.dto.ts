import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * PUT /api/me/ai-key — request body (issue #25, epic #20).
 *
 * The key is write-only in the strongest sense available: there is no endpoint,
 * anywhere, that returns it. Its whole lifetime is request body → service →
 * `CredentialsService.setSecret` → AES-GCM ciphertext.
 *
 * -----------------------------------------------------------------------------
 * WHY THESE THREE RULES AND NO MORE
 * -----------------------------------------------------------------------------
 *
 * `.min(20)` — a bound on typos, not on format. Every real OpenAI key is far
 * longer; a 19-character value is a truncated paste, and catching it here turns
 * a mystifying 401 later into an immediate "that looks too short".
 *
 * `.max(512)` — a bound on what a paste accident can push into an encrypted
 * column, generous enough for the long project-scoped key form.
 *
 * `/^\S+$/` — no whitespace ANYWHERE, not just at the ends. A key with an
 * internal space is a line-wrapped paste, and it would otherwise be stored
 * intact and fail authentication forever with nothing to explain why. Note this
 * is a REJECTION, not a trim: the form trims before submitting, and the server
 * deliberately does not alter a secret's bytes (see `CredentialsService`).
 *
 * WHAT IS DELIBERATELY NOT ENFORCED: the `sk-` prefix. OpenAI has changed key
 * formats before and will again, and a server-side prefix rule turns that into
 * an outage for every user at once. The web form shows a soft hint instead
 * (#28), which costs nothing when it is wrong.
 *
 * NO BLANK-PRESERVES HERE, unlike the platform key. This endpoint's only job is
 * to set a key; there is no surrounding form whose other fields a user might be
 * editing, so an empty submission is a mistake rather than "keep the stored
 * one", and saying so is more useful than silently succeeding.
 */
const setUserAiKeySchema = z.object({
  apiKey: z
    .string()
    .min(20, 'That key looks too short. Copy the whole value from OpenAI.')
    .max(512)
    .regex(/^\S+$/, 'An API key cannot contain spaces or line breaks.'),
});

export type SetUserAiKeyInput = z.infer<typeof setUserAiKeySchema>;

export class SetUserAiKeyDto extends createZodDto(setUserAiKeySchema) {}
