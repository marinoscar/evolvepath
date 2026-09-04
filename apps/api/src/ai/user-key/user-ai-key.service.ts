import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { CredentialsService } from '../../credentials/credentials.service';
import {
  AI_USER_CREDENTIAL_LABEL,
  AI_USER_CREDENTIAL_PURPOSE,
} from '../ai-credential.constants';
import { AiSettingsService } from '../ai-settings.service';
import { runConnectionChecks } from '../connection-probe';
import { AiProviderRegistry } from '../providers/ai-provider.registry';
import type { AiTestResult } from '../dto/ai-test-result.dto';
import type { UserAiKeyStatus } from './dto/user-ai-key-status.dto';

// =============================================================================
// UserAiKeyService — bring your own key (issue #25, epic #20)
// =============================================================================
//
// Every user of EvolvePath brings their own OpenAI key. That is a product-owner
// constraint, and PRD §118's cost strategy and PRD §85's "the user controls what
// the AI holds" both follow from it.
//
// OWNERSHIP IS BY CONSTRUCTION, NOT BY CHECK. Every method takes a `userId`
// that the controller reads from `@CurrentUser('id')`; there is no `:userId`
// route parameter anywhere, so there is no path on which one user can address
// another's key and therefore no ownership check to forget. That is why these
// endpoints carry a plain `@Auth()` and no permission: the resource is the
// caller's own, which is the same rule `PatController` follows.
//
// The key lives at `(purpose 'ai:openai:user', name '<userId>')`, a DIFFERENT
// purpose from the platform key, so the two are encrypted under different
// derived sub-keys and a row moved between them does not decrypt. See
// `ai-credential.constants.ts`.
// =============================================================================

@Injectable()
export class UserAiKeyService {
  private readonly logger = new Logger(UserAiKeyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: CredentialsService,
    private readonly settings: AiSettingsService,
    private readonly providers: AiProviderRegistry,
    private readonly config: ConfigService,
  ) {}

  /**
   * The masked description of a user's stored key.
   *
   * The narrow read `GET /api/auth/me` uses on every page load, so it does one
   * credential lookup and no settings read.
   */
  async describe(
    userId: string,
  ): Promise<{ configured: boolean; hint: string | null; updatedAt: Date | null }> {
    const info = await this.credentials.describe(
      AI_USER_CREDENTIAL_PURPOSE,
      userId,
    );

    return {
      configured: info !== null,
      hint: info?.hint ?? null,
      updatedAt: info?.updatedAt ?? null,
    };
  }

