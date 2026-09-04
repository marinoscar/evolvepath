import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// =============================================================================
// GET /api/ai-settings/models — response body (issue #24, epic #20)
// =============================================================================
//
// 200 IN EVERY CONFIGURATION, INCLUDING FAILURE. The same design as the test
// endpoints, and for the same reason set out at length in
// `email/dto/test-email-result.dto.ts`: "we could not reach OpenAI with this
// key" is an ANSWER to the question the admin page asked, and this app's error
// envelope suppresses detail in production and funnels the client into generic
// failure handling, so the one useful fact would be the one fact lost.
//
// A real 4xx/5xx still means what it always means: not authenticated, not
// permitted, malformed, or a bug. A 429 from the refresh throttle is a genuine
// 4xx — the request was refused rather than attempted.
// =============================================================================

export const aiModelInfoSchema = z.object({
  id: z.string(),
  /** Unix seconds as the provider reports it, for display only. */
  created: z.number().int(),
});

export const aiModelsResponseSchema = z.object({
  /** Did we actually reach the provider? Read this, not the HTTP status. */
  success: z.boolean(),

  /**
   * The GPT ≥ 5.4 subset, newest first.
   *
   * FILTERED SERVER-SIDE by `filterSupportedModels`, not by the page. The rule
   * has to hold on the write path anyway (a `PUT` naming an unsupported model
   * is a 400), so filtering here keeps "the select offered it" and "the save
   * accepted it" answered by the same code.
   *
   * Can be non-empty on `success: false` — see `source: 'cache'`.
   */
  models: z.array(aiModelInfoSchema),

  /** When the returned list was fetched from the provider. */
  fetchedAt: z.iso.datetime().nullable(),

  /**
   * Where the list came from. `'cache'` on a failure means the provider is
   * unreachable right now but a previous catalog is still being shown — the
   * page says so rather than silently presenting stale data as live.
   */
  source: z.enum(['live', 'cache']).nullable(),

  /** Why the fetch failed, redacted. Null on success. */
  error: z.string().nullable(),
});

export type AiModelsResponse = z.infer<typeof aiModelsResponseSchema>;

export class AiModelsResponseDto extends createZodDto(aiModelsResponseSchema) {}
