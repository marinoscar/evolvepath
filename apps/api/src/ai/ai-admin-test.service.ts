import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { CredentialsService } from '../credentials/credentials.service';
import {
  AI_PLATFORM_CREDENTIAL_NAME,
  AI_PLATFORM_CREDENTIAL_PURPOSE,
} from './ai-credential.constants';
import { AiSettingsService } from './ai-settings.service';
import { runConnectionChecks } from './connection-probe';
import { AiProviderRegistry } from './providers/ai-provider.registry';
import type { AiTestResult } from './dto/ai-test-result.dto';

// =============================================================================
// AiAdminTestService — the "Test connection" button (issue #24, epic #20)
// =============================================================================
//
// THIS IS A DIAGNOSTIC, and every decision below follows from that — the same
// argument `email/email-test-send.service.ts` makes for mail.
//
// IT RETURNS A RESULT; IT DOES NOT THROW. A refused connection is a successful
// diagnosis. Configuration problems detected before a provider is reached — no
// provider chosen, AI switched off, no platform key — come back through the
// same `{ success: false, error }` shape as a 401 from OpenAI, because to the
// administrator they are all the same question ("why doesn't this work?") and
// answering some of them through the error envelope would mean the page needs
// two code paths to display one sentence.
//
// IT USES THE PLATFORM KEY, NEVER A USER'S. `keyScope: 'platform'` on the
// telemetry row records that, and the user-key test (#25) is the mirror image.
// =============================================================================

@Injectable()
export class AiAdminTestService {
  private readonly logger = new Logger(AiAdminTestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AiSettingsService,
    private readonly credentials: CredentialsService,
    private readonly providers: AiProviderRegistry,
    private readonly config: ConfigService,
  ) {}

  async testConnection(actor: { id: string; email: string }): Promise<AiTestResult> {
    const startedAt = Date.now();

    // ---- Refuse-as-result, before anything touches the network -------------

    let settings;
    try {
      settings = await this.settings.get();
    } catch {
      return this.record(actor, startedAt, {
        success: false,
        providerKind: null,
        model: null,
        error:
          'The stored AI configuration could not be read. Save the settings again to repair it.',
        errorCode: 'ai_disabled',
        checks: { listModels: 'skipped', generate: 'skipped' },
      });
    }

    if (settings.provider === null) {
      return this.record(actor, startedAt, {
        success: false,
        providerKind: null,
        model: null,
        error:
          'No AI provider is selected. Choose OpenAI, save, then test again.',
        errorCode: 'ai_disabled',
        checks: { listModels: 'skipped', generate: 'skipped' },
      });
    }

    if (!settings.enabled) {
      return this.record(actor, startedAt, {
        success: false,
        providerKind: settings.provider,
        model: null,
        error: 'AI is switched off. Enable it, save, then test again.',
        errorCode: 'ai_disabled',
        checks: { listModels: 'skipped', generate: 'skipped' },
      });
    }

    const apiKey = await this.credentials.getSecret(
      AI_PLATFORM_CREDENTIAL_PURPOSE,
      AI_PLATFORM_CREDENTIAL_NAME,
    );

    if (!apiKey) {
      return this.record(actor, startedAt, {
        success: false,
        providerKind: settings.provider,
        model: null,
        error: 'No platform API key is configured. Save one, then test again.',
        errorCode: 'auth',
        checks: { listModels: 'skipped', generate: 'skipped' },
      });
    }

    // ---- The probes --------------------------------------------------------

    const outcome = await runConnectionChecks(
      this.providers.get(settings.provider),
      { apiKey, baseUrl: this.settings.resolveBaseUrl(settings) },
      settings.defaultModel,
      this.config.get<number>('ai.requestTimeoutMs') ?? 60000,
    );

    // `success` is every check that RAN. A skipped generate does not make the
    // test fail — see the connection-probe header.
    const success =
      outcome.checks.listModels === 'passed' &&
      outcome.checks.generate !== 'failed';

    return this.record(actor, startedAt, {
      success,
      providerKind: settings.provider,
      model: outcome.model,
      error: outcome.error,
      errorCode: outcome.errorCode,
      checks: outcome.checks,
      providerRequestId: outcome.providerRequestId,
      inputTokens: outcome.inputTokens,
      outputTokens: outcome.outputTokens,
    });
  }

  /**
   * Persist one attempt and return the result.
   *
   * EVERY exit path goes through here, including the four that never reach the
   * network: "the administrator pressed Test and nothing happened because AI is
   * off" is exactly the fact an audit trail and a telemetry table are for, and
   * a branch that returned early without recording is how that stops being
   * true.
   *
   * Telemetry failures are swallowed. A database hiccup writing an audit row
   * must not turn a successful diagnosis into a 500 on the page that was
   * diagnosing.
   */
  private async record(
    actor: { id: string; email: string },
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
    const attemptedAt = new Date();

    const result: AiTestResult = {
      success: outcome.success,
      providerKind: outcome.providerKind,
      model: outcome.model,
      latencyMs,
      error: outcome.error,
      attemptedAt: attemptedAt.toISOString(),
      checks: outcome.checks,
    };

    this.logger.log(
      `AI test scope=platform status=${outcome.success ? 'succeeded' : 'failed'} latencyMs=${latencyMs} user=${actor.id}`,
    );

    try {
      await this.prisma.aiInvocation.create({
        data: {
          operation: 'test_connection',
          keyScope: 'platform',
          userId: actor.id,
          provider: outcome.providerKind ?? 'openai',
          model: outcome.model,
          providerRequestId: outcome.providerRequestId ?? null,
          status: outcome.success ? 'succeeded' : 'failed',
          errorCode: outcome.errorCode,
          // Already redacted: it came from AiProviderError, whose message is
          // built by `mapOpenAiFailure` through AiKeyRedactor, or it is one of
          // this file's own literals.
          errorMessage: outcome.error,
          inputTokens: outcome.inputTokens ?? null,
          outputTokens: outcome.outputTokens ?? null,
          latencyMs,
        },
      });

      await this.prisma.auditEvent.create({
        data: {
          actorUserId: actor.id,
          action: 'ai_settings:test',
          targetType: 'system_settings',
          // No settings row is guaranteed to exist (a test on a fresh install
          // fails before one is written), and `targetId` is non-nullable, so
          // the stable settings key names the target.
          targetId: 'ai',
          meta: {
            success: outcome.success,
            providerKind: outcome.providerKind,
            model: outcome.model,
            checks: outcome.checks,
            error: outcome.error,
          } as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Could not record the AI connection test: ${err instanceof Error ? err.name : 'unknown error'}`,
      );
    }

    return result;
  }
}
