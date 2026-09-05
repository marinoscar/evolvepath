import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * `POST /notifications/interactions/dismissed` — the service worker's report
 * (issue #64, epic E12).
 *
 * ONE FIELD, and the UUID is the entire capability. A dismissal happens with no
 * page open and therefore no session and no bearer token: `notificationclose`
 * fires in a service worker that may be the only thing running. The
 * alternatives are worse in both directions — never recording dismissals loses
 * the clearest signal a user gives about unwanted messages, and keeping a
 * credential inside a service worker puts one in the least protected place in
 * the browser.
 *
 * What the capability can do is deliberately almost nothing: it marks ONE
 * already-sent notification as dismissed. It reads nothing back, cannot be
 * enumerated (a v4 UUID), and replaying it writes one more row saying the same
 * thing.
 */
export const dismissInteractionSchema = z.object({
  sentInteractionId: z.uuid(),
});

export class DismissInteractionDto extends createZodDto(dismissInteractionSchema) {}
