import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createPlanVersionSchema = z.object({
  /**
   * REQUIRED, unlike on the first version.
   *
   * PRD §80 wants "Changed Sep 12 · Reason: 3 repeated evening misses" to be
   * renderable for every change. A version with no rationale makes that line
   * unrenderable forever — the moment the user knew why has passed by the time
   * anybody notices. The first version needs no rationale because there is no
   * change to explain.
   */
  rationale: z.string().trim().min(1).max(2000),
  expectedWeeklyLoad: z.number().int().min(0).max(10080).nullish(),
  fallbackStrategy: z.string().trim().max(1000).nullish(),
  /**
   * Whether to carry the current behaviours forward. 'active' is the default
   * because a new version is nearly always an adjustment to what exists, and
   * an empty v2 would silently drop everything the user built.
   */
  copyRoutinesFrom: z.enum(['active', 'none']).default('active'),
});

export class CreatePlanVersionDto extends createZodDto(createPlanVersionSchema) {}
