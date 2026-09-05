#!/usr/bin/env node
// =============================================================================
// fake-openai — a deterministic stand-in for OpenAI (issue #30, epic #20)
// =============================================================================
//
// TEST INFRASTRUCTURE ONLY. It authenticates nothing, encrypts nothing, and
// will happily answer any request whose bearer token starts with `sk-test-`.
// Never run it anywhere a real client could reach it.
//
// It exists so the epic is provable end to end — database, API and UI — without
// an OpenAI account, deterministically, in a repository with no CI. Every later
// epic's e2e (onboarding proposals, coach chat, workout programs) needs the same
// thing, which is why it speaks the shape of the API rather than the shape of
// one test.
//
// ZERO DEPENDENCIES, ESM, `node:http` ONLY. That is what lets it run from a
// read-only bind mount inside `node:24-alpine` with no install step and no
// build — see `infra/compose/fake-openai.compose.yml`.
//
// -----------------------------------------------------------------------------
// WHAT IT DELIBERATELY DOES BEYOND ECHOING
// -----------------------------------------------------------------------------
//
//   1. IT REJECTS `store !== false`. The provider (#23) must send `store: false`
//      on every generate, because this product sends a user's own coaching
//      context under their own key. Asserting it here as well as in a unit test
//      means a regression fails the e2e suite too — where it would otherwise be
//      invisible.
//
//   2. IT SERVES MODELS THE >= 5.4 FILTER MUST DROP (`gpt-5.3`, `gpt-4o`,
//      `gpt-5.5-realtime`). A catalog containing only supported models would let
//      a broken filter pass.
//
//   3. IT BUILDS ITS ANSWER FROM THE REQUESTED JSON SCHEMA rather than from a
//      fixture. A caller that changes its contract gets a conforming answer with
//      no edit here, which is what stops this file becoming a second place every
//      later epic has to update.
//
//   4. IT ANSWERS SOME PERSONAS IN CHARACTER (`scenarios/index.mjs`, #93). A
//      schema-shaped placeholder is enough to prove a call happened; it is not
//      enough to prove the coach's loop works, because a proposal full of
//      "placeholder" strings and made-up uuids is rejected by the hallucination
//      guard before it reaches anybody. Scenarios are keyed on the SCHEMA NAME
//      and a keyword in the input — never on a header, because the API calls
//      this server and the browser does not.
//
// `x-fake-behaviour` selects a failure mode: `rate_limit`, `timeout`, `refusal`,
// `invalid_json`. Anything else is the happy path.
// =============================================================================

import { createServer } from 'node:http';

import { matchScenario } from './scenarios/index.mjs';

const PORT = Number(process.env.PORT || 8089);

/** Fixed epoch so a snapshot of the catalog is stable across runs. */
const CREATED = 1772000000;

/**
 * Deliberately mixed. The three unsupported entries are what make the >= 5.4
 * filter observable in the UI: if they appear in the admin page's select, the
 * filter is broken.
 */
const MODELS = [
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.3',
  'gpt-4o',
  'gpt-5.5-realtime',
].map((id) => ({ id, object: 'model', created: CREATED, owned_by: 'openai' }));

const MODEL_IDS = new Set(MODELS.map((m) => m.id));

let requestCounter = 0;

function send(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'x-request-id': `fake-${requestCounter}`,
    ...headers,
  });
  res.end(payload);
}

function sendError(res, status, message, extra = {}, headers = {}) {
  send(res, status, { error: { message, ...extra } }, headers);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    // Signalled rather than thrown so the caller answers 400 in OpenAI's shape
    // instead of the process dying on a malformed body.
    return null;
  }
}

/**
 * Build the smallest object satisfying a JSON Schema.
 *
 * Recursive and type-driven, so a caller's new contract needs no edit here.
 * Only the subset `toOpenAiStrictSchema` (#23) can emit is handled — which is
 * the whole subset this product can ever send.
 */
function buildFromSchema(schema) {
  if (!schema || typeof schema !== 'object') return null;

  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];

  // `anyOf` is how a nullable property is spelled. Prefer a non-null branch so
  // the answer exercises the caller's real shape rather than always being null.
  if (Array.isArray(schema.anyOf)) {
    const branch =
      schema.anyOf.find((b) => b && b.type !== 'null') ?? schema.anyOf[0];
    return buildFromSchema(branch);
  }

  // Strict mode spells an optional property as `type: ['string', 'null']`.
  const type = Array.isArray(schema.type)
    ? schema.type.find((t) => t !== 'null') ?? 'null'
    : schema.type;

  switch (type) {
    case 'object': {
      const out = {};
      const properties = schema.properties ?? {};
      for (const key of schema.required ?? Object.keys(properties)) {
        out[key] = buildFromSchema(properties[key]);
      }
      return out;
    }
    case 'array':
      return [];
    case 'string':
      return 'placeholder';
    case 'number':
    case 'integer':
      return 0;
    case 'boolean':
      // `true`, so the connection probe's `{ ok: boolean }` yields `{"ok":true}`
      // and reads as a pass.
      return true;
    case 'null':
    default:
      return null;
  }
}

