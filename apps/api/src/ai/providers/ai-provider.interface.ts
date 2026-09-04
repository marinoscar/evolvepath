import type { AiProviderKind } from '../ai-settings.schema';

// =============================================================================
// AiProvider — the wire-format boundary (issue #23, epic #20)
// =============================================================================
//
// EXACTLY ONE PLACE IN THIS PRODUCT KNOWS WHAT AN LLM REQUEST LOOKS LIKE ON THE
// NETWORK, and it is behind this interface. The gateway (#26), the admin test
// (#24) and the user-key test (#25) all speak these types and nothing else, so
// adding a second provider later is a new implementation rather than an edit
// spread across every caller.
//
// PROVIDERS THROW. This is the deliberate inversion of the never-throw contract
// the rest of the AI surface follows: the gateway and the two test services are
// the never-throw boundaries, and they are the only code allowed to catch. A
// provider that swallowed its own failures would have to invent a result shape
// for "the key is wrong", and every caller would then have to check both an
// exception and a status field. Errors are `AiProviderError` (gateway/ai-errors.ts)
// with a typed code the callers switch on.
//
// The provider knows nothing about Prisma, settings, personas or logging. It is
// handed `auth` and a request; that is the whole of its world.
// =============================================================================

/**
 * Everything needed to address one provider account.
 *
 * `baseUrl` is per-call rather than per-instance because it is admin
 * configuration (`AiSettings.baseUrl`, falling back to `OPENAI_BASE_URL`), and
 * a provider that cached it at construction would keep serving a stale proxy
 * for the life of the process after an administrator changed it.
 */
export interface AiProviderAuth {
  apiKey: string;
  baseUrl: string;
}

/** One entry of the provider's model catalog. */
export interface AiModelInfo {
  id: string;
  /** Unix seconds, as the provider reports it. Used only for display. */
  created: number;
}

/** How hard the model should look at an image. */
export type AiImageDetail = 'low' | 'high' | 'auto';

/**
 * One piece of a user turn.
 *
 * Images travel as BYTES, not URLs, at this layer. A URL would have to be
 * reachable by OpenAI, which means either a public object or a signed URL with
 * a lifetime we would have to reason about; inlining keeps the whole exchange
 * inside one request that the user's own key pays for. E03 may add a
 * signed-URL mode behind the resolver (#26), and this type is what it would
 * grow a variant on.
 */
export type AiContentPart =
  | { type: 'text'; text: string }
  | {
      type: 'image';
      mimeType: string;
      base64: string;
      detail?: AiImageDetail;
    };

/** One structured generation request. */
export interface AiGenerateRequest {
  model: string;

  /** The system/developer prompt. */
  instructions?: string;

  /** The user turn: text plus, for vision personas, images. */
  input: AiContentPart[];

  /**
   * The output contract, already converted to OpenAI strict-mode JSON Schema
   * by `gateway/strict-json-schema.ts`.
   *
   * NOT OPTIONAL. PRD §115 step 5 is "call model with structured contract" and
   * PRD §16 requires validated structured output for critical operations;
   * there is no free-text mode in this product, so there is no way to ask for
   * one here.
   */
  jsonSchema: { name: string; schema: Record<string, unknown> };

  maxOutputTokens?: number;

  reasoningEffort?: 'low' | 'medium' | 'high';

  /** Hard deadline. The provider aborts the request when it elapses. */
  timeoutMs: number;

  /**
   * Provider-side correlation, ≤ 16 keys with values ≤ 512 chars.
   *
   * The ONLY way to join a provider-side log to an `ai_invocations` row; #26
   * passes `{ invocationId, persona, promptVersion }`. Never the prompt, never
   * anything user-authored.
   */
  metadata?: Record<string, string>;
}

/** What the call cost, in the provider's own accounting. */
export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  /**
   * A COUNT OF REASONING TOKENS, never the reasoning itself. PRD §16 and §88
   * forbid storing chain of thought; a bill is not a transcript.
   */
  reasoningTokens: number;
}

/** One structured generation response, normalised across providers. */
export interface AiGenerateResponse {
  /** The model's JSON, still as text — the caller parses and validates. */
  outputText: string | null;

  /** The model's stated refusal, when it declined. Mutually exclusive with output. */
  refusal: string | null;

  usage: AiUsage;

  /** The provider's own request id, for a support ticket. */
  providerRequestId: string | null;

  /** What the provider says it actually ran, which can differ from `model`. */
  responseModel: string | null;

  /** Why generation stopped early (`max_output_tokens`, …), or null. */
  incompleteReason: string | null;
}

/** One LLM vendor. */
export interface AiProvider {
  readonly kind: AiProviderKind;

  /**
   * The catalog this key can reach, UNFILTERED.
   *
   * Filtering is the catalog service's job (#24) using
   * `model-catalog/model-version-filter.ts`, so the ≥ 5.4 rule lives in one
   * place rather than being reimplemented per provider.
   */
  listModels(auth: AiProviderAuth): Promise<AiModelInfo[]>;

  generate(
    auth: AiProviderAuth,
    request: AiGenerateRequest,
  ): Promise<AiGenerateResponse>;
}

/** DI token for the configured provider. */
export const AI_PROVIDER = Symbol('AI_PROVIDER');
