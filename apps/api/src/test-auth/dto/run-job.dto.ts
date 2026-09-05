import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * `POST /auth/test/run-job` — request (issue #59, epic E12).
 *
 * WHY A SIMULATED CLOCK. Every rule this engine enforces is about time —
 * "starts in twenty minutes", "inside quiet hours", "already sent today". A
 * test that can only run the job at the real `now` has to seed data relative to
 * the wall clock and then wait, which is how a suite ends up with a `sleep` in
 * it and a flake on a slow machine. `now` moves the whole run instead.
 *
 * The clock is passed all the way down as an argument because `decide()` and
 * every scanner window take `now` explicitly and read no global — see the
 * header of `notification-policy.ts` for why that is the shape.
 */
const runJobSchema = z.object({
  job: z.enum(['coaching-notifications']),
  now: z.iso.datetime().optional(),
});

export class RunJobDto extends createZodDto(runJobSchema) {}
