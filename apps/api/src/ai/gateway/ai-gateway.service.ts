import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';

import { findPersona } from '../ai-personas';
import { AiSettingsService } from '../ai-settings.service';
import { UserAiKeyService } from '../user-key/user-ai-key.service';
import { AiProviderRegistry } from '../providers/ai-provider.registry';
import type {
  AiContentPart,
  AiGenerateResponse,
  AiUsage,
} from '../providers/ai-provider.interface';
import { AiAttachmentResolverService } from '../attachments/ai-attachment-resolver.service';
import { AiProviderError, type AiErrorCode } from './ai-errors';
import { AiKeyRedactor } from './ai-key-redactor';
import { AiInvocationLogService } from './ai-invocation-log.service';
import { toOpenAiStrictSchema } from './strict-json-schema';
import type { AiInvokeRequest, AiInvokeResult } from './ai-gateway.types';

// =============================================================================
// AiGatewayService — the one AI call in this product (issue #26, epic #20)
// =============================================================================
//
// PRD §115 fixes the shape of every AI workflow: scoped context → policy →
// structured contract → validate → persist only valid output → log. §88 fixes
// what must be logged, §117 that prompt versions are captured, §120 that
// deterministic features keep working when the model does not. Every later epic
// needs all of that, so it is implemented ONCE, here, and no caller in E02–E12
// ever touches a key, a provider, a JSON schema or a telemetry row.
//
// -----------------------------------------------------------------------------
// IT DOES NOT THROW. THAT IS THE CONTRACT.
// -----------------------------------------------------------------------------
//
// Not for a missing key, a disabled provider, an unconfigured model, a refused
// attachment, a rate limit, a timeout, a refusal or output that fails
// validation. Every one of those is `{ ok: false, error: { code } }`, because
// PRD §120 requires the deterministic path to keep working — and a caller
// cannot keep working around an exception it has to remember to catch.
//
// THE ONE EXCEPTION is an unknown persona in step 1. That cannot happen with a
// `PersonaKey`-typed call, so reaching it means a caller cast a string; it is a
// programmer error and is thrown as one rather than being logged as a provider
// failure that will read like a transient outage.
//
// -----------------------------------------------------------------------------
// THE USER'S KEY, ONLY, ALWAYS
// -----------------------------------------------------------------------------
//
// `userAiKey.getSecretForUser` and nothing else. There is deliberately no
// platform-key fallback: it would break cost attribution, and it would quietly
// break the promise the setup gate (#29) makes to a user who has just been told
// their own key is required. A unit test asserts that the platform credential
// address is never read from this file.
// =============================================================================

const tracer = trace.getTracer('evolvepath-api');

@Injectable()
export class AiGatewayService {
  private readonly logger = new Logger(AiGatewayService.name);

