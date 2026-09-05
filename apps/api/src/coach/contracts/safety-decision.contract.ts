import { z } from 'zod';

/**
 * What the `safety` persona is allowed to return.
 *
 * THREE KEYS, AND NONE OF THEM IS FREE-FORM ADVICE. The schema is the
 * enforcement of "classify only" (PRD §14.8) — the prompt says it, but only
 * the schema makes it impossible. `rationale` is bounded and is for a log
 * line; nothing in the product renders it to a user.
 */
export const safetyModelSchema = z.object({
  decision: z.enum(['allow', 'conservative', 'redirect']),
  category: z.enum([
    'none',
    'injury',
    'disordered_eating',
    'crisis',
    'medication',
    'pregnancy',
    'other_medical',
  ]),
  rationale: z.string().max(200),
});

export type SafetyModelOutput = z.infer<typeof safetyModelSchema>;
