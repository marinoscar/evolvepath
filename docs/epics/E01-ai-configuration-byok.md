# E01 — AI Provider Configuration & Bring-Your-Own-Key

<!-- epic-meta: slug=ai-configuration-byok phase=1 -->

## Epic

### Goal

Give EvolvePath a governed way to talk to an LLM before any product feature needs one. An administrator connects OpenAI once — platform key, per-persona model selection from a live `/v1/models` catalog filtered to GPT ≥ 5.4, and a test-connection button that reports the provider's real error — and every user brings their own OpenAI key, gated at first sign-in with step-by-step instructions and a test. Every later AI call in the product (VISION §18 "AI everywhere, chatbot nowhere"; PRD §14 AI System Architecture) goes through one `AiGatewayService` that enforces PRD §115 (structured contract → validate → log), PRD §88 (observability of model, prompt version, tokens, latency, validation result) and PRD §120 (deterministic product logic keeps working when the model is unavailable). Keys are encrypted with the existing `CredentialsService`, never returned by any endpoint, and never logged.

### Background

The repository is a generic production foundation (OAuth, RBAC, settings hub, encrypted credentials, storage, notifications) with **no AI code and no HTTP client dependency** — Node 24 `fetch` is used directly, no `openai` package is added. The design copies proven patterns instead of inventing:

- **Settings + write-only secret + test connection** is exactly what the email feature already does: `apps/api/src/email/email-settings.service.ts` (own `system_settings` row key, `describeForAdmin()` that never throws, `If-Match` versioning, audit `email_settings:replace`), `apps/api/src/email/email-test-send.service.ts` (HTTP 200 with `{ success, error, attemptedAt }`, audit `email_settings:test`), `apps/api/src/email/dto/update-email-settings.dto.ts` (`blankable` fields, `nestjs-zod` `createZodDto`), `apps/api/src/email/email-settings.schema.ts` (compile-time "carries no secret" proof). The web twins are `apps/web/src/hooks/useEmailSettings.ts` and `apps/web/src/pages/Admin/EmailSettingsPage.tsx`.
- **Secrets** live in `apps/api/src/credentials/credentials.service.ts` (`getSecret`/`describe`/`setSecret`/`deleteSecret`, keyed `(purpose, name)`, AES-256-GCM with per-purpose sub-keys, "blank preserves"). No migration is needed for per-user keys: purpose `ai:openai:user`, name `<userId>`; platform key purpose `ai:openai`, name `platform`.
- **Settings UI** is registry-driven (CLAUDE.md "MANDATORY: Settings UI Pattern"): `apps/web/src/config/adminSections.tsx` (`ADMIN_SECTIONS`), `apps/web/src/config/userSettingsSections.tsx` (`USER_SETTINGS_SECTIONS`), shared `apps/web/src/components/settings/SettingsHub.tsx`. The spec file those rules cite, `docs/specs/settings-ui.md`, does not exist (referenced from CLAUDE.md, `docs/ARCHITECTURE.md`, `docs/TESTING.md`, `EmailSettingsPage.tsx`) — E01-11 creates it.
- **Route gating**: `apps/web/src/components/common/ProtectedRoute.tsx` checks authentication only; there is no onboarding gate. It is the insertion point for the BYOK gate. `/activate` already renders outside `Layout`; `/setup/ai-key` follows that shape.
- **Error envelope**: `apps/api/src/common/filters/http-exception.filter.ts` overwrites any `code` an exception supplies (mapping status → `BAD_REQUEST`, `CONFLICT`, … `ERROR`); a body that must reach the client verbatim is wrapped with `withVerbatimErrorBody()` from `apps/api/src/common/exceptions/verbatim-error-body.exception.ts`. The 412 `AI_KEY_REQUIRED` response uses that.
- **Storage** is S3-only (`STORAGE_PROVIDER` token, `download(key)` returns a `Readable`); `ObjectsService.getById(id, userId)` enforces ownership; processors merge results into `metadata._processing` (`apps/api/src/storage/processing/object-processing.service.ts`). E03-03 will write video frames as `metadata._processing['video-frames'] = { frames: [{ objectId, timestampMs }], durationMs, width, height }`; E01-06's resolver reads exactly that shape.
- **Tests**: API integration specs use `createTestApp({ overrideProviders })` from `apps/api/test/helpers/test-app.helper.ts` (see `apps/api/test/settings/email-settings.integration.spec.ts` for the override pattern); web tests use Vitest + RTL + MSW (`apps/web/src/__tests__/mocks/handlers.ts`) and `vitest-axe`; visual baselines live in `tests/visual/specs/*-snapshots/` and are regenerated only inside `mcr.microsoft.com/playwright:v1.62.1-noble`; behavioural e2e lives in `tests/e2e/` against Docker Compose with the `/testing/login` page (`tests/e2e/helpers/auth.helper.ts`).
- **Observability**: OTel is wired (`apps/api/src/instrumentation.ts`; `trace.getTracer('evolvepath-api')` in `apps/api/src/common/decorators/trace.decorator.ts`); Pino logging via `LoggingInterceptor`.

Product constraints this epic fixes for every later epic: personas are `planner`, `coach`, `pattern_analyst`, `workout_programmer`, `weekly_reviewer`, `notification_copywriter`, `safety`, `media_analyst` (vision); AI never mutates plans directly (PRD §15) — the gateway returns structured output, callers decide; internal chain of thought is never stored or exposed (PRD §16, §88).

Related specs after this epic ships: `docs/specs/ai-configuration.md` (new, E01-12), `docs/specs/ai-gateway.md` (new, E01-12), `docs/specs/settings-ui.md` (new, E01-11).

### Scope

- [ ] E01-01 feat(db): add ai_invocations table for AI observability
- [ ] E01-02 feat(api): add AI persona registry, settings schema and model version filter
- [ ] E01-03 feat(api): add OpenAI provider over the Responses API with structured and image input
- [ ] E01-04 feat(api): add admin AI settings endpoints with live model catalog and test connection
- [ ] E01-05 feat(api): add per-user OpenAI key endpoints and aiKey status on /auth/me
- [ ] E01-06 feat(api): add AI gateway with invocation logging and attachment resolution
- [ ] E01-07 feat(web): add AI settings admin page with persona model selectors
- [ ] E01-08 feat(web): add user OpenAI key settings page and shared key form
- [ ] E01-09 feat(web): gate signed-in users without an OpenAI key behind the setup flow
- [ ] E01-10 test(tests): add fake OpenAI server and end-to-end AI key and admin flows
- [ ] E01-11 docs(docs): create the missing docs/specs/settings-ui.md
- [ ] E01-12 docs(docs): document AI configuration, BYOK and the "Adding an AI persona" recipe

### Out of scope

- Any product feature that *uses* the gateway (onboarding planner, coach chat, workout programming) — E04+ call `AiGatewayService.invoke()`; this epic ships the gateway and proves it with a probe.
- A second provider (Anthropic, Gemini, Azure OpenAI). The `AiProvider` interface and `provider: enum(['openai'])` leave the door open; nothing else is built.
- Platform-key fallback for users without a key. The gateway reads only the user's key; the platform key serves only the admin catalog and admin test (decision recorded in `docs/specs/ai-configuration.md`).
- Media upload UI, MIME/size enforcement, video frame sampling, HEIC normalisation, signed-URL attachment mode, storage quotas — E03. E01-06 ships the attachment *resolver* (inline base64 mode) so E03 has a consumer.
- Streaming responses, tool calling, conversation memory, prompt templates per persona (E06), safety classifier (E06-06).
- Distributed rate limiting (`@nestjs/throttler`, Redis). The test throttles are per-process sliding windows and documented as such.
- Usage-based billing, per-user spend caps, cost dashboards.
- A credentials admin UI beyond the two key fields this epic adds.
- GitHub Actions CI (declined by the product owner; verification is local `npm test`, Playwright e2e and the manual script).

### Sequencing

```
E01-01 (db)  ─┐
E01-02 (api) ─┼─► E01-04 (admin API) ─► E01-07 (admin page) ─┐
E01-03 (api) ─┤                                              ├─► E01-10 (fake server + e2e) ─► E01-12 (docs)
              └─► E01-05 (user key API) ─► E01-08 (key page) ─► E01-09 (gate) ─┘
E01-03 + E01-05 ─► E01-06 (gateway)  (parallel with the web work; E01-10 does not depend on it)
E01-11 (settings-ui spec) — independent; can be picked up any time
```

- **Parallel start**: E01-01, E01-02, E01-03, E01-11 have no dependencies. E01-01 and E01-02 are each under an hour; run them first so E01-04/E01-05 are unblocked.
- **Critical path**: E01-03 → E01-05 → E01-08 → E01-09 → E01-10 → E01-12. The gate (E01-09) is what changes every existing e2e test's landing page, so E01-10 must land in the same PR train.
- **Contract freeze**: the gateway signature in E01-06 and the persona keys in E01-02 are consumed by E02–E12. Change them only through this epic.
- **Frontend fixtures**: E01-08 makes `User.aiKey` required in `apps/web/src/types/index.ts`, which breaks compilation of every fixture that builds a `User` (`apps/web/src/__tests__/utils/test-utils.tsx`, `apps/web/src/__tests__/mocks/data.ts`, `apps/web/src/__tests__/mocks/handlers.ts`, `apps/web/visual/main.tsx`). That is intentional; fix them in E01-08.

### Manual end-to-end verification

Run from a clean clone. Postgres is external to Compose: point `POSTGRES_*` at a reachable database. Replace `<you@example.com>` with the address you will sign in with. Every `psql` check below uses the same connection string; export it once:

```bash
export PGURL="postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@$POSTGRES_HOST:$POSTGRES_PORT/$POSTGRES_DB"
```

1. **Configure the environment.**
   `cp infra/compose/.env.example infra/compose/.env`, then in `infra/compose/.env` set `POSTGRES_HOST/PORT/USER/PASSWORD/DB` to your database, `JWT_SECRET` and `COOKIE_SECRET` to 32+ character values, `INITIAL_ADMIN_EMAIL=<you@example.com>`, and `SECRETS_ENCRYPTION_KEY=$(openssl rand -base64 32)` (paste the generated value; no trailing comment on the line). Leave `OPENAI_BASE_URL` unset — the overlay in step 2 sets it.
2. **Start the stack with the fake OpenAI server.**
   `cd infra/compose && docker compose -f base.compose.yml -f dev.compose.yml -f fake-openai.compose.yml up --build`
   Expected: `api`, `web`, `nginx`, `fake-openai` all running; `curl -s http://localhost:3535/api/health/live` returns `{"status":"ok"...}`; `docker compose -f base.compose.yml -f dev.compose.yml -f fake-openai.compose.yml exec api sh -c 'wget -qO- http://fake-openai:8089/healthz'` prints `ok`.
3. **Migrate and seed** (second shell, same directory):
   `docker compose -f base.compose.yml -f dev.compose.yml -f fake-openai.compose.yml exec api npm run prisma:migrate`
   `docker compose -f base.compose.yml -f dev.compose.yml -f fake-openai.compose.yml exec api npm run prisma:seed`
   Expected: migration `add_ai_invocations` listed as applied; seed prints the permission/role counts and adds `<you@example.com>` to the allowlist.
   Check: `psql "$PGURL" -c "select table_name from information_schema.tables where table_name='ai_invocations';"` → one row.
4. **Sign in without a key and hit the gate.**
   Open http://localhost:3535/testing/login, enter `<you@example.com>`, role **Admin**, leave "Seed an OpenAI key" **unchecked**, click *Login as Test User*.
   Expected: URL becomes `http://localhost:3535/setup/ai-key`. The page shows the heading "Connect your OpenAI API key", the numbered instructions (sign in at platform.openai.com → API keys → Create new secret key → name it "EvolvePath" → copy it once → paste here), a link to https://platform.openai.com/api-keys, the billing note, a password field, *Test key*, *Save and continue* (disabled while the field is empty) and a *Sign out* link. There is no app bar, rail or bottom navigation.
   Type `http://localhost:3535/` in the address bar → you are sent back to `/setup/ai-key`. Same for `/admin/settings` and `/settings`.
