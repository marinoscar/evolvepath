import { z } from 'zod';

import { PERSONA_KEYS } from './ai-personas';

// =============================================================================
// AI settings — shape and validation (issue #22, epic #20)
// =============================================================================
//
// The admin-configurable half of the AI connection: which provider, whether it
// is on, where it lives, and which model each persona uses. Everything here is
// ORDINARY CONFIGURATION and is safe to return from an admin endpoint (#24).
//
// NO API KEY IS HERE, AND NONE MUST EVER BE ADDED — neither the platform key
// nor a user's. They live in the encrypted credential store at
// `(purpose 'ai:openai', name 'platform')` and `(purpose 'ai:openai:user',
// name <userId>)` respectively. The reasoning is mechanical and is spelled out
// at length in `email-settings.schema.ts`, which this file deliberately
// mirrors: this object is persisted as a settings blob and returned wholesale
// by the settings endpoints, so a secret in it is one careless response away
// from exposure. There is a compile-time proof of the absence at the bottom.
//
// Stored in its OWN `system_settings` row under key `'ai'`, never inside the
// `'global'` blob — see the header of `email-settings.service.ts` for why that
// blob eats foreign keys on every write.
// =============================================================================

/**
 * Providers this app can talk to, as a value.
 *
 * ONE ENTRY, ON PURPOSE. Epic #20 scopes a second provider out explicitly; the
 * enum exists so that adding Anthropic later widens the type in one edit and
 * every `switch` that lacks the new arm fails typecheck, rather than the
 * provider being a bare `string` that silently accepts anything.
 */
export const AI_PROVIDER_KINDS = ['openai'] as const;

/** A configured provider. See {@link AI_PROVIDER_KINDS}. */
export type AiProviderKind = (typeof AI_PROVIDER_KINDS)[number];

export const aiSettingsSchema = z.object({
  /**
   * Which provider to use. `null` means "no provider chosen", which is the
   * state of every fresh installation.
   *
   * NULLABLE RATHER THAN OPTIONAL, for the reason `emailSettingsSchema` gives:
   * "the admin has not picked one" is a real, persisted state the settings
   * page renders, not an absent key whose meaning has to be guessed.
   */
  provider: z.enum(AI_PROVIDER_KINDS).nullable(),

  /**
   * Master switch. The gateway refuses with `ai_disabled` while this is false.
   *
   * A separate axis from `provider` so an administrator can switch AI off —
   * during an incident, or while a bill is investigated — without losing the
   * per-persona model choices they would otherwise have to rebuild.
   */
  enabled: z.boolean(),

  /**
   * Override for the provider's base URL.
   *
   * Absent means "use `OPENAI_BASE_URL` from the environment", which is the
   * normal case. It exists for a proxy and for the fake OpenAI server the e2e
   * suite runs against (#30).
   *
   * The HTTPS-IN-PRODUCTION RULE IS NOT HERE. It is enforced by
   * `AiSettingsService.update` (#24), because it depends on `NODE_ENV`, and a
   * schema that reads process state is a schema that validates differently
   * depending on where it runs — including in a test that never intended to
   * assert deployment policy.
   */
  baseUrl: z.url().optional(),

  /**
   * The model used by any persona that has not been given one of its own.
   *
   * `null` is "not chosen yet": a fresh install has no catalog to choose from
   * until a platform key is saved and `/ai-settings/models` can be refreshed.
   */
  defaultModel: z.string().trim().min(1).nullable(),

  /**
   * Per-persona overrides, sparse: an absent key means "use `defaultModel`".
   *
   * SPARSE AND PARTIAL ON PURPOSE. Materialising all eight keys would mean
   * that adding a persona (#32's recipe, one registry entry) suddenly requires
   * a data migration over every installation's settings row to add its key.
   * Absent-means-default is the same contract notification preferences use.
   *
   * `z.partialRecord` with `z.enum(PERSONA_KEYS)` is what makes
   * `{ bogus: 'gpt-5.4' }` a parse failure rather than a stored key nothing
   * will ever read — the 400 E01-04 (#24) returns.
   *
   * The value is nullable as well as absent-able: `null` is what the admin
   * page sends when a persona is switched back to "Use default", and it is
   * distinguishable from "never touched" only in that it round-trips through
   * the form. Both resolve to `defaultModel`.
   */
  personaModels: z.partialRecord(
    z.enum(PERSONA_KEYS),
    z.string().trim().min(1).nullable(),
  ),
});

/** Validated AI settings. */
export type AiSettings = z.infer<typeof aiSettingsSchema>;

/**
 * What a system with no AI configuration looks like.
 *
 * Not `{}`: `provider`, `enabled`, `defaultModel` and `personaModels` are all
 * required by the schema, so the "nothing configured yet" state is spelled out
 * rather than being an invalid object that only survives because nobody
 * validates it.
 */
export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: null,
  enabled: false,
  defaultModel: null,
  personaModels: {},
};

/**
 * The `system_settings.key` this configuration is stored under.
 *
 * Exported so the write path (#24) and every test fixture address the same row
 * by the same constant rather than by a repeated string literal.
 */
export const AI_SETTINGS_KEY = 'ai';

// -----------------------------------------------------------------------------
// Compile-time proof that no secret-bearing field crept in
// -----------------------------------------------------------------------------
//
// The same technique as `EmailSettingsCarriesNoSecret`. Adding `apiKey` (or any
// of the other names below) to the schema above makes this type resolve to
// `never`, and the file stops compiling — a build break at the moment of the
// mistake, rather than a security review that has to notice a new optional
// string.
//
// If you are here because this line went red: you are trying to put a key into
// a settings blob. Use CredentialsService instead.

type SecretFieldNames =
  | 'apiKey'
  | 'platformApiKey'
  | 'secret'
  | 'password'
  | 'token';

export type AiSettingsCarriesNoSecret =
  Extract<keyof AiSettings, SecretFieldNames> extends never ? true : never;

export const AI_SETTINGS_CARRIES_NO_SECRET: AiSettingsCarriesNoSecret = true;
