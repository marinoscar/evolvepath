import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import type { z } from 'zod';

import { PrismaService } from '../prisma/prisma.service';
import { CredentialsService } from '../credentials/credentials.service';
import type { PersonaKey } from './ai-personas';
import {
  AI_SETTINGS_KEY,
  DEFAULT_AI_SETTINGS,
  type AiSettings,
  aiSettingsSchema,
} from './ai-settings.schema';
import {
  AI_PLATFORM_CREDENTIAL_LABEL,
  AI_PLATFORM_CREDENTIAL_NAME,
  AI_PLATFORM_CREDENTIAL_PURPOSE,
} from './ai-credential.constants';
import { isSupportedModelId } from './model-catalog/model-version-filter';
import type { UpdateAiSettingsInput } from './dto/update-ai-settings.dto';

// =============================================================================
// AiSettingsService (issue #24, epic #20)
// =============================================================================
//
// Where the AI configuration is read from and written to. Structurally a twin
// of `email/email-settings.service.ts`, and deliberately so: the same
// own-settings-row, blank-preserves, secret-first, If-Match story, proven by an
// existing feature rather than reinvented. Read that file's header for why the
// row is its own `system_settings` key rather than a field inside the `'global'`
// blob — the blob rebuilds itself on every write and would eat this.
// =============================================================================

/** The masked view of the stored platform key that the admin page renders. */
export interface AiPlatformKeyStatus {
  configured: boolean;
  /** The store's own mask, e.g. `••••0000`. Null when nothing is stored. */
  hint: string | null;
  updatedAt: Date | null;
  updatedByUserId: string | null;
}

/** Everything `GET /api/ai-settings` renders. */
export interface AiSettingsAdminView extends AiSettings {
  platformKeyStatus: AiPlatformKeyStatus;
  /** Why the stored row would not parse. FIELD PATHS ONLY. Null normally. */
  settingsError: string | null;
  version: number;
  updatedAt: Date | null;
  updatedBy: { id: string; email: string } | null;
}

/**
 * A Zod failure rendered as the list of field paths that failed.
 *
 * PATHS, NEVER VALUES — the same rule `EmailSettingsService` follows. Zod's own
 * `message` strings can quote the received value, and one of the values in this
 * schema is a base URL that could carry a credential in its userinfo component.
 */
function describeInvalidPaths(error: z.ZodError): string {
  return error.issues
    .map((issue) => issue.path.join('.') || '(root)')
    .join(', ');
}

/**
 * Drop the settings fields an admin left empty.
 *
 * Only `baseUrl` is optional in this schema, but the function is written
 * generically (and exempts the fields where `null` is a real persisted state)
 * so that adding an optional field later does not require remembering this
 * step. See `stripUnsetSettingFields` in the email service for the full
 * argument.
 */
function stripUnsetSettingFields(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    // `null` is a REAL, PERSISTED STATE for these three: "no provider chosen",
    // "no default model chosen", and a persona explicitly set back to the
    // default. Stripping them would drop required keys and fail the parse.
    if (key === 'provider' || key === 'defaultModel' || key === 'personaModels') {
      out[key] = value;
      continue;
    }

    if (value === '' || value === null) continue;

    out[key] = value;
  }

  return out;
}

/** Is this submission "I did not retype the key"? Mirrors the credential store. */
function isBlankKey(value: string | null | undefined): boolean {
  return value === undefined || value === null || value === '';
}