function messageResponse(model, content) {
  return {
    id: `resp_${requestCounter}`,
    object: 'response',
    model,
    status: 'completed',
    output: [
      {
        type: 'message',
        id: `msg_${requestCounter}`,
        role: 'assistant',
        status: 'completed',
        content,
      },
    ],
    usage: {
      input_tokens: 42,
      output_tokens: 7,
      total_tokens: 49,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
    incomplete_details: null,
  };
}

const server = createServer(async (req, res) => {
  requestCounter += 1;

  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const path = url.pathname;
  const behaviour = req.headers['x-fake-behaviour'] ?? 'default';

  const log = (status) =>
    // One line per request: method, path, selected behaviour, status. Enough to
    // tell "the API never called me" from "the API called me and I said no".
    console.log(`fake-openai ${req.method} ${path} behaviour=${behaviour} -> ${status}`);

  if (path === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    log(200);
    return;
  }

  if (!path.startsWith('/v1/')) {
    sendError(res, 404, `Unknown path ${path}`);
    log(404);
    return;
  }

  // The auth check. `sk-test-` rather than a fixed value so a spec can use a
  // recognisable key of its own and still be accepted; the MESSAGE is OpenAI's
  // own wording, because the admin and user pages render it verbatim and the
  // e2e specs assert on it.
  const authorization = String(req.headers.authorization ?? '');
  if (!authorization.startsWith('Bearer sk-test-')) {
    sendError(res, 401, 'Incorrect API key provided: sk-***', {
      type: 'invalid_request_error',
      code: 'invalid_api_key',
    });
    log(401);
    return;
  }

  if (path === '/v1/models' && req.method === 'GET') {
    send(res, 200, { object: 'list', data: MODELS });
    log(200);
    return;
  }

  if (path === '/v1/responses' && req.method === 'POST') {
    const body = await readJson(req);

    if (body === null) {
      sendError(res, 400, 'fake-openai: request body was not JSON');
      log(400);
      return;
    }

    // THE `store: false` GUARD. See the header — a regression in the provider
    // fails the e2e suite here rather than passing silently.
    if (body.store !== false) {
      sendError(res, 400, 'fake-openai: store must be false');
      log(400);
      return;
    }

    if (!MODEL_IDS.has(body.model)) {
      sendError(
        res,
        404,
        `The model \`${body.model}\` does not exist or you do not have access to it.`,
        { type: 'invalid_request_error', code: 'model_not_found' },
      );
      log(404);
      return;
    }

    if (behaviour === 'rate_limit') {
      sendError(
        res,
        429,
        `Rate limit reached for ${body.model}`,
        { type: 'rate_limit_error' },
        { 'retry-after': '1' },
      );
      log(429);
      return;
    }

    if (behaviour === 'timeout') {
      // Never answers. The socket closes when the client's AbortController
      // fires, which is exactly what the provider's timeout path needs to see.
      log('(hanging)');
      req.on('aborted', () => res.destroy());
      return;
    }

    if (behaviour === 'refusal') {
      send(
        res,
        200,
        messageResponse(body.model, [
          { type: 'refusal', refusal: "I can't help with that." },
        ]),
      );
      log(200);
      return;
    }

    if (behaviour === 'invalid_json') {
      send(
        res,
        200,
        messageResponse(body.model, [
          { type: 'output_text', text: 'not json {', annotations: [] },
        ]),
      );
      log(200);
      return;
    }

    // A named scenario first (#93), the generic builder otherwise. The
    // fallback is what keeps this file from becoming a second place every
    // later epic has to update: a persona with no scenario still gets a
    // conforming answer built from its own schema.
    const schema = body?.text?.format?.schema;
    const answer = matchScenario(body) ?? buildFromSchema(schema);

    send(
      res,
      200,
      messageResponse(body.model, [
        { type: 'output_text', text: JSON.stringify(answer), annotations: [] },
      ]),
    );
    log(200);
    return;
  }

  sendError(res, 404, `Unknown path ${path}`);
  log(404);
});

server.listen(PORT, () => {
  console.log(`fake-openai listening on :${PORT}`);
});
