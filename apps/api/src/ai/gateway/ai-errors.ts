import { HttpException } from '@nestjs/common';

import { withVerbatimErrorBody } from '../../common/exceptions/verbatim-error-body.exception';

// =============================================================================
// AI error taxonomy (issue #23, epic #20)
// =============================================================================
//
// ONE CLOSED SET OF CODES for everything that can go wrong on the way to an
// answer, so a caller in E04–E12 can branch on a value rather than on the text
// of a message that came off the network. The codes are persisted on
// `ai_invocations.error_code`, which is what makes "how often does the coach
// hit rate limits?" a query rather than a log grep.
//
// The split matters: `AiProviderError` is thrown, by providers only. It never
// reaches an HTTP client — the gateway (#26) and the test services (#24, #25)
// turn it into a result. `AiKeyRequiredException` is the one AI failure that
// IS an HTTP response, because it is actionable by the user in a way no other
// is: go and add a key.
// =============================================================================

/**
 * Every way an AI call can fail, as a value.
 *
 * Grouped by who can act on it:
 *   • the provider or the network — `auth`, `rate_limit`, `timeout`,
 *     `network`, `provider`
 *   • the model's answer          — `schema`, `refusal`
 *   • this application's state    — `attachment`, `no_user_key`, `no_model`,
 *     `ai_disabled`
 *
 * The second and third groups are the reason this is not just an HTTP status:
 * "the model returned something that failed validation" and "the administrator
 * has not chosen a model" are both invisible to a status code and both change
 * what the caller should do next.
 */
export const AI_ERROR_CODES = [
  'auth',
  'rate_limit',
  'timeout',
  'network',
  'provider',
  'schema',
  'refusal',
  'attachment',
  'no_user_key',
  'no_model',
  'ai_disabled',
] as const;

/** One failure mode. See {@link AI_ERROR_CODES}. */
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

/**
 * A typed provider failure.
 *
 * THROWN BY PROVIDERS, CAUGHT BY THE GATEWAY AND THE TEST SERVICES, and never
 * by anything else. Its `message` has already been through `AiKeyRedactor` by
 * the time it is constructed by `mapOpenAiFailure`, so it is safe to persist
 * and to show an administrator — which is the whole point of showing the
 * provider's real error rather than a generic one.
 */
export class AiProviderError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
    /** The provider's HTTP status, when the failure had one. */
    readonly status?: number,
    /** The provider's `x-request-id`, for a support ticket. */
    readonly providerRequestId?: string | null,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

/**
 * The message the user sees when they hit an AI feature with no key saved.
 *
 * Kept as a constant so the API, the tests and the docs quote the same string,
 * and so the route it names can be renamed in one place.
 */
export const AI_KEY_REQUIRED_MESSAGE =
  'An OpenAI API key is required. Add one under Settings → OpenAI API Key.';

/**
 * HTTP 412 with `code: 'AI_KEY_REQUIRED'`.
 *
 * -----------------------------------------------------------------------------
 * WHY VERBATIM, AND WHY 412
 * -----------------------------------------------------------------------------
 * `HttpExceptionFilter` rebuilds every error body and OVERWRITES `code` from
 * the status — 412 would come out as `'ERROR'`, and the web app's one useful
 * discriminator would be destroyed server-side. `withVerbatimErrorBody` is the
 * documented opt-out for exactly this case: a body whose shape a client must
 * be able to recognise. The client behaviour it drives (#29) is a redirect to
 * `/setup/ai-key`, which is not something a generic 4xx can trigger.
 *
 * 412 Precondition Failed rather than 401/403: the caller IS authenticated and
 * IS authorised: a precondition of the *resource* — their own key — is unmet.
 * A 401 would make the web app's interceptor try to refresh a perfectly good
 * token, and a 403 would tell the user they lack permission for something they
 * are entitled to do.
 *
 * THE GATEWAY NEVER THROWS THIS. It returns `ok: false` with code
 * `no_user_key`, because a gateway that threw would break its own never-throw
 * contract and take down the deterministic fallback PRD §120 requires. HTTP
 * controllers in later epics opt in with {@link assertAiKeyAvailable}.
 */
export class AiKeyRequiredException extends HttpException {
  constructor(message: string = AI_KEY_REQUIRED_MESSAGE) {
    super(
      {
        statusCode: 412,
        code: 'AI_KEY_REQUIRED',
        message,
      },
      412,
    );

    withVerbatimErrorBody(this);
  }
}

/**
 * Turn a keyless gateway result into the 412 above; leave every other result
 * alone.
 *
 * The opt-in for HTTP controllers: a route that has nothing useful to do
 * without AI calls this and lets the web app's redirect handle it, while a
 * route with a deterministic fallback (PRD §120) simply does not call it and
 * carries on with `ok: false`. Making it a one-line call at the call site is
 * what keeps that a visible decision rather than a default.
 */
export function assertAiKeyAvailable(result: {
  ok: boolean;
  error?: { code: AiErrorCode };
}): void {
  if (!result.ok && result.error?.code === 'no_user_key') {
    throw new AiKeyRequiredException();
  }
}
