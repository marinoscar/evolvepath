import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { AiKeyRedactor } from './ai-key-redactor';

// =============================================================================
// AiInvocationLogService (issue #26, epic #20)
// =============================================================================
//
// The durable half of PRD §88: one `ai_invocations` row per AI call, on every
// exit path. This service owns the two rules the table's comments delegate to
// "the writer":
//
//   1. REDACTION. Every string that lands in the row — the error message and
//      both JSON blobs — goes through `AiKeyRedactor` first. The blobs are
//      redacted RECURSIVELY, because a key can end up nested inside a
//      structured payload (a caller quoting a curl command, a model echoing an
//      instruction) where a top-level scrub would miss it. The blobs use
//      `scrub`, not `apply`: they are bounded as a whole below, and capping each
//      string at the error-message length would silently truncate a long system
//      prompt.
//
//   2. CAPS. `errorMessage` at 2000 chars (the redactor's own cap), and each
//      JSON blob at 32 KiB. The column is `@db.Text`/`jsonb` with no bound by
//      design — a database-side limit would truncate mid-key and leave a
//      fragment behind — so the bound lives here, applied after the scrub.
//
// AND ONE MORE, WHICH IS WHY THIS IS A SERVICE AND NOT A `prisma.create` AT THE
// CALL SITE: A FAILED TELEMETRY WRITE MUST NEVER FAIL THE CALL. A database
// hiccup while recording a successful coaching reply must not turn it into a
// 500 for the user. The write is awaited (so a test can assert it) and its
// rejection is logged and swallowed.
// =============================================================================

/** 32 KiB, measured in UTF-16 code units — the cheap bound, not the exact one. */
const MAX_JSON_CHARS = 32 * 1024;

export interface AiInvocationRecord {
  invocationId: string;
  operation: 'invoke' | 'test_connection';
  keyScope: 'user' | 'platform';
  userId: string | null;
  persona: string | null;
  provider: string;
  model: string | null;
  promptVersion: string | null;
  requestId: string | null;
  providerRequestId: string | null;
  status: 'succeeded' | 'failed' | 'invalid_output' | 'refused';
  errorCode: string | null;
  errorMessage: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  reasoningTokens: number | null;
  latencyMs: number;
  outputValid: boolean | null;
  attachmentCount: number;
  input: unknown;
  output: unknown;
  /** Registered with the redactor so an echoed key cannot survive into the row. */
  secrets?: Array<string | null | undefined>;
}

@Injectable()
export class AiInvocationLogService {
  private readonly logger = new Logger(AiInvocationLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(record: AiInvocationRecord): Promise<void> {
    const redactor = new AiKeyRedactor();
    for (const secret of record.secrets ?? []) redactor.protect(secret);

    try {
      await this.prisma.aiInvocation.create({
        data: {
          id: record.invocationId,
          operation: record.operation,
          keyScope: record.keyScope,
          userId: record.userId,
          persona: record.persona,
          provider: record.provider,
          model: record.model,
          promptVersion: record.promptVersion,
          requestId: record.requestId,
          providerRequestId: record.providerRequestId,
          status: record.status,
          errorCode: record.errorCode,
          errorMessage: record.errorMessage
            ? redactor.apply(record.errorMessage)
            : null,
          inputTokens: record.inputTokens,
          outputTokens: record.outputTokens,
          cachedInputTokens: record.cachedInputTokens,
          reasoningTokens: record.reasoningTokens,
          latencyMs: record.latencyMs,
          outputValid: record.outputValid,
          attachmentCount: record.attachmentCount,
          input: this.prepareJson(record.input, redactor),
          output: this.prepareJson(record.output, redactor),
        },
      });
    } catch (err) {
      // Swallowed on purpose. See the header: telemetry must not fail the call.
      this.logger.warn(
        `Could not record AI invocation ${record.invocationId}: ${err instanceof Error ? err.name : 'unknown error'}`,
      );
    }
  }

  /**
   * Redact recursively, then cap.
   *
   * The cap is checked against the SERIALISED form, because that is what the
   * column stores; when it is exceeded the whole value is replaced by a marker
   * plus a short preview rather than being truncated. A truncated JSON document
   * is not JSON, and a `jsonb` column would reject it — so "keep the first 32
   * KiB" is not actually an option here even if it were desirable.
   */
  private prepareJson(
    value: unknown,
    redactor: AiKeyRedactor,
  ): Prisma.InputJsonValue | undefined {
    if (value === undefined || value === null) return undefined;

    const redacted = this.redactDeep(value, redactor);
    const serialised = JSON.stringify(redacted) ?? 'null';

    if (serialised.length <= MAX_JSON_CHARS) {
      return redacted as Prisma.InputJsonValue;
    }

    return {
      _truncated: true,
      preview: serialised.slice(0, 1024),
    } as unknown as Prisma.InputJsonValue;
  }

  /**
   * Scrub every string in a structure, keys included.
   *
   * Keys as well as values because a caller building a payload from user input
   * can produce an object keyed by something it does not control.
   */
  private redactDeep(value: unknown, redactor: AiKeyRedactor): unknown {
    // `scrub`, not `apply`: the blob is bounded as a whole at 32 KiB below, and
    // capping each string at the error-message length would silently truncate a
    // long system prompt — the exact "structured input" PRD §88 wants readable.
    if (typeof value === 'string') return redactor.scrub(value);

    if (Array.isArray(value)) {
      return value.map((item) => this.redactDeep(item, redactor));
    }

    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        out[redactor.scrub(key)] = this.redactDeep(item, redactor);
      }
      return out;
    }

    return value;
  }
}
