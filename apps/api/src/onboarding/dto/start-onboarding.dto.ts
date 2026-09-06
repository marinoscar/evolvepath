import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Step 1's body (issue #101, epic E04).
 *
 * The timezone is not optional and is not guessed from an IP: every commitment
 * this flow creates is an instant computed from it, and a wrong one puts
 * tonight's dinner on tomorrow. The browser knows the answer
 * (`Intl.DateTimeFormat().resolvedOptions().timeZone`), so the client sends it.
 */
export const startOnboardingSchema = z.object({
  timezone: z.string().min(1).max(64),
  locale: z.string().min(2).max(20).optional(),
});

export class StartOnboardingDto extends createZodDto(startOnboardingSchema) {}
