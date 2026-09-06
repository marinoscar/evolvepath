# fake-openai

A deterministic stand-in for OpenAI's `/v1/models` and `/v1/responses`, so
EvolvePath's end-to-end suite can exercise the whole AI path — database, API and
UI — without an OpenAI account and without spending anything.

**Test infrastructure only.** It authenticates nothing and will answer any
request whose bearer token starts with `sk-test-`. Never run it anywhere a real
client could reach it; the Compose overlay deliberately publishes no port.

## Running it

Zero dependencies, no build step, Node 24:

```bash
node tools/fake-openai/server.mjs          # listens on :8089
PORT=9000 node tools/fake-openai/server.mjs
```

In Compose it is a `node:24-alpine` container with this directory bind-mounted
read-only — see `infra/compose/fake-openai.compose.yml`, which also points the
API at it via `OPENAI_BASE_URL=http://fake-openai:8089/v1`.

## Endpoints

| Method | Path | Behaviour |
|---|---|---|
| GET | `/healthz` | `200 ok`. The Compose healthcheck. |
| GET | `/v1/models` | The catalog below. |
| POST | `/v1/responses` | A structured answer built from the requested JSON schema. |

Anything else is a 404 in OpenAI's error shape.

### The catalog

```
gpt-5.4          ← supported
gpt-5.4-mini     ← supported
gpt-5.3          ← below the floor
gpt-4o           ← below the floor
gpt-5.5-realtime ← excluded variant
```

**Deliberately mixed.** The three unsupported entries are what make the
GPT ≥ 5.4 filter observable: if any of them appears in the admin page's model
select, the filter is broken. A catalog of only supported models would let a
broken filter pass.

### The answer

`POST /v1/responses` builds its reply **from `text.format.schema`**, recursively
and by type — `string` → `"placeholder"`, `number` → `0`, `boolean` → `true`,
`array` → `[]`, an `enum` → its first value, a nullable `anyOf` → its non-null
branch. So the connection probe's `{ ok: boolean }` yields `{"ok":true}`, and a
later epic that changes its contract gets a conforming answer with **no edit
here**. That is the point: this file must not become a second place every epic
has to update.

## Guards

| Condition | Response |
|---|---|
| Bearer token not starting `sk-test-` | 401 `Incorrect API key provided: sk-***` |
| `store` is not exactly `false` | 400 `fake-openai: store must be false` |
| Unknown `model` | 404 `model_not_found` |
| Body is not JSON | 400 |

The **`store: false` guard is load-bearing.** The provider must send it on every
generate, because this product sends a user's own coaching context under their
own key and must not leave it in OpenAI's response store. Asserting it here as
well as in a unit test means a regression fails the e2e suite too, where it
would otherwise be invisible.

The 401 message is OpenAI's own wording on purpose: the admin and user pages
render provider errors verbatim, and the e2e specs assert on that string.

## Scenarios

A schema-shaped placeholder proves a call happened. It does not prove the
coach's loop works: a proposal full of `"placeholder"` strings and made-up
uuids is rejected by the hallucination guard before anyone sees it.

`scenarios/index.mjs` therefore answers some personas **in character**, keyed on
the strict JSON schema name and a keyword in the serialized input. Anything it
says nothing about returns `null` and falls through to the schema builder.

| schema name | input contains | answer |
|---|---|---|
| `coach_reply` | `Wednesday` | `PLAN_CHALLENGE` with a `move` proposal, Wed 18:30 → Sat 09:00 |
| `coach_reply` | `procrastinat` | `ACTIVATION_REDUCTION` with a 10-minute action |
| `coach_reply` | anything else | `NORMAL_REMINDER`, no proposal |
| `safety_decision` | `hurts` / `sore` / `tweak` | `conservative` / `injury` |
| `safety_decision` | anything else | `allow` / `none` |
| `insight_proposal` | — | two insights, each with its observation |

**Keyed on the schema name, never on a header.** The API calls this server; the
browser does not, so a Playwright spec cannot set a header on the request that
matters. The only thing a spec controls is what the user types, which arrives
inside the input.

**Ids come out of the context, not out of the fixture.** The `coach_reply`
scenario reads the first `planId=`, `routineId=` and `commitmentId=` the context
assembler rendered and uses those. When the context has none it **declines to
propose** rather than inventing one — a made-up uuid would look like a coach
failure rather than the seed failure it is.

```bash
npm run test:fake-openai   # node --test, zero dependencies, from the repo root
```

## Failure modes

Send `x-fake-behaviour` on `POST /v1/responses`:

| Value | Effect |
|---|---|
| `rate_limit` | 429 with `retry-after: 1` |
| `timeout` | Never answers; the socket closes when the client aborts |
| `refusal` | A `refusal` content part instead of `output_text` |
| `invalid_json` | `output_text` of `not json {` |

Anything else (including absent) is the happy path.

## Poking it by hand

```bash
node tools/fake-openai/server.mjs &

curl -s localhost:8089/v1/models -H 'authorization: Bearer sk-test-x' | jq '.data[].id'

curl -s -X POST localhost:8089/v1/responses \
  -H 'authorization: Bearer sk-test-x' -H 'content-type: application/json' \
  -d '{"model":"gpt-5.4","store":false,"input":[],"text":{"format":{"type":"json_schema","name":"p","schema":{"type":"object","properties":{"ok":{"type":"boolean"}},"required":["ok"]}}}}' \
  | jq -r '.output[0].content[0].text'
# {"ok":true}
```

## `GET /__debug/last` (issue #103, epic #67)

What the last `/v1/responses` body actually contained:

```json
{
  "schemaName": "media_advice",
  "imageCount": 4,
  "imageUrls": ["data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ"],
  "textParts": 1
}
```

It exists for one assertion nothing else in the stack can make: **"every
sampled frame reached the provider"** is a claim about the request body. The
attachment can say four frames *exist*; only this server knows whether four
images were *sent*.

`imageUrls` entries are truncated to 40 characters — enough to tell a `data:`
URL from an `https://` one, which is the whole point of the
`AI_ATTACHMENT_MODE` assertion, and not enough to be image bytes in a log.

Unauthenticated, like `/healthz`, for the same reason: this server trusts any
`sk-test-` token and is not reachable from outside the Compose network. The
`e2e-media.compose.yml` overlay publishes port 8089 so the test runner — which
is on the host — can reach it.
