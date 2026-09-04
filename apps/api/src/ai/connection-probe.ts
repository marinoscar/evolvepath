import { z } from 'zod';

import { AiProviderError, type AiErrorCode } from './gateway/ai-errors';
import { toOpenAiStrictSchema } from './gateway/strict-json-schema';
import type {
  AiGenerateRequest,
  AiProvider,
  AiProviderAuth,
} from './providers/ai-provider.interface';

// =============================================================================
// Connection probe (issue #24, epic #20)
// =============================================================================
//
// "Does this key work?" asked identically by the administrator about the
// platform key (#24) and by every user about their own (#25). ONE
// IMPLEMENTATION, because the two answers must mean the same thing: a user
// told "your key works" and an administrator told "the connection works" are
// entitled to have been asked the same question of the same provider.
//
// TWO CHECKS, NOT ONE, and the split is the whole diagnostic value:
//
//   listModels — validates the KEY. Costs no tokens. Fails for a wrong,
//                revoked or unfunded key.
//   generate   — validates the KEY AGAINST THE CHOSEN MODEL. Costs 16 output
//                tokens. Fails when the key is fine but the account has not
//                been granted the model, which is the single most confusing
//                state to be in and the one a boolean cannot express.
//
// `generate` is SKIPPED, not failed, when there is no model to probe: a user
// testing their key before an administrator has chosen a default has nothing
// to generate against, and reporting that as a failure sends them hunting for
// a problem with their key that does not exist.
// =============================================================================

/** The probe's output contract. Deliberately the smallest thing expressible. */
const probeSchema = z.object({ ok: z.boolean() });

/** `json_schema.name` on the wire; matched by the fake server's log lines. */
export const CONNECTION_PROBE_SCHEMA_NAME = 'connection_probe';

/**
 * The probe prompt.
 *
 * Says exactly what it wants and nothing else. It is not a capability test and
 * must never grow into one: a longer prompt costs the key's owner more money
 * for the same one-bit answer.
 */
export const CONNECTION_PROBE_INSTRUCTIONS =
  'Reply with the JSON {"ok":true}.';

/**
 * 16 tokens is enough for `{"ok":true}` with room to spare and far too few for
 * anything else, so a misconfigured model cannot run up a bill on a button.
 */
export const CONNECTION_PROBE_MAX_OUTPUT_TOKENS = 16;

/** The generate request both test services send. */
export function buildConnectionProbeRequest(
  model: string,
  timeoutMs: number,
): AiGenerateRequest {
  return {
    model,
    instructions: CONNECTION_PROBE_INSTRUCTIONS,
    input: [{ type: 'text', text: 'ping' }],
    jsonSchema: {
      name: CONNECTION_PROBE_SCHEMA_NAME,
      schema: toOpenAiStrictSchema(probeSchema),
    },
    maxOutputTokens: CONNECTION_PROBE_MAX_OUTPUT_TOKENS,
    timeoutMs,
    // No persona, no prompt version, no user text: this is infrastructure, and
    // tagging it as such keeps it out of any later per-persona cost analysis.
    metadata: { purpose: 'test_connection' },
  };
}

/** The outcome of one probe. `'skipped'` is a first-class, non-failing state. */
export type ProbeCheck = 'passed' | 'failed' | 'skipped';

export interface ConnectionCheckOutcome {
  checks: { listModels: ProbeCheck; generate: ProbeCheck };
  /** The model the generate probe ran against. Null when it was skipped. */
  model: string | null;
  error: string | null;
  errorCode: AiErrorCode | null;
  providerRequestId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

/**
 * Run both checks against one key.
 *
 * NEVER THROWS. Every provider failure becomes a `'failed'` check plus the
 * provider's redacted message, because a refused connection is a successful
 * diagnosis and the message is the answer the caller came for. Callers add
 * their own persistence, auditing and throttling around this.
 *
 * @param model the model to probe, or `null` to skip the generate check.
 */
export async function runConnectionChecks(
  provider: AiProvider,
  auth: AiProviderAuth,
  model: string | null,
  timeoutMs: number,
): Promise<ConnectionCheckOutcome> {
  const outcome: ConnectionCheckOutcome = {
    checks: { listModels: 'failed', generate: 'skipped' },
    model: null,
    error: null,
    errorCode: null,
    providerRequestId: null,
    inputTokens: null,
    outputTokens: null,
  };

  try {
    await provider.listModels(auth);
    outcome.checks.listModels = 'passed';
  } catch (err) {
    return { ...outcome, ...describeFailure(err) };
  }

  // No model configured: the key is proven, and there is nothing further to
  // ask. `success` is `listModels` alone, which the caller derives.
  if (!model) return outcome;

  outcome.model = model;
  outcome.checks.generate = 'failed';

  try {
    const response = await provider.generate(
      auth,
      buildConnectionProbeRequest(model, timeoutMs),
    );

    outcome.providerRequestId = response.providerRequestId;
    outcome.inputTokens = response.usage.inputTokens;
    outcome.outputTokens = response.usage.outputTokens;

    if (response.refusal) {
      outcome.error = `The model refused the probe: ${response.refusal}`;
      outcome.errorCode = 'refusal';
      return outcome;
    }

    const parsed = probeSchema.safeParse(
      safeJsonParse(response.outputText ?? ''),
    );

    if (!parsed.success || parsed.data.ok !== true) {
      // The key and the model both work; the model just did not honour a
      // one-field strict schema. Worth saying plainly rather than as "failed",
      // because the fix is a different model rather than a different key.
      outcome.error =
        'The model answered, but not with the expected JSON. Try a different model.';
      outcome.errorCode = 'schema';
      return outcome;
    }

    outcome.checks.generate = 'passed';
    return outcome;
  } catch (err) {
    return { ...outcome, ...describeFailure(err) };
  }
}

function describeFailure(err: unknown): Partial<ConnectionCheckOutcome> {
  if (err instanceof AiProviderError) {
    return {
      error: err.message,
      errorCode: err.code,
      providerRequestId: err.providerRequestId ?? null,
    };
  }

  // Not a provider failure: a bug here, or a settings read that blew up. The
  // message is deliberately generic — an unexpected error's text has not been
  // through the redactor.
  return {
    error: 'The connection test failed unexpectedly.',
    errorCode: 'provider',
  };
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
