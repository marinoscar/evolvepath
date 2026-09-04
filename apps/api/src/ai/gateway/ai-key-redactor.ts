import { SecretRedactor } from '../../email/base-email.provider';

// =============================================================================
// AiKeyRedactor (issue #23, epic #20)
// =============================================================================
//
// Every AI error message in this product is shown to somebody — an
// administrator on the settings page, a user on the key setup page — and
// persisted on an `ai_invocations` row. That is deliberate: the provider's real
// error ("Incorrect API key provided", "you do not have access to gpt-5.4") is
// the only thing that makes the test button diagnostic rather than decorative.
// It also means provider text reaches a screen and a database, so it is scrubbed
// first, without exception.
//
// TWO PASSES, BECAUSE ONE IS NOT ENOUGH:
//
//   1. `SecretRedactor` (reused from the email transports, NOT copied — the
//      class is generic despite its home) removes the exact key we hold. This
//      is the pass that catches a provider echoing the credential verbatim.
//
//   2. A PATTERN PASS over `sk-…`. OpenAI's own 401 body quotes a MASKED form
//      of the submitted key, and a proxy or a future error shape could quote a
//      different key entirely — one we never held and therefore never
//      registered. Pass 1 cannot see either. Pass 2 does not care whose key it
//      is.
//
// And a CAP, because `ai_invocations.error_message` is `@db.Text` with no
// length bound by design (a bound would truncate mid-key and leave a fragment).
// The cap belongs to the writer, and this is the writer.
// =============================================================================

/**
 * Anything shaped like an OpenAI secret key, whoever it belongs to.
 *
 * `sk-` plus at least 8 of the characters OpenAI uses (base62 plus `_` and
 * `-`). The 8-character floor is what stops the pattern eating an ordinary
 * word: `sk-` on its own, or a two-letter suffix, is far more likely to be
 * prose than a credential, and destroying a readable error is a real cost.
 *
 * `\b` on the left only. There is no word boundary after `-` in a trailing
 * position, and requiring one would fail to match a key at the end of a
 * sentence followed by a period.
 */
const OPENAI_KEY_PATTERN = /\bsk-[A-Za-z0-9_-]{8,}/g;

/** What a matched key becomes. Recognisable as a key, useless as one. */
const KEY_PLACEHOLDER = 'sk-***';

/**
 * The cap `ai_invocations.error_message` and every admin alert are written
 * against.
 *
 * 2000 characters is far more than any useful provider error and far less than
 * an HTML error page from a misconfigured proxy, which is the realistic worst
 * case for an unbounded message.
 */
export const MAX_AI_ERROR_MESSAGE_LENGTH = 2000;

/**
 * Scrub-then-cap for AI error text.
 *
 * Extends the email redactor rather than wrapping it so `protect()` keeps its
 * exact inherited semantics — including the "withhold the whole message" branch
 * for a secret too short to replace safely, which is the correct trade there
 * and here alike.
 */
export class AiKeyRedactor extends SecretRedactor {
  /**
   * Scrub every registered secret and every key-shaped substring out of `text`,
   * then cap it.
   *
   * ORDER MATTERS AND IS NOT INTERCHANGEABLE. Capping first could cut a key in
   * half and leave the first half standing, which is a leak the pattern pass
   * would then be unable to match. Scrub, then cap.
   */
  override apply(text: string): string {
    const scrubbed = super
      .apply(text)
      .replace(OPENAI_KEY_PATTERN, KEY_PLACEHOLDER);

    if (scrubbed.length <= MAX_AI_ERROR_MESSAGE_LENGTH) return scrubbed;

    return `${scrubbed.slice(0, MAX_AI_ERROR_MESSAGE_LENGTH - 1)}…`;
  }
}

/**
 * One-shot redaction for a caller that does not already hold a redactor.
 *
 * The convenience form used by the invocation logger (#26), which redacts
 * whole JSON blobs and has no send-scoped redactor to reuse.
 */
export function redactAiText(
  text: string,
  secrets: Array<string | null | undefined> = [],
): string {
  const redactor = new AiKeyRedactor();
  for (const secret of secrets) redactor.protect(secret);
  return redactor.apply(text);
}
