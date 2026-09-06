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
  /**
   * ONE ROUTE, ONE ENUM — E11's comeback sweep is added here rather than as a
   * second `jobs/run` route, so a harness keeps learning one shape (#112).
   */
  job: z.enum(['coaching-notifications', 'comeback', 'milestones']),
  now: z.iso.datetime().optional(),
  /**
   * Which user to run a per-user job for. Required by `comeback`, which sweeps
   * one person at a time; ignored by the coaching engine, which scans everyone.
   */
  email: z.string().email().optional(),
});

export class RunJobDto extends createZodDto(runJobSchema) {}
