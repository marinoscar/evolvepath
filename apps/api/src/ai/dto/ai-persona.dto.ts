import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import {
  AI_PERSONA_CAPABILITIES,
  AI_PERSONA_TIERS,
  PERSONA_KEYS,
} from '../ai-personas';

/**
 * GET /api/ai-settings/personas — one row of the admin persona table (#24).
 *
 * A read-only projection of the registry in `ai-personas.ts`. The web app gets
 * the SERVER'S ANSWER rather than a second copy of the list, for the reason
 * `notification-events.ts` sets out on its own axis: two declarations drift,
 * and the drift shows up as a model selector for a persona nothing invokes.
 *
 * `defaultReasoningEffort` is deliberately NOT published. It is a gateway
 * implementation detail an administrator cannot act on, and publishing it
 * invites a UI control for something this epic does not make configurable.
 */
export const aiPersonaSchema = z.object({
  key: z.enum(PERSONA_KEYS),
  label: z.string(),
  description: z.string(),
  tier: z.enum(AI_PERSONA_TIERS),
  capabilities: z.array(z.enum(AI_PERSONA_CAPABILITIES)),
});

export type AiPersonaDto_ = z.infer<typeof aiPersonaSchema>;

export class AiPersonaDto extends createZodDto(aiPersonaSchema) {}
