import { AiProviderError, type AiErrorCode } from '../../gateway/ai-errors';
import { AiKeyRedactor } from '../../gateway/ai-key-redactor';

// =============================================================================
// OpenAI failure mapping (issue #23, epic #20)
// =============================================================================
//
// Turns "something went wrong at OpenAI" into one of the closed set of codes in
// `gateway/ai-errors.ts`, with a message that is safe to show an administrator
// and safe to persist. Split out of the provider so the mapping can be tested
// against status/body pairs without standing up a fetch mock, and so the
// provider reads as request/parse/return with the error taxonomy elsewhere.
//
// EVERY MESSAGE THAT LEAVES HERE HAS BEEN REDACTED AND CAPPED. There is no
// path through this module that constructs an `AiProviderError` without going
// through `redact`.
// =============================================================================

/** The error envelope OpenAI puts on a failure, as much of it as we read. */
interface OpenAiErrorBody {
  error?: {
    message?: unknown;
    type?: unknown;
    code?: unknown;
  };
}

function readErrorBody(body: unknown): {
  message: string | null;
  code: string | null;
} {
  if (!body || typeof body !== 'object') return { message: null, code: null };

  const error = (body as OpenAiErrorBody).error;
  if (!error || typeof error !== 'object') return { message: null, code: null };

  return {
    message: typeof error.message === 'string' ? error.message : null,
    code: typeof error.code === 'string' ? error.code : null,
  };
}

/**
 * Map an HTTP failure to a typed error.
 *
 * The status/code table, and why each row is what it is:
 *
 *   401, 403       → `auth`       The key is wrong, revoked, or lacks the
 *                                 scope. The one failure a user can fix alone,
 *                                 and the reason the test button exists.
 *   404            → `no_model`   OpenAI answers 404 for a model the key
 *                                 cannot reach — a real and common state
 *                                 (a tier that has not been granted GPT-5.4),
 *                                 not a routing bug. `model_not_found` in the
 *                                 body says the same thing at any status.
 *   429            → `rate_limit` Distinct from `provider` because the caller's
 *                                 correct response is different: back off,
 *                                 rather than report.
 *   5xx            → `provider`   Theirs, transient.
 *   other 4xx      → `provider`   Ours, and not transient — but the caller can
 *                                 do nothing differently, so it shares a code.
 *                                 The message carries the detail.
 *
 * @param apiKey registered with the redactor so a body that echoes the
 *               credential cannot carry it out of this function.
 */
export function mapOpenAiFailure(
  status: number,
  body: unknown,
  headers: Headers | undefined,
  apiKey?: string,
): AiProviderError {
  const { message, code } = readErrorBody(body);

  const redactor = new AiKeyRedactor();
  redactor.protect(apiKey);

  const text = redactor.apply(
    message ?? `OpenAI request failed with HTTP ${status}`,
  );

  const providerRequestId = headers?.get('x-request-id') ?? null;

  let mapped: AiErrorCode;

  if (code === 'model_not_found') {
    mapped = 'no_model';
  } else if (status === 401 || status === 403) {
    mapped = 'auth';
  } else if (status === 404) {
    mapped = 'no_model';
  } else if (status === 429) {
    mapped = 'rate_limit';
  } else {
    mapped = 'provider';
  }

  return new AiProviderError(mapped, text, status, providerRequestId);
}

/**
 * Map a thrown fetch failure — no response arrived at all.
 *
 *   AbortError / TimeoutError → `timeout`  We aborted it; the deadline was ours.
 *   TypeError                 → `network`  How `fetch` reports DNS, TLS and
 *                                          connection failures. Distinct from
 *                                          `provider` because nothing at
 *                                          OpenAI is necessarily wrong.
 *   anything else             → `provider`
 *
 * `timeoutMs` is threaded through only so the message can state the deadline
 * that was actually exceeded, which is the difference between an admin
 * changing `AI_REQUEST_TIMEOUT_MS` and an admin filing a ticket with OpenAI.
 */
export function mapOpenAiThrow(
  err: unknown,
  apiKey?: string,
  timeoutMs?: number,
): AiProviderError {
  const redactor = new AiKeyRedactor();
  redactor.protect(apiKey);

  const name =
    err && typeof err === 'object' && 'name' in err
      ? String((err as { name: unknown }).name)
      : '';

  if (name === 'AbortError' || name === 'TimeoutError') {
    return new AiProviderError(
      'timeout',
      timeoutMs === undefined
        ? 'OpenAI request timed out'
        : `OpenAI request timed out after ${timeoutMs} ms`,
    );
  }

  const rawMessage =
    err instanceof Error ? err.message : 'OpenAI request failed';

  if (err instanceof TypeError) {
    return new AiProviderError(
      'network',
      redactor.apply(`Could not reach OpenAI: ${rawMessage}`),
    );
  }

  return new AiProviderError('provider', redactor.apply(rawMessage));
}
