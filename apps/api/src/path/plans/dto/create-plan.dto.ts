import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { createRoutineInputSchema } from '../../routines/dto/create-routine.dto';

export const createPlanSchema = z.object({
  rationale: z.string().trim().max(2000).nullish(),
  /** Minutes per week this plan expects to cost. */
  expectedWeeklyLoad: z.number().int().min(0).max(10080).nullish(),
  fallbackStrategy: z.string().trim().max(1000).nullish(),
  /**
   * Routines to create alongside v1. Capped at 10 because a first plan with
   * eleven behaviours in it is not a plan the user will keep.
   */
  routines: z.array(createRoutineInputSchema).max(10).default([]),
});

export class CreatePlanDto extends createZodDto(createPlanSchema) {}