5. **Test a bad key, then a good one.**
   Paste `sk-wrong-key-0000000000000000` and click *Test key*. Expected: a red alert "Test failed" whose `<pre>` block contains `Incorrect API key provided: sk-***` (the fake server's 401 message), and `checks: listModels failed`.
   Replace it with `sk-test-e2e-manual-000000000000` and click *Test key*. Expected: green alert "Key works", `checks: listModels passed`, `generate skipped` (no platform default model yet). Click *Save and continue*. Expected: URL `http://localhost:3535/` (the Home page with app bar); the user menu works.
   Check: `psql "$PGURL" -c "select purpose, name, hint from credentials where purpose='ai:openai:user';"` → one row, `hint` ends with `0000`, and `psql "$PGURL" -c "select action, target_type from audit_events where action like 'ai_user_key:%' order by created_at;"` → `ai_user_key:test`, `ai_user_key:test`, `ai_user_key:set`.
6. **Configure the platform.**
   Open http://localhost:3535/admin/settings. Expected: the *General* group shows a new **AI** card between *Email* and *Advanced (JSON)*. Click it → `http://localhost:3535/admin/settings/ai` with title "AI".
   Select provider **OpenAI**, switch **Enabled** on, paste platform key `sk-test-platform-000000000000`, click **Save**. Expected: snackbar "AI settings saved"; the platform key field is empty again and shows "Configured · ••••0000".
   Check: `psql "$PGURL" -c "select key, version, value from system_settings where key='ai';"` → `version 1`, `value` contains `"provider": "openai"`, `"enabled": true`, no key material. `psql "$PGURL" -c "select purpose, name from credentials where purpose='ai:openai';"` → `platform`.
7. **Refresh models and pick per-persona models.**
   Click **Refresh models**. Expected: the *Default model* select lists exactly `gpt-5.4` and `gpt-5.4-mini` (the fake server also serves `gpt-5.3`, `gpt-4o`, `gpt-5.5-realtime`, which must not appear); a caption "Fetched just now · live".
   Choose default model `gpt-5.4`. In the persona table, set `coach` → `gpt-5.4-mini` and `media_analyst` → `gpt-5.4`; leave the rest as *Use default*. Click **Save**. Expected: snackbar; `version` in the DB becomes 2 and `value.personaModels` is `{"coach":"gpt-5.4-mini","media_analyst":"gpt-5.4"}`.
   Resize the window below 600px (or open the page on a phone): the persona table becomes a stack of cards, one per persona, with the same selects.
8. **Test the platform connection.**
   Click **Test connection**. Expected: green alert "Connection works", `providerKind openai`, `model gpt-5.4`, `checks: listModels passed · generate passed`, a latency in ms.
   Click it six times within a minute. Expected: the sixth attempt shows a red alert "Too many test attempts — try again in N s" (HTTP 429).
   Check: `psql "$PGURL" -c "select operation, key_scope, status, model, input_tokens, output_tokens from ai_invocations order by created_at;"` → rows with `test_connection / user / succeeded / null` (from step 5; the user test skipped generate so `model` is null) and `test_connection / platform / succeeded / gpt-5.4`. `psql "$PGURL" -c "select action from audit_events where action='ai_settings:test';"` → five rows (the throttled sixth is not audited).
9. **Reject an unsupported model.**
   Open the browser devtools console and run
   `fetch('/api/ai-settings',{method:'PUT',headers:{'content-type':'application/json','authorization':'Bearer '+localStorage.getItem('access_token'),'if-match':'2'},body:JSON.stringify({provider:'openai',enabled:true,defaultModel:'gpt-5.3',personaModels:{}})}).then(r=>r.json()).then(console.log)`
   Expected: HTTP 400 with `message` containing `gpt-5.3` and "5.4". The DB row is unchanged (`version` still 2).
10. **Remove the user key and watch the gate return.**
    Open http://localhost:3535/settings. Expected: a new **AI** group with card **OpenAI API Key**. Click it → `http://localhost:3535/settings/ai-key` showing "Configured · ••••0000", last test time and result, *Test key*, *Replace key* field, and **Remove key**.
    Click **Remove key**. Expected: a confirm dialog stating that you will be asked for a key again before you can use the app. Confirm. Expected: URL `http://localhost:3535/setup/ai-key`.
    Check: `psql "$PGURL" -c "select count(*) from credentials where purpose='ai:openai:user';"` → `0`; `psql "$PGURL" -c "select action from audit_events where action='ai_user_key:delete';"` → one row.
11. **Seeded login skips the gate.**
    Click *Sign out* on the setup page, open http://localhost:3535/testing/login, same email, tick "Seed an OpenAI key", login. Expected: URL `/` directly; `/settings/ai-key` shows "Configured · ••••" with a hint ending in the last four characters of the seeded `sk-test-e2e-…` key.
12. **Run the automated suites** (from the repo root): `cd apps/api && npm test`, `cd apps/web && npm run test:run`, `cd tests/e2e && npx playwright test` (the Compose stack from step 2 is reused). Expected: all green, including `ai-key-gate.spec.ts` and `admin-ai-settings.spec.ts`.

## Child issues

### E01-01 `feat(db): add ai_invocations table for AI observability`

**Part of epic:** E01 · **Blocked by:** none · **Component:** database · **Priority:** P0 · **Agents:** database-dev → docs-dev

#### Problem statement

PRD §88 requires every AI operation to be observable internally: model, prompt version, structured input and output, validation result, latency, token use, safety decision. PRD §117 requires the prompt version to be captured in logs. PRD §16 and §88 forbid storing hidden chain of thought. Nothing in the schema can hold this today. The table is created first so E01-04 (admin test), E01-05 (user key test, whose `lastTest` is derived from it) and E01-06 (the gateway) can all write to it, and so that E06 can later record `safetyDecision` and user acceptance without another migration.

#### Proposed solution

Add one telemetry table, `ai_invocations`, written by the API on every exit path of an AI call (success, provider failure, invalid output, refusal) and on every test-connection attempt. It is telemetry: the user FK uses `SetNull`, not `Cascade`, so a deleted account does not erase the cost record.

**Data (database-dev)** — in `apps/api/prisma/schema.prisma`, after `Notification`:

```prisma
enum AiInvocationOperation {
  invoke
  test_connection

  @@map("ai_invocation_operation")
}

enum AiKeyScope {
  user
  platform

  @@map("ai_key_scope")
}

enum AiInvocationStatus {
  succeeded
  failed
  invalid_output
  refused

  @@map("ai_invocation_status")
}

model AiInvocation {
  id                String                @id @default(uuid()) @db.Uuid
  operation         AiInvocationOperation
  keyScope          AiKeyScope            @map("key_scope")
  userId            String?               @map("user_id") @db.Uuid
  persona           String?
  provider          String
  model             String?
  promptVersion     String?               @map("prompt_version")
  requestId         String?               @map("request_id")
  providerRequestId String?               @map("provider_request_id")
  status            AiInvocationStatus
  errorCode         String?               @map("error_code")
  errorMessage      String?               @map("error_message") @db.Text
  inputTokens       Int?                  @map("input_tokens")
  outputTokens      Int?                  @map("output_tokens")
  cachedInputTokens Int?                  @map("cached_input_tokens")
  reasoningTokens   Int?                  @map("reasoning_tokens")
  latencyMs         Int                   @map("latency_ms")
  outputValid       Boolean?              @map("output_valid")
  safetyDecision    String?               @map("safety_decision")
  attachmentCount   Int                   @default(0) @map("attachment_count")
  input             Json?
  output            Json?
  createdAt         DateTime              @default(now()) @map("created_at") @db.Timestamptz

  user User? @relation("UserAiInvocations", fields: [userId], references: [id], onDelete: SetNull)

  @@index([userId, createdAt])
  @@index([persona, createdAt])
  @@index([status, createdAt])
  @@map("ai_invocations")
}
```

Add `aiInvocations AiInvocation[] @relation("UserAiInvocations")` to `model User`. Column notes (put them as comments in the schema): `model` is nullable because a user-key test that skips the generate probe has no model; `errorMessage` is redacted and capped at 2000 chars by the writer (E01-06 `AiKeyRedactor`), never by the DB; `input`/`output` hold the structured request/response after redaction, capped at 32 KiB with a `{ "_truncated": true }` marker — **never** raw provider bodies, never reasoning/chain of thought; `safetyDecision` is free text reserved for E06-06 (`allow` / `conservative` / `redirect`).

Migration: `cd apps/api && npm run prisma:migrate:dev -- --name add_ai_invocations`. Then `npm run prisma:generate`. Seed: no change (`apps/api/prisma/seed.ts` untouched — no new permissions).

**API (backend-dev)** — n/a (writers arrive in E01-04/05/06).

**UI (frontend-dev)** — n/a.

**Tests (testing-dev)** — `apps/api/test/prisma/ai-invocations.integration.spec.ts` (new, `useMockDatabase: false`, skipped unless `DATABASE_URL`/test DB from `infra/compose/test.compose.yml` is reachable, same guard the other DB-backed specs use): inserts a row with every nullable column null and `latencyMs: 0`; inserts a row with `userId` of a created user, deletes the user, asserts the invocation survives with `userId: null`; asserts the three enums accept exactly their listed values (Prisma type check at compile time + a runtime `$queryRaw` on `pg_enum` for `ai_invocation_status`).

**Docs (docs-dev)** — CLAUDE.md "Database Tables": add `ai_invocations - AI call telemetry (model, tokens, latency, validation result, redacted I/O); no chain of thought`. `docs/ARCHITECTURE.md` database section: one row in the table list. (Full narrative lands in E01-12.)

#### Acceptance criteria

- [ ] `npm run prisma:migrate` on an empty database creates `ai_invocations` with the columns, three enums and three composite indexes above.
- [ ] Migration folder is named `<timestamp>_add_ai_invocations` and contains only this change.
- [ ] Deleting a user sets `ai_invocations.user_id` to NULL rather than deleting rows or failing.
- [ ] `npm run prisma:generate` succeeds and `AiInvocation`, `AiInvocationStatus`, `AiKeyScope`, `AiInvocationOperation` are importable from `@prisma/client`.
- [ ] `npm test` in `apps/api` and `npm run typecheck` pass.
- [ ] CLAUDE.md "Database Tables" lists the table.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: n/a (schema only); the writer, not the DB, caps `errorMessage`
- [ ] Observability: table is the durable half of PRD §88; no chain-of-thought column exists by design
- [ ] Security: no key material column; `input`/`output` are documented as redacted-by-writer
- [ ] Config & secrets: none
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script

1. `cd infra/compose && docker compose -f base.compose.yml -f dev.compose.yml up --build`, then `docker compose -f base.compose.yml -f dev.compose.yml exec api npm run prisma:migrate`.
2. `psql "$PGURL" -c "\d ai_invocations"` → columns and indexes `ai_invocations_user_id_created_at_idx`, `ai_invocations_persona_created_at_idx`, `ai_invocations_status_created_at_idx`.
3. `psql "$PGURL" -c "select enum_range(null::ai_invocation_status);"` → `{succeeded,failed,invalid_output,refused}`.

#### Out of scope

- Retention/pruning job for old rows (add alongside `StorageCleanupTask` when volume warrants).
- Admin UI over invocations.
- Aggregated cost/usage views.

#### Notes for the implementing agent

- Use `npm run prisma:migrate:dev -- --name add_ai_invocations`, never bare `npx prisma`; the npm scripts construct `DATABASE_URL` (`apps/api/scripts/prisma-env.js`).
- Enum values are lowercase to match `StorageObjectStatus` and `NotificationDeliveryStatus` in the same schema; `@@map` the enum type names to snake_case like the tables.
- Keep `@default(uuid()) @db.Uuid` (the `drop_stale_uuid_defaults` migration removed DB-side defaults; the Prisma-side default is the convention now).
- Do not add a `Cascade` here even though the brief says product tables cascade — this is telemetry, and the epic's spec states the reason.

---

### E01-02 `feat(api): add AI persona registry, settings schema and model version filter`

**Part of epic:** E01 · **Blocked by:** none · **Component:** api · **Priority:** P0 · **Agents:** backend-dev → testing-dev

#### Problem statement

PRD §14 defines multiple logical AI responsibilities ("they may use the same underlying model initially") and PRD §118 asks for model tiering (small model for extraction/notification rewrite, strong reasoning model for planning and weekly review). The product owner requires per-persona model selection restricted to GPT ≥ 5.4. Three pure, dependency-free building blocks are needed before any endpoint: the persona registry (the one list the dispatcher, the admin page and the docs read — same promise `notification-events.ts` makes), the Zod shape of the `'ai'` settings row, and the model-id filter. Shipping them alone keeps E01-03/04/05 small and lets E02+ import `PERSONA_KEYS` immediately.

#### Proposed solution

Create the `apps/api/src/ai/` module skeleton with three files and their unit specs. No controller, no Prisma access yet; `AiModule` is registered in `app.module.ts` so later children only add providers.

**Data (database-dev)** — n/a.

**API (backend-dev)**

`apps/api/src/ai/ai.module.ts` (new): `@Module({ imports: [PrismaModule, CredentialsModule, StorageModule, ConfigModule], providers: [], exports: [] })` — not global. Add `AiModule` to `imports` in `apps/api/src/app.module.ts` after `NotificationsModule`. (`ConfigModule` is global already; importing it explicitly documents the dependency.)

`apps/api/src/ai/ai-personas.ts` (new), modeled on `apps/api/src/notifications/notification-events.ts`:

```ts
export const AI_PERSONA_TIERS = ['fast', 'reasoning'] as const;
export type AiPersonaTier = (typeof AI_PERSONA_TIERS)[number];
export const AI_PERSONA_CAPABILITIES = ['text', 'vision'] as const;
export type AiPersonaCapability = (typeof AI_PERSONA_CAPABILITIES)[number];
export type AiReasoningEffort = 'low' | 'medium' | 'high';

export const PERSONA_KEYS = [
  'planner', 'coach', 'pattern_analyst', 'workout_programmer',
  'weekly_reviewer', 'notification_copywriter', 'safety', 'media_analyst',
] as const;
export type PersonaKey = (typeof PERSONA_KEYS)[number];

export interface AiPersonaDef {
  key: PersonaKey;
  label: string;            // user-facing, shown in the admin table
  description: string;      // one sentence, user-facing
  tier: AiPersonaTier;
  capabilities: AiPersonaCapability[];
  defaultReasoningEffort?: AiReasoningEffort;
}

export const AI_PERSONAS: AiPersonaDef[] = [ /* one entry per key, in PERSONA_KEYS order */ ];
export function findPersona(key: string): AiPersonaDef | undefined;  // Map lookup; never throws
export function isPersonaKey(key: string): key is PersonaKey;
```

Entries: `planner` (Planner — turns an aspiration into an outcome and a behavioural plan; `reasoning`, `['text']`, `defaultReasoningEffort: 'medium'`), `coach` (Coach — day-to-day coaching replies, help starting, decomposition; `fast`, `['text']`), `pattern_analyst` (Pattern analyst — finds recurring obstacles and successful time windows in evidence; `reasoning`, `['text']`), `workout_programmer` (Workout programmer — builds and adapts structured workout programs; `reasoning`, `['text']`, `'medium'`), `weekly_reviewer` (Weekly reviewer — planned-vs-actual review and next-week proposals; `reasoning`, `['text']`, `'medium'`), `notification_copywriter` (Notification copywriter — rewrites approved notification decisions into short copy; `fast`, `['text']`), `safety` (Safety — classifies health, eating, distress and relationship requests for conservative handling; `fast`, `['text']`), `media_analyst` (Media analyst — describes workout form, equipment and meals from photos and video frames; `fast`, `['text', 'vision']`).

`apps/api/src/ai/ai-settings.schema.ts` (new), modeled on `apps/api/src/email/email-settings.schema.ts`:

```ts
export const AI_PROVIDER_KINDS = ['openai'] as const;
export type AiProviderKind = (typeof AI_PROVIDER_KINDS)[number];
export const aiSettingsSchema = z.object({
  provider: z.enum(AI_PROVIDER_KINDS).nullable(),
  enabled: z.boolean(),
  baseUrl: z.url().optional(),                       // https-only in production is enforced by the service (E01-04), not here
  defaultModel: z.string().trim().min(1).nullable(),
  personaModels: z.partialRecord(z.enum(PERSONA_KEYS), z.string().trim().min(1).nullable()),
});
export type AiSettings = z.infer<typeof aiSettingsSchema>;
export const DEFAULT_AI_SETTINGS: AiSettings = { provider: null, enabled: false, defaultModel: null, personaModels: {} };
export const AI_SETTINGS_KEY = 'ai';
// compile-time proof, same technique as EmailSettingsCarriesNoSecret:
type SecretFieldNames = 'apiKey' | 'platformApiKey' | 'secret' | 'password' | 'token';
export type AiSettingsCarriesNoSecret = Extract<keyof AiSettings, SecretFieldNames> extends never ? true : never;
export const AI_SETTINGS_CARRIES_NO_SECRET: AiSettingsCarriesNoSecret = true;
```

`apps/api/src/ai/model-catalog/model-version-filter.ts` (new), pure:

```ts
export const MIN_SUPPORTED_MODEL = { major: 5, minor: 4 } as const;
export const EXCLUDED_MODEL_VARIANT_TOKENS = ['realtime','audio','transcribe','tts','image','embedding','moderation','search','instruct','codex'] as const;
export interface ParsedGptModelId { major: number; minor: number; variant: string | null }
export function parseGptModelId(id: string): ParsedGptModelId | null;   // /^gpt-(\d+)(?:\.(\d+))?(?:-([a-z0-9.-]+))?$/i ; minor defaults to 0
export function isSupportedModelId(id: string): boolean;                // parsed && version >= 5.4 && no excluded token among variant.split('-')
export function compareModelIds(a: string, b: string): number;          // version desc, then id asc (localeCompare)
export function filterSupportedModels<T extends { id: string }>(models: T[]): T[];  // filter + sort
```

**UI (frontend-dev)** — n/a.

**Tests (testing-dev)** — colocated Jest specs:

- `apps/api/src/ai/ai-personas.spec.ts`: keys unique; every key matches `^[a-z][a-z0-9_]*$`; `AI_PERSONAS` order equals `PERSONA_KEYS`; `media_analyst` declares `vision`; no other persona declares `vision`; `findPersona('nope')` returns `undefined` and does not throw; every `label`/`description` is non-empty.
- `apps/api/src/ai/ai-settings.schema.spec.ts`: `DEFAULT_AI_SETTINGS` parses; `personaModels: { coach: null }` parses; `personaModels: { bogus: 'gpt-5.4' }` fails; `baseUrl: 'not a url'` fails; `provider: 'anthropic'` fails.
- `apps/api/src/ai/model-catalog/model-version-filter.spec.ts` — table-driven: `gpt-5.4` ✓, `gpt-5.4-mini` ✓, `gpt-5.4-2026-03-01` ✓, `gpt-5.10` ✓ (numeric compare, not string), `gpt-6` ✓, `GPT-5.4` ✓ (case-insensitive), `gpt-5.3` ✗, `gpt-5` ✗ (= 5.0), `gpt-4o` ✗, `gpt-4.1` ✗, `o3` ✗, `chatgpt-5.4-latest` ✗, `gpt-5.4-realtime-preview` ✗, `gpt-5.5-audio` ✗; sort: `['gpt-5.4-mini','gpt-6','gpt-5.10','gpt-5.4']` → `['gpt-6','gpt-5.10','gpt-5.4','gpt-5.4-mini']`.

**Docs (docs-dev)** — none in this child (E01-12 writes the recipe).

#### Acceptance criteria

- [ ] `AiModule` is imported by `AppModule`; the API boots with no new providers.
- [ ] `PERSONA_KEYS` exports exactly the eight keys in the order listed; `findPersona` never throws.
- [ ] `aiSettingsSchema` rejects unknown persona keys and unknown providers at parse time.
- [ ] `isSupportedModelId` returns the table above exactly; `filterSupportedModels` sorts version-desc then id-asc.
- [ ] The three spec files exist and pass with `npm test` in `apps/api`; `npm run typecheck` passes.
- [ ] `AI_SETTINGS_CARRIES_NO_SECRET` compiles (adding `apiKey` to the schema breaks the build).

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: pure functions return `null`/`false`/`undefined`, never throw on bad input
- [ ] Observability: n/a
- [ ] Security: the settings schema cannot carry a secret (compile-time proof)
- [ ] Config & secrets: none
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated (none required here)

#### Manual test script

1. `cd apps/api && npm test -- ai-personas ai-settings.schema model-version-filter` → three suites green.
2. `npm run typecheck` → clean.
3. `npm run start:dev` → log shows `AiModule dependencies initialized`.

#### Out of scope

- Reading/writing the settings row (E01-04).
- Fetching a live catalog (E01-04).
- Persona prompt text (E04+; prompts live with their callers, versioned per PRD §117).

#### Notes for the implementing agent

- Zod 4 is in use (`"zod": "^4.4.3"`): `z.url()`, `z.partialRecord()`, `z.iso.datetime()` exist; do not import from `zod/v3`.
- Copy the header comment style of `notification-events.ts` — the registry entry is the whole contract for "add a persona".
- `PERSONA_KEYS` must be a `readonly` tuple literal (not derived from `AI_PERSONAS.map`) so `z.enum(PERSONA_KEYS)` and `Partial<Record<PersonaKey, …>>` type-check; the spec asserts the two lists agree.
- Keep the filter free of Nest imports; E01-04 unit-tests the catalog service by mocking the provider and relying on this module untouched.

---

### E01-03 `feat(api): add OpenAI provider over the Responses API with structured and image input`

**Part of epic:** E01 · **Blocked by:** E01-02 · **Component:** api · **Priority:** P0 · **Agents:** backend-dev → testing-dev

#### Problem statement

PRD §16 requires critical AI operations to produce validated structured output; PRD §115 step 5 is "call model with structured contract". Media must be usable by the AI (equipment photos, meal photos, form-check video frames — VISION §14, PRD §37, §46). The repository has no HTTP client and no OpenAI SDK, and adding one is a dependency the product owner does not want. A thin, typed provider over OpenAI's Responses API using Node 24 `fetch`, with JSON-schema-constrained output and `input_image` parts, is the only piece of code in the product that knows the wire format.

#### Proposed solution

A provider-neutral interface plus one implementation. Providers **throw** a typed `AiProviderError`; the gateway (E01-06) and the two test services (E01-04, E01-05) are the never-throw boundaries.

**Data (database-dev)** — n/a.

**API (backend-dev)**

`apps/api/src/ai/providers/ai-provider.interface.ts` (new):

```ts
export interface AiProviderAuth { apiKey: string; baseUrl: string }
export interface AiModelInfo { id: string; created: number }
export type AiImageDetail = 'low' | 'high' | 'auto';
export type AiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: string; base64: string; detail?: AiImageDetail };
export interface AiGenerateRequest {
  model: string;
  instructions?: string;
  input: AiContentPart[];
  jsonSchema: { name: string; schema: Record<string, unknown> };
  maxOutputTokens?: number;
  reasoningEffort?: 'low' | 'medium' | 'high';
  timeoutMs: number;
  metadata?: Record<string, string>;   // ≤16 keys, values ≤512 chars — invocation id, persona, prompt version
}
export interface AiUsage { inputTokens: number; outputTokens: number; cachedInputTokens: number; reasoningTokens: number }
export interface AiGenerateResponse {
  outputText: string | null;
  refusal: string | null;
  usage: AiUsage;
  providerRequestId: string | null;
  responseModel: string | null;
  incompleteReason: string | null;
}
export interface AiProvider {
  readonly kind: AiProviderKind;
  listModels(auth: AiProviderAuth): Promise<AiModelInfo[]>;
  generate(auth: AiProviderAuth, request: AiGenerateRequest): Promise<AiGenerateResponse>;
}
export const AI_PROVIDER = Symbol('AI_PROVIDER');
```

`apps/api/src/ai/gateway/ai-errors.ts` (new):

```ts
export const AI_ERROR_CODES = ['auth','rate_limit','timeout','network','provider','schema','refusal','attachment','no_user_key','no_model','ai_disabled'] as const;
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];
export class AiProviderError extends Error {
  constructor(readonly code: AiErrorCode, message: string, readonly status?: number, readonly providerRequestId?: string | null) {}
}
export class AiKeyRequiredException extends HttpException { /* E01-06 */ }
```

`apps/api/src/ai/gateway/ai-key-redactor.ts` (new): `AiKeyRedactor` wraps `SecretRedactor` from `apps/api/src/email/base-email.provider.ts` (`protect(secret)`, `apply(text)`) and adds a regex pass `/\bsk-[A-Za-z0-9_-]{8,}\b/g → 'sk-***'` so a key echoed by the provider in a different form is still scrubbed; `apply()` also caps at 2000 chars (append `…`). Exported `redactAiText(text, secrets)` helper for one-shot use.

`apps/api/src/ai/providers/openai/openai-error.ts` (new): `mapOpenAiFailure(status, body, headers)` → `AiProviderError`: 401/403 → `auth`, 404 → `no_model` (also when `body.error.code === 'model_not_found'`), 429 → `rate_limit`, 5xx → `provider`, other 4xx → `provider`; `mapOpenAiThrow(err)`: `AbortError`/`TimeoutError` → `timeout`, `TypeError` (fetch network failure) → `network`, else `provider`. The message is `body.error.message ?? statusText`, passed through `AiKeyRedactor` with the api key protected, capped at 2000 chars. `providerRequestId` from the `x-request-id` header.

`apps/api/src/ai/providers/openai/openai.provider.ts` (new) `@Injectable() OpenAiProvider implements AiProvider`:

- `listModels(auth)`: `GET {baseUrl}/models` with `Authorization: Bearer <key>`; returns `data.map(m => ({ id: m.id, created: m.created }))` **unfiltered** (the catalog service filters); non-2xx → `mapOpenAiFailure`.
- `generate(auth, req)`: `POST {baseUrl}/responses` with body
  `{ model, instructions, input: [{ role: 'user', content: parts }], text: { format: { type: 'json_schema', name: req.jsonSchema.name, schema: req.jsonSchema.schema, strict: true } }, max_output_tokens, reasoning: req.reasoningEffort ? { effort } : undefined, store: false, metadata }`
  where a `text` part → `{ type: 'input_text', text }` and an `image` part → `{ type: 'input_image', image_url: 'data:<mimeType>;base64,<base64>', detail: detail ?? 'auto' }`. `store: false` is **mandatory** and asserted by a unit test. Timeout via `AbortController` + `setTimeout(req.timeoutMs)` (cleared in `finally`). Parse: first `output[]` item of `type: 'message'`; its `content[]` items of `type: 'output_text'` concatenated → `outputText`; an item of `type: 'refusal'` → `refusal`; `usage.input_tokens`, `usage.output_tokens`, `usage.input_tokens_details?.cached_tokens ?? 0`, `usage.output_tokens_details?.reasoning_tokens ?? 0`; `incomplete_details?.reason ?? null`; `responseModel = body.model ?? null`; `providerRequestId` from `x-request-id`. Unparseable 2xx body → `AiProviderError('provider', 'OpenAI returned an unreadable response')`.
- Headers: `Content-Type: application/json`, `Authorization`, `User-Agent: evolvepath-api`. Never log the request body or the key; log line on failure only: `OpenAI <op> failed status=<n> code=<code> requestId=<id>`.

`apps/api/src/ai/providers/ai-provider.registry.ts` (new): `AiProviderRegistry.get(kind: AiProviderKind): AiProvider` — `{ openai: OpenAiProvider }`; throws `Error('Unknown AI provider')` (programmer error, not a provider failure).

`apps/api/src/ai/gateway/strict-json-schema.ts` (new): `toOpenAiStrictSchema(schema: ZodType): Record<string, unknown>` — `z.toJSONSchema(schema)` then a recursive walk: every `object` node gets `additionalProperties: false` and `required` = all property keys; optional properties become nullable (`type: [t, 'null']` or `anyOf` with `{type:'null'}`); strips `$schema`. Documented limitation: `z.record` and `z.union` of objects are rejected with a thrown `Error` at call time (strict mode cannot express them) — callers must model with explicit keys.

`apps/api/src/config/configuration.ts`: add

```ts
ai: {
  openai: { baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1' },
  requestTimeoutMs: parseInt(process.env.AI_REQUEST_TIMEOUT_MS || '60000', 10),
},
```

Register in `ai.module.ts`: `providers: [OpenAiProvider, AiProviderRegistry]`, `exports: [AiProviderRegistry]`.

**UI (frontend-dev)** — n/a.

**Tests (testing-dev)** — colocated, `global.fetch` mocked with `jest.spyOn(globalThis, 'fetch')`:

- `openai.provider.spec.ts`: request body snapshot for a text-only call (asserts `store: false`, `text.format.strict: true`, `input[0].role === 'user'`); image part becomes `input_image` with a `data:image/jpeg;base64,` URL and `detail`; `reasoning` omitted when no effort; `Authorization` header carries the key; `x-request-id` captured; `usage` mapped including cached/reasoning; refusal item → `refusal` set and `outputText` null; `incomplete_details.reason` mapped; 401 → `AiProviderError.code === 'auth'` and the key never appears in `message`; 404 → `no_model`; 429 → `rate_limit`; 503 → `provider`; fetch rejecting with `TypeError` → `network`; a never-resolving fetch with `timeoutMs: 20` → `timeout` within 100 ms; `listModels` returns unfiltered ids.
- `openai-error.spec.ts`: message capped at 2000 chars; `sk-…` pattern scrubbed even when not the protected key.
- `ai-key-redactor.spec.ts`: protected secret replaced with `[redacted]`; `sk-abcdefghijklmnop` → `sk-***`; short secrets withhold the whole message (inherited behaviour).
- `strict-json-schema.spec.ts`: `z.object({ a: z.string(), b: z.number().optional() })` → `required: ['a','b']`, `b` nullable, `additionalProperties: false`; nested object handled; `z.record` throws.
- `ai-provider.registry.spec.ts`: `get('openai')` is the `OpenAiProvider` instance; unknown kind throws.

**Docs (docs-dev)** — none here; `.env.example` and CLAUDE.md env vars land in E01-12 (E01-04 needs `OPENAI_BASE_URL` documented for the fake server; add the two lines to `infra/compose/.env.example` in this child, no trailing comments after values).

#### Acceptance criteria

- [ ] `OpenAiProvider.generate` sends `store: false`, `text.format.type: 'json_schema'`, `strict: true` on every call.
- [ ] Image parts are sent as `input_image` data URLs with the given `detail`.
- [ ] Every non-2xx and every thrown fetch error becomes an `AiProviderError` with the mapped `code`, a redacted `message` ≤ 2000 chars and the `x-request-id` when present.
- [ ] A request exceeding `timeoutMs` is aborted and surfaces as `code: 'timeout'`.
- [ ] `toOpenAiStrictSchema` output satisfies OpenAI strict mode for the probe schema `{ ok: boolean }` and for a nested object with optionals.
- [ ] `OPENAI_BASE_URL` and `AI_REQUEST_TIMEOUT_MS` are read from the environment with the defaults above and documented in `.env.example`.
- [ ] All specs above pass; no `openai` package appears in `apps/api/package.json`.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: provider throws typed `AiProviderError` only; no raw fetch errors escape
- [ ] Observability: failure log line with status/code/requestId, never body or key
- [ ] Security: key only in the `Authorization` header; redactor applied to every message; `store: false`
- [ ] Config & secrets: `OPENAI_BASE_URL` (default `https://api.openai.com/v1`), `AI_REQUEST_TIMEOUT_MS` (default 60000)
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated (`.env.example` lines)

#### Manual test script

1. `cd apps/api && npm test -- providers gateway/strict-json-schema gateway/ai-key-redactor` → green.
2. With a real key exported: `node -e "..."` is not required; instead run the E01-10 fake server locally (`node tools/fake-openai/server.mjs`) once it exists and point `OPENAI_BASE_URL=http://localhost:8089/v1` for the E01-04 manual script.

#### Out of scope

- Streaming (`stream: true`), tool calls, file inputs, audio.
- Retries/backoff on 429 (callers decide; the gateway returns `rate_limit`).
- A second provider.

#### Notes for the implementing agent

- Node 24 `fetch` is global; do not add `node-fetch`, `undici` or `axios`.
- The `metadata` field is the only way to correlate a provider-side log with an `ai_invocations` row; E01-06 passes `{ invocationId, persona, promptVersion }`.
- `SecretRedactor` lives in `apps/api/src/email/base-email.provider.ts`; import it rather than copying — the class is generic despite its home.
- Keep the provider free of Prisma and settings knowledge; it receives `auth` and a request and nothing else.

---

### E01-04 `feat(api): add admin AI settings endpoints with live model catalog and test connection`

**Part of epic:** E01 · **Blocked by:** E01-01, E01-02, E01-03 · **Component:** api · **Priority:** P0 · **Agents:** backend-dev → testing-dev → docs-dev

#### Problem statement

An administrator must be able to choose the provider, store the platform key, see which GPT ≥ 5.4 models the platform key can reach, assign a model per persona (PRD §118 tiering), and prove the connection works with the provider's real error in front of them — the same diagnostic loop `POST /email-settings/test` already gives for mail. Without this, the user-key test (E01-05) has no default model to probe and later epics have no model to call.

#### Proposed solution

Structurally copy the email settings feature: `AiSettingsService` / `AiSettingsController` / `AiAdminTestService` / `UpdateAiSettingsDto` mirror `apps/api/src/email/{email-settings.service,email-settings.controller,email-test-send.service,dto/update-email-settings.dto}.ts`. Add `AiModelCatalogService` (live fetch, short TTL) and `TestThrottle`.

**Data (database-dev)** — n/a. Writes `system_settings` row key `'ai'` (E01-02 schema) and `credentials` `(purpose 'ai:openai', name 'platform')`; reads/writes `ai_invocations` (E01-01).

**API (backend-dev)**

`apps/api/src/ai/ai-credential.constants.ts` (new):

```ts
export const AI_PLATFORM_CREDENTIAL_PURPOSE = 'ai:openai';
export const AI_PLATFORM_CREDENTIAL_NAME = 'platform';
export const AI_PLATFORM_CREDENTIAL_LABEL = 'OpenAI platform API key';
export const AI_USER_CREDENTIAL_PURPOSE = 'ai:openai:user';   // name = userId (E01-05)
export const AI_USER_CREDENTIAL_LABEL = 'OpenAI API key';
```

| Method | Path | Permission / guard | Request | Response |
|---|---|---|---|---|
| GET | `/api/ai-settings` | `@Auth({ permissions: [PERMISSIONS.SYSTEM_SETTINGS_READ] })` | — | `AiSettingsResponseDto`: `AiSettings` + `platformKeyStatus { configured, hint, updatedAt, updatedByUserId }` + `settingsError: string \| null` + `version` + `updatedAt` + `updatedBy { id, email } \| null` |
| PUT | `/api/ai-settings` | `SYSTEM_SETTINGS_WRITE` | `UpdateAiSettingsDto` = `aiSettingsSchema.extend({ baseUrl: blankable(z.url()), platformApiKey: z.string().max(512).nullish() })`; header `If-Match: <version>` | 200 `AiSettingsResponseDto`; 400 unsupported model / https violation / Zod; 409 version mismatch |
| GET | `/api/ai-settings/personas` | `SYSTEM_SETTINGS_READ` | — | `AiPersonaDto[]` in registry order (`key,label,description,tier,capabilities`) |
| GET | `/api/ai-settings/models?refresh=true` | `SYSTEM_SETTINGS_READ` | query `refresh?: boolean` | **200 always** `AiModelsResponseDto { success, models: [{ id, created }], fetchedAt: string \| null, source: 'live' \| 'cache' \| null, error: string \| null }` filtered by `filterSupportedModels`; 429 when `refresh=true` exceeds 10/min per user |
| POST | `/api/ai-settings/test` | `SYSTEM_SETTINGS_WRITE` | no body | **200 always** `AiTestResultDto { success, providerKind: 'openai' \| null, model: string \| null, latencyMs: number \| null, error: string \| null, attemptedAt, checks: { listModels: 'passed' \| 'failed' \| 'skipped', generate: same } }`; 429 over 5/min per user |

`AiSettingsService` (`apps/api/src/ai/ai-settings.service.ts`): `get(): Promise<AiSettings>` (throws on an invalid stored row, like `EmailSettingsService.get`), `describeForAdmin()` (never throws; invalid row → defaults + `settingsError`), `update(input, userId, expectedVersion?)`: strip `platformApiKey`; parse with `aiSettingsSchema`; **validate models** — `defaultModel` and every non-null `personaModels[*]` must pass `isSupportedModelId`, else `BadRequestException('Model "gpt-5.3" is not supported: EvolvePath requires GPT 5.4 or newer.')`; **https rule** — when `config.nodeEnv === 'production'` and `baseUrl` does not start with `https://` → 400; version check → `ConflictException`; if `platformApiKey` non-blank → `credentials.setSecret(AI_PLATFORM_CREDENTIAL_PURPOSE, AI_PLATFORM_CREDENTIAL_NAME, key, { label, updatedByUserId })` **before** the row upsert (a failed key write must not leave a saved row claiming a key); upsert row `'ai'` with `version: { increment: 1 }`; `catalog.invalidate()`; audit `prisma.auditEvent.create({ action: 'ai_settings:replace', targetType: 'system_settings', targetId: 'ai', meta: { provider, enabled, defaultModel, personaModels, platformKeyReplaced: boolean } })` — never the key or hint. `resolveModel(persona: PersonaKey): string | null` = `personaModels[persona] ?? defaultModel` (used by E01-06). `resolveBaseUrl(): string` = `settings.baseUrl ?? config.get('ai.openai.baseUrl')`.

`AiModelCatalogService` (`apps/api/src/ai/model-catalog/ai-model-catalog.service.ts`): in-memory `{ models, fetchedAt }` with 5-minute TTL; `list({ refresh }): Promise<AiModelsResult>`: no platform key (`credentials.getSecret` null) → `{ success: false, models: [], source: null, error: 'No platform API key is configured. Save one, then refresh.' }`; provider null/disabled → same shape with the reason; otherwise provider `listModels` → `filterSupportedModels` → cache; `AiProviderError` → `{ success: false, models: cached ?? [], source: cached ? 'cache' : null, error: message }`. `invalidate()`.

`AiAdminTestService` (`apps/api/src/ai/ai-admin-test.service.ts`) `testConnection(actor: { id, email }): Promise<AiTestResult>` — refuse-as-result (HTTP 200, `success: false`) when: settings unreadable; `provider === null` ("No AI provider is selected. Choose OpenAI, save, then test again."); `enabled === false`; no platform key. Then `checks.listModels`: provider `listModels` (validates the key). Then if `defaultModel` is set: `checks.generate` — a probe `generate({ model: defaultModel, instructions: 'Reply with the JSON {"ok":true}.', input: [{ type: 'text', text: 'ping' }], jsonSchema: { name: 'connection_probe', schema: toOpenAiStrictSchema(z.object({ ok: z.boolean() })) }, maxOutputTokens: 16, timeoutMs: config.ai.requestTimeoutMs, metadata: { purpose: 'test_connection' } })`, success iff `JSON.parse(outputText).ok === true`; else `checks.generate = 'skipped'` and `success` is `listModels` alone. Every attempt: one `ai_invocations` row `operation: 'test_connection', keyScope: 'platform', userId: actor.id, provider: 'openai', model, status, errorCode, errorMessage (redacted), latencyMs, tokens` and one audit row `ai_settings:test` with `meta: { success, providerKind, model, checks, error }` (redacted). Log `AI test scope=platform status=… latencyMs=… user=<id>`.

`TestThrottle` (`apps/api/src/ai/gateway/test-throttle.ts`) `@Injectable()`: `Map<string, number[]>` keyed `${bucket}:${userId}`, sliding 60 s window; buckets `user_test` 5/min, `admin_test` 5/min, `models_refresh` 10/min; `check(bucket, userId): { allowed: true } | { allowed: false, retryAfterSeconds }`; timestamps older than the window are pruned on every call (no timer). Controllers inject `@Res({ passthrough: true }) reply: FastifyReply`, set `reply.header('Retry-After', String(s))` and `throw new HttpException({ message: \`Too many test attempts. Try again in ${s} s.\`, details: { retryAfterSeconds: s } }, 429)`. Per-process only — documented in the class header and in `docs/specs/ai-configuration.md`; `@nestjs/throttler` is the upgrade path.

DTOs in `apps/api/src/ai/dto/`: `ai-settings-response.dto.ts` (with `AiSettingsResponseCarriesNoSecret` proof over the response type: no `platformApiKey`/`apiKey`/`secret` key), `update-ai-settings.dto.ts`, `ai-persona.dto.ts`, `ai-models-response.dto.ts`, `ai-test-result.dto.ts` — all `createZodDto`. Controller `apps/api/src/ai/ai-settings.controller.ts`: `@ApiTags('AI Settings') @Controller('ai-settings')`; `If-Match` parsing copied verbatim from `EmailSettingsController.replaceSettings` (`Number.isInteger` guard). Register tag `AI Settings` in `apps/api/src/openapi/tags.ts` under "Account & Settings" after `Email Settings` (description: provider, platform key write-only, per-persona models, live catalog ≥ 5.4, test returns 200 with the provider's error). Module: add the services + controller; export `AiSettingsService`.

**UI (frontend-dev)** — n/a (E01-07).

**Tests (testing-dev)**

- Unit (colocated): `ai-settings.service.spec.ts` (model validation 400 messages; https rule only in production; key written before row; blank/absent key preserves; audit meta has no key/hint; `resolveModel` precedence), `ai-model-catalog.service.spec.ts` (TTL hit/miss with fake timers; `refresh` bypasses cache; provider failure falls back to cache with `source: 'cache'`; filter applied), `ai-admin-test.service.spec.ts` (each refuse-as-result branch; generate skipped without default model; probe body asserts `max_output_tokens: 16` and instructions text; invocation row written on every path), `test-throttle.spec.ts` (6th call within 60 s denied with `retryAfterSeconds` ≥ 1; call 61 s later allowed; buckets independent).
- Integration `apps/api/test/ai/ai-settings.integration.spec.ts` (new) via `createTestApp({ overrideProviders: [{ provide: OpenAiProvider, useValue: mockProvider }, { provide: CredentialsService, useValue: mockCredentials }] })`, users from `apps/api/test/helpers/auth-mock.helper.ts` plus a read-only user as in `email-settings.integration.spec.ts`: GET 401/403/200 with `platformKeyStatus`; GET degrades an invalid stored row to 200 + `settingsError`; PUT 409 on stale `If-Match`; PUT 400 for `defaultModel: 'gpt-5.3'` and for `personaModels: { bogus: 'gpt-5.4' }`; PUT with `platformApiKey` calls `setSecret` with `('ai:openai','platform')` and the submitted key **never appears in the serialised response** (`JSON.stringify(res.body)` does not include it); blank key preserves (`setSecret` not called); `/models` 200 `success: false` with no key; `/models` filters `gpt-5.3` out; `/models?refresh=true` 11th call in a minute → 429 with `Retry-After`; `/test` 403 for read-only; `/test` 200 `success: false` when provider null; `/test` 200 `success: true` with `checks.generate: 'passed'` when the mock returns `{"ok":true}`; audit rows `ai_settings:replace` and `ai_settings:test` created; 6th `/test` in a minute → 429 and no audit row.
- OpenAPI: `apps/api/test/openapi/openapi-document.spec.ts` already asserts no undeclared/orphan tags — it must stay green with `AI Settings` declared.

**Docs (docs-dev)** — `docs/API.md`: new section "AI Settings (Admin)" with the five endpoints (full narrative in E01-12; add the section stub here so the endpoints are never undocumented).

#### Acceptance criteria

- [ ] `GET /api/ai-settings` returns settings, `platformKeyStatus` and `version`, never key material, and never 500s on a corrupt row.
- [ ] `PUT /api/ai-settings` rejects models below 5.4 and unknown persona keys with 400, stale `If-Match` with 409, and stores the platform key write-only (blank preserves).
- [ ] `GET /api/ai-settings/models` returns only GPT ≥ 5.4 ids, sorted, with `source` and `fetchedAt`; without a platform key it is 200 with `success: false`.
- [ ] `POST /api/ai-settings/test` returns 200 in every configuration and the provider's redacted error text on failure; a set default model is probed with a 16-token structured call.
- [ ] Both test-like endpoints are throttled per user (5/min test, 10/min refresh) with a 429 carrying `Retry-After`.
- [ ] Every save and every test attempt produces an `audit_events` row; every test attempt produces an `ai_invocations` row with `keyScope: 'platform'`.
- [ ] The `AI Settings` tag renders in `/api/docs` under Account & Settings.
- [ ] Unit + integration suites above pass.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: test/models endpoints never surface provider failures as 4xx/5xx; validation failures are 400 with actionable messages
- [ ] Observability: `ai_invocations` row + audit per test; log lines without secrets
- [ ] Security: `system_settings:read` for reads, `:write` for save/test; key never in any response, log or audit meta; https-only base URL in production
- [ ] Config & secrets: platform key in `credentials` `(ai:openai, platform)`; `OPENAI_BASE_URL` fallback
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated (`docs/API.md` stub)

#### Manual test script

1. Stack up with the fake server (epic script steps 1–3), sign in as admin with "Seed an OpenAI key" ticked (or, before E01-09 lands, without it).
2. In devtools: `const t = localStorage.getItem('access_token'); const h = { 'content-type': 'application/json', authorization: 'Bearer ' + t };`
3. `fetch('/api/ai-settings',{headers:h}).then(r=>r.json()).then(console.log)` → `provider: null`, `platformKeyStatus.configured: false`, `version: 0`.
4. `fetch('/api/ai-settings',{method:'PUT',headers:{...h,'if-match':'0'},body:JSON.stringify({provider:'openai',enabled:true,defaultModel:null,personaModels:{},platformApiKey:'sk-test-platform-000000000000'})}).then(r=>r.json()).then(console.log)` → `platformKeyStatus.configured: true`, `hint: '••••0000'`, `version: 1`, and the response text does not contain `sk-test`.
5. `fetch('/api/ai-settings/models?refresh=true',{headers:h}).then(r=>r.json()).then(console.log)` → `models: [{id:'gpt-5.4'},{id:'gpt-5.4-mini'}]`, `source: 'live'`.
6. Repeat step 4 with `defaultModel:'gpt-5.3'` and `'if-match':'1'` → HTTP 400 mentioning 5.4.
7. `fetch('/api/ai-settings/test',{method:'POST',headers:h}).then(r=>r.json()).then(console.log)` → `success: true`, `checks.generate: 'skipped'` (no default model yet); set `defaultModel:'gpt-5.4'` via PUT and repeat → `checks.generate: 'passed'`.
8. `psql "$PGURL" -c "select operation, key_scope, status, model from ai_invocations;"` → two `test_connection/platform` rows.

#### Out of scope

- The admin page (E01-07).
- Per-user key endpoints (E01-05).
- Distributed throttling.

#### Notes for the implementing agent

- Copy the `blankable`/`unset` helpers from `update-email-settings.dto.ts` rather than re-deriving them; `stripUnsetSettingFields` in `email-settings.service.ts` shows how a blank `baseUrl` is dropped before parsing.
- Fastify, not Express: `@Res({ passthrough: true })` gives a `FastifyReply`; use `reply.header()`, never `res.set()`.
- `nestjs-zod` DTOs: the global `ZodValidationPipe` (`app.module.ts`) validates bodies and query; `refresh` arrives as the string `'true'` — use `z.stringbool()` or `z.coerce.boolean()` deliberately (note `z.coerce.boolean()('false') === true`).
- Do not put the key hint in audit `meta`; `platformKeyReplaced: true/false` is enough.
- Register the OpenAPI tag or `test/openapi/openapi-document.spec.ts` fails.

---

### E01-05 `feat(api): add per-user OpenAI key endpoints and aiKey status on /auth/me`

**Part of epic:** E01 · **Blocked by:** E01-01, E01-02, E01-03 · **Component:** api · **Priority:** P0 · **Agents:** backend-dev → testing-dev

#### Problem statement

Every user brings their own OpenAI key (product-owner constraint; PRD §118 cost strategy is per user, PRD §85 gives users control over what the AI holds). The key must be encrypted at rest with the existing `CredentialsService`, never readable through the API, testable by the user against their own key only, removable, and its presence must travel on `GET /api/auth/me` so the web app can gate the whole shell without a second request on boot (the visual harness fakes `AuthContext` and would otherwise need a second fake).

#### Proposed solution

A `UserAiKeyService` + `UserAiKeyController` under `apps/api/src/ai/user-key/`, plain `@Auth()` (own resource, like `apps/api/src/pat/pat.controller.ts`), keys stored at `(purpose 'ai:openai:user', name <userId>)`. `AuthService.getCurrentUser` gains `aiKey`. The test-login DTO gains `withAiKey` so e2e can seed a key.

**Data (database-dev)** — n/a. Rows in `credentials` and `ai_invocations` (`keyScope: 'user'`).

**API (backend-dev)**

| Method | Path | Permission / guard | Request | Response |
|---|---|---|---|---|
| GET | `/api/me/ai-key` | `@Auth()` | — | `UserAiKeyStatusDto { configured, hint: string \| null, updatedAt: string \| null, lastTest: { attemptedAt, success, model: string \| null, error: string \| null } \| null, platform: { provider: 'openai' \| null, enabled: boolean, hasDefaultModel: boolean } }` |
| PUT | `/api/me/ai-key` | `@Auth()` | `SetUserAiKeyDto { apiKey: z.string().min(20).max(512).regex(/^\S+$/) }` | 200 `UserAiKeyStatusDto` |
| DELETE | `/api/me/ai-key` | `@Auth()` | — | 204, idempotent |
| POST | `/api/me/ai-key/test` | `@Auth()` | no body | **200 always** `AiTestResultDto` (same shape as admin test); 429 over 5/min |
| GET | `/api/auth/me` | existing | — | existing `CurrentUserDto` + `aiKey: { configured: boolean, hint: string \| null }` |

`UserAiKeyService` (`apps/api/src/ai/user-key/user-ai-key.service.ts`):

- `describe(userId): Promise<{ configured, hint, updatedAt }>` → `credentials.describe(AI_USER_CREDENTIAL_PURPOSE, userId)`.
- `status(userId): Promise<UserAiKeyStatus>` = `describe` + `lastTest` from `prisma.aiInvocation.findFirst({ where: { userId, operation: 'test_connection', keyScope: 'user' }, orderBy: { createdAt: 'desc' } })` mapped to `{ attemptedAt: createdAt, success: status === 'succeeded', model, error: errorMessage }` + `platform` from `AiSettingsService.describeForAdmin()`-free `get()` wrapped in try/catch (unreadable settings → `{ provider: null, enabled: false, hasDefaultModel: false }`).
- `set(userId, apiKey, actorUserId = userId)`: `const replaced = (await credentials.describe(...)) !== null`; `credentials.setSecret(AI_USER_CREDENTIAL_PURPOSE, userId, apiKey, { label: AI_USER_CREDENTIAL_LABEL, updatedByUserId: actorUserId })`; audit `{ actorUserId, action: 'ai_user_key:set', targetType: 'user', targetId: userId, meta: { replaced } }` — never the hint. The key is **not trimmed server-side** (the form trims; `CredentialsService` stores byte-for-byte by design) and no `sk-` prefix is enforced (soft UI hint only).
- `deleteForUser(userId, actorUserId = userId)`: `credentials.deleteSecret(...)` (no-op when absent); audit `ai_user_key:delete` only when a row existed. Exists from day one so a future user hard-delete can call it — stated in `docs/specs/ai-configuration.md`.
- `getSecretForUser(userId): Promise<string | null>` — the only read path the gateway uses (E01-06).
- `test(userId): Promise<AiTestResult>`: refuse-as-result when no user key ("No OpenAI API key is saved for your account."); `checks.listModels` with the **user** key against `AiSettingsService.resolveBaseUrl()`; `checks.generate`: probe (same body as E01-04) with the **user key** only when the platform has `provider === 'openai' && enabled && defaultModel`, else `'skipped'` with `model: null`; `ai_invocations` row `operation: 'test_connection', keyScope: 'user', userId`; audit `ai_user_key:test` `{ success, checks, model, error }` (redacted). Throttle bucket `user_test`.

`UserAiKeyController` (`apps/api/src/ai/user-key/user-ai-key.controller.ts`): `@ApiTags('AI Key') @Controller('me/ai-key')`; every handler reads `@CurrentUser('id')` — there is no `:userId` parameter by design. DTOs in `apps/api/src/ai/user-key/dto/{set-user-ai-key.dto.ts, user-ai-key-status.dto.ts}` (`createZodDto`; status DTO carries a `CarriesNoSecret` proof). Register tag `AI Key` in `apps/api/src/openapi/tags.ts` under "Account & Settings" (description: the caller's own OpenAI key — write-only, testable, removable; the key is never returned).

`AuthService.getCurrentUser` (`apps/api/src/auth/auth.service.ts`): add `aiKey: await this.userAiKey.describe(user.id)` mapped to `{ configured, hint }`; `AuthModule` imports `AiModule` (no cycle: `AiModule` imports Prisma/Credentials/Storage/Config only); `CurrentUserDto` (`apps/api/src/auth/dto/auth-user.dto.ts`) gains `aiKey: AiKeySummaryDto` with `@ApiProperty`.

Test auth: `apps/api/src/test-auth/dto/test-login.dto.ts` gains `withAiKey: z.preprocess((v) => v === true || v === 'true' || v === 'on' || v === '1', z.boolean()).optional()` (the `/testing/login` page is a native urlencoded form, so the checkbox arrives as `'on'`); `TestAuthService.loginAsTestUser` calls `userAiKey.set(user.id, \`sk-test-e2e-${randomBytes(12).toString('hex')}\`)` when true (`TestAuthModule` imports `AiModule`). The web page `apps/web/src/pages/TestLoginPage.tsx` gets a `<FormControlLabel control={<Checkbox name="withAiKey" data-testid="test-with-ai-key" />} label="Seed an OpenAI key (skip the setup gate)" />`, unchecked by default. Module remains non-production only.

`AiModule`: add `UserAiKeyService`, `UserAiKeyController`; export `UserAiKeyService`.

**UI (frontend-dev)** — only the checkbox on `TestLoginPage.tsx` above (dev-only page). Pages arrive in E01-08.

**Tests (testing-dev)**

- Unit: `user-ai-key.service.spec.ts` — `set` audits `replaced: true` on second write and never includes the hint; `deleteForUser` idempotent and audits only when a row existed; `status.lastTest` null when no invocation; `test` refuses without key, skips generate without platform default, uses the user key for both checks (assert `getSecret` called with `('ai:openai:user', userId)` and never with `'ai:openai'`); `apiKey` with internal whitespace fails the DTO; 19-char key fails; 20-char passes.
- Integration `apps/api/test/ai/user-ai-key.integration.spec.ts` (new), overriding `OpenAiProvider` and `CredentialsService`: a **viewer** can GET/PUT/DELETE/test (no permission needed); PUT 400 for `apiKey: 'short'` and for `'has space in it 12345678'`; PUT response and `GET /auth/me` never contain the submitted key; `GET /auth/me` includes `aiKey.configured` flipping false → true → false across PUT/DELETE; DELETE twice → 204 both; `/test` 200 with `success: false` and the provider's 401 text verbatim (redacted key) when the mock throws `auth`; `/test` 6th call in a minute → 429; `lastTest` reflects the latest `ai_invocations` row; audit rows `ai_user_key:set|delete|test` created; `POST /api/auth/test/login` with `withAiKey: true` (urlencoded `withAiKey=on` too) calls `setSecret` with `'ai:openai:user'` and a value starting `sk-test-e2e-`.
- Existing `apps/api/src/auth/auth.service.spec.ts`: extend for `aiKey` in `getCurrentUser`.

**Docs (docs-dev)** — `docs/API.md` stub section "AI Key (current user)" with the four endpoints and the `aiKey` field on `GET /auth/me` (narrative in E01-12).

#### Acceptance criteria

- [ ] Any authenticated user (including a Viewer) can save, test and remove their own key; no endpoint accepts a user id.
- [ ] The key is validated (`20–512` chars, no whitespace), stored via `CredentialsService` at `('ai:openai:user', <userId>)`, and never appears in any response body, log line or audit row.
- [ ] `GET /api/me/ai-key` reports `configured`, `hint`, `updatedAt`, the latest test outcome derived from `ai_invocations`, and whether the platform is configured with a default model.
- [ ] `POST /api/me/ai-key/test` uses only the user's key, returns 200 with `success:false` + provider error on failure, skips the generate probe when no platform default model exists, and is throttled 5/min.
- [ ] `DELETE /api/me/ai-key` is idempotent 204.
- [ ] `GET /api/auth/me` includes `aiKey: { configured, hint }`.
- [ ] `POST /api/auth/test/login` with `withAiKey` seeds an `sk-test-e2e-…` key (non-production only).
- [ ] Unit + integration suites pass; `AI Key` tag is declared.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: test never throws for provider problems; DTO errors are 400; throttled attempts 429 with `Retry-After`
- [ ] Observability: `ai_invocations` `keyScope: 'user'` row per test; audit `ai_user_key:set|delete|test`; log lines carry user id, never key
- [ ] Security: ownership by construction (`@CurrentUser('id')`); different credential purpose from the platform key so ciphertexts cannot be swapped
- [ ] Config & secrets: requires `SECRETS_ENCRYPTION_KEY`; document that test login with `withAiKey` fails with 500 when it is unset
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated (`docs/API.md` stub)

#### Manual test script

1. Stack up (epic steps 1–3); sign in as a **viewer** via http://localhost:3535/testing/login without the checkbox.
2. Devtools: `const h={'content-type':'application/json',authorization:'Bearer '+localStorage.getItem('access_token')};`
3. `fetch('/api/me/ai-key',{headers:h}).then(r=>r.json()).then(console.log)` → `configured: false`, `lastTest: null`.
4. `fetch('/api/me/ai-key',{method:'PUT',headers:h,body:JSON.stringify({apiKey:'sk-test-e2e-manual-000000000000'})}).then(r=>r.json()).then(console.log)` → `configured: true`, `hint: '••••0000'`; response text has no `sk-test`.
5. `fetch('/api/auth/me',{headers:h}).then(r=>r.json()).then(u=>console.log(u.data?.aiKey ?? u.aiKey))` → `{ configured: true, hint: '••••0000' }`.
6. `fetch('/api/me/ai-key/test',{method:'POST',headers:h}).then(r=>r.json()).then(console.log)` → `success: true`, `checks.listModels: 'passed'`, `checks.generate: 'skipped'` (until the admin sets a default model).
7. `psql "$PGURL" -c "select operation, key_scope, user_id is not null as has_user, status from ai_invocations order by created_at desc limit 1;"` → `test_connection | user | t | succeeded`.
8. `fetch('/api/me/ai-key',{method:'DELETE',headers:h}).then(r=>console.log(r.status))` twice → `204`, `204`; `psql "$PGURL" -c "select action from audit_events where action like 'ai_user_key:%';"` → `set`, `test`, `delete` (one delete).

#### Out of scope

- The settings page and setup page (E01-08/09).
- Admin visibility into which users have keys.
- Key rotation reminders/expiry.

#### Notes for the implementing agent

- `CredentialsService.setSecret` signature is at `apps/api/src/credentials/credentials.service.ts:286`; `describe` returns `CredentialInfo { purpose, name, hint, label, updatedByUserId, createdAt, updatedAt } | null`; the `hint` is `'••••' + last 4` for values ≥ 8 chars.
- The `/testing/login` form is a plain `<form method="POST">`; NestJS's `FastifyAdapter` registers `@fastify/formbody`, so the DTO sees strings — hence the `preprocess`.
- Follow `PatController` for the `@Auth()`-only own-resource pattern and OpenAPI annotations.
- Do not add `user_ai_key:*` permissions; the brief's rule for per-user resources is plain `@Auth()` with ownership by construction.

---

### E01-06 `feat(api): add AI gateway with invocation logging and attachment resolution`

**Part of epic:** E01 · **Blocked by:** E01-03, E01-05 · **Component:** api · **Priority:** P0 · **Agents:** backend-dev → testing-dev

#### Problem statement

PRD §115 fixes the shape of every AI workflow (scoped context → policy → structured contract → validate → persist only valid output → log), PRD §88 what must be logged, PRD §117 that prompt versions are captured, PRD §120 that deterministic features must survive AI failure, and VISION §14/PRD §37/§46 that photos and videos feed the AI. Every later epic needs one call that does all of this so that no caller ever touches keys, providers, schemas or logging. This child ships that call with a contract frozen for E02–E12.

#### Proposed solution

`AiGatewayService.invoke()` — never throws for provider problems, one `ai_invocations` row on every exit path, one OTel span per call, user key only, attachments resolved for vision personas.

**Data (database-dev)** — n/a (writes `ai_invocations`).

**API (backend-dev)**

`apps/api/src/ai/gateway/ai-gateway.types.ts` (new):

```ts
export interface AiAttachment { storageObjectId: string; detail?: AiImageDetail }
export interface AiInvokeRequest<T> {
  persona: PersonaKey;
  userId: string;
  promptVersion: string;          // e.g. 'planner.v1' — captured on the row and span (PRD §117)
  instructions: string;           // system/developer prompt
  input: string;                  // the user-turn text; attachments are separate
  attachments?: AiAttachment[];
  schema: ZodType<T>;
  schemaName: string;             // json_schema name, ^[a-zA-Z0-9_-]{1,64}$
  maxOutputTokens?: number;
  reasoningEffort?: AiReasoningEffort;   // defaults to persona.defaultReasoningEffort
  requestId?: string;             // HTTP request id when called from a request scope
}
export type AiInvokeResult<T> =
  | { ok: true;  invocationId: string; output: T; usage: AiUsage; model: string; latencyMs: number }
  | { ok: false; invocationId: string; error: { code: AiErrorCode; message: string }; model: string | null; latencyMs: number };
```

`AiGatewayService.invoke<T>(req): Promise<AiInvokeResult<T>>` (`apps/api/src/ai/gateway/ai-gateway.service.ts`, new) — steps, in order, each failure short-circuiting to a logged `ok:false`:

1. `findPersona(req.persona)` — `undefined` is a programmer error: `throw new Error(...)` (the one exception to never-throw; it cannot happen with a `PersonaKey`-typed call).
2. `settings = await aiSettings.get()` (catch → `ai_disabled` "AI settings could not be read"); `provider === null || !enabled` → `ai_disabled`.
3. `model = aiSettings.resolveModel(persona)` → null → `no_model` ("No model is configured for persona X and no default model is set").
4. `apiKey = await userAiKey.getSecretForUser(req.userId)` → null → `no_user_key`. **Never** `credentials.getSecret(AI_PLATFORM_CREDENTIAL_PURPOSE, …)` — a unit test asserts it.
5. Attachments: if `req.attachments?.length` and persona lacks `vision` → `attachment` ("Persona X does not accept attachments"); else `parts = await resolver.resolve(req.userId, req.attachments)` (throws `AiProviderError('attachment', …)` → `ok:false`).
6. Provider call inside an OTel span (below) with `toOpenAiStrictSchema(req.schema)`, `timeoutMs = config.ai.requestTimeoutMs`, `metadata: { invocationId, persona, promptVersion }`.
7. `refusal` non-null → status `refused`, code `refusal`, message = refusal text (redacted). `outputText` null / `incompleteReason` set → `invalid_output`, code `schema`, message `Model returned no output (${incompleteReason ?? 'unknown'})`. `JSON.parse` failure or `schema.safeParse` failure → `invalid_output`, code `schema`, message with the Zod issue paths (never the raw output).
8. Success → `ok:true`.

Every exit writes one row via `AiInvocationLogService.record()` (`apps/api/src/ai/gateway/ai-invocation-log.service.ts`, new): `operation:'invoke', keyScope:'user', userId, persona, provider:'openai', model, promptVersion, requestId, providerRequestId, status, errorCode, errorMessage (redacted ≤2000), tokens, latencyMs, outputValid, attachmentCount, input: { instructions, input, attachments: [ids], schemaName }, output: parsed | { raw: outputText } for invalid` — both JSON values passed through `AiKeyRedactor` and capped at 32 KiB (`{ _truncated: true, preview: first 1024 chars }`). Row write failures are logged and swallowed (telemetry must not fail the call). `invocationId` is generated up front (`randomUUID()`) so the span, the metadata and the row share it.

OTel span `ai.invoke` (`SpanKind.CLIENT`, tracer `trace.getTracer('evolvepath-api')`): attributes `gen_ai.system='openai'`, `gen_ai.operation.name='chat'`, `gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `ai.persona`, `ai.prompt_version`, `ai.key_scope='user'`, `ai.invocation_id`, `ai.attachment_count`, `ai.status`, `ai.error_code`, `enduser.id`. **Never** prompt or completion content. Span status `ERROR` only when `status === 'failed'` (refusal/invalid_output are OK spans with `ai.status` set). Log line (Nest `Logger`, info on success, warn otherwise): `AI invoke id=<uuid> persona=<k> model=<m> scope=user status=<s> latencyMs=<n> tokens=<in>/<out> user=<userId>`.

`AiKeyRequiredException` (`gateway/ai-errors.ts`): `withVerbatimErrorBody(new HttpException({ statusCode: 412, code: 'AI_KEY_REQUIRED', message: 'An OpenAI API key is required. Add one under Settings → OpenAI API Key.' }, 412))` so the filter sends the body verbatim (its default mapping would overwrite `code`). The gateway never throws it; export `assertAiKeyAvailable(result)` — throws it when `result.ok === false && result.error.code === 'no_user_key'` — for HTTP controllers in later epics, so the web app's 412 handling (E01-09) can redirect to setup.

`AiAttachmentResolverService` (`apps/api/src/ai/attachments/ai-attachment-resolver.service.ts`, new) `resolve(userId, attachments): Promise<AiContentPart[]>`:

- Config `ai.attachments.maxImagesPerCall` (env `AI_MAX_IMAGES_PER_CALL`, default 10), `ai.attachments.maxImageBytes` (`AI_MAX_IMAGE_BYTES`, default 20971520 = 20 MiB), `ai.attachments.mode` fixed `'inline'` (a `'signed-url'` mode is declared in the type for E03 but not implemented — selecting it throws at boot).
- For each attachment: `objects.getById(id, userId)` (existing ownership check; `NotFoundException` → `AiProviderError('attachment', 'Attachment <id> was not found')`); `status !== 'ready'` → `attachment` "Attachment <id> is not ready"; `mimeType.startsWith('image/')` → `storageKey` via `prisma.storageObject.findUnique({ where: { id }, select: { storageKey: true } })` (the response DTO omits it) → `storageProvider.download(key)` → buffer; over `maxImageBytes` → `attachment` "Image <id> exceeds N bytes"; → `{ type: 'image', mimeType, base64, detail }`. `mimeType.startsWith('video/')` → read `metadata._processing['video-frames'].frames` (`[{ objectId, timestampMs }]`); absent → `attachment` "Video <id> has not been processed yet"; each frame `objectId` resolved recursively as an image (ownership check applies to the frame objects too). Any other MIME → `attachment` "Unsupported attachment type". Total image parts > `maxImagesPerCall` → `attachment` "Too many images (N > max)".
- Injects `ObjectsService` (exported by `StorageModule`), `STORAGE_PROVIDER` (exported by `StorageProvidersModule` — add it to `AiModule.imports` alongside `StorageModule`), `PrismaService`, `ConfigService`.

`configuration.ts`: add `ai.attachments: { maxImageBytes, maxImagesPerCall, mode: 'inline' }`. `AiModule`: add `AiGatewayService`, `AiInvocationLogService`, `AiAttachmentResolverService`, `TestThrottle`; **exports** `AiGatewayService`, `UserAiKeyService`, `AiSettingsService` (final export list for the epic).

**UI (frontend-dev)** — n/a.

**Tests (testing-dev)**

- `ai-gateway.service.spec.ts` (mocks: `AiSettingsService`, `UserAiKeyService`, `CredentialsService`, `AiProviderRegistry`, `AiAttachmentResolverService`, `AiInvocationLogService`, `PrismaService`): each short-circuit code (`ai_disabled` ×2, `no_model`, `no_user_key`, `attachment` for non-vision persona) writes a row with that `errorCode` and returns `ok:false`; success parses the schema and returns `output` typed; provider `AiProviderError('rate_limit')` → `ok:false` `rate_limit`, row `status:'failed'`; refusal → row `status:'refused'`; invalid JSON → `invalid_output`/`schema`, row `outputValid:false`, `output.raw` present; Zod-invalid JSON → same with issue paths in message; `credentials.getSecret` is **never** called with `'ai:openai'` (assert `toHaveBeenCalledWith` on the user service only, and a spy on `CredentialsService.getSecret` filtered by purpose has zero platform calls); `reasoningEffort` defaults from persona; span attributes contain no `instructions`/`input` text (use `@opentelemetry/sdk-trace-base` `InMemorySpanExporter` or spy on `tracer.startActiveSpan`); log-write rejection does not change the result.
- `ai-invocation-log.service.spec.ts`: 32 KiB cap with `_truncated`; key redaction inside nested JSON; `errorMessage` ≤ 2000.
- `ai-attachment-resolver.service.spec.ts` (mock `ObjectsService`, `createMockStorageProvider()` from `apps/api/test/mocks/storage-provider.mock.ts`, `PrismaService`): foreign object (`getById` throws `NotFoundException`) → `attachment`; `status:'processing'` → `attachment`; image inlined with correct data URL mime; oversize buffer → `attachment`; video with two frames → two image parts in `timestampMs` order; video without `_processing['video-frames']` → "has not been processed yet"; 11 images → "Too many images"; `text/plain` → unsupported.
- Integration `apps/api/test/ai/ai-gateway.integration.spec.ts` (new): boots `AppModule` with `createTestApp`, resolves `AiGatewayService` from `context.module`, overrides `OpenAiProvider` with a mock returning `{"ok":true}`; asserts `invoke` succeeds for a seeded user key and that `prismaMock.aiInvocation.create` was called with `keyScope:'user'`; asserts `AiKeyRequiredException` serialises as `{ statusCode: 412, code: 'AI_KEY_REQUIRED', message }` by registering a throwaway test route via `registerRoutes`.

**Docs (docs-dev)** — none here; `docs/specs/ai-gateway.md` is E01-12.

#### Acceptance criteria

- [ ] `AiGatewayService.invoke` has exactly the request/result types above and is exported from `AiModule`; it never rejects for provider, key, settings, attachment or schema problems.
- [ ] Every call — success or any failure — produces exactly one `ai_invocations` row with `keyScope:'user'`, the prompt version, tokens, latency, `outputValid`, redacted input/output JSON ≤ 32 KiB.
- [ ] The gateway reads only `('ai:openai:user', userId)`; the platform key is never consulted (unit-tested).
- [ ] Attachments are accepted only for `vision` personas; images are inlined as base64 data URLs within `AI_MAX_IMAGE_BYTES`; videos expand to their sampled frames; unprocessed videos fail with a clear `attachment` error; at most `AI_MAX_IMAGES_PER_CALL` images per call.
- [ ] One `ai.invoke` CLIENT span per call with the listed `gen_ai.*`/`ai.*` attributes and no prompt/completion content; ERROR status only for `failed`.
- [ ] `AiKeyRequiredException` renders as HTTP 412 `{ code: 'AI_KEY_REQUIRED' }` verbatim.
- [ ] All specs above pass; `npm run typecheck` passes.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: typed error codes; telemetry write failures swallowed; programmer errors (unknown persona, unsupported attachment mode) throw
- [ ] Observability: row + span + log line per call; PRD §88 fields covered; no chain of thought stored
- [ ] Security: user key only; redaction on every persisted string; ownership check on every attachment and frame
- [ ] Config & secrets: `AI_MAX_IMAGE_BYTES` (20 MiB), `AI_MAX_IMAGES_PER_CALL` (10); documented in E01-12
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated (E01-12 owns the spec; this child adds JSDoc on `invoke`)

#### Manual test script

1. Stack up with the fake server; admin configured with `defaultModel: 'gpt-5.4'` (epic steps 6–7); signed in with a seeded key.
2. Until E04 ships a caller, exercise the gateway from a Jest integration run: `cd apps/api && npm test -- ai-gateway.integration` → green; then `psql "$PGURL" -c "select persona, prompt_version, status, output_valid from ai_invocations where operation='invoke';"` shows nothing (mock DB) — the DB-backed proof is E01-10's e2e `admin-ai-settings.spec.ts` test-connection rows plus the E04 onboarding proposal.
3. Temporarily set `AI_REQUEST_TIMEOUT_MS=100` in `.env`, restart `api`, call `POST /api/ai-settings/test` with the fake server header behaviour `timeout` (`docker compose … exec api sh -c 'curl -s -X POST http://fake-openai:8089/v1/responses -H "authorization: Bearer sk-test-x" -H "x-fake-behaviour: timeout"'` hangs as expected); the API test result shows `error: 'OpenAI request timed out after 100 ms'`. Restore the value.

#### Out of scope

- Signed-URL attachment mode, HEIC/EXIF normalisation, per-user storage quota (E03-05).
- Safety pre-check (E06-06) — `safetyDecision` stays null.
- Retry/backoff, streaming, caching of stable summaries (PRD §118 "cache stable summaries" is a caller concern).

#### Notes for the implementing agent

- Never `throw` from `invoke` after step 1; wrap the provider call and the resolver in `try/catch` that map `AiProviderError` → result and any other error → `provider` with a redacted `message`.
- `withVerbatimErrorBody` is in `apps/api/src/common/exceptions/verbatim-error-body.exception.ts`; without it the filter rewrites `code` to `'ERROR'` for 412.
- `ObjectsService.getById` returns `ObjectResponseDto` (no `storageKey`); read the key with Prisma after the ownership check passes, as specified.
- Register `AiInvocationLogService` writes with `prisma.aiInvocation.create`; `input`/`output` must be `Prisma.InputJsonValue`.
- Keep `strict-json-schema` conversion outside the span so a schema bug throws synchronously at the call site (programmer error), not as a provider failure.

---

### E01-07 `feat(web): add AI settings admin page with persona model selectors`

**Part of epic:** E01 · **Blocked by:** E01-04 · **Component:** web · **Priority:** P0 · **Agents:** frontend-dev → testing-dev

#### Problem statement

The admin API from E01-04 needs its registry-declared destination (CLAUDE.md "Settings UI Pattern" rules 1–4): a card in `ADMIN_SECTIONS`, a route, and a page that mirrors `EmailSettingsPage` so an administrator can select the provider, store the platform key write-only, refresh the live catalog, pick a default and per-persona models (PRD §118), and test the connection with the provider's error shown verbatim — on a phone as well as a desktop (PRD §123 mobile-first).

#### Proposed solution

Clone the email settings page and hook, add a persona/model table that degrades to cards below `sm`.

**Data (database-dev)** — n/a.

**API (backend-dev)** — n/a (E01-04).

**UI (frontend-dev)**

`apps/web/src/types/index.ts` — add: `AiProviderKind = 'openai'`; `AiPersonaTier`, `AiPersonaCapability`, `AiPersona { key, label, description, tier, capabilities }`; `AiPlatformKeyStatus { configured, hint, updatedAt, updatedByUserId }`; `AiSettings { provider, enabled, baseUrl?, defaultModel, personaModels: Partial<Record<string, string | null>>, platformKeyStatus, settingsError, version, updatedAt, updatedBy }`; `AiSettingsInput { provider, enabled, baseUrl?: Blankable<string>, defaultModel, personaModels, platformApiKey?: string }` (reuse the existing `Blankable` type); `AiModelInfo { id, created }`; `AiModelsResult { success, models, fetchedAt, source, error }`; `AiTestCheck = 'passed' | 'failed' | 'skipped'`; `AiTestResult { success, providerKind?, model?, latencyMs?, error: string | null, attemptedAt?, checks?: { listModels, generate } }`.

`apps/web/src/services/api.ts` — `getAiSettings()`, `updateAiSettings(input, expectedVersion)` (sends `If-Match` exactly like `updateEmailSettings`), `getAiPersonas()`, `getAiModels(refresh = false)`, `testAiConnection()`.

`apps/web/src/hooks/useAiSettings.ts` (new) — clone of `useEmailSettings` returning `{ settings, personas, models, isLoading, loadError, isSaving, saveError, isTesting, testResult, isRefreshingModels, save(input): Promise<boolean>, test(): Promise<void>, refreshModels(): Promise<void>, clearTestResult, clearSaveError, refresh }`; 409 on save → reload + explanatory `saveError`; personas fetched once; models fetched on mount (`refresh=false`) and on demand (`refresh=true`); a 429 from refresh/test becomes `testResult = { success: false, error: message }` / `models.error`, never a thrown error.

`apps/web/src/components/ai/PersonaModelTable.tsx` (new) — props `{ personas: AiPersona[]; models: AiModelInfo[]; personaModels: Partial<Record<string, string | null>>; defaultModel: string | null; disabled: boolean; onChange(key: string, model: string | null): void }`. ≥ `sm`: MUI `Table` with columns Persona (label + description caption + tier chip + "vision" chip), Model (`Select` with first option "Use default (<defaultModel or 'none'>)" = `null`, then the catalog ids; a stored id missing from the catalog is still rendered as a selectable "(not in catalog)" option so a save does not silently drop it). < `sm`: one `Card` per persona with the same select. Branch with `useMediaQuery(theme.breakpoints.down('sm'))` inside one component tree — a local layout choice, **not** one of the five coupled gates (say so in the file header and cite `docs/specs/settings-ui.md` §5).

`apps/web/src/pages/Admin/AiSettingsPage.tsx` (new) — route `/admin/settings/ai`; structure mirrors `EmailSettingsPage`: `settingsError` warning banner; provider `RadioGroup` (`OpenAI`; `provider: null` selects nothing); `Enabled` switch (choosing a provider does not flip it); "Platform API key" password `TextField` with visibility toggle, helper text showing `platformKeyStatus` ("Configured · ••••abcd · updated <relative time>" or "Not configured"), placeholder "Leave blank to keep the stored key"; **Advanced** accordion with `baseUrl` (helper: "Override only for a proxy or the test server; https is required in production"); **Models** section: `Refresh models` button with caption "Fetched <relative> · live|cache" and an inline error alert from `models.error`; `Default model` select; `PersonaModelTable`; **Test connection** button disabled with a prose `testBlockedReason` when: saving, testing, form dirty ("Save your changes before testing"), no write permission, `provider === null`, `!enabled`, `!platformKeyStatus.configured` (each a separate stated reason, as `EmailSettingsPage` does); result `Alert` (success: providerKind/model/latency/checks; failure: `<pre>` with the verbatim error, dismissible); **Save** sends `AiSettingsInput` with `platformApiKey` **omitted** when the field is blank and `If-Match: version`; read-only users (no `system_settings:write`) see the subtitle "Read-only" with controls disabled. a11y: every control labelled; result alerts `role="status"`/`role="alert"`; the `<pre>` inside a region labelled "Test result".

`apps/web/src/App.tsx` — lazy `AiSettingsPage`; route `<Route path="/admin/settings/ai" element={<RequirePermission permission="system_settings:read" fallback={<Navigate to="/" replace />}><AiSettingsPage /></RequirePermission>} />` next to `/admin/settings/email`.

`apps/web/src/config/adminSections.tsx` — in `General`, between `Email` and `Advanced (JSON)`: `{ title: 'AI', description: 'Connect OpenAI, choose which model each coaching persona uses, and test the connection.', Icon: SmartToyOutlinedIcon (from '@mui/icons-material/SmartToyOutlined'), path: '/admin/settings/ai', permission: 'system_settings:read' }` with the same "mirrors `ai-settings.controller.ts` GET" comment the Email card carries.

`apps/web/visual/main.tsx` — add the `/admin/settings/ai` route to the harness routes (the hub card must navigate in the visual harness too).

**Tests (testing-dev)** (Vitest + RTL + MSW under `apps/web/src/__tests__/`)

- `mocks/handlers.ts`: handlers for `GET/PUT /ai-settings`, `GET /ai-settings/personas`, `GET /ai-settings/models`, `POST /ai-settings/test` with **mutable state** (`let aiSettingsState`, `let aiPlatformKeyConfigured`) and exported reset helpers; PUT bumps `version`, honours `If-Match` (409 on mismatch), 400 for a model id below 5.4.
- `hooks/useAiSettings.test.ts`: loads settings+personas+models; 409 → reloads and sets `saveError`; test result stored as state (not thrown); 429 on refresh becomes `models.error`.
- `pages/Admin/AiSettingsPage.test.tsx`: renders provider radio state from `provider: null`; choosing OpenAI does not flip Enabled; every `testBlockedReason` branch; success/failure result rendering with the verbatim `<pre>` error, never truncated; `settingsError` banner; read-only subtitle; redirect without `system_settings:read`; catalog filters nothing client-side (renders what the API sends); a stored model missing from the catalog still shows; `axe` has no violations at 1280px and at 375px.
- `pages/Admin/AiSettingsPage.wire.test.tsx`: exact PUT body — blank key field ⇒ `platformApiKey` absent from the JSON; typed key ⇒ present with the typed value; `personaModels` contains only changed keys with `null` for "Use default"; `If-Match` equals the loaded `version`.
- `components/ai/PersonaModelTable.test.tsx`: table at ≥ 600px, cards at < 600px (mock `matchMedia`); `onChange(key, null)` for "Use default".
- `config/settingsRegistry.test.ts` / `config/destinations.test.ts`: add the new route to the owned-routes list so "claims every route in App.tsx" stays green; assert the AI card's `permission === 'system_settings:read'`.
- Visual: regenerate `tests/visual/specs/admin-hub.spec.ts-snapshots/*` inside `mcr.microsoft.com/playwright:v1.62.1-noble` (`cd tests/visual && npm run test:update`); add `tests/visual/specs/ai-settings.spec.ts` capturing `/admin/settings/ai` at 1440×900 and 390×844 (MSW is not available in the harness — the page's loading/error state is what gets captured unless the harness gains a stub; capture the hub card instead if that is the case and say so in the spec).

**Docs (docs-dev)** — CLAUDE.md "Access Control"/settings pointers unchanged; E01-12 documents the page.

#### Acceptance criteria

- [ ] `/admin/settings` shows the **AI** card in General for a `system_settings:read` user and hides it otherwise; the Console rail and AppBar title resolve it (registry-driven).
- [ ] `/admin/settings/ai` loads settings, personas and models; provider/enabled/platform key/base URL/default model/persona models are editable and saved with `If-Match`.
- [ ] The platform key field is write-only: blank on load, omitted from the request when left blank, and the stored status is shown next to it.
- [ ] Refresh models lists only what the API returns (≥ 5.4), with fetched time and source; API-side failure is shown inline, not as a crash.
- [ ] Test connection is disabled with a stated reason whenever it would be pointless, and shows the provider's verbatim error on failure.
- [ ] Below 600px the persona table renders as cards with identical controls; none of the five coupled breakpoint gates is modified.
- [ ] axe reports no violations; all listed Vitest suites pass; visual baselines updated in the pinned container.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: 409 reload path; 400 messages surfaced; test/refresh failures rendered, never thrown to the boundary
- [ ] Observability: n/a client-side
- [ ] Security: key never echoed into state after save; password field `autoComplete="off"`
- [ ] Config & secrets: none
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated (E01-12)

#### Manual test script

1. Epic script steps 6–9 verbatim.
2. Additionally, as a user whose only permission is `system_settings:read` (log in via `/testing/login` as viewer, then grant the role in the Users page as admin, or use the visual harness `?route=/admin/settings/ai&perms=system_settings:read`): the page loads read-only; Save and Test are disabled with the reason "You need system_settings:write".

#### Out of scope

- The user key form (E01-08).
- Cost/usage display.
- Model descriptions/pricing.

#### Notes for the implementing agent

- `EmailSettingsPage.tsx` is the template for form state, `testBlockedReason`, snackbar and 409 handling; `useEmailSettings.ts` for the hook. Do not "improve" the shared patterns in passing.
- Registry card first, then the route, then the page (CLAUDE.md rule 1); the card's `permission` must be the exact string `ai-settings.controller.ts` enforces on GET.
- `destinations.test.ts` reads `App.tsx` source and fails on any unlisted route.
- Icons are components (`Icon: SmartToyOutlinedIcon`), never rendered elements.
- Do not touch `Layout.tsx`, `BottomNav`, `SettingsHub.tsx` or `AppBar.tsx` breakpoint logic.

---

### E01-08 `feat(web): add user OpenAI key settings page and shared key form`

**Part of epic:** E01 · **Blocked by:** E01-05 · **Component:** web · **Priority:** P0 · **Agents:** frontend-dev → testing-dev

#### Problem statement

Users need a place to add, test, replace and remove their own OpenAI key (E01-05 API), reachable from the per-user settings hub as a registry card (CLAUDE.md rules 1–4). The same form and instructions must be reusable by the first-login setup screen (E01-09), so the form is built as a shared component with two variants rather than two pages that drift.

#### Proposed solution

Shared `OpenAiKeyForm` + `OpenAiKeyInstructions` components, a `useMyAiKey` hook, the `/settings/ai-key` page and its registry card. `User.aiKey` becomes a required field on the web `User` type.

**Data (database-dev)** — n/a.

**API (backend-dev)** — n/a (E01-05).

**UI (frontend-dev)**

`apps/web/src/types/index.ts`: `export interface AiKeySummary { configured: boolean; hint: string | null }`; `User.aiKey: AiKeySummary` (**required**, so every fixture must declare it); `MyAiKeyStatus { configured, hint, updatedAt, lastTest: { attemptedAt, success, model, error } | null, platform: { provider: AiProviderKind | null, enabled, hasDefaultModel } }`. Fix every `User` literal: `apps/web/src/__tests__/utils/test-utils.tsx` (`mockUser`, `mockAdminUser`: `aiKey: { configured: true, hint: '••••e2e1' }`), `apps/web/src/__tests__/mocks/data.ts`, `apps/web/src/__tests__/mocks/handlers.ts` (`mockUser`, `GET /auth/me`), `apps/web/visual/main.tsx` (`harnessUser`).

`apps/web/src/services/api.ts`: `getMyAiKey()`, `setMyAiKey(apiKey)`, `deleteMyAiKey()`, `testMyAiKey()`.

`apps/web/src/hooks/useMyAiKey.ts` (new): `{ status, isLoading, loadError, isSaving, saveError, isTesting, testResult, isRemoving, save(apiKey): Promise<boolean>, test(): Promise<void>, remove(): Promise<boolean>, clearTestResult, clearSaveError, refresh }`; after a successful `save` **and** after a successful `remove`, call `refreshUser()` from `useAuth()` so `user.aiKey` (and therefore the gate in E01-09) updates without a reload; 429 on test → `testResult = { success: false, error }`; 400 on save → `saveError` with the API message.

`apps/web/src/components/ai/OpenAiKeyInstructions.tsx` (new): props `{ variant: 'setup' | 'settings' }`. Numbered steps: (1) Sign in at platform.openai.com, (2) open **API keys**, (3) click **Create new secret key**, (4) name it "EvolvePath", (5) copy the key — it is shown once, (6) paste it below. Link `https://platform.openai.com/api-keys` with `target="_blank" rel="noopener noreferrer"`. Note: "Billing must be enabled on your OpenAI account or requests will fail." `settings` variant renders inside a collapsed `Accordion` ("How do I get a key?"); `setup` variant renders open.

`apps/web/src/components/ai/OpenAiKeyForm.tsx` (new): props `{ status: MyAiKeyStatus | AiKeySummary | null; variant: 'setup' | 'settings'; onSave(apiKey: string): Promise<boolean>; onTest(): Promise<void>; onRemove?: () => Promise<boolean>; isSaving: boolean; isTesting: boolean; testResult: AiTestResult | null; clearTestResult(): void; saveError: string | null }`. Behaviour: password `TextField` (`autoComplete="off"`, `spellCheck={false}`) with show/hide toggle (`aria-label="Show key"/"Hide key"`); value is trimmed on paste and on submit; soft helper hint "OpenAI keys usually start with sk-" shown (not blocking) when the value is non-empty and does not start with `sk-`; Save button label "Save key" (settings) / "Save and continue" (setup), disabled while empty, saving or testing; **Test key** button: when the field has a value it saves first then tests? — no: keep it simple and honest: *Test key* is enabled only when `status.configured` is true and the field is empty ("Save the key, then test it"); a persistent, dismissible result `Alert` with `checks` and a `<pre>` carrying the verbatim error; status line "Configured · ••••abcd · last tested <relative> (worked|failed)" or "No key saved"; **Remove key** (only when `onRemove` is given and `status.configured`) opens a confirm `Dialog` whose text states "You will be asked for a key again before you can use EvolvePath"; confirm calls `onRemove`. a11y: labelled controls; `aria-live="polite"` status; the dialog traps focus (MUI default) and returns focus to the button.

`apps/web/src/pages/UserAiKeyPage.tsx` (new): route `/settings/ai-key`, wrapped like the other user settings pages (`UserSettingsSection` chrome with title "OpenAI API Key", subtitle "EvolvePath uses your own OpenAI key for every AI feature. It is stored encrypted and never shown again."); renders `OpenAiKeyInstructions variant="settings"` and `OpenAiKeyForm variant="settings"` bound to `useMyAiKey` (with `onRemove`). After a successful remove, the E01-09 gate will redirect to setup — nothing to do here beyond `refreshUser()`.

`apps/web/src/config/userSettingsSections.tsx`: new section between `Account` and `Security`: `{ label: 'AI', cards: [{ title: 'OpenAI API Key', description: 'Add, test or remove the OpenAI API key that powers your coaching.', Icon: KeyIcon (from '@mui/icons-material/Key'), path: '/settings/ai-key' }] }` — no `permission` (own resource, `@Auth()` only).

`apps/web/src/App.tsx`: lazy `UserAiKeyPage`; `<Route path="/settings/ai-key" element={<UserAiKeyPage />} />` beside `/settings/tokens`. `apps/web/visual/main.tsx`: add the route.

**Tests (testing-dev)**

- `mocks/handlers.ts`: `GET/PUT/DELETE /me/ai-key`, `POST /me/ai-key/test` with mutable `aiKeyState` and an exported `setAiKeyConfigured(configured: boolean)` that also updates the `GET /auth/me` payload's `aiKey`.
- `components/ai/OpenAiKeyForm.test.tsx`: pasted value with surrounding whitespace is trimmed before `onSave`; Save disabled when empty; show/hide toggles input `type`; failure result renders the error verbatim inside `<pre>`; success result shows `checks`; Remove opens the confirm dialog and only calls `onRemove` after confirm; soft `sk-` hint appears/disappears; `axe` clean for both variants.
- `components/ai/OpenAiKeyInstructions.test.tsx`: link href/rel; accordion collapsed in `settings`, open in `setup`.
- `hooks/useMyAiKey.test.ts`: `save` resolves true and calls `refreshUser` (spy through a mocked `AuthContext`); `remove` calls `refreshUser`; test result stored as state; 400 → `saveError`.
- `pages/UserAiKeyPage.test.tsx`: title/subtitle; loads status; instructions collapsed; full save → status line updates.
- `config/userSettingsSections.test.ts`: the AI section exists with exactly one card, no `permission`, path `/settings/ai-key`; `settingsPageTitle(USER_SETTINGS_SECTIONS, '/settings', 'Settings', '/settings/ai-key') === 'OpenAI API Key'`.
- `config/destinations.test.ts`: add `/settings/ai-key` to owned routes.
- Visual: regenerate `tests/visual/specs/user-hub.spec.ts-snapshots/user-hub-1440x900.png` inside the pinned container (new card changes the grid); add an `ai-key` capture of `/settings/ai-key` at 390×844 if the harness can render it without MSW (see E01-07 note).

**Docs (docs-dev)** — E01-12.

#### Acceptance criteria

- [ ] `/settings` shows an **AI** group with the **OpenAI API Key** card for every signed-in user; AppBar title resolves to "OpenAI API Key" on the route.
- [ ] A user can save a key (trimmed, ≥ 20 chars, no whitespace), see "Configured · ••••xxxx", test it and read the provider's verbatim error or the checks on success, replace it, and remove it after confirming.
- [ ] The key input never shows a stored value; the page shows only the hint.
- [ ] `user.aiKey` in `AuthContext` reflects a save or removal immediately (no page reload).
- [ ] `OpenAiKeyForm`/`OpenAiKeyInstructions` are reused unchanged by E01-09's setup page (two variants, one component each).
- [ ] The compiler forces every `User` fixture to declare `aiKey`; all listed Vitest suites and axe pass; visual baselines updated.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: 400/429/provider failures rendered inline; nothing thrown to the error boundary
- [ ] Observability: n/a
- [ ] Security: `autoComplete="off"`, value cleared from state after save, never logged; instructions link uses `rel="noopener noreferrer"`
- [ ] Config & secrets: none
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated (E01-12)

#### Manual test script

1. Epic script step 10, and step 5's form interactions performed on `/settings/ai-key` instead (replace a key, test it).
2. At 375px width: instructions accordion, field, buttons and the result alert stack vertically with no horizontal scroll.

#### Out of scope

- The gate and the setup route (E01-09).
- Showing usage/cost for the key.

#### Notes for the implementing agent

- Making `User.aiKey` required is deliberate — let the compiler enumerate the fixtures (`test-utils.tsx`, `mocks/data.ts`, `mocks/handlers.ts`, `visual/main.tsx`).
- `useAuth().refreshUser` exists in `apps/web/src/contexts/AuthContext.tsx`; call it, do not re-fetch `/auth/me` ad hoc.
- Use `UserSettingsSection` (`apps/web/src/pages/UserSettingsSection.tsx`) for page chrome like `UserTokensPage`.
- Registry card before route (CLAUDE.md rule 1); no `permission` on the card; do not add a tab anywhere (rule 2).
- Relative times: `apps/web/src/utils/relativeTime.ts`.

---

### E01-09 `feat(web): gate signed-in users without an OpenAI key behind the setup flow`

**Part of epic:** E01 · **Blocked by:** E01-08 · **Component:** web · **Priority:** P0 · **Agents:** frontend-dev → testing-dev

#### Problem statement

Every user must bring their own key before using the app (product-owner constraint), and the experience at first login must explain how to get one and let them test it. `ProtectedRoute` only checks authentication; there is no onboarding gate. The gate must cover admins too (an admin without a key cannot use the coach either), must not cover the setup page or the device activation page, and must send the user back where they were going.

#### Proposed solution

A `RequireAiKey` layout route reading `user.aiKey.configured` from `AuthContext`, a full-screen `/setup/ai-key` page outside `Layout` (like `/activate`), and a 412 `AI_KEY_REQUIRED` handler in the API client.

**Data (database-dev)** — n/a.

**API (backend-dev)** — n/a.

**UI (frontend-dev)**

`apps/web/src/components/common/RequireAiKey.tsx` (new):

```tsx
export function RequireAiKey() {
  const { user } = useAuth(); const location = useLocation();
  if (user && !user.aiKey.configured) return <Navigate to="/setup/ai-key" state={{ from: location }} replace />;
  return <Outlet />;
}
```

`apps/web/src/pages/AiKeySetupPage.tsx` (new): route `/setup/ai-key`, rendered **outside** `Layout` and `NotificationProvider` (no app bar, rail, bottom nav, bell) — same full-screen `Container`/`Paper` shape as `ActivateDevicePage`. Content: heading "Connect your OpenAI API key", one-paragraph why ("EvolvePath runs every AI feature with your own key. It is encrypted, never shown again, and used only for your account."), `OpenAiKeyInstructions variant="setup"`, `OpenAiKeyForm variant="setup"` (no `onRemove`) bound to `useMyAiKey`, and a **Sign out** text button calling `useAuth().logout()` then `navigate('/login', { replace: true })`. On successful save: `refreshUser()` (the hook does it) then `navigate(location.state?.from?.pathname ?? '/', { replace: true })`. If the user already has a key and lands here (bookmark), redirect to `/` immediately.

`apps/web/src/App.tsx` route tree (the exact nesting):

```
<Route element={<ProtectedRoute />}>
  <Route path="/activate" element={<ActivateDevicePage />} />          // exempt
  <Route path="/setup/ai-key" element={<AiKeySetupPage />} />          // exempt
  <Route element={<RequireAiKey />}>
    <Route element={<NotificationProvider><Layout /></NotificationProvider>}>
      … every existing shell route, including /admin/* and /settings/ai-key …
    </Route>
  </Route>
</Route>
```

`/settings/ai-key` is **not** exempt: removing the key there sends the user to setup (the confirm dialog says so). `apps/web/visual/main.tsx`: mirror the nesting (harness user has `aiKey.configured: true`, so nothing visible changes; the structure stays identical to `App.tsx`).

`apps/web/src/services/api.ts`: when a response is 412 with body `code === 'AI_KEY_REQUIRED'`, throw `ApiError` with `code: 'AI_KEY_REQUIRED'` (the class already carries `code`), and additionally dispatch a `window` `CustomEvent('evolvepath:ai-key-required')`; `AuthContext` listens and calls `refreshUser()` so `RequireAiKey` re-evaluates and redirects. This covers a key deleted from another tab or via the API.

**Tests (testing-dev)**

- `components/common/RequireAiKey.test.tsx`: `aiKey.configured: false` → redirects to `/setup/ai-key` with `state.from` = the attempted location; `true` → renders `Outlet`; unauthenticated is not its concern (`ProtectedRoute` above) — assert it renders `Outlet` when `user` is null to prove no double-redirect.
- `pages/AiKeySetupPage.test.tsx`: renders instructions open + setup form + Sign out; no `AppBar`/`BottomNav` in the tree; successful save navigates to `state.from` when present, else `/`; Sign out calls `logout` and navigates to `/login`; a user with a configured key is redirected to `/`; axe clean at 375px and 1280px.
- `App.test.tsx` (existing): extend with a routing test — with `setAiKeyConfigured(false)` in MSW, visiting `/` lands on `/setup/ai-key`; visiting `/activate` does not; visiting `/admin/settings` as admin lands on setup; after `PUT /me/ai-key` the app navigates to `/admin/settings`.
- `services/api.test.ts`: a 412 `AI_KEY_REQUIRED` response throws `ApiError` with that `code` and dispatches the event.
- `contexts/AuthContext.test.tsx`: the event triggers `refreshUser`.
- `config/destinations.test.ts`: `/setup/ai-key` listed as deliberately unowned (like `/activate`).
- e2e: `tests/e2e/helpers/auth.helper.ts` — `TestUserOptions.withAiKey?: boolean` (default `true`): when true, check `[data-testid="test-with-ai-key"]` before submitting; when false, `waitForURL('/setup/ai-key')` instead of `'/'`. All existing e2e specs keep passing because the default seeds a key. The specs themselves land in E01-10.

**Docs (docs-dev)** — E01-12 (`docs/ARCHITECTURE.md` route table gains `/setup/ai-key`; `docs/TESTING.md` gains `withAiKey`).

#### Acceptance criteria

- [ ] A signed-in user without a key is redirected from every shell route (including `/admin/*` and `/settings/*`) to `/setup/ai-key`; `/activate` and `/setup/ai-key` are reachable without a key.
- [ ] The setup page has no app chrome, shows the instructions open, a Sign out link, and the shared key form in `setup` variant.
- [ ] After saving a working key the user lands on the route they originally requested (or `/`).
- [ ] Removing the key on `/settings/ai-key` returns the user to the setup page.
- [ ] A 412 `AI_KEY_REQUIRED` API response refreshes the user and triggers the redirect.
- [ ] `loginAsTestUser` seeds a key by default and existing e2e specs stay green; `withAiKey: false` lands on setup.
- [ ] All listed Vitest suites and axe pass.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: loading state from `AuthContext` respected (no flash-redirect before `/auth/me` resolves — `ProtectedRoute` already spins on `isLoading`)
- [ ] Observability: n/a
- [ ] Security: the gate is UX only; authorization stays server-side (`no_user_key` / 412) — say so in the component header
- [ ] Config & secrets: none
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated (E01-12)

#### Manual test script

1. Epic script steps 4, 5, 10, 11 verbatim.
2. With a key configured, open two tabs; in tab A remove the key; in tab B click any AI-backed action once E04 exists — until then, call `fetch('/api/me/ai-key',{method:'DELETE',…})` from tab A's console and then navigate in tab B: the next `/auth/me` refresh (or a 412) sends tab B to setup.

#### Out of scope

- Onboarding wizard gating order (E04-05 adds "onboarding complete" after this gate).
- Remembering a dismissed setup (there is no dismiss; the key is mandatory).

#### Notes for the implementing agent

- Keep `ProtectedRoute.tsx` unchanged; `RequireAiKey` is a sibling layout route, so the `ProtectedRoute` tests remain valid.
- `ActivateDevicePage.tsx` is the layout reference for a full-screen page outside `Layout`.
- The five coupled breakpoint gates are untouched — the setup page is outside `Layout`, so `showRail`/`BottomNav` do not apply to it.
- `destinations.test.ts` must list `/setup/ai-key` as deliberately unowned or it fails.
- The e2e helper change is small but it is the reason E01-10 must follow immediately: until the specs exist nothing proves the default.

---

### E01-10 `test(tests): add fake OpenAI server and end-to-end AI key and admin flows`

**Part of epic:** E01 · **Blocked by:** E01-04, E01-05, E01-09 · **Component:** tests, infra · **Priority:** P0 · **Agents:** testing-dev → ops-dev

#### Problem statement

The epic must be provable end to end (DB + API + UI) without an OpenAI account, deterministically, in CI-less local runs. Every later epic's e2e (onboarding proposals, coach chat, workout programs) needs the same thing: a fake OpenAI server that speaks enough of `/v1/models` and `/v1/responses` to exercise the provider, the filter, the tests and the gate, plus failure modes on demand.

#### Proposed solution

A zero-dependency Node HTTP server, a Compose overlay that points the API at it, an e2e helper flag, and two Playwright specs.

**Data (database-dev)** — n/a.

**API (backend-dev)** — n/a (the API already reads `OPENAI_BASE_URL`).

**UI (frontend-dev)** — n/a.

**Tests (testing-dev)**

`tools/fake-openai/server.mjs` (new; `tools/` directory is new) — `node:http` only, `PORT` env (default 8089), logs one line per request:

- `GET /healthz` → 200 `ok`.
- Auth: `Authorization: Bearer sk-test-…` (prefix `sk-test-`) required on `/v1/*`; otherwise 401 `{ "error": { "message": "Incorrect API key provided: sk-***", "type": "invalid_request_error", "code": "invalid_api_key" } }`.
- `GET /v1/models` → `{ "object": "list", "data": [ {id:'gpt-5.4'}, {id:'gpt-5.4-mini'}, {id:'gpt-5.3'}, {id:'gpt-4o'}, {id:'gpt-5.5-realtime'} ] }` each with `object:'model', created: <fixed epoch>, owned_by:'openai'` — so the ≥ 5.4 filter is observable in the UI.
- `POST /v1/responses`: reject unknown `model` (not in the list) with 404 `{ error: { message: "The model \`x\` does not exist or you do not have access to it.", code: "model_not_found" } }`; header `x-fake-behaviour` selects: `rate_limit` → 429 `{ error: { message: "Rate limit reached for gpt-5.4", type: "rate_limit_error" } }` + `retry-after: 1`; `timeout` → never responds (ends when the client aborts); `refusal` → a message whose content is `[{ type: 'refusal', refusal: "I can't help with that." }]`; `invalid_json` → `output_text` `"not json {"`; default → build the object from `body.text.format.schema`: for each `required` key by `type`: `string` → `"placeholder"`, `number`/`integer` → `0`, `boolean` → `true`, `array` → `[]`, `object` → recurse, `enum` → first value, `["x","null"]` → `null`; so the probe schema `{ ok: boolean }` yields `{"ok":true}`. Response: `{ id: 'resp_<n>', object: 'response', model: body.model, status: 'completed', output: [{ type: 'message', id: 'msg_<n>', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(obj), annotations: [] }] }], usage: { input_tokens: 42, output_tokens: 7, total_tokens: 49, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } }, incomplete_details: null }` with header `x-request-id: fake-<n>`. Any request whose body has `store !== false` → 400 `{ error: { message: "fake-openai: store must be false" } }` (guards the E01-03 invariant end to end).
- `tools/fake-openai/README.md` (new): how to run (`node tools/fake-openai/server.mjs`), the behaviours, and that it is test infrastructure only.

`infra/compose/fake-openai.compose.yml` (new):

```yaml
services:
  fake-openai:
    image: node:24-alpine
    command: ["node", "/srv/server.mjs"]
    volumes:
      - ../../tools/fake-openai:/srv:ro
    environment:
      - PORT=8089
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:8089/healthz"]
      interval: 5s
      timeout: 3s
      retries: 10
    networks:
      - app-network
  api:
    environment:
      - OPENAI_BASE_URL=http://fake-openai:8089/v1
      # Test-only default so `withAiKey` can encrypt a key on a fresh clone; a real
      # value in .env always wins. Never use this value outside local testing.
      - SECRETS_ENCRYPTION_KEY=${SECRETS_ENCRYPTION_KEY:-ZmFrZS1vcGVuYWktZTJlLWtleS0wMDAwMDAwMDAwMDA=}
    depends_on:
      fake-openai:
        condition: service_healthy
```

`tests/e2e/playwright.config.ts`: `webServer.command` becomes `cd ../../infra/compose && docker compose -f base.compose.yml -f dev.compose.yml -f fake-openai.compose.yml up`; add a second readiness probe comment (the API `health/live` URL is enough since `api` depends on the fake server being healthy).

`tests/e2e/helpers/auth.helper.ts`: `withAiKey?: boolean` (default `true`) per E01-09; export `loginAsAdmin(page, email, { withAiKey })` pass-through.

`tests/e2e/specs/ai-key-gate.spec.ts` (new):
1. login `withAiKey: false` → URL `/setup/ai-key`; heading visible; no `[data-testid="bottom-nav"]`/app bar; `/`, `/settings`, `/admin/settings` all redirect back.
2. bad key `sk-wrong-000000000000000000` → Test disabled until saved; type it, Save → API 200 saved; Test → alert contains `Incorrect API key provided: sk-***`.
3. good key `sk-test-e2e-playwright-0000` → Save and continue → URL `/`.
4. `/settings/ai-key` → status "Configured"; Remove key → confirm → URL `/setup/ai-key`.
5. login `withAiKey: true` (default) → URL `/` immediately.

`tests/e2e/specs/admin-ai-settings.spec.ts` (new), admin login (seeded key):
1. `/admin/settings` shows the AI card; click → `/admin/settings/ai`.
2. choose OpenAI, Enabled on, platform key `sk-test-platform-0000000000`, Save → snackbar; key field empty; status "Configured".
3. Refresh models → default-model options are exactly `gpt-5.4`, `gpt-5.4-mini` (assert `gpt-5.3`, `gpt-4o`, `gpt-5.5-realtime` absent).
4. default `gpt-5.4`, `coach` → `gpt-5.4-mini`, Save.
5. Test connection → "Connection works", `generate passed`.
6. `page.request.put('/api/ai-settings', …defaultModel:'gpt-5.3'…)` with the session token → 400.
7. viewport 390×844 → persona cards visible, table absent.
8. DB proof through the API surface: `GET /api/me/ai-key` `lastTest` non-null after a user test; and `GET /api/ai-settings` `version` incremented twice.

**Docs (docs-dev)** — `docs/TESTING.md` E2E section: fake server, overlay, `withAiKey`, behaviours header; `tools/fake-openai/README.md`. (E01-12 completes.)

**Ops (ops-dev)** — build/run the overlay stack, run the e2e suite, report; no git operations.

#### Acceptance criteria

- [ ] `node tools/fake-openai/server.mjs` starts with no `npm install`; `/healthz`, `/v1/models`, `/v1/responses` behave as specified including all four `x-fake-behaviour` modes and the 401/404/400 guards.
- [ ] `docker compose -f base.compose.yml -f dev.compose.yml -f fake-openai.compose.yml up` brings the API up with `OPENAI_BASE_URL=http://fake-openai:8089/v1` and a healthy `fake-openai`.
- [ ] `cd tests/e2e && npx playwright test` passes: `auth.spec.ts`, `example.spec.ts` (unchanged), `ai-key-gate.spec.ts`, `admin-ai-settings.spec.ts`.
- [ ] `loginAsTestUser` defaults to a seeded key; `withAiKey: false` lands on setup.
- [ ] The fake server rejects `store !== false`, so a regression in E01-03 fails e2e.
- [ ] `docs/TESTING.md` documents the fake server and the flag.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: fake server returns JSON errors in OpenAI's shape; never crashes on malformed bodies (400)
- [ ] Observability: one log line per fake request with method, path, behaviour, status
- [ ] Security: the compose default encryption key is test-only and overridden by `.env`; the fake server binds inside the Compose network (no published port by default; publish `8089:8089` only via a local override if needed)
- [ ] Config & secrets: `OPENAI_BASE_URL` overlay; `SECRETS_ENCRYPTION_KEY` default in the overlay only
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script

1. `node tools/fake-openai/server.mjs &` then `curl -s localhost:8089/v1/models -H 'authorization: Bearer sk-test-x' | jq '.data[].id'` → five ids; `curl -s -X POST localhost:8089/v1/responses -H 'authorization: Bearer sk-test-x' -H 'content-type: application/json' -d '{"model":"gpt-5.4","store":false,"input":[],"text":{"format":{"type":"json_schema","name":"p","schema":{"type":"object","properties":{"ok":{"type":"boolean"}},"required":["ok"]}}}}' | jq -r '.output[0].content[0].text'` → `{"ok":true}`; add `-H 'x-fake-behaviour: refusal'` → `content[0].type == "refusal"`; without `"store":false` → 400.
2. Epic script steps 2–3 and 12.

#### Out of scope

- Simulating streaming, tool calls, token accounting fidelity, or latency profiles.
- A GitHub Actions workflow (declined).

#### Notes for the implementing agent

- Zero dependencies, ESM (`.mjs`), Node 24 — no TypeScript build step, so the file runs inside `node:24-alpine` from a read-only bind mount.
- `SECRETS_ENCRYPTION_KEY` in the overlay: 32 bytes base64 (`fake-openai-e2e-key-000000000000`); `.env` overrides via `env_file` precedence rules already documented in `base.compose.yml`.
- Do not modify `base.compose.yml`; overlay only.
- `tests/e2e` pins `@playwright/test ^1.40.0`; visual tests pin 1.62.1 — they are separate projects, do not merge them.
- Selectors: prefer roles/labels (`getByRole('button', { name: 'Save and continue' })`) over test ids; add `data-testid` only where E01-08/09 already define them.

---

### E01-11 `docs(docs): create the missing docs/specs/settings-ui.md`

**Part of epic:** E01 · **Blocked by:** none · **Component:** docs · **Priority:** P0 · **Agents:** docs-dev

#### Problem statement

CLAUDE.md's "MANDATORY: Settings UI Pattern" section cites `docs/specs/settings-ui.md` five times as the place that holds the rationale, the rejected alternatives and §5 on the breakpoint gates; `docs/ARCHITECTURE.md` (lines ~899 and ~992), `docs/TESTING.md` (~910) and `apps/web/src/pages/Admin/EmailSettingsPage.tsx` link it too. The file does not exist. This epic adds three settings surfaces (E01-07/08/09) whose issues instruct agents to follow that spec, so the dead link must become a real document before those children run.

#### Proposed solution

Write `docs/specs/settings-ui.md` (new) from the code as it is, not from memory. Sections:

1. **Purpose and scope** — the two hubs (`/admin/settings`, `/settings`), what "registry-driven hub" means, the epic #90 history (issues #91–#96) in two sentences.
2. **The five MANDATORY rules** — restate each rule from CLAUDE.md verbatim, then the rationale below it: (1) registry declaration first; (2) never a new tab on an existing settings page — the reachability-vs-content distinction with `UsersPage.tsx` (Users/Allowlist) as the legitimate tab example and `SystemSettingsPage`'s former three tabs as the anti-example; (3) the card `permission` is the controller's exact string, with the verified mapping (`system_settings:read/write` → `system-settings.controller.ts` and `email-settings.controller.ts`, `users:read` → `users.controller.ts`, `allowlist:read` gates content inside Users & Allowlist; after E01-04, `ai-settings.controller.ts`); (4) reuse `SettingsHub` — the 4-prop binding in `UserSettingsHubPage.tsx`; (5) the five coupled breakpoint gates.
3. **Registry shapes** — `SettingsCardDef` (`title, description, Icon, path?, disabled?, permission?, alwaysShow?`), `SettingsSectionDef`, `visibleSettingsSections(sections, hasPermission, query)` (title-only search, empty sections dropped, `alwaysShow` semantics), `settingsPageTitle(sections, hubPath, hubTitle, pathname)` (longest-prefix, segment-boundary, `null` outside the hub) — from `apps/web/src/config/adminSections.tsx`; `USER_SETTINGS_SECTIONS` declares data only and re-uses the helpers.
4. **`SettingsHub` props** — from `apps/web/src/components/settings/SettingsHub.tsx`: `sections`, `hubKey`, `title`, `subtitle`; what the component owns (search field, grouped grid ≥ sm, drill-down list < sm, scroll restoration keyed by `hubKey`).
5. **Breakpoints** — the five gates by file and expression (`Layout.tsx` `showRail` `up('sm')`; `BottomNav` `down('sm')`; `<main>` `pb: { xs: 10, sm: 3 }`; `SettingsHub.tsx` `isCompactWindow`; `AppBar.tsx` `isCompactWindow`), why `sm` (600) and not `md` (900), and why there is deliberately no shared constant (a constant would invite gating new things on it; the five are coupled by meaning, not by value). Note that a component-local `useMediaQuery(down('sm'))` for layout inside one page (e.g. `PersonaModelTable`, E01-07) is allowed and is not a sixth gate.
6. **Rejected alternatives** — tab strips per area; ungoverned routes (a route without a card is invisible to hub, rail and title); role-based gating instead of permission strings (the split-brain `destinations.ts` describes); gating at `md`; a second copy of the gate helpers for the user hub.
7. **Accessibility requirements** — hub cards are links with accessible names; search is a labelled `input type="search"`; the drill-down list uses list semantics; AppBar back arrow has `aria-label`; page titles come from the registry so `document.title`/heading match; axe runs in the page tests.
8. **Testing** — `apps/web/src/__tests__/config/settingsRegistry.test.ts`, `destinations.test.ts` (route ownership invariant that reads `App.tsx`), `components/settings/SettingsHub.test.tsx`; the visual harness (`apps/web/visual/main.tsx`, `tests/visual/`, pinned `mcr.microsoft.com/playwright:v1.62.1-noble`, `npm run test:update`).
9. **Adding a settings page (checklist)** — card → route → page → tests → visual baselines → docs, with the E01 cards as the worked example once they exist.

Cross-link: add the file to `docs/ARCHITECTURE.md`'s existing references (already linked), CLAUDE.md (already linked). No code changes.

**Data (database-dev)** — n/a. **API (backend-dev)** — n/a. **UI (frontend-dev)** — n/a. **Tests (testing-dev)** — n/a (docs). **Docs (docs-dev)** — as above.

#### Acceptance criteria

- [ ] `docs/specs/settings-ui.md` exists; every existing link to it resolves (`grep -rn "settings-ui.md" CLAUDE.md docs apps/web/src`).
- [ ] The five rules appear verbatim with rationale and rejected alternatives; §5 is the breakpoint section CLAUDE.md points to.
- [ ] Registry types, helper semantics and `SettingsHub` props match the current source (verified by reading `adminSections.tsx`, `userSettingsSections.tsx`, `SettingsHub.tsx`, `Layout.tsx`, `AppBar.tsx`).
- [ ] The accessibility and testing sections name real files.
- [ ] No other file is modified.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: n/a
- [ ] Observability: n/a
- [ ] Security: the permission-string rule and its verified mapping are documented
- [ ] Config & secrets: n/a
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed) — unaffected
- [ ] Docs updated

#### Manual test script

1. `grep -rn "settings-ui.md" CLAUDE.md docs apps/web/src` → every hit's relative link resolves to the new file.
2. Read §5 and confirm the five expressions match `apps/web/src/components/common/Layout.tsx`, `apps/web/src/components/navigation/BottomNav.tsx`, `apps/web/src/components/settings/SettingsHub.tsx`, `apps/web/src/components/navigation/AppBar.tsx`.

#### Out of scope

- Changing any rule; this documents what exists.
- Documenting the AI pages (E01-12 links them from here once they exist).

#### Notes for the implementing agent

- Source of truth is the code plus the file headers in `adminSections.tsx`, `userSettingsSections.tsx`, `SettingsHub.tsx`, `Layout.tsx` — they already contain most of the rationale; consolidate, do not paraphrase loosely.
- Keep section numbering stable: CLAUDE.md links "§5" for breakpoints.
- Commit as `docs(docs): create docs/specs/settings-ui.md`.

---

### E01-12 `docs(docs): document AI configuration, BYOK and the "Adding an AI persona" recipe`

**Part of epic:** E01 · **Blocked by:** E01-01, E01-02, E01-03, E01-04, E01-05, E01-06, E01-07, E01-08, E01-09, E01-10, E01-11 · **Component:** docs · **Priority:** P0 · **Agents:** docs-dev

#### Problem statement

Every later epic will call the gateway, add personas, and run e2e against the fake server. Without a spec, agents will re-derive decisions (platform-key fallback, catalog caching, gate mechanics) and drift. PRD §88/§117 also require the observability contract to be written down. This child makes the epic's decisions durable in the places agents actually read: CLAUDE.md, `docs/API.md`, `docs/specs/*`, `docs/SECURITY-ARCHITECTURE.md`, `docs/TESTING.md`, `.env.example`.

#### Proposed solution

**Data (database-dev)** — n/a. **API (backend-dev)** — n/a. **UI (frontend-dev)** — n/a. **Tests (testing-dev)** — n/a.

**Docs (docs-dev)**

1. `docs/API.md`:
   - New section **"AI Settings (Admin)"** after "Settings": `GET /ai-settings`, `PUT /ai-settings` (If-Match, write-only `platformApiKey`, 400 model < 5.4, 409), `GET /ai-settings/personas`, `GET /ai-settings/models?refresh=` (200 always, filter, `source`, 429 on refresh), `POST /ai-settings/test` (200 always, `checks`, 429). Request/response JSON examples with the DTO shapes from E01-04.
   - New section **"AI Key (current user)"**: `GET/PUT/DELETE /me/ai-key`, `POST /me/ai-key/test`, with the note that the key is never returned and `lastTest` is derived from `ai_invocations`.
   - `GET /auth/me` example gains `"aiKey": { "configured": true, "hint": "••••abcd" }`.
   - "Error Codes" table: `AI_KEY_REQUIRED` | 412 | The caller has no OpenAI key; complete `/setup/ai-key`. "Rate Limits": replace the "not implemented" note's absolute claim with the per-user, per-process throttles on `/ai-settings/test` (5/min), `/ai-settings/models?refresh=true` (10/min), `/me/ai-key/test` (5/min), `Retry-After` header.
2. `CLAUDE.md`:
   - "API Endpoints (MVP)": subsections **AI Settings (Admin)** and **AI Key (current user)** listing the nine routes; `GET /api/auth/me` note.
   - "Database Tables": `ai_invocations` (if E01-01 did not already add it, add; otherwise expand to "…model, tokens, latency, validation result, redacted I/O; never chain of thought").
   - "Environment Variables": new **AI** block — `OPENAI_BASE_URL` (default `https://api.openai.com/v1`; the fake server overlay sets `http://fake-openai:8089/v1`), `AI_REQUEST_TIMEOUT_MS` (default 60000), `AI_MAX_IMAGE_BYTES` (default 20971520), `AI_MAX_IMAGES_PER_CALL` (default 10); and a sentence under `SECRETS_ENCRYPTION_KEY` that it now also protects the platform and per-user OpenAI keys.
   - "Security Guidelines": bullet "OpenAI keys (platform and per-user) are encrypted in `credentials`, write-only through the API, redacted from every error, log, audit row and `ai_invocations` row; the gateway uses only the caller's key".
   - "Common Patterns": new recipe **"Adding an AI persona"** modelled on "Adding a Notification", three steps: (1) add the entry to `AI_PERSONAS` in `apps/api/src/ai/ai-personas.ts` and the key to `PERSONA_KEYS` (label/description are user-facing copy on the admin page; `tier` guides the admin's model choice; declare `vision` only if the persona will receive attachments) — no migration, the admin page and `GET /ai-settings/personas` pick it up; (2) define the output contract as a Zod object with explicit keys (no `z.record`, no unions of objects — strict mode) and a versioned prompt (`'<persona>.v1'`) beside the caller; (3) call `AiGatewayService.invoke({ persona, userId, promptVersion, instructions, input, attachments?, schema, schemaName })` from a service whose module `imports: [AiModule]`, branch on `result.ok`, keep the deterministic path working when `ok:false` (PRD §120), and never persist AI output without user approval where PRD §15 applies. Point at `AiAdminTestService` as the smallest worked example of a call.
   - "Specialized Subagents" unchanged.
3. `docs/specs/ai-configuration.md` (new): goals; the settings row `'ai'` and its schema; platform vs user key addresses and why two purposes; the admin endpoints and the catalog (live, 5-min TTL, invalidated on save, never stored — storing it would bump `version` and 409 every save); the ≥ 5.4 filter rules with the test table; test semantics (refuse-as-result, probe, throttle buckets and the per-process caveat with `@nestjs/throttler` as upgrade); the web gate mechanics (`aiKey` on `/auth/me`, `RequireAiKey`, exempt routes, 412 handling); **decisions and rejected alternatives**: a `user_credentials` table (rejected — `credentials` already keyed by purpose/name with sub-keys), caching the catalog in the settings row (rejected — version churn), platform-key fallback for keyless users (rejected — cost attribution and the gate's promise), gate via a separate `/me/ai-key` fetch on boot (rejected — waterfall and the visual harness's fake `AuthContext`), client-side video sampling (rejected — E03 samples server-side so the gateway sees the same frames every time); **user deletion note**: any future hard-delete must call `UserAiKeyService.deleteForUser(userId)` (credentials have no FK to users); the manual E2E script (link to `docs/epics/E01-ai-configuration-byok.md`).
4. `docs/specs/ai-gateway.md` (new): the `invoke` contract (types verbatim from E01-06), the step order, error codes and what callers should do for each, the `ai_invocations` row and what is/isn't stored, the OTel span attributes, the log line format, attachments (inline mode, limits, video frame shape from E03), `AiKeyRequiredException`/`assertAiKeyAvailable`, and "how to test a caller" (override `OpenAiProvider` in `createTestApp`, or run against the fake server).
5. `docs/SECURITY-ARCHITECTURE.md`: in §14 "Encrypted Credential Storage" add **"BYOK lifecycle"**: creation (`PUT /me/ai-key`, audit `ai_user_key:set`), use (gateway `getSecret` at the moment of the call, never cached), test (`ai_user_key:test`), removal (`ai_user_key:delete`, idempotent), key rotation runbook link, what is redacted where, and that keys never enter `system_settings`, logs, spans or `ai_invocations`.
6. `docs/TESTING.md`: E2E section — the fake OpenAI server (`tools/fake-openai/server.mjs`), the Compose overlay, `x-fake-behaviour`, `withAiKey` in `loginAsTestUser`; API section — overriding `OpenAiProvider`/`CredentialsService` in integration specs (`apps/api/test/ai/*.integration.spec.ts` as examples); web section — the AI MSW handlers and `setAiKeyConfigured`.
7. `infra/compose/.env.example`: an **AI** block with the four variables above, comments on the line above each value, **no trailing comments after values** (the file header explains why); note that `OPENAI_BASE_URL` is normally unset.
8. `docs/ARCHITECTURE.md`: route table gains `/setup/ai-key`, `/settings/ai-key`, `/admin/settings/ai`; module list gains `AiModule`; a short "AI gateway" paragraph linking the two specs.
9. `docs/epics/README.md` and `ROADMAP.md`: back-link E01's verification script and mark this child in Scope when it closes (per the maintenance rule).

#### Acceptance criteria

- [ ] `docs/API.md` documents all nine AI endpoints, the `aiKey` field on `/auth/me`, the 412 code and the three throttles with examples matching the implemented DTOs.
- [ ] CLAUDE.md lists the endpoints, the table, the four env vars, the security bullet and the "Adding an AI persona" recipe; the recipe's three steps name real files and the real `invoke` signature.
- [ ] `docs/specs/ai-configuration.md` and `docs/specs/ai-gateway.md` exist and record the decisions and rejected alternatives above, the throttle caveat, the user-deletion note and the manual script link.
- [ ] `docs/SECURITY-ARCHITECTURE.md` §14 has the BYOK lifecycle; `docs/TESTING.md` covers the fake server, `withAiKey`, provider overrides and MSW handlers.
- [ ] `.env.example` has the AI block with no trailing comments after values.
- [ ] Every file path and symbol named in the docs exists in the repo (`grep` spot-check listed in the manual script).

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: n/a
- [ ] Observability: PRD §88 field list mapped to `ai_invocations` columns and span attributes in `ai-gateway.md`
- [ ] Security: BYOK lifecycle and redaction rules documented
- [ ] Config & secrets: env block documented in CLAUDE.md, `.env.example`, `SECURITY-ARCHITECTURE.md` config reference
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed) — unaffected
- [ ] Docs updated

#### Manual test script

1. `grep -n "ai-settings\|me/ai-key\|AI_KEY_REQUIRED" docs/API.md CLAUDE.md` → all present.
2. `grep -n "OPENAI_BASE_URL\|AI_REQUEST_TIMEOUT_MS\|AI_MAX_IMAGE_BYTES\|AI_MAX_IMAGES_PER_CALL" infra/compose/.env.example CLAUDE.md docs/SECURITY-ARCHITECTURE.md` → present in all three; `grep -nE "^[A-Z_]+=.*\s#" infra/compose/.env.example` → no output (no trailing comments).
3. For every backticked path in the two new specs: `test -e <path>` succeeds (write a one-line shell loop over `grep -oE 'apps/[^` ]+|tools/[^` ]+|tests/[^` ]+'`).
4. Run the epic's manual script once more from step 4 onward with the docs open; every UI string quoted in the docs matches the screen.

#### Out of scope

- Documenting later epics' callers.
- API reference generation changes (`/api/docs` is generated from decorators).

#### Notes for the implementing agent

- Model the recipe on CLAUDE.md "Adding a Notification" (same voice, three numbered steps, "live examples" line).
- CLAUDE.md is read by every agent; keep additions tight and put narrative in the specs.
- `docs/API.md` uses `#### METHOD /path` headings and JSON blocks; follow it exactly so the table of contents stays consistent.
- Do not restate `apps/cli/README.md` or `docs/specs/vps-deploy.md` content; link.
