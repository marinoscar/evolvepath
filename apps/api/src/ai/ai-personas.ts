// =============================================================================
// AI persona registry (issue #22, epic #20)
// =============================================================================
//
// ONE declaration, three consumers — the same argument
// `apps/api/src/notifications/notification-events.ts` makes for events, applied
// to the logical AI responsibilities PRD §14 describes ("they may use the same
// underlying model initially").
//
//   1. the admin settings page (#24/#27) — the persona x model matrix, and the
//      label/description an administrator reads while choosing
//   2. the gateway (#26)                 — which model to resolve, whether
//      attachments are even accepted, what reasoning effort to default to
//   3. the docs                          — CLAUDE.md's "Adding an AI persona"
//      recipe (#32) is one entry in this file and nothing else
//
// Without one list the page has its own and the dispatcher has its own, and
// they drift: a model selector for a persona nothing invokes, or a persona
// invoked with no way for an administrator to tier it.
//
// THE KEYS ARE FROZEN FOR E02–E12. The epic (#20) says so explicitly: later
// epics import `PERSONA_KEYS` and persist the key on every `ai_invocations`
// row, so renaming one is a data migration over telemetry, not a refactor. Add
// a key; never edit one in place.
//
// This file is intentionally NOT a Nest provider — pure data and pure
// functions, so the schema below, the tests, and `GET /ai-settings/personas`
// can all consume it without standing up DI for a constant. It imports nothing
// from Nest, Prisma or Zod for the same reason.
// =============================================================================

/**
 * How much reasoning a persona's work is worth paying for.
 *
 * A HINT TO THE ADMINISTRATOR, NOT AN ENFORCED CONSTRAINT. PRD §118 asks for
 * model tiering — a small model for extraction and notification rewrites, a
 * strong reasoning model for planning and weekly review — but the person
 * holding the OpenAI bill is the one who decides, so this shapes the admin
 * page's guidance rather than restricting the select.
 */
export const AI_PERSONA_TIERS = ['fast', 'reasoning'] as const;

/** A persona's cost/quality tier. See {@link AI_PERSONA_TIERS}. */
export type AiPersonaTier = (typeof AI_PERSONA_TIERS)[number];

/**
 * What kinds of input a persona can receive.
 *
 * `vision` IS A GATE, NOT A LABEL. The gateway (#26) refuses attachments for a
 * persona that does not declare it, before a single byte is downloaded from
 * storage — so an accidental attachment on the notification copywriter is a
 * typed error rather than an image quietly billed to the user's key.
 */
export const AI_PERSONA_CAPABILITIES = ['text', 'vision'] as const;

/** An input capability. See {@link AI_PERSONA_CAPABILITIES}. */
export type AiPersonaCapability = (typeof AI_PERSONA_CAPABILITIES)[number];

/** OpenAI's reasoning-effort dial, as the Responses API spells it. */
export type AiReasoningEffort = 'low' | 'medium' | 'high';

/**
 * Every persona, as a value.
 *
 * A READONLY TUPLE LITERAL, not `AI_PERSONAS.map((p) => p.key)`. The derived
 * form would be a `string[]`, and `z.enum()` and `Partial<Record<PersonaKey,…>>`
 * both need the literal union to be useful — `personaModels: { bogus: '…' }`
 * has to fail at parse time, which is exactly what E01-04 (#24) returns 400
 * for. The spec asserts that this list and `AI_PERSONAS` agree, so the pair
 * cannot drift even though it is written twice.
 */
export const PERSONA_KEYS = [
  'planner',
  'coach',
  'pattern_analyst',
  'workout_programmer',
  'weekly_reviewer',
  'notification_copywriter',
  'safety',
  'media_analyst',
] as const;

/** One of the eight logical AI responsibilities. See {@link PERSONA_KEYS}. */
export type PersonaKey = (typeof PERSONA_KEYS)[number];

/** One persona, fully described for every surface that renders or invokes it. */
export interface AiPersonaDef {
  /** Stable key, persisted on every `ai_invocations` row. Never edit in place. */
  key: PersonaKey;

  /** Short human label, the row heading on the admin persona table. */
  label: string;

  /**
   * One sentence on what this persona actually does, in the administrator's
   * terms. This is the only place the answer to "what am I choosing a model
   * for?" is written down.
   */
  description: string;

