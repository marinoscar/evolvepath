import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { AI_PROVIDER_KINDS } from '../ai-settings.schema';

// =============================================================================
// POST /api/ai-settings/test and /api/me/ai-key/test — response (issues #24, #25)
// =============================================================================
//
// THIS ENDPOINT ANSWERS 200 EVEN WHEN THE CONNECTION FAILED, for the reasons
// spelled out in full in `email/dto/test-email-result.dto.ts`: a refused
// connection is a SUCCESSFUL DIAGNOSTIC, and it is the entire point of the
// button. `success` is the only success signal; a caller that reads the HTTP
// status reports success for every misconfiguration there is.
//
// ONE SHAPE FOR BOTH THE ADMIN AND THE USER TEST, deliberately. The two
// services answer different questions with different keys, but the page
// rendering the answer is the same component in both variants (#28), and two
// shapes would mean two renderers for one sentence.
// =============================================================================

/**
 * What happened to one probe.
 *
 * `'skipped'` is a first-class outcome, not a failure: a user testing their key
 * before an administrator has chosen a default model has nothing to generate
 * against, and reporting that as `'failed'` would send them looking for a
 * problem with their key that does not exist.
 */
export const aiTestCheckSchema = z.enum(['passed', 'failed', 'skipped']);

export const aiTestResultSchema = z.object({
  /** Did every check that ran pass? Read this, not the HTTP status. */
  success: z.boolean(),

  /** Which provider answered (or refused). Null when none is configured. */
  providerKind: z.enum(AI_PROVIDER_KINDS).nullable(),

  /** The model the generate probe used. Null when it was skipped. */
  model: z.string().nullable(),

  latencyMs: z.number().int().nullable(),

  /**
   * THE PROVIDER'S ACTUAL ERROR, VERBATIM. Null on success.
   *
   * `Incorrect API key provided: sk-***`, `Rate limit reached for gpt-5.4`.
   * Not a category and not a rewritten sentence — a wrong key, an ungranted
   * model tier and a firewalled egress all collapse into the same useless
   * toast otherwise.
   *
   * Safe to surface: it has already been through `AiKeyRedactor`, which is the
   * only exit path for provider error text, and which scrubs both the key we
   * hold and anything else shaped like one before capping at 2000 chars.
   */
  error: z.string().nullable(),

  attemptedAt: z.iso.datetime(),

  /**
   * The two probes, reported separately.
   *
   * ONE BOOLEAN IS NOT ENOUGH. "The key is valid but this model is not
   * available to it" and "the key is wrong" are different problems with
   * different fixes, and they are exactly the two states these fields
   * distinguish.
   */
  checks: z.object({
    /** Can this key reach the catalog at all? Validates the key itself. */
    listModels: aiTestCheckSchema,
    /** Can it run a 16-token structured generation on the chosen model? */
    generate: aiTestCheckSchema,
  }),
});

export type AiTestResult = z.infer<typeof aiTestResultSchema>;

export class AiTestResultDto extends createZodDto(aiTestResultSchema) {}
