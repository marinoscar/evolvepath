import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * `GET /notifications/metrics` — query and response (issue #69, epic E12).
 *
 * The window is bounded at both ends for different reasons: below seven days
 * every rate is noise (a cap of four a day means a handful of sends), and above
 * 180 the aggregation walks rows nobody is asking a question about. Neither
 * bound is arbitrary and neither is a performance guess — they are the range in
 * which the numbers mean something.
 */
export const notificationMetricsQuerySchema = z.object({
  days: z.coerce.number().int().min(7).max(180).default(30),
});

export class NotificationMetricsQueryDto extends createZodDto(
  notificationMetricsQuerySchema,
) {}

const suppressCountsSchema = z.object({
  QUIET_HOURS: z.number().int(),
  DAILY_CAP: z.number().int(),
  WEEKLY_CAP: z.number().int(),
  PER_COMMITMENT_MAX: z.number().int(),
  SKIPPED: z.number().int(),
  MUTED: z.number().int(),
  DOMAIN_PAUSED: z.number().int(),
  FATIGUE: z.number().int(),
  ALREADY_DONE: z.number().int(),
});

const notificationMetricsSchema = z.object({
  window: z.object({
    from: z.iso.datetime(),
    to: z.iso.datetime(),
    days: z.number().int(),
  }),
  perEvent: z.array(
    z.object({
      eventKey: z.string(),
      category: z.string().nullable(),
      sent: z.number().int(),
      opened: z.number().int(),
      actioned: z.number().int(),
      dismissed: z.number().int(),
      ignored: z.number().int(),
      suppressed: suppressCountsSchema,
      actionRate: z.number().nullable(),
      bestLeadMinutes: z.number().int().nullable(),
    }),
  ),
  /**
   * PRD §65. The value `GET /progress` exposes as `independence.ratio` — one
   * formula, one home, so the two screens cannot disagree about it.
   */
  independence: z.object({
    completions: z.number().int(),
    unprompted: z.number().int(),
    ratio: z.number().nullable(),
  }),
  reminderTrend: z.array(
    z.object({
      month: z.string(),
      domain: z.enum(['WORK', 'FAMILY', 'HEALTH']),
      sent: z.number().int(),
      completions: z.number().int(),
    }),
  ),
  insights: z.array(z.string()),
});

export class NotificationMetricsDto extends createZodDto(notificationMetricsSchema) {}
