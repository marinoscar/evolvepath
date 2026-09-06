import { Injectable, Logger } from '@nestjs/common';

import type { AiProviderKind } from '../../ai-settings.schema';
import { AiProviderError } from '../../gateway/ai-errors';
import type {
  AiContentPart,
  AiGenerateRequest,
  AiGenerateResponse,
  AiModelInfo,
  AiProvider,
  AiProviderAuth,
} from '../ai-provider.interface';
import { mapOpenAiFailure, mapOpenAiThrow } from './openai-error';

// =============================================================================
// OpenAiProvider — the Responses API over Node's global fetch (issue #23)
// =============================================================================
//
// NO SDK, NO HTTP CLIENT DEPENDENCY. Node 24's global `fetch` is used directly,
// which is a deliberate constraint from epic #20 and not an oversight: the
// `openai` package is a large, fast-moving dependency whose value is the part
// of the surface this product does not use (streaming, assistants, files,
// audio, retries with their own policy). What this product needs is two
// endpoints and a strict-mode JSON schema, and that is about 200 lines.
//
// THE RESPONSES API, not chat completions: `text.format.type: 'json_schema'`
// with `strict: true` is what makes PRD §115's "structured contract" a
// guarantee from the provider rather than a hope about the prompt.
//
// `store: false` ON EVERY CALL, AND IT IS NOT OPTIONAL. This product sends a
// user's own coaching context — obstacles, health data, family commitments —
// under the user's own key. Leaving it in OpenAI's response store would put
// that on a dashboard we do not control, retained by a policy we do not set.
// A unit test asserts the flag, and the fake server (#30) rejects a request
// without it, so a regression fails both suites.
// =============================================================================

/** How a text part is spelled on the Responses API wire. */
interface OpenAiInputText {
  type: 'input_text';
  text: string;
}

/** How an image part is spelled: a data URL, inline, in the request body. */
interface OpenAiInputImage {
  type: 'input_image';
  image_url: string;
  detail: string;
}

@Injectable()
export class OpenAiProvider implements AiProvider {
  readonly kind: AiProviderKind = 'openai';

  private readonly logger = new Logger(OpenAiProvider.name);

  /**
   * The catalog this key can reach, unfiltered.
   *
   * No timeout is applied here, unlike `generate`: this is a small, fast call
   * made from an admin screen that is already waiting on it, and giving it its
   * own configurable deadline would be a second knob for no benefit. `fetch`'s
   * own connection handling still bounds it.
   */
  async listModels(auth: AiProviderAuth): Promise<AiModelInfo[]> {
    let response: Response;

    try {
      response = await fetch(`${this.trimBase(auth.baseUrl)}/models`, {
        method: 'GET',
        headers: this.headers(auth.apiKey),
      });
    } catch (err) {
      throw mapOpenAiThrow(err, auth.apiKey);
    }

    const body = await this.readJson(response);

    if (!response.ok) {
      throw this.reportFailure(
        'listModels',
        mapOpenAiFailure(response.status, body, response.headers, auth.apiKey),
        response.status,
      );
    }

    const data = (body as { data?: unknown })?.data;

    if (!Array.isArray(data)) {
      throw new AiProviderError(
        'provider',
        'OpenAI returned an unreadable model list',
        response.status,
        response.headers.get('x-request-id'),
      );
    }

    return data
      .filter(
        (model): model is { id: string; created?: unknown } =>
          !!model &&
          typeof model === 'object' &&
          typeof (model as { id?: unknown }).id === 'string',
      )
      .map((model) => ({
        id: model.id,
        created: typeof model.created === 'number' ? model.created : 0,
      }));
  }

