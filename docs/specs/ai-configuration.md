# AI Configuration & Bring-Your-Own-Key

> **Status:** implemented by epic [#20](https://github.com/marinoscar/evolvepath/issues/20)
> (issues #21–#32). This file records the *decisions*; the call contract is
> [`ai-gateway.md`](ai-gateway.md), the endpoints are
> [`../API.md`](../API.md), and the UI pattern the two pages follow is
> [`settings-ui.md`](settings-ui.md).

---

## 1. Goals

Give EvolvePath a governed way to talk to an LLM *before* any product feature
needs one:

- An administrator connects OpenAI **once** — provider, platform key,
  per-persona model selection from a live catalog, and a test that reports the
  provider's real error.
- **Every user brings their own key**, gated at first sign-in with instructions
  and a test.
- Every AI call in the product goes through one gateway that enforces PRD §115
  (structured contract → validate → log), §88 (observability) and §120
  (deterministic logic survives an unavailable model).
- Keys are encrypted with the existing `CredentialsService`, never returned by
  any endpoint, and never logged.

---

## 2. Where the configuration lives

### The `'ai'` settings row

`system_settings` has a row of its own under key `'ai'`, validated by
`apps/api/src/ai/ai-settings.schema.ts`:

| Field | Meaning |
|---|---|
| `provider` | `'openai'` or `null` ("not chosen" — a persisted state, not an absent key) |
| `enabled` | Master switch, a **separate axis** from `provider` |
| `baseUrl` | Optional override; absent means `OPENAI_BASE_URL` |
| `defaultModel` | Used by any persona without one of its own |
| `personaModels` | **Sparse** per-persona overrides |

**Its own row, not a field in the `'global'` blob.** `SystemSettingsService`
rebuilds that blob field by field on every write (`parse` strips unknown keys;
`patch` hand-builds `{ ui, features }`), so an `ai` key inside it would be
silently destroyed the next time an administrator saved an unrelated setting.
The same argument `email-settings.service.ts` makes at length.

**`personaModels` is sparse on purpose.** An absent key means "use
`defaultModel`". Materialising all eight would make *adding a persona* a data
migration over every installation's settings row — which would break the epic's
headline promise that a persona costs one registry entry.

**`enabled` and `provider` are two fields, not a three-way choice.** "Off,
OpenAI retained" and "never configured" are genuinely different states;
collapsing them would cost an administrator their whole model configuration for
switching AI off during an incident.

### The two key addresses

| Key | Purpose | Name |
|---|---|---|
| Platform | `ai:openai` | `platform` |
| Per-user | `ai:openai:user` | `<userId>` |

**Two purposes, not one with two names.** `CredentialsService` derives a
distinct AES sub-key per purpose, so a row moved or copied between the two does
not decrypt. That is a mechanical barrier against a mix-up in which a user's key
serves the admin catalog or — far worse — one user's key serves another's call.

No migration was needed for per-user keys: the store is already keyed by an
arbitrary discriminator within a purpose, and a uuid is a perfectly good one.

---

## 3. The model catalog

Fetched live from the provider with the platform key, filtered to **GPT 5.4 or
newer**, sorted newest-first, cached **in memory for 5 minutes** and invalidated
on every settings save.

### The ≥ 5.4 rule

A **version floor plus a variant denylist**, not an id allowlist
(`model-catalog/model-version-filter.ts`). An allowlist goes stale the day
OpenAI ships a model, and going stale means an administrator cannot select a
model they are paying for until this repo is redeployed. The denylist keeps out
families that are structurally wrong for this product — realtime, audio,
embedding, moderation, instruct — matched against dash-separated *variant
tokens*, so `gpt-5.5-audio` is excluded and a hypothetical `gpt-5.5-audiophile`
is not.

The table the spec asserts:

| Id | | Why |
|---|---|---|
| `gpt-5.4` | ✓ | the floor |
| `gpt-5.4-mini` | ✓ | a cheaper sibling |
| `gpt-5.4-2026-03-01` | ✓ | a dated snapshot |
| `gpt-5.10` | ✓ | numeric minor compare, not string |
| `gpt-6` | ✓ | a bare major reads as 6.0 |
| `GPT-5.4` | ✓ | case-insensitive |
| `gpt-5.3` | ✗ | below the floor |
| `gpt-5` | ✗ | reads as 5.0, a real older model |
| `gpt-4o`, `gpt-4.1` | ✗ | below the floor |
| `o3` | ✗ | not a `gpt-` id |
| `chatgpt-5.4-latest` | ✗ | anchored at `gpt-` |
| `gpt-5.4-realtime-preview`, `gpt-5.5-audio` | ✗ | excluded variant token |

The **same function** gates the read and the write, so "the select offered it"
and "the save accepted it" can never disagree. The floor is a *write-time* rule
in the service rather than a schema rule, so a stored row naming a since-retired
model degrades to `settingsError` on the admin page instead of becoming
unparseable.

---

## 4. Test semantics

Both test endpoints **answer 200 in every configuration**, including failure. A
refused connection is a *successful diagnosis*, and it is the entire reason the
buttons exist: a wrong key, an ungranted model tier and a firewalled egress fail
differently, and only the provider's own text tells them apart. This app's error
envelope suppresses detail in production and the client funnels it into generic
failure handling, so the one useful fact would be the one fact lost.

**Two checks, reported separately** (`connection-probe.ts`, shared by both):

- `listModels` — validates the **key**. Costs no tokens.
- `generate` — validates the key **against the chosen model**, with a 16-token
  structured probe. Fails when the key is fine but the account has not been
  granted the model, which is the most confusing state to be in and the one a
  single boolean cannot express.

`'skipped'` is a first-class, non-failing outcome: a user testing their key
before an administrator has chosen a default model has nothing to generate
against, and reporting that as a failure sends them hunting for a problem that
does not exist. The user-facing copy says so explicitly.

### Throttles

Per user, per **process**: `admin_test` 5/min, `user_test` 5/min,
`models_refresh` 10/min. A refused attempt is a real 429 with `Retry-After` and
is **not audited** — it was refused rather than attempted, so there is no
diagnosis to record.

**The per-process scope is a documented limitation, not an oversight.** Two API
replicas allow twice the rate and a restart forgets everything. That is
acceptable for what this actually defends against — an accidental loop and a
bored click — and it buys the epic a throttle with no Redis and no shared-state
failure mode of its own. It is **not** a defence against a determined caller,
and nothing else should be built on it. `@nestjs/throttler` with a Redis store
is the upgrade path; the buckets are already named the way that migration would
want them.

---

## 5. The web gate

1. `GET /auth/me` carries `aiKey: { configured, hint }`.
2. `RequireAiKey` is a layout route between `ProtectedRoute` and the app shell.
3. A keyless user is redirected to `/setup/ai-key` with `state.from` carrying
   the route they asked for.
4. **Exempt routes: `/activate` and `/setup/ai-key`, and only those.** The first
   is a credential operation with nothing to do with AI; the second is the
   gate's own destination, and a gate that redirected its own target would loop.
5. `/settings/ai-key` is deliberately **inside** the gate, so removing a key
   returns the user to setup — which is what its confirm dialog promises.
6. A **412 `AI_KEY_REQUIRED`** dispatches a window event that `AuthContext`
   listens for and re-reads the user, so a key removed in another tab redirects
   this one on its next AI call.

**This is UX, not authorization.** The gateway's `no_user_key` and the server's
412 are the real gate; deleting `RequireAiKey` would make the app unpleasant,
not insecure.

---

## 6. Decisions and rejected alternatives

**A `user_credentials` table.** Rejected: `credentials` is already keyed by
`(purpose, name)` with per-purpose sub-keys, already audited, and already
carries a compile-time proof that its presentation type cannot hold secret
material. A second store would duplicate all of it and halve the scrutiny.

**Caching the catalog in the settings row.** Rejected for a mechanical reason:
that row carries the `version` counter the admin form uses for `If-Match`. A
background catalog write would bump it, and the administrator's next save would
409 against a change they never made and cannot see. The cache is derived data
with a provider as its source of truth; it does not belong in a versioned
document.

**A platform-key fallback for keyless users.** Rejected. It breaks cost
attribution — PRD §118's strategy is per user — and it quietly breaks the
promise the setup gate makes to somebody who has just been told their own key is
required. The gateway reads only `('ai:openai:user', userId)`, and a unit test
asserts the platform address is never reached from it.

**Gating the web app on a separate `GET /me/ai-key` at boot.** Rejected: a
waterfall in front of every page load, and the visual-regression harness fakes
`AuthContext` wholesale and would need a second fake to render anything at all.
The flag rides on a request the app already makes.

**Client-side video frame sampling.** Rejected: the model would see different
frames depending on the client, which makes a coaching answer irreproducible and
a bug report unactionable. E03 samples server-side, and the gateway reads the
frames it recorded.

**Enforcing an `sk-` prefix on a user's key.** Rejected: OpenAI has changed key
formats before and will again, and a server-side prefix rule turns that into an
outage for every user at once. The form shows a soft hint, which costs nothing
when it is wrong.

**Blank-preserves on the per-user key.** Rejected, unlike the platform key.
There is no surrounding form whose other fields a user might be editing, so an
empty submission is a mistake rather than "keep the stored one", and saying so is
more useful than silently succeeding.

---

## 7. User deletion

`credentials` has **no foreign key to `users`**, so deleting an account does not
cascade to its OpenAI key. Any future hard-delete **must** call
`UserAiKeyService.deleteForUser(userId)`. That method ships from day one for
exactly this reason, before anything but the settings page calls it.

By contrast `ai_invocations.user_id` is `ON DELETE SET NULL` rather than
`CASCADE`: deleting an account must not erase the record that those calls
happened or what they cost.

---

## 8. Verification

The epic's end-to-end script is in issue
[#20](https://github.com/marinoscar/evolvepath/issues/20). In short:

```bash
cd infra/compose
docker compose -f base.compose.yml -f dev.compose.yml -f fake-openai.compose.yml up --build
```

then, from each workspace: `npm test` in `apps/api`, `npm run test:run` in
`apps/web`, and `npx playwright test` in `tests/e2e`. The stand-in and its failure modes are
documented in [`../../tools/fake-openai/README.md`](../../tools/fake-openai/README.md);
the testing conventions are in [`../TESTING.md`](../TESTING.md).
