import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * `POST /auth/test/simulate-idle` — request (issue #112, epic E11).
 *
 * WHY SHIFT DATA RATHER THAN TRAVEL IN TIME. Every rule the comeback loop
 * enforces is about elapsed time — "three days of silence", "four misses in a
 * week", "scheduled before the start of local today". A global clock seam would
 * have to reach every service the sweep touches, and a test that moved it would
 * be exercising a code path production never runs.
 *
 * Moving the user's own rows backwards instead keeps the sweep, the detector
 * and the momentum engine running against the real `new Date()`, which is the
 * thing the suite is actually meant to prove works.
 */
const simulateIdleSchema = z.object({
  email: z.string().email(),
  idleDays: z.number().int().min(1).max(60),
});

export class SimulateIdleDto extends createZodDto(simulateIdleSchema) {}
