import type { ZodType } from 'zod';

import type { AiReasoningEffort, PersonaKey } from '../ai-personas';
import type { AiErrorCode } from './ai-errors';
import type {
  AiImageDetail,
  AiUsage,
} from '../providers/ai-provider.interface';

// =============================================================================
// The gateway contract (issue #26, epic #20)
// =============================================================================
//
// FROZEN FOR E02–E12. Every AI-using feature in this product calls
// `AiGatewayService.invoke()` with these types; the epic says so explicitly, and
// changing them is a change to every caller at once. Add optional fields; do not
// repurpose existing ones.
//
// The shape encodes the rules the product cannot afford to leave to convention:
//
//   • `schema` is REQUIRED. There is no free-text mode (PRD §115, §16). A caller
//     that wants prose asks for `{ text: string }`.
//   • `promptVersion` is REQUIRED, and is captured on the telemetry row and the
//     span (PRD §117). It is what makes "did the coach get worse after we
//     changed the prompt?" answerable.
//   • `userId` is REQUIRED and is whose key pays. There is no platform-key
//     fallback (epic #20's scope section says so): a keyless caller gets
//     `no_user_key`, not somebody else's bill.
//   • The result is a DISCRIMINATED UNION, not `{ output?, error? }`. `ok: true`
//     narrows `output` to `T`, so a caller cannot read a possibly-absent output
//     without first handling the failure PRD §120 requires them to handle.
// =============================================================================

/** One stored object to show the model. Vision personas only. */
export interface AiAttachment {
  storageObjectId: string;
  detail?: AiImageDetail;
}

export interface AiInvokeRequest<T> {
  persona: PersonaKey;

  /** Whose key pays, and whose data this is. */
  userId: string;

  /**
   * e.g. `'planner.v1'`. Captured on the row and the span (PRD §117).
   *
   * Bump it whenever `instructions` changes meaningfully; that is the whole
   * point, and there is no way for this layer to detect it for you.
   */
  promptVersion: string;

  /** The system/developer prompt. */
  instructions: string;

  /** The user-turn text. Attachments travel separately. */
  input: string;

  /** Images to include. Refused for a persona that does not declare `vision`. */
  attachments?: AiAttachment[];

  /** The output contract. Validated before the caller ever sees `output`. */
  schema: ZodType<T>;

  /** `json_schema.name` on the wire: `^[a-zA-Z0-9_-]{1,64}$`. */
  schemaName: string;

  maxOutputTokens?: number;

  /** Defaults to the persona's `defaultReasoningEffort`. */
  reasoningEffort?: AiReasoningEffort;

  /** The HTTP request id, when called from a request scope. Joins the app logs. */
  requestId?: string;
}

/**
 * The outcome. Never a thrown exception for anything on this list.
 *
 * `invocationId` is present on BOTH arms: it is the row in `ai_invocations` and
 * the `ai.invocation_id` on the span, so a support conversation about a failure
 * has something to quote.
 */
export type AiInvokeResult<T> =
  | {
      ok: true;
      invocationId: string;
      output: T;
      usage: AiUsage;
      model: string;
      latencyMs: number;
    }
  | {
      ok: false;
      invocationId: string;
      error: { code: AiErrorCode; message: string };
      model: string | null;
      latencyMs: number;
    };
