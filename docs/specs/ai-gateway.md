# The AI Gateway

> **Status:** implemented by [#26](https://github.com/marinoscar/evolvepath/issues/26)
> (epic [#20](https://github.com/marinoscar/evolvepath/issues/20)).
> Configuration decisions are in [`ai-configuration.md`](ai-configuration.md);
> the recipe for adding a persona is in
> [CLAUDE.md](../../CLAUDE.md#adding-an-ai-persona).

`AiGatewayService.invoke()` is the **only** way this product calls a model. No
caller in E02–E12 touches a key, a provider, a JSON schema or a telemetry row.

---

## 1. The contract

**Frozen for E02–E12.** Add optional fields; never repurpose an existing one.

```ts
export interface AiInvokeRequest<T> {
  persona: PersonaKey;
  userId: string;              // whose key pays, and whose data this is
  promptVersion: string;       // e.g. 'planner.v1' — PRD §117
  instructions: string;        // the system/developer prompt
  input: string;               // the user turn; attachments travel separately
  attachments?: AiAttachment[];
  schema: ZodType<T>;          // REQUIRED — there is no free-text mode
  schemaName: string;          // ^[a-zA-Z0-9_-]{1,64}$
  maxOutputTokens?: number;
  reasoningEffort?: AiReasoningEffort;  // defaults to the persona's
  requestId?: string;          // the HTTP request id, when in a request scope
}

export type AiInvokeResult<T> =
  | { ok: true;  invocationId: string; output: T; usage: AiUsage; model: string; latencyMs: number }
  | { ok: false; invocationId: string; error: { code: AiErrorCode; message: string }; model: string | null; latencyMs: number };
```

Why the shape is what it is:

- **`schema` is required.** PRD §115 step 5 and §16 leave no free-text mode. A
  caller that wants prose asks for `{ text: string }`.
- **`promptVersion` is required.** It is what makes "did the coach get worse
  after we changed the prompt?" answerable. Nothing can infer it for you.
- **A discriminated union, not `{ output?, error? }`.** `ok: true` narrows
  `output` to `T`, so a caller *cannot* read the output without first handling
  the failure PRD §120 requires them to handle.
- **`invocationId` on both arms.** It is the `ai_invocations` row and the span's
  `ai.invocation_id`, so a support conversation has something to quote.

---

## 2. It does not throw

Not for a missing key, a disabled provider, an unconfigured model, a refused
attachment, a rate limit, a timeout, a refusal, or output that fails validation.
Every one of those is `{ ok: false }`, because PRD §120 requires the
deterministic path to keep working — and a caller cannot keep working around an
exception it has to remember to catch.

**Two exceptions, both programmer errors:**

- An **unknown persona**. It cannot happen with a `PersonaKey`-typed call, so
  reaching it means a caller cast a string.
- A **schema strict mode cannot express** (a record, or a union of objects).
  Conversion runs *outside* the OTel span deliberately, so this surfaces
  synchronously at the call site rather than reading as a provider outage.

Even the telemetry write is wrapped in the gateway itself: the never-throw
promise is this class's own, not one borrowed from a logger that might stop
catching.

---

## 3. Step order

1. `findPersona` — unknown is a programmer error (throws).
2. Read settings — unreadable, no provider, or disabled → `ai_disabled`.
3. `resolveModel(settings, persona)` — none → `no_model`.
4. `userAiKey.getSecretForUser(userId)` — none → `no_user_key`. **Never** the
   platform key; a unit test asserts that address is never reached from here.
5. Attachments — a non-vision persona → `attachment`, refused **before a byte
   leaves storage**; otherwise resolved (see §6).
6. The provider call, inside the `ai.invoke` span.
7. Interpret: refusal → `refused`; no output or an incomplete reason, unparseable
   JSON, or a Zod mismatch → `invalid_output`.
8. Success.

Exactly one `ai_invocations` row is written on **every** one of those exits.

---

## 4. Error codes, and what a caller should do

| Code | Meaning | Caller's move |
|---|---|---|
| `ai_disabled` | No provider chosen, AI off, or an unreadable settings row | Deterministic fallback. An administrator must act. |
| `no_model` | No model for this persona and no default | Deterministic fallback. An administrator must act. |
| `no_user_key` | The caller has no key | `assertAiKeyAvailable(result)` → 412, **or** fall back |
| `auth` | The key is wrong, revoked or unfunded | Tell the user to check their key |
| `rate_limit` | 429 from the provider | Back off and retry later |
| `timeout` | Our deadline elapsed | Retry, or fall back |
| `network` | DNS/TLS/connection failure | Retry, or fall back |
| `provider` | Theirs, or an unclassified failure | Fall back |
| `schema` | Output was absent, unparseable, or failed the contract | Fall back; consider the prompt or the model |
| `refusal` | The model declined | Show the refusal, or redirect the user |
| `attachment` | Not found, not ready, too large, too many, unsupported | Tell the user which attachment |

### `AiKeyRequiredException` and `assertAiKeyAvailable`

```ts
const result = await this.ai.invoke({ /* … */ });
assertAiKeyAvailable(result);   // no_user_key -> HTTP 412 AI_KEY_REQUIRED
if (!result.ok) return this.templateFallback();
```

**The gateway never throws it.** A route with a deterministic fallback (PRD §120)
simply does not call `assertAiKeyAvailable`; a route with nothing useful to offer
without AI does, and the web app's redirect handles it. Keeping it a one-line
opt-in is what makes that a visible decision rather than a default.

The 412 body is sent **verbatim**, bypassing the shared error envelope, because
the filter's status-derived rewriting would turn `code` into `ERROR` and destroy
the only discriminator the web app has. See
`common/exceptions/verbatim-error-body.exception.ts`.

---

## 5. What is recorded

### The `ai_invocations` row

PRD §88 asks that every AI operation be observable internally. The mapping:

| PRD §88 asks for | Column |
|---|---|
| model | `model`, plus `provider` |
| prompt version (§117) | `prompt_version` |
| structured input and output | `input`, `output` (JSONB, redacted) |
| validation result | `output_valid`, `status` |
| latency | `latency_ms` |
| token use | `input_tokens`, `output_tokens`, `cached_input_tokens`, `reasoning_tokens` |
| safety decision | `safety_decision` (reserved for E06-06) |

Plus `operation`, `key_scope`, `user_id`, `persona`, `request_id`,
`provider_request_id`, `error_code`, `error_message`, `attachment_count`.

**What is stored:** the instructions, the user turn, the attachment **ids**, the
schema name, and the parsed output — or, for an invalid answer, the raw text.
That is what makes a bad answer diagnosable.

**What is never stored:** the model's internal chain of thought. There is no
column for it (PRD §16, §88), and the provider skips reasoning items in
`output[]` rather than lifting them out of the payload. Reasoning **tokens** are
counted, because a bill is not a transcript. Attachment bytes are not copied
either — they are already in storage.

**Redaction and caps, both owned by the writer:**

- Every string goes through `AiKeyRedactor`: the exact key we hold, **plus** an
  `sk-…` pattern pass for a key echoed in a form we never registered.
- JSON blobs are redacted **recursively**, object keys included, and use
  `scrub` (no length cap) — capping each string at the error-message bound would
  silently truncate a long system prompt.
- The blob is capped **as a whole** at 32 KiB, replaced by
  `{ _truncated: true, preview }` rather than cut short: a truncated JSON
  document is not JSON and `jsonb` would reject it.
- `error_message` is capped at 2000 chars, **scrub-then-cap** — capping first
  could bisect a key and leave half standing.

A failed telemetry write is logged and swallowed. It must never fail the call it
describes.

### The span

One `ai.invoke` CLIENT span on tracer `evolvepath-api`:

`gen_ai.system`, `gen_ai.operation.name`, `gen_ai.request.model`,
`gen_ai.response.model`, `gen_ai.usage.input_tokens`,
`gen_ai.usage.output_tokens`, `ai.persona`, `ai.prompt_version`,
`ai.key_scope`, `ai.invocation_id`, `ai.attachment_count`, `ai.status`,
`ai.error_code`, `enduser.id`.

**Attributes only, never content.** Spans are exported to a third-party backend
and these prompts carry a user's health, family and work context.

`ERROR` status **only** for `failed`. A refusal and an answer that fails
validation are things the model *did*; the call worked, and marking them as span
errors would make every error-rate alert fire on model behaviour rather than on
outages.

### The log line

```
AI invoke id=<uuid> persona=<k> model=<m> scope=user status=<s> latencyMs=<n> tokens=<in>/<out> user=<userId>
```

Ids and counts only — no prompt, no output, no key. Application logs are
shipped, indexed and retained far more widely than the telemetry table is.

---

## 6. Attachments

Vision personas only (`media_analyst` today). Every object — **and every video
frame individually** — goes through `ObjectsService.getById(id, userId)`, the
existing ownership check. Skipping it for a frame because its parent passed would
make a forged `_processing` blob a read primitive.

- **Images** are downloaded and inlined as base64 data URLs, aborting mid-stream
  once `AI_MAX_IMAGE_BYTES` (20 MiB) is passed. The storage key is read with
  Prisma *after* the ownership check: `ObjectResponseDto` omits it deliberately.
- **Videos** expand to the frames E03-03 recorded at
  `metadata._processing['video-frames'] = { frames: [{ objectId, timestampMs }], … }`,
  in `timestampMs` order. An unprocessed video is a clear `attachment` error.
- Anything else is "Unsupported attachment type".
- The `AI_MAX_IMAGES_PER_CALL` (10) check runs **once, at the end**, against the
  expanded count — a per-attachment check would let ten videos through as a
  hundred images.
- A not-found and a not-owned object collapse to **one message**: distinguishing
  them would tell a caller whether an id they do not own exists, which is the
  enumeration the ownership check exists to prevent.

**Inline, not signed URLs.** A signed URL means handing OpenAI a credential that
reaches this deployment's storage, with a lifetime to reason about and a fetch we
cannot observe. `mode` is declared so E03 can add the alternative deliberately;
selecting it today throws **at boot**, so a misconfiguration is a failed deploy
rather than a broken coaching reply.

---

## 7. How to test a caller

**Unit / integration:** override the provider in `createTestApp`, so nothing
leaves the process:

```ts
context = await createTestApp({
  useMockDatabase: true,
  overrideProviders: [
    { provide: CredentialsService, useValue: mockCredentials },
    { provide: OpenAiProvider, useValue: mockProvider },
  ],
});
```

Worked examples: `apps/api/test/ai/ai-gateway.integration.spec.ts` (which also
proves the gateway resolves from the real `AppModule` graph — the only way a
missing module import surfaces) and `ai-settings.integration.spec.ts`.

**End to end:** run against the fake OpenAI server —
[`tools/fake-openai/README.md`](../../tools/fake-openai/README.md). It builds its
answer from the requested JSON schema, so a new contract needs no edit there, and
`x-fake-behaviour` selects `rate_limit`, `timeout`, `refusal` or `invalid_json`.
