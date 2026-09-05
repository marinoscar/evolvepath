import type { InterventionMode } from '../nba/intervention-mode';

// =============================================================================
// The coach's sentence, without the coach (issue #38, epic E05)
// =============================================================================
//
// PRD §120: the deterministic path must keep working. When the provider is down,
// the key is missing, or the model returns something that fails the schema, the
// insight card still says something true — keyed by the same intervention mode
// the deterministic engine already resolved.
//
// These are not apologies. A user whose provider key expired should not learn
// about it from a coaching card; they should get a slightly plainer sentence and
// find the key problem in settings, where it belongs.
// =============================================================================

const TEMPLATES: Record<InterventionMode, string> = {
  ACT: 'One thing at a time is how the week gets done. Start with what is in front of you.',
  CLARIFY:
    'It is easier to finish something when you know what finishing looks like. Worth a sentence on what “done” means here.',
  REDUCE:
    'A full day is not a failed day. Doing the smaller version keeps the thread intact.',
  DIAGNOSE:
    'Something about this one keeps making it easy to move. That is usually a sign it is too big, not that you are lazy.',
  RECONNECT:
    'Low energy is information, not a verdict. The smallest version still counts today.',
  CHALLENGE_PLAN:
    'This has not been working for a while. That is worth changing the plan over, rather than trying harder at the same thing.',
  RECOVER:
    'A gap is normal, and starting again is the whole skill. One small thing today is enough.',
  REINFORCE:
    'You have been consistent this week. That consistency is the thing that compounds — keep it cheap to continue.',
};

/** Never null: there is always something honest to say. */
export function insightTemplateFor(mode: InterventionMode): string {
  return TEMPLATES[mode];
}

/** What the card says on a day with nothing scheduled. */
export const EMPTY_DAY_INSIGHT =
  'Nothing is scheduled today. If that is deliberate, good — if not, one small commitment is a fine place to restart.';