  async generate(
    auth: AiProviderAuth,
    request: AiGenerateRequest,
  ): Promise<AiGenerateResponse> {
    const body = {
      model: request.model,
      instructions: request.instructions,
      input: [
        {
          role: 'user',
          content: request.input.map((part) => this.toWirePart(part)),
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: request.jsonSchema.name,
          schema: request.jsonSchema.schema,
          strict: true,
        },
      },
      max_output_tokens: request.maxOutputTokens,
      reasoning: request.reasoningEffort
        ? { effort: request.reasoningEffort }
        : undefined,
      // See the header. Not a default, not configurable.
      store: false,
      metadata: request.metadata,
    };

    // AbortController rather than `AbortSignal.timeout`, because the timer has
    // to be cleared in `finally`: a pending 60-second timer keeps the event
    // loop alive after a fast response, which turns every Jest run of this
    // provider into a "did not exit one second after test run completed"
    // warning and, in production, delays a graceful shutdown.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);

    let response: Response;

    try {
      response = await fetch(`${this.trimBase(auth.baseUrl)}/responses`, {
        method: 'POST',
        headers: this.headers(auth.apiKey),
        // JSON.stringify drops the `undefined` values above, so an absent
        // `instructions`, `max_output_tokens`, `reasoning` or `metadata`
        // simply does not appear on the wire.
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw this.reportFailure(
        'generate',
        mapOpenAiThrow(err, auth.apiKey, request.timeoutMs),
      );
    } finally {
      clearTimeout(timer);
    }

    const parsed = await this.readJson(response);

    if (!response.ok) {
      throw this.reportFailure(
        'generate',
        mapOpenAiFailure(
          response.status,
          parsed,
          response.headers,
          auth.apiKey,
        ),
        response.status,
      );
    }

    return this.toGenerateResponse(parsed, response);
  }

  // ---------------------------------------------------------------------------
  // Wire shapes
  // ---------------------------------------------------------------------------

  private toWirePart(part: AiContentPart): OpenAiInputText | OpenAiInputImage {
    if (part.type === 'text') {
      return { type: 'input_text', text: part.text };
    }

    if (part.type === 'image_url') {
      // Passed through untouched. `image_url` takes a data URL or an http(s)
      // one, so signed-url mode needs no second wire shape — the URL is simply
      // one the provider fetches rather than one it decodes.
      return {
        type: 'input_image',
        image_url: part.url,
        detail: part.detail ?? 'auto',
      };
    }

    return {
      type: 'input_image',
      // Inline, in the request body. See the AiContentPart docs for why bytes
      // rather than a URL OpenAI would have to fetch.
      image_url: `data:${part.mimeType};base64,${part.base64}`,
      detail: part.detail ?? 'auto',
    };
  }

  /**
   * Pull the four things a caller needs out of a Responses payload.
   *
   * DEFENSIVE ON EVERY FIELD. This is a body from a service we do not control,
   * reached through a base URL an administrator can point anywhere; a missing
   * `usage` or a reshaped `output` must produce a typed provider error, not a
   * `TypeError` from a property access two frames up in the gateway.
   */
  private toGenerateResponse(
    body: unknown,
    response: Response,
  ): AiGenerateResponse {
    const providerRequestId = response.headers.get('x-request-id');

    if (!body || typeof body !== 'object') {
      throw new AiProviderError(
        'provider',
        'OpenAI returned an unreadable response',
        response.status,
        providerRequestId,
      );
    }

    const payload = body as {
      model?: unknown;
      output?: unknown;
      usage?: unknown;
      incomplete_details?: unknown;
    };

    const output = Array.isArray(payload.output) ? payload.output : null;

    if (!output) {
      throw new AiProviderError(
        'provider',
        'OpenAI returned an unreadable response',
        response.status,
        providerRequestId,
      );
    }

    // The first `message` item. Reasoning items also appear in `output[]` and
    // are deliberately skipped rather than read: PRD §16 and §88 forbid storing
    // chain of thought, and the cheapest way to keep that promise is never to
    // lift it out of the payload in the first place.
    const message = output.find(
      (item) =>
        !!item &&
        typeof item === 'object' &&
        (item as { type?: unknown }).type === 'message',
    ) as { content?: unknown } | undefined;

    const content = Array.isArray(message?.content) ? message.content : [];

    const texts: string[] = [];
    let refusal: string | null = null;

    for (const item of content) {
      if (!item || typeof item !== 'object') continue;
      const typed = item as { type?: unknown; text?: unknown; refusal?: unknown };

      if (typed.type === 'output_text' && typeof typed.text === 'string') {
        texts.push(typed.text);
      } else if (typed.type === 'refusal' && typeof typed.refusal === 'string') {
        refusal = typed.refusal;
      }
    }

    const usage = (payload.usage ?? {}) as Record<string, unknown>;
    const inputDetails = (usage.input_tokens_details ?? {}) as Record<
      string,
      unknown
    >;
    const outputDetails = (usage.output_tokens_details ?? {}) as Record<
      string,
      unknown
    >;

    const incomplete = (payload.incomplete_details ?? null) as {
      reason?: unknown;
    } | null;

    return {
      // Null rather than '' when there is no text: "the model said nothing" and
      // "the model said the empty string" are different, and the gateway maps
      // the first to `invalid_output`.
      outputText: texts.length > 0 ? texts.join('') : null,
      refusal,
      usage: {
        inputTokens: this.toCount(usage.input_tokens),
        outputTokens: this.toCount(usage.output_tokens),
        cachedInputTokens: this.toCount(inputDetails.cached_tokens),
        reasoningTokens: this.toCount(outputDetails.reasoning_tokens),
      },
      providerRequestId,
      responseModel: typeof payload.model === 'string' ? payload.model : null,
      incompleteReason:
        incomplete && typeof incomplete.reason === 'string'
          ? incomplete.reason
          : null,
    };
  }

  private toCount(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  // ---------------------------------------------------------------------------
  // Transport plumbing
  // ---------------------------------------------------------------------------

  private headers(apiKey: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      // The key's ONLY appearance. It is never logged, never in a query
      // string, never in the body.
      Authorization: `Bearer ${apiKey}`,
      'User-Agent': 'evolvepath-api',
    };
  }

  /** Tolerate a configured base URL with or without a trailing slash. */
  private trimBase(baseUrl: string): string {
    return baseUrl.replace(/\/+$/, '');
  }

  /**
   * Read a body as JSON, or `null` when it is not JSON at all.
   *
   * Returning null rather than throwing keeps the failure paths uniform: a
   * proxy's HTML error page becomes `mapOpenAiFailure(502, null, …)` with a
   * status-derived message, and an unreadable 200 becomes the explicit
   * "unreadable response" error in `toGenerateResponse`.
   */
  private async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  /**
   * Log one line for a failure and hand the error back to be thrown.
   *
   * STATUS, CODE AND REQUEST ID ONLY. Never the request body (it carries the
   * user's coaching context), never the key, never the provider's message —
   * that message is already going to a screen and a database row, and
   * application logs are shipped, indexed and retained far more widely.
   */
  private reportFailure(
    operation: string,
    error: AiProviderError,
    status?: number,
  ): AiProviderError {
    this.logger.warn(
      `OpenAI ${operation} failed status=${status ?? 'none'} code=${error.code} requestId=${error.providerRequestId ?? 'none'}`,
    );
    return error;
  }
}