  /** Everything `GET /api/me/ai-key` renders. */
  async status(userId: string): Promise<UserAiKeyStatus> {
    const [described, lastInvocation] = await Promise.all([
      this.describe(userId),
      this.prisma.aiInvocation.findFirst({
        where: { userId, operation: 'test_connection', keyScope: 'user' },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      configured: described.configured,
      hint: described.hint,
      updatedAt: described.updatedAt ? described.updatedAt.toISOString() : null,
      lastTest: lastInvocation
        ? {
            attemptedAt: lastInvocation.createdAt.toISOString(),
            success: lastInvocation.status === 'succeeded',
            model: lastInvocation.model,
            error: lastInvocation.errorMessage,
          }
        : null,
      platform: await this.describePlatform(),
    };
  }

  /**
   * Store or replace a user's key.
   *
   * NOT TRIMMED SERVER-SIDE. The form trims before submitting, and
   * `CredentialsService` stores byte-for-byte by design — silently altering a
   * secret's bytes produces an authentication failure with no visible cause.
   * The DTO rejects internal whitespace outright, which is the real failure
   * mode a trim would be papering over.
   *
   * @param actorUserId who performed the write. Defaults to the owner; the
   *                    parameter exists so a future support flow is auditable
   *                    as itself rather than masquerading as the user.
   */
  async set(
    userId: string,
    apiKey: string,
    actorUserId: string = userId,
  ): Promise<void> {
    const replaced =
      (await this.credentials.describe(AI_USER_CREDENTIAL_PURPOSE, userId)) !==
      null;

    await this.credentials.setSecret(AI_USER_CREDENTIAL_PURPOSE, userId, apiKey, {
      label: AI_USER_CREDENTIAL_LABEL,
      updatedByUserId: actorUserId,
    });

    await this.prisma.auditEvent.create({
      data: {
        actorUserId,
        action: 'ai_user_key:set',
        targetType: 'user',
        targetId: userId,
        // WHETHER a key was replaced, never which one and never its hint. A
        // hint in an audit row narrows a brute force over a stored value for
        // anyone who can read the audit trail.
        meta: { replaced } as unknown as Prisma.InputJsonValue,
      },
    });

    this.logger.log(
      `AI key ${replaced ? 'replaced' : 'stored'} for user ${userId}`,
    );
  }

  /**
   * Remove a user's key. Idempotent.
   *
   * EXISTS FROM DAY ONE, before anything but the settings page calls it,
   * because `credentials` has NO foreign key to `users`: a future hard-delete
   * of an account will not cascade to the key, and must call this. That is
   * recorded in `docs/specs/ai-configuration.md` as well as here.
   */
  async deleteForUser(
    userId: string,
    actorUserId: string = userId,
  ): Promise<void> {
    const existed =
      (await this.credentials.describe(AI_USER_CREDENTIAL_PURPOSE, userId)) !==
      null;

    await this.credentials.deleteSecret(AI_USER_CREDENTIAL_PURPOSE, userId);

    // Only audit a real removal. A DELETE against an address that held nothing
    // is a no-op, and recording it would fill the trail with events describing
    // nothing — including every repeat of an idempotent retry.
    if (existed) {
      await this.prisma.auditEvent.create({
        data: {
          actorUserId,
          action: 'ai_user_key:delete',
          targetType: 'user',
          targetId: userId,
          meta: {} as unknown as Prisma.InputJsonValue,
        },
      });

      this.logger.log(`AI key removed for user ${userId}`);
    }
  }

  /**
   * The plaintext key, for the gateway's use at the moment of a call.
   *
   * THE ONLY READ PATH FOR PLAINTEXT IN THIS PRODUCT, and deliberately a
   * separate method from everything above so that every caller of it is visible
   * in one search. The gateway (#26) fetches it per call and never caches it.
   */
  async getSecretForUser(userId: string): Promise<string | null> {
    return this.credentials.getSecret(AI_USER_CREDENTIAL_PURPOSE, userId);
  }

  /**
   * "Does my key work?"
   *
   * Runs the SAME two probes as the admin test (`connection-probe.ts`) with the
   * USER'S key, so the two answers mean the same thing. The generate probe is
   * skipped unless the administrator has configured a provider, enabled it and
   * chosen a default model — a user cannot be asked to diagnose an empty model
   * selection they do not control.
   *
   * NEVER THROWS for a provider problem: a refused connection is the diagnosis.
   */
  async test(userId: string): Promise<AiTestResult> {
    const startedAt = Date.now();

    const apiKey = await this.getSecretForUser(userId);

    if (!apiKey) {
      return this.record(userId, startedAt, {
        success: false,
        providerKind: null,
        model: null,
        error: 'No OpenAI API key is saved for your account.',
        errorCode: 'no_user_key',
        checks: { listModels: 'skipped', generate: 'skipped' },
      });
    }

    let settings;
    try {
      settings = await this.settings.get();
    } catch {
      settings = null;
    }

    // The key itself can still be proven even when the platform is
    // unconfigured: `listModels` needs no model and no provider selection, only
    // a base URL. So the test runs, and only the generate probe is skipped.
    const providerKind = settings?.provider ?? 'openai';
    const probeModel =
      settings &&
      settings.provider === 'openai' &&
      settings.enabled &&
      settings.defaultModel
        ? settings.defaultModel
        : null;

    const outcome = await runConnectionChecks(
      this.providers.get(providerKind),
      {
        apiKey,
        baseUrl: this.settings.resolveBaseUrl(
          settings ?? { provider: null, enabled: false, defaultModel: null, personaModels: {} },
        ),
      },
      probeModel,
      this.config.get<number>('ai.requestTimeoutMs') ?? 60000,
    );

    const success =
      outcome.checks.listModels === 'passed' &&
      outcome.checks.generate !== 'failed';

    return this.record(userId, startedAt, {
      success,
      providerKind: settings?.provider ?? null,
      model: outcome.model,
      error: outcome.error,
      errorCode: outcome.errorCode,
      checks: outcome.checks,
      providerRequestId: outcome.providerRequestId,
      inputTokens: outcome.inputTokens,
      outputTokens: outcome.outputTokens,
    });
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * What the administrator has configured, as far as this user needs to know.
   *
   * Wrapped in try/catch so an unreadable settings row degrades to "nothing is
   * configured" rather than making a user's own key page un-renderable over a
   * problem only an administrator can fix.
   */
  private async describePlatform(): Promise<UserAiKeyStatus['platform']> {
    try {
      const settings = await this.settings.get();
      return {
        provider: settings.provider,
        enabled: settings.enabled,
        hasDefaultModel: settings.defaultModel !== null,
      };
    } catch {
      return { provider: null, enabled: false, hasDefaultModel: false };
    }
  }

  /**
   * Persist one test attempt and return the result.
   *
   * Every exit path goes through here, including the "no key saved" one, and
   * telemetry failures are swallowed — the same contract `AiAdminTestService`
   * documents at length. `keyScope: 'user'` is what distinguishes these rows
   * from the platform tests in the same table.
   */
  private async record(
    userId: string,
    startedAt: number,
    outcome: {
      success: boolean;
      providerKind: 'openai' | null;
      model: string | null;
      error: string | null;
      errorCode: string | null;
      checks: AiTestResult['checks'];
      providerRequestId?: string | null;
      inputTokens?: number | null;
      outputTokens?: number | null;
    },
  ): Promise<AiTestResult> {
    const latencyMs = Date.now() - startedAt;

    const result: AiTestResult = {
      success: outcome.success,
      providerKind: outcome.providerKind,
      model: outcome.model,
      latencyMs,
      error: outcome.error,
      attemptedAt: new Date().toISOString(),
      checks: outcome.checks,
    };

    this.logger.log(
      `AI test scope=user status=${outcome.success ? 'succeeded' : 'failed'} latencyMs=${latencyMs} user=${userId}`,
    );

    try {
      await this.prisma.aiInvocation.create({
        data: {
          operation: 'test_connection',
          keyScope: 'user',
          userId,
          provider: outcome.providerKind ?? 'openai',
          model: outcome.model,
          providerRequestId: outcome.providerRequestId ?? null,
          status: outcome.success ? 'succeeded' : 'failed',
          errorCode: outcome.errorCode,
          // Already redacted: it came from AiProviderError, whose message is
          // built through AiKeyRedactor, or it is one of this file's literals.
          errorMessage: outcome.error,
          inputTokens: outcome.inputTokens ?? null,
          outputTokens: outcome.outputTokens ?? null,
          latencyMs,
        },
      });

      await this.prisma.auditEvent.create({
        data: {
          actorUserId: userId,
          action: 'ai_user_key:test',
          targetType: 'user',
          targetId: userId,
          meta: {
            success: outcome.success,
            checks: outcome.checks,
            model: outcome.model,
            error: outcome.error,
          } as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Could not record the AI key test: ${err instanceof Error ? err.name : 'unknown error'}`,
      );
    }

    return result;
  }
}
