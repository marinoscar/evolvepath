// =============================================================================
// The copywriter's output contract (issue #59, epic E12)
// =============================================================================
//
// Explicit keys, no records, no unions — the strict-mode rules in
// `docs/specs/ai-gateway.md`. The maxima are not stylistic: an OS notification
// elides a title at roughly 60 characters and a body at roughly 140, so copy
// over the cap is copy the user never reads the end of. Rejecting it here means
// the deterministic template is used instead of a truncated sentence.

import { z } from 'zod';

import {
  COPY_ACTION_LABEL_MAX,
  COPY_BODY_MAX,
  COPY_TITLE_MAX,
} from '../coaching-events';

export const NOTIFICATION_COPY_PROMPT_VERSION = 'notification-copy.v1';
export const NOTIFICATION_COPY_SCHEMA_NAME = 'notification_copy';

export const notificationCopySchema = z.object({
  title: z.string().min(1).max(COPY_TITLE_MAX),
  body: z.string().min(1).max(COPY_BODY_MAX),
  actionLabel: z.string().min(1).max(COPY_ACTION_LABEL_MAX),
});

export type NotificationCopy = z.infer<typeof notificationCopySchema>;