@Injectable()
export class AiSettingsService {
  private readonly logger = new Logger(AiSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    // Only ever used through `setSecret` (write) and `describe` (masked read).
    // `getSecret` — the plaintext one — is never called from this file and must
    // not be: nothing on the settings path needs the key's value, and a call to
    // it here would put plaintext one careless `return` away from a response.
    private readonly credentials: CredentialsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Read the current AI configuration.
   *
   * @throws when a row exists but does not validate. The gateway (#26) catches
   *         this and reports `ai_disabled`; silently substituting defaults
   *         would report a corrupt row as the benign "AI is not configured".
   */
  async get(): Promise<AiSettings> {
    const row = await this.prisma.systemSettings.findUnique({
      where: { key: AI_SETTINGS_KEY },
      select: { value: true },
    });

    if (!row) return DEFAULT_AI_SETTINGS;

    const parsed = aiSettingsSchema.safeParse(row.value);

    if (!parsed.success) {
      const paths = describeInvalidPaths(parsed.error);
      this.logger.error(
        `Stored AI settings are invalid at: ${paths}. AI is unusable until they are saved again.`,
      );
      throw new Error(
        `Stored AI settings are invalid at: ${paths}. Re-save the AI configuration.`,
      );
    }

    return parsed.data;
  }

  /**
   * Everything `GET /api/ai-settings` renders.
   *
   * NEVER THROWS on an invalid stored row: it reports the problem in
   * `settingsError` and returns the defaults alongside it, so the broken row
   * does not take down the one screen capable of repairing it. See the same
   * method on `EmailSettingsService` for the full argument.
   */
  async describeForAdmin(): Promise<AiSettingsAdminView> {
    const row = await this.prisma.systemSettings.findUnique({
      where: { key: AI_SETTINGS_KEY },
      include: { updatedByUser: { select: { id: true, email: true } } },
    });

    let settings: AiSettings = DEFAULT_AI_SETTINGS;
    let settingsError: string | null = null;

    if (row) {
      const parsed = aiSettingsSchema.safeParse(row.value);

      if (parsed.success) {
        settings = parsed.data;
      } else {
        const paths = describeInvalidPaths(parsed.error);
        this.logger.error(
          `Stored AI settings are invalid at: ${paths}. Serving defaults to the settings page so they can be re-saved.`,
        );
        settingsError = `The stored AI configuration is invalid at: ${paths}. Correct those fields and save to repair it.`;
      }
    }

    return this.toAdminView(settings, settingsError, row);
  }

  /**
   * Replace the AI configuration (`PUT /api/ai-settings`).
   *
   * TWO DESTINATIONS, ONE SUBMISSION: the ordinary settings go to the `'ai'`
   * row of `system_settings`, the platform key goes to the encrypted credential
   * store and nowhere else.
   *
   * ORDER: validate, then key, then row. The key is written BEFORE the row for
   * the reason `EmailSettingsService.update` gives — `setSecret` can reject a
   * blank first write, and a row saved before that rejection would claim a key
   * that does not exist. The opposite partial failure is harmless: a stored key
   * no row points at yet is inert.
   */
  async update(
    input: UpdateAiSettingsInput,
    userId: string,
    expectedVersion?: number,
  ): Promise<AiSettingsAdminView> {
    // Destructured out FIRST so the key is a named local that never travels
    // with the rest of the body. `aiSettingsSchema.parse` below would strip it
    // anyway (Zod drops unknown keys) — that is the structural guarantee — but
    // relying on a silent strip to keep a secret out of a persisted blob is a
    // guarantee nobody reading the call site can see.
    const { platformApiKey, ...submitted } = input;

    const settings = aiSettingsSchema.parse(stripUnsetSettingFields(submitted));

    this.assertSupportedModels(settings);
    this.assertSecureBaseUrl(settings);

    const existing = await this.prisma.systemSettings.findUnique({
      where: { key: AI_SETTINGS_KEY },
      select: { version: true },
    });
    const currentVersion = existing?.version ?? 0;

    if (expectedVersion !== undefined && currentVersion !== expectedVersion) {
      throw new ConflictException(
        `AI settings version mismatch. Expected ${expectedVersion}, found ${currentVersion}`,
      );
    }

    const keySubmitted = !isBlankKey(platformApiKey);

    if (keySubmitted) {
      await this.credentials.setSecret(
        AI_PLATFORM_CREDENTIAL_PURPOSE,
        AI_PLATFORM_CREDENTIAL_NAME,
        // Passed through UNTOUCHED. Blank preserves; see the DTO header.
        platformApiKey,
        {
          label: AI_PLATFORM_CREDENTIAL_LABEL,
          updatedByUserId: userId,
        },
      );
    }

    const row = await this.prisma.systemSettings.upsert({
      where: { key: AI_SETTINGS_KEY },
      update: {
        value: settings as unknown as Prisma.InputJsonValue,
        updatedByUserId: userId,
        version: { increment: 1 },
      },
      create: {
        key: AI_SETTINGS_KEY,
        value: settings as unknown as Prisma.InputJsonValue,
        updatedByUserId: userId,
      },
      include: { updatedByUser: { select: { id: true, email: true } } },
    });

    await this.prisma.auditEvent.create({
      data: {
        actorUserId: userId,
        action: 'ai_settings:replace',
        targetType: 'system_settings',
        targetId: AI_SETTINGS_KEY,
        meta: {
          // SAFE TO RECORD IN FULL: `settings` is the output of
          // `aiSettingsSchema.parse`, and that schema carries a compile-time
          // proof that it has no secret-bearing field.
          provider: settings.provider,
          enabled: settings.enabled,
          defaultModel: settings.defaultModel,
          personaModels: settings.personaModels,
          // WHETHER the key changed, never what it changed to — and never the
          // hint either, which would narrow a brute force over a stored value.
          platformKeyReplaced: keySubmitted,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    this.logger.log(
      `AI settings replaced by user ${userId}` +
        (keySubmitted ? ' (platform key updated)' : ''),
    );

    return this.toAdminView(settings, null, row);
  }

  /**
   * Which model a persona should use: its own, or the default.
   *
   * THE ONE PLACE THAT PRECEDENCE IS EXPRESSED. The gateway (#26) and the admin
   * page both need the answer, and a second implementation is how "the page
   * showed gpt-5.4-mini and the call used gpt-5.4" happens. A persona entry
   * explicitly set to `null` ("use default") is indistinguishable from an
   * absent one here, which is exactly right.
   */
  resolveModel(settings: AiSettings, persona: PersonaKey): string | null {
    return settings.personaModels[persona] ?? settings.defaultModel;
  }

  /**
   * Where to send requests: the admin's override, or the environment default.
   *
   * Admin-over-environment because the override exists precisely for the cases
   * the environment cannot know about — an installation-specific proxy, and the
   * fake server the e2e suite points at.
   */
  resolveBaseUrl(settings: AiSettings): string {
    return (
      settings.baseUrl ??
      (this.config.get<string>('ai.openai.baseUrl') ??
        'https://api.openai.com/v1')
    );
  }

  // ---------------------------------------------------------------------------
  // Validation that cannot live in the schema
  // ---------------------------------------------------------------------------

  /**
   * Every named model must be one this product will talk to.
   *
   * NOT IN THE ZOD SCHEMA, on purpose: the schema also validates rows READ back
   * from the database, and a stored row naming a model that has since been
   * retired must degrade to `settingsError` on the admin page rather than
   * becoming unparseable. The floor is a WRITE-time rule.
   *
   * The message names the offending id and the requirement, because "invalid
   * model" leaves an administrator with no idea whether they mistyped, chose a
   * retired model, or hit a policy.
   */
  private assertSupportedModels(settings: AiSettings): void {
    const named: string[] = [];

    if (settings.defaultModel) named.push(settings.defaultModel);
    for (const model of Object.values(settings.personaModels)) {
      if (model) named.push(model);
    }

    for (const model of named) {
      if (!isSupportedModelId(model)) {
        throw new BadRequestException(
          `Model "${model}" is not supported: EvolvePath requires GPT 5.4 or newer.`,
        );
      }
    }
  }

  /**
   * In production, the provider must be reached over TLS.
   *
   * The key travels in an `Authorization` header on every request; a plaintext
   * base URL puts it on the wire. Enforced HERE rather than in the schema
   * because it depends on `NODE_ENV`, and a schema that reads process state
   * validates differently depending on where it runs — including in a test that
   * never intended to assert deployment policy.
   *
   * Development and test are exempt so the fake OpenAI server (#30) and a local
   * proxy work without a certificate.
   */
  private assertSecureBaseUrl(settings: AiSettings): void {
    if (!settings.baseUrl) return;
    if (this.config.get<string>('nodeEnv') !== 'production') return;

    if (!settings.baseUrl.startsWith('https://')) {
      throw new BadRequestException(
        'The AI base URL must use https:// in production: the API key is sent on every request.',
      );
    }
  }

  /**
   * Assemble the admin view from validated settings and the row they came from.
   *
   * Shared by `describeForAdmin` and `update` so a PUT's response is built by
   * the same code as the following GET — otherwise the page renders one shape
   * after saving and another after a reload.
   */
  private async toAdminView(
    settings: AiSettings,
    settingsError: string | null,
    row: {
      version: number;
      updatedAt: Date;
      updatedByUser: { id: string; email: string } | null;
    } | null,
  ): Promise<AiSettingsAdminView> {
    // The masked read. NOT `getSecret`: `describe` returns `CredentialInfo`,
    // which has no field able to carry secret material, and whose query does
    // not select the ciphertext column at all.
    const info = await this.credentials.describe(
      AI_PLATFORM_CREDENTIAL_PURPOSE,
      AI_PLATFORM_CREDENTIAL_NAME,
    );

    return {
      ...settings,
      platformKeyStatus: {
        configured: info !== null,
        hint: info?.hint ?? null,
        updatedAt: info?.updatedAt ?? null,
        updatedByUserId: info?.updatedByUserId ?? null,
      },
      settingsError,
      version: row?.version ?? 0,
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedByUser ?? null,
    };
  }
}
