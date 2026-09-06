import { z } from 'zod';

// =============================================================================
// The first-Path contract (issue #101, epic E04)
// =============================================================================
//
// ONE SHAPE, THREE PRODUCERS. The planner persona fills this in, the
// deterministic template fills the same thing in, and the user's edited copy
// comes back through it at approve. Everything downstream — the guardrails, the
// approve transaction, the wizard's review screen — reads exactly one type, so
// "the coach is down" changes where a proposal came from and never what a
// proposal is.
//
// It is also the gateway's `schema`, which means the model is asked for these
// keys through OpenAI structured output rather than through a sentence in a
// prompt asking nicely.
//
// PLAIN KEYS, NO UNIONS, NO RECORDS: `toOpenAiStrictSchema` cannot express
// either, and `.nullable()` is preferred over `.optional()` because the
// converter turns an optional property into a nullable required one anyway —
// so a nullable field round-trips losslessly and an optional one does not.
// =============================================================================

/** E02's `Domain`, spelled out here so the schema stays free of Prisma. */
export const proposalDomain = z.enum(['WORK', 'FAMILY', 'HEALTH']);

export type ProposalDomain = z.infer<typeof proposalDomain>;

/**
 * How a routine is cued (PRD §10.5).
 *
 * A PROPOSAL-LEVEL vocabulary, not the database's: `routines.trigger_type` is
 * `TIME | EVENT`, and this is the three-way distinction a person recognises
 * when they read their own plan. `mapTriggerType` in the approve path is the
 * one place the two vocabularies meet.
 */
export const proposalTriggerType = z.enum(['AFTER', 'AT_TIME', 'WEEKDAYS']);

export const onboardingProposalSchema = z.object({
  bestSelf: z.object({
    identityStatement: z.string().min(10).max(300),
    workIdentity: z.string().max(200).nullable(),
    familyIdentity: z.string().max(200).nullable(),
    healthIdentity: z.string().max(200).nullable(),
    sixMonthVision: z.string().max(1000),
  }),

  outcomes: z
    .array(
      z.object({
        domain: proposalDomain,
        title: z.string().max(120),
        whyItMatters: z.string().max(400),
        successDefinition: z.string().max(400),
      }),
    )
    .max(3),

  /**
   * At most three, and that cap is the product (PRD §70). A first plan with
   * five habits in it is a plan the user abandons in week two, and the number
   * is enforced here rather than asked for in the prompt because a model that
   * proposes four is not a model this code may correct silently.
   */
  routines: z
    .array(
      z.object({
        domain: proposalDomain,
        title: z.string().max(120),
        triggerType: proposalTriggerType,
        triggerValue: z.string().max(80),
        frequency: z.string().max(40),
        idealMinutes: z.number().int().min(5).max(120),
        minimumMinutes: z.number().int().min(2).max(60),
        fallbackBehavior: z.string().max(200),
      }),
    )
    .max(3),

  firstWeekCommitments: z
    .array(
      z.object({
        domain: proposalDomain,
        title: z.string().max(120),
        /** An ISO instant. The window it must fall in is a guardrail, not a type. */
        scheduledStart: z.string().datetime({ offset: true }),
        durationMinutes: z.number().int().min(5).max(180),
        fullVersion: z.string().max(200),
        shortVersion: z.string().max(200),
        minimumVersion: z.string().max(200),
      }),
    )
    .min(1)
    .max(12),

  rationale: z.string().max(800),

  /**
   * Whether this proposal is the smaller one produced after a low confidence
   * answer (PRD §72). The review screen prints the §20 sentence off it, so it
   * is data rather than a client-side inference from two payloads.
   */
  reducedFromRequest: z.boolean(),
});

export type OnboardingProposal = z.infer<typeof onboardingProposalSchema>;

/** Captured on every `ai_invocations` row. Bump it when the prompt changes. */
export const ONBOARDING_PROPOSAL_PROMPT_VERSION = 'onboarding-proposal.v1';

/** `json_schema.name` on the wire. */
export const ONBOARDING_PROPOSAL_SCHEMA_NAME = 'onboarding_proposal';