  constructor(
    private readonly settings: AiSettingsService,
    private readonly userAiKey: UserAiKeyService,
    private readonly providers: AiProviderRegistry,
    private readonly attachments: AiAttachmentResolverService,
    private readonly log: AiInvocationLogService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Make one structured AI call on behalf of a user.
   *
   * Steps, in order, each failure short-circuiting to a logged `ok: false`:
   *
   *   1. resolve the persona (throws for an unknown one — see the header)
   *   2. read the settings; refuse when no provider is chosen or AI is off
   *   3. resolve the model for this persona; refuse when there is none
   *   4. read the CALLER'S key; refuse when they have none
   *   5. resolve attachments, refusing them outright for a non-vision persona
   *   6. call the provider inside an `ai.invoke` span
   *   7. interpret the answer: refusal, no output, unparseable, schema-invalid
   *   8. success
   *
   * Exactly one `ai_invocations` row is written on every one of those exits.
   *
   * @returns a discriminated union. `ok: true` narrows `output` to `T`; a caller
   *          cannot read the output without first handling the failure.
   */
  async invoke<T>(req: AiInvokeRequest<T>): Promise<AiInvokeResult<T>> {
    // Generated UP FRONT so the span, the provider-side metadata and the
    // database row all carry the same id and can be joined after the fact.
    const invocationId = randomUUID();
    const startedAt = Date.now();

    const persona = findPersona(req.persona);

    if (!persona) {
      // The one throw. See the header.
      throw new Error(
        `Unknown AI persona "${req.persona}". Add it to AI_PERSONAS before invoking it.`,
      );
    }

    // ---- 2. settings ------------------------------------------------------

    let settings;
    try {
      settings = await this.settings.get();
    } catch {
      return this.fail(req, invocationId, startedAt, null, {
        code: 'ai_disabled',
        message:
          'AI settings could not be read. An administrator needs to re-save the AI configuration.',
      });
    }

    if (settings.provider === null || !settings.enabled) {
      return this.fail(req, invocationId, startedAt, null, {
        code: 'ai_disabled',
        message: 'AI is not configured or is switched off for this deployment.',
      });
    }

    // ---- 3. model ---------------------------------------------------------

    const model = this.settings.resolveModel(settings, req.persona);

    if (!model) {
      return this.fail(req, invocationId, startedAt, null, {
        code: 'no_model',
        message: `No model is configured for persona ${req.persona} and no default model is set.`,
      });
    }

    // ---- 4. the caller's key ---------------------------------------------

    const apiKey = await this.userAiKey.getSecretForUser(req.userId);

    if (!apiKey) {
      return this.fail(req, invocationId, startedAt, model, {
        code: 'no_user_key',
        message: 'No OpenAI API key is saved for this account.',
      });
    }

    // Registered the instant we hold it, before anything that can throw while
    // holding it — the same rule the email transports follow.
    const redactor = new AiKeyRedactor();
    redactor.protect(apiKey);

    // ---- 5. attachments ---------------------------------------------------

    let attachmentParts: AiContentPart[] = [];

    if (req.attachments?.length) {
      if (!persona.capabilities.includes('vision')) {
        // Refused BEFORE a single byte is fetched from storage: a persona that
        // cannot see is not billed for downloading images it will not receive.
        return this.fail(req, invocationId, startedAt, model, {
          code: 'attachment',
          message: `Persona ${req.persona} does not accept attachments.`,
        });
      }

      try {
        attachmentParts = await this.attachments.resolve(
          req.userId,
          req.attachments,
        );
      } catch (err) {
        return this.fail(
          req,
          invocationId,
          startedAt,
          model,
          this.describeError(err, redactor),
        );
      }
    }

    // ---- 6. the provider call --------------------------------------------

    // Converted OUTSIDE the span, deliberately: a schema this converter refuses
    // (a record, a union of objects) is a programmer error at the call site, and
    // running it inside the span would dress it up as a provider failure.
    const jsonSchema = {
      name: req.schemaName,
      schema: toOpenAiStrictSchema(req.schema),
    };

    const provider = this.providers.get(settings.provider);
    const baseUrl = this.settings.resolveBaseUrl(settings);
    const timeoutMs = this.config.get<number>('ai.requestTimeoutMs') ?? 60000;

    return tracer.startActiveSpan(
      'ai.invoke',
      { kind: SpanKind.CLIENT },
      // The return type is annotated because TypeScript widens `ok: true` to
      // `boolean` in an inferred async callback, which then fails to satisfy the
      // discriminated union the whole contract depends on.
      async (span): Promise<AiInvokeResult<T>> => {
        // ATTRIBUTES ONLY, NEVER CONTENT. No instructions, no input, no output:
        // spans are exported to a third-party backend, and this product's
        // prompts carry a user's health, family and work context.
        span.setAttributes({
          'gen_ai.system': 'openai',
          'gen_ai.operation.name': 'chat',
          'gen_ai.request.model': model,
          'ai.persona': req.persona,
          'ai.prompt_version': req.promptVersion,
          'ai.key_scope': 'user',
          'ai.invocation_id': invocationId,
          'ai.attachment_count': attachmentParts.length,
          'enduser.id': req.userId,
        });

        let response: AiGenerateResponse;

        try {
          response = await provider.generate(
            { apiKey, baseUrl },
            {
              model,
              instructions: req.instructions,
              input: [{ type: 'text', text: req.input }, ...attachmentParts],
              jsonSchema,
              maxOutputTokens: req.maxOutputTokens,
              reasoningEffort:
                req.reasoningEffort ?? persona.defaultReasoningEffort,
              timeoutMs,
              // The only join between a provider-side log and our row.
              metadata: {
                invocationId,
                persona: req.persona,
                promptVersion: req.promptVersion,
              },
            },
          );
        } catch (err) {
          const error = this.describeError(err, redactor);
          span.setAttributes({ 'ai.status': 'failed', 'ai.error_code': error.code });
          span.setStatus({ code: SpanStatusCode.ERROR, message: error.code });
          span.end();

          return this.fail(req, invocationId, startedAt, model, error, {
            attachmentCount: attachmentParts.length,
            secrets: [apiKey],
          });
        }

        span.setAttributes({
          'gen_ai.response.model': response.responseModel ?? model,
          'gen_ai.usage.input_tokens': response.usage.inputTokens,
          'gen_ai.usage.output_tokens': response.usage.outputTokens,
        });

        const outcome = this.interpret(response, req, redactor);

        span.setAttribute('ai.status', outcome.status);
        if (outcome.status !== 'succeeded') {
          span.setAttribute('ai.error_code', outcome.error.code);
        }
        // OK, unconditionally. ERROR status is set only on the provider-failure
        // path above: a refusal and an answer that fails validation are things
        // the model DID, and the call itself worked. Marking them as span errors
        // would make every alert on error rate fire on model behaviour rather
        // than on outages.
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();

        const latencyMs = Date.now() - startedAt;

        if (outcome.status === 'succeeded') {
          this.logLine(req, invocationId, model, 'succeeded', latencyMs, response.usage);

          await this.recordSafely({
            invocationId,
            operation: 'invoke',
            keyScope: 'user',
            userId: req.userId,
            persona: req.persona,
            provider: 'openai',
            model,
            promptVersion: req.promptVersion,
            requestId: req.requestId ?? null,
            providerRequestId: response.providerRequestId,
            status: 'succeeded',
            errorCode: null,
            errorMessage: null,
            inputTokens: response.usage.inputTokens,
            outputTokens: response.usage.outputTokens,
            cachedInputTokens: response.usage.cachedInputTokens,
            reasoningTokens: response.usage.reasoningTokens,
            latencyMs,
            outputValid: true,
            attachmentCount: attachmentParts.length,
            input: this.describeInput(req),
            output: outcome.output,
            safetyDecision: req.safetyDecision ?? null,
            secrets: [apiKey],
          });

          return {
            ok: true,
            invocationId,
            output: outcome.output as T,
            usage: response.usage,
            model,
            latencyMs,
          };
        }

        return this.fail(req, invocationId, startedAt, model, outcome.error, {
          status: outcome.status,
          attachmentCount: attachmentParts.length,
          providerRequestId: response.providerRequestId,
          usage: response.usage,
          outputValid: false,
          output: outcome.rawOutput,
          secrets: [apiKey],
        });
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Interpreting one provider answer
  // ---------------------------------------------------------------------------

  private interpret<T>(
    response: AiGenerateResponse,
    req: AiInvokeRequest<T>,
    redactor: AiKeyRedactor,
  ):
    | { status: 'succeeded'; output: unknown; error?: undefined; rawOutput?: undefined }
    | {
        status: 'refused' | 'invalid_output';
        error: { code: AiErrorCode; message: string };
        rawOutput: unknown;
        output?: undefined;
      } {
    if (response.refusal) {
      return {
        status: 'refused',
        error: { code: 'refusal', message: redactor.apply(response.refusal) },
        // The refusal text, which is the model's own words to the user and is
        // safe to keep. NOT reasoning: a refusal is an output, not a thought.
        rawOutput: { refusal: redactor.apply(response.refusal) },
      };
    }

    if (response.outputText === null || response.incompleteReason) {
      return {
        status: 'invalid_output',
        error: {
          code: 'schema',
          message: `Model returned no output (${response.incompleteReason ?? 'unknown'}).`,
        },
        rawOutput: response.outputText ? { raw: response.outputText } : null,
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.outputText);
    } catch {
      return {
        status: 'invalid_output',
        error: {
          code: 'schema',
          message: 'Model output was not valid JSON.',
        },
        rawOutput: { raw: response.outputText },
      };
    }

    const validated = req.schema.safeParse(parsed);

    if (!validated.success) {
      // FIELD PATHS ONLY, never the received values — the same rule the settings
      // services follow. Zod's own messages can quote what it saw, and what it
      // saw is model output about a user's private context.
      const paths = validated.error.issues
        .map((issue) => issue.path.join('.') || '(root)')
        .join(', ');

      return {
        status: 'invalid_output',
        error: {
          code: 'schema',
          message: `Model output did not match the expected contract at: ${paths}.`,
        },
        rawOutput: { raw: response.outputText },
      };
    }

    return { status: 'succeeded', output: validated.data };
  }

  // ---------------------------------------------------------------------------
  // Failure bookkeeping
  // ---------------------------------------------------------------------------

  /** Record a failed exit and return it. Every `ok: false` goes through here. */
  private async fail<T>(
    req: AiInvokeRequest<T>,
    invocationId: string,
    startedAt: number,
    model: string | null,
    error: { code: AiErrorCode; message: string },
    extra: {
      status?: 'failed' | 'refused' | 'invalid_output';
      attachmentCount?: number;
      providerRequestId?: string | null;
      usage?: AiUsage;
      outputValid?: boolean | null;
      output?: unknown;
      secrets?: Array<string | null | undefined>;
    } = {},
  ): Promise<AiInvokeResult<T>> {
    const latencyMs = Date.now() - startedAt;
    const status = extra.status ?? 'failed';

    this.logLine(req, invocationId, model, status, latencyMs, extra.usage);

    await this.recordSafely({
      invocationId,
      operation: 'invoke',
      keyScope: 'user',
      userId: req.userId,
      persona: req.persona,
      provider: 'openai',
      model,
      promptVersion: req.promptVersion,
      requestId: req.requestId ?? null,
      providerRequestId: extra.providerRequestId ?? null,
      status,
      errorCode: error.code,
      errorMessage: error.message,
      inputTokens: extra.usage?.inputTokens ?? null,
      outputTokens: extra.usage?.outputTokens ?? null,
      cachedInputTokens: extra.usage?.cachedInputTokens ?? null,
      reasoningTokens: extra.usage?.reasoningTokens ?? null,
      latencyMs,
      outputValid: extra.outputValid ?? null,
      attachmentCount: extra.attachmentCount ?? req.attachments?.length ?? 0,
      input: this.describeInput(req),
      output: extra.output ?? null,
      safetyDecision: req.safetyDecision ?? null,
      secrets: extra.secrets,
    });

    return { ok: false, invocationId, error, model, latencyMs };
  }

  /**
   * Write the telemetry row, and never let its failure escape.
   *
   * `AiInvocationLogService.record` already swallows its own database errors,
   * so this is belt AND braces — deliberately. The never-throw contract in the
   * header is this class's promise, and a promise that holds only because
   * ANOTHER class remembers to catch is one refactor away from being false.
   * A caller relying on PRD §120's deterministic fallback would then see an
   * exception from a code path that exists to prevent exactly that.
   */
  private async recordSafely(
    record: Parameters<AiInvocationLogService['record']>[0],
  ): Promise<void> {
    try {
      await this.log.record(record);
    } catch (err) {
      this.logger.warn(
        `Could not record AI invocation ${record.invocationId}: ${err instanceof Error ? err.name : 'unknown error'}`,
      );
    }
  }

  /**
   * What went into the call, for the row's `input` column.
   *
   * The prompt and the user turn ARE stored — that is deliberate and is what
   * makes a bad answer diagnosable (PRD §88 asks for "structured input and
   * output"). Attachments are recorded by ID ONLY: the bytes are already in
   * storage, and copying twenty megabytes of image into a telemetry row would
   * be both useless and expensive. The logger redacts and caps this.
   */
  private describeInput<T>(req: AiInvokeRequest<T>): unknown {
    return {
      instructions: req.instructions,
      input: req.input,
      attachments: (req.attachments ?? []).map((a) => a.storageObjectId),
      schemaName: req.schemaName,
    };
  }

  private describeError(
    err: unknown,
    redactor: AiKeyRedactor,
  ): { code: AiErrorCode; message: string } {
    if (err instanceof AiProviderError) {
      // Already redacted by the provider's mapper; re-applied because this
      // redactor also holds the user's key, which that mapper did not.
      return { code: err.code, message: redactor.apply(err.message) };
    }

    // Not a provider failure: a bug. Its text has not been through any
    // redactor, so it is deliberately not surfaced.
    this.logger.error(
      `Unexpected error during AI invoke: ${err instanceof Error ? err.name : 'unknown error'}`,
    );

    return { code: 'provider', message: 'The AI call failed unexpectedly.' };
  }

  /**
   * One line per call.
   *
   * IDS AND COUNTS ONLY — no prompt, no output, no key. Application logs are
   * shipped, indexed and retained far more widely than the telemetry table is.
   */
  private logLine<T>(
    req: AiInvokeRequest<T>,
    invocationId: string,
    model: string | null,
    status: string,
    latencyMs: number,
    usage?: AiUsage,
  ): void {
    const line =
      `AI invoke id=${invocationId} persona=${req.persona} model=${model ?? 'none'} ` +
      `scope=user status=${status} latencyMs=${latencyMs} ` +
      `tokens=${usage?.inputTokens ?? 0}/${usage?.outputTokens ?? 0} user=${req.userId}`;

    if (status === 'succeeded') {
      this.logger.log(line);
    } else {
      this.logger.warn(line);
    }
  }
}
