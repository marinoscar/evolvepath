import type { InterventionType } from '../../coach/contracts/coach-reply.contract';
import { frictionRuleFor, type FrictionAnswer } from './friction-answers';

// =============================================================================
// The deterministic intervention (issue #116, epic E07)
// =============================================================================
//
// PRD §120: every answer produces a usable intervention with the provider down.
// This file is what "usable" means — a sentence and a concrete first move,
// written once and reviewed once, rather than whatever the model produced that
// time.
//
// It is also the SERVER GUARD's fallback. When the coach replies with the wrong
// intervention type, an action longer than fifteen minutes, or another
// commitment's id, the reply is discarded and this is sent instead. A reply the
// server had to correct is a reply the server may as well have written.
//
// NO MOTIVATIONAL THEATRE (VISION §9). Every recommended action names the first
// concrete thing to write or open. "You've got this" is not an action.
// =============================================================================

export interface InterventionAction {
  title: string;
  durationMinutes: number;
}

export interface FrictionIntervention {
  interventionType: InterventionType;
  userMessage: string;
  recommendedAction: InterventionAction | null;
  fallbackAction: InterventionAction | null;
  suggestedReschedule: { scheduledStart: string; scheduledEnd: string } | null;
  source: 'ai' | 'template';
}

export interface TemplateContext {
  commitmentTitle: string;
  /** The commitment's minimum version, when it declares one. */
  minimum: InterventionAction | null;
  /** The outcome's motivation, in the user's own words. */
  motivation: string | null;
  /** For SOMETHING_URGENT only. */
  suggestedReschedule: { scheduledStart: string; scheduledEnd: string } | null;
  /** The user's own words, for OTHER. */
  text: string | null;
}

/** A minimum version is not guaranteed; this is what stands in for one. */
const GENERIC_MINIMUM: InterventionAction = {
  title: 'Open the work and write the next three bullets',
  durationMinutes: 10,
};

export function templateInterventionFor(
  answer: FrictionAnswer,
  ctx: TemplateContext,
): FrictionIntervention {
  const rule = frictionRuleFor(answer);
  const minimum = ctx.minimum ?? GENERIC_MINIMUM;

  const base = {
    interventionType: rule.interventionType,
    suggestedReschedule: null,
    source: 'template' as const,
  };

  switch (answer) {
    case 'DONT_KNOW_WHERE_TO_BEGIN':
      return {
        ...base,
        userMessage:
          "Not knowing where to begin is a starting problem, not an effort problem. Make the first move small enough that there is nothing to decide.",
        recommendedAction: {
          title:
            'Start for 10 minutes: open the work and write one sentence stating what done looks like',
          durationMinutes: 10,
        },
        fallbackAction: minimum,
      };

    case 'TOO_BIG':
      return {
        ...base,
        userMessage:
          "Let's stop treating this like one task. Doing a named slice of it is the whole move today.",
        recommendedAction: {
          title: `For the next 10 minutes, write only the first three bullets of "${ctx.commitmentTitle}"`,
          durationMinutes: 10,
        },
        fallbackAction: minimum,
      };

    case 'TIRED':
      return {
        ...base,
        userMessage:
          'Then do the smallest honest version today. A short one still counts, and it keeps the thing alive.',
        recommendedAction: minimum,
        fallbackAction: {
          title: 'Reschedule to your next morning slot',
          durationMinutes: minimum.durationMinutes,
        },
      };

    case 'DONT_WANT_TO':
      return {
        ...base,
        userMessage: ctx.motivation
          ? `You said this matters because: "${ctx.motivation}". You do not have to want to — give it five minutes and then decide.`
          : 'You do not have to want to. Give it five minutes and then decide.',
        recommendedAction: { title: 'Give it 5 minutes, then decide', durationMinutes: 5 },
        fallbackAction: minimum,
      };

    case 'SOMETHING_URGENT':
      return {
        ...base,
        userMessage:
          'That happens. Moving it for a real reason is not avoidance — this one will not count against you.',
        // No action: the move IS the action, and offering a start alongside it
        // would be arguing with the answer the user just gave.
        recommendedAction: null,
        fallbackAction: null,
        suggestedReschedule: ctx.suggestedReschedule,
      };

    case 'WORRIED_ABOUT_QUALITY':
      return {
        ...base,
        userMessage: 'A rough draft is the goal, not the final version.',
        recommendedAction: {
          title: 'Write a deliberately bad first draft for 10 minutes',
          durationMinutes: 10,
        },
        fallbackAction: minimum,
      };

    case 'NEED_MORE_INFO':
      return {
        ...base,
        userMessage:
          'Then the next piece of work is finding out, not doing. That is still progress on this.',
        recommendedAction: {
          title: 'Spend 10 minutes listing exactly what you need to know and who has it',
          durationMinutes: 10,
        },
        fallbackAction: minimum,
      };

    case 'OTHER':
    default:
      return {
        ...base,
        userMessage:
          'Noted — the coach will have that next time. For now, the smallest version keeps it moving.',
        recommendedAction: minimum,
        fallbackAction: null,
      };
  }
}
