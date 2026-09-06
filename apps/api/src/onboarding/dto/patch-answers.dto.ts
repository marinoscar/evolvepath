import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import {
  domainReflectionsSchema,
  healthBaselineSchema,
  obstaclesSchema,
} from '../../user-profile/user-profile.schema';
import { proposalDomain } from '../onboarding-proposal.schema';

// =============================================================================
// The merge patch behind steps 2–7 (issue #101, epic E04)
// =============================================================================
//
// STRICT. An unknown key is a 400 rather than a silently dropped answer: the
// wizard saves as the user types, and a typo'd field name that answered 200
// would look like a working save and lose the answer.
//
// `DONE` is not an acceptable `step`. Completion is `POST /onboarding/approve`'s
// to declare — a client that could patch its way there would have a completed
// account with no Path in it.
// =============================================================================

export const patchAnswersSchema = z
  .object({
    step: z.enum([
      'PROMISE',
      'VISION',
      'DOMAINS',
      'REALITY',
      'TIME',
      'HEALTH_BASELINE',
      'COACHING_STYLE',
      'PROPOSAL',
      'NOTIFICATIONS',
    ]),
    sixMonthVision: z.string().max(4000),
    domains: z.array(proposalDomain).min(1).max(3),
    domainReflections: domainReflectionsSchema,
    obstacles: obstaclesSchema,
    weekdayMinutes: z.number().int().min(5).max(240),
    healthBaseline: healthBaselineSchema,
    coachingStyle: z.enum(['GENTLE', 'BALANCED', 'DIRECT']),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Send at least one answer to save.',
  });

export class PatchAnswersDto extends createZodDto(patchAnswersSchema) {}
