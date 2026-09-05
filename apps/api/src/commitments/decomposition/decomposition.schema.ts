import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// =============================================================================
// "Break this down" (issue #40, epic E05)
// =============================================================================
//
// The output contract for the `coach` persona's decomposition call, and the
// input contract for applying one. THE SAME SCHEMA VALIDATES BOTH DIRECTIONS,
// which is the point: a proposal the user edited before accepting is checked
// against exactly what the model was allowed to return, so an edited step
// cannot smuggle in a shape the model could not have produced.
//
// The bounds are the product decision, not a formality:
//
//   * at most FIVE steps — a decomposition that needs six is a plan, and PRD
//     §15 says a plan change needs the user's approval through the plan editor,
//     not a coach reply.
//   * the FIRST step at most FIFTEEN minutes — the whole purpose of this flow
//     is to make starting cheap. A first step longer than that has reproduced
//     the problem the user asked for help with.
// =============================================================================

export const decompositionStepSchema = z.object({
  title: z.string().min(1).max(120),
  minutes: z.number().int().min(1).max(60),
});

export const decompositionProposalSchema = z.object({
  steps: z.array(decompositionStepSchema).min(1).max(5),
  /** Deliberately its own field: it is what the "Use this" button creates. */
  firstStep: z.object({
    title: z.string().min(1).max(120),
    minutes: z.number().int().min(1).max(15),
  }),
  /** One sentence to the user. Never persisted. */
  message: z.string().max(240),
  source: z.enum(['ai', 'template']),
});

export type DecompositionProposal = z.infer<typeof decompositionProposalSchema>;
export type DecompositionStep = z.infer<typeof decompositionStepSchema>;

export class ApplyDecompositionDto extends createZodDto(decompositionProposalSchema) {}

/** `json_schema.name` on the wire; matched by the fake server's log lines. */
export const DECOMPOSITION_SCHEMA_NAME = 'decomposition_proposal';

/**
 * What the user gets when the coach cannot answer — a wrong provider key, no
 * key at all, a timeout, a refusal.
 *
 * PRD §120: the deterministic path must keep working. This is not an apology
 * dressed as a feature; five minutes is a real, useful first move, and offering
 * it is strictly better than an error dialog on the one screen a stuck user
 * reached for help from.
 */
export function templateProposal(): DecompositionProposal {
  return {
    steps: [{ title: 'Open it and do the first 5 minutes', minutes: 5 }],
    firstStep: { title: 'Open it and do the first 5 minutes', minutes: 5 },
    message: 'The coach is unavailable — start with 5 minutes instead.',
    source: 'template',
  };
}