  /** Guidance for the administrator's model choice. See {@link AI_PERSONA_TIERS}. */
  tier: AiPersonaTier;

  /**
   * What this persona can be handed. Always includes `'text'`; `'vision'` is
   * the gate described on {@link AI_PERSONA_CAPABILITIES}.
   */
  capabilities: AiPersonaCapability[];

  /**
   * Reasoning effort the gateway applies when a caller does not name one.
   *
   * Absent means "send no `reasoning` field at all" and let the model's own
   * default stand — which is the right answer for the fast personas, where an
   * explicit `low` would be a claim about a model we have not chosen yet.
   */
  defaultReasoningEffort?: AiReasoningEffort;
}

/**
 * The personas this application can invoke, in {@link PERSONA_KEYS} order.
 *
 * Order is asserted by the spec and is the order the admin table renders, so
 * the page's rows do not reshuffle when an entry is added mid-list.
 */
export const AI_PERSONAS: AiPersonaDef[] = [
  {
    key: 'planner',
    label: 'Planner',
    description:
      'Turns an aspiration into an outcome and a behavioural plan.',
    tier: 'reasoning',
    capabilities: ['text'],
    defaultReasoningEffort: 'medium',
  },
  {
    key: 'coach',
    label: 'Coach',
    description:
      'Day-to-day coaching replies, help starting, and decomposition.',
    // The highest-volume persona by a wide margin — every Today-screen nudge
    // goes through it — so `fast` is a cost statement, not a quality one.
    tier: 'fast',
    capabilities: ['text'],
  },
  {
    key: 'pattern_analyst',
    label: 'Pattern analyst',
    description:
      'Finds recurring obstacles and successful time windows in evidence.',
    tier: 'reasoning',
    capabilities: ['text'],
  },
  {
    key: 'workout_programmer',
    label: 'Workout programmer',
    description: 'Builds and adapts structured workout programs.',
    tier: 'reasoning',
    capabilities: ['text'],
    defaultReasoningEffort: 'medium',
  },
  {
    key: 'weekly_reviewer',
    label: 'Weekly reviewer',
    description: 'Planned-vs-actual review and next-week proposals.',
    tier: 'reasoning',
    capabilities: ['text'],
    defaultReasoningEffort: 'medium',
  },
  {
    key: 'notification_copywriter',
    label: 'Notification copywriter',
    description:
      'Rewrites approved notification decisions into short copy.',
    tier: 'fast',
    capabilities: ['text'],
  },
  {
    key: 'safety',
    label: 'Safety',
    description:
      'Classifies health, eating, distress and relationship requests for conservative handling.',
    // Fast on purpose: this runs BEFORE the persona the user actually asked
    // for, so its latency is paid on every sensitive turn.
    tier: 'fast',
    capabilities: ['text'],
  },
  {
    key: 'media_analyst',
    label: 'Media analyst',
    description:
      'Describes workout form, equipment and meals from photos and video frames.',
    tier: 'fast',
    // THE ONLY PERSONA THAT DECLARES VISION. The spec asserts that, so adding
    // a second one is a deliberate edit to both files rather than a slip.
    capabilities: ['text', 'vision'],
  },
];

const PERSONAS_BY_KEY = new Map<string, AiPersonaDef>(
  AI_PERSONAS.map((persona) => [persona.key, persona]),
);

/**
 * The definition for `key`, or `undefined` when nothing is registered under it.
 *
 * RETURNS `undefined` RATHER THAN THROWING because the caller is frequently
 * holding a string that came from persisted data — a `personaModels` entry or
 * an `ai_invocations` row written before a persona was removed from this list.
 * A decommissioned persona must not turn the admin settings page into a 500;
 * the caller decides whether an unknown key is "skip it" or "this is a bug".
 * (The gateway treats it as a bug, because its parameter is `PersonaKey`.)
 */
export function findPersona(key: string): AiPersonaDef | undefined {
  return PERSONAS_BY_KEY.get(key);
}

/**
 * Narrow an arbitrary string to a {@link PersonaKey}.
 *
 * The guard the settings service needs when validating a stored
 * `personaModels` object whose keys came off a JSONB column, where the type
 * system has nothing to go on.
 */
export function isPersonaKey(key: string): key is PersonaKey {
  return PERSONAS_BY_KEY.has(key);
}
