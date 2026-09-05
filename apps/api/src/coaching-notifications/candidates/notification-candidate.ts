// =============================================================================
// What the scanner produces (issue #59, epic E12)
// =============================================================================

import type { CoachingCategory, CoachingEventKey } from '../coaching-events';
import type { PolicyCommitment } from '../policy/notification-policy';

export interface NotificationCandidate {
  userId: string;
  eventKey: CoachingEventKey;
  category: CoachingCategory;
  /** When this message is *for*. Recorded as the decision's `scheduledFor`. */
  dueAt: Date;
  /**
   * The idempotency key. A PLAIN STRING with no structure parsed out of it —
   * the unique index `(user_id, event_key, dedupe_key)` is the lock, and the
   * engine can change how it identifies a candidate without a migration.
   *
   * Moment-bound categories (N1-N5, N7) use the commitment id, so they get
   * exactly ONE decision ever. Daily-retried ones (N6, N8, N9) append the local
   * date, so they get one decision per day until their source row goes away.
   */
  dedupeKey: string;
  commitmentId?: string;
  /** The facts `decide()` needs about the commitment, if there is one. */
  commitment?: PolicyCommitment;
  /** Everything the templates read, minus `sentInteractionId` and `copy`. */
  payload: Record<string, unknown>;
  /** For `meta.leadMinutes` on the interaction row. */
  leadMinutes?: number;
  /** The domain whose mode gates this candidate, when there is one. */
  domain?: 'WORK' | 'FAMILY' | 'HEALTH';
}
