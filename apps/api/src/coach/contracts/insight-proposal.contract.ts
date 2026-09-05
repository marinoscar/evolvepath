import { z } from 'zod';

/**
 * What the `pattern_analyst` persona may return.
 *
 * `observation` and `statement` are two fields on purpose (PRD §14.4). The
 * observation is the fact — "12 of 15 kept commitments were before noon"; the
 * statement is the durable inference the coach would later act on — "morning
 * commitments are more reliable". Collapsing them would let an inference be
 * stored with nothing to check it against, and PRD §10.12 requires the user to
 * be able to approve or reject it knowing which is which.
 *
 * Five, at most. A screen of twenty "insights" is not something anybody
 * reviews; it is something everybody dismisses.
 */
export const insightProposalSchema = z.object({
  insights: z
    .array(
      z.object({
        category: z.enum([
          'WORK',
          'FAMILY',
          'HEALTH',
          'COACHING_PREFERENCE',
          'NOTIFICATION_PREFERENCE',
          'PATTERN',
        ]),
        statement: z.string().min(1).max(200),
        observation: z.string().min(1).max(200),
        evidenceCount: z.number().int().min(1),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(5),
});

export type InsightProposal = z.infer<typeof insightProposalSchema>;

/** `json_schema.name` on the wire. */
export const INSIGHT_PROPOSAL_SCHEMA_NAME = 'insight_proposal';
