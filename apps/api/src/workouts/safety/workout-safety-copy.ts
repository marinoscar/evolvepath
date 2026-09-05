// =============================================================================
// What the product says about pain (issue #81, epic E09)
// =============================================================================
//
// PRD §45. A CONSTANT, not a template and not a model call, for three reasons
// that all point the same way:
//
//   1. It has to arrive when the provider is down. Sharp pain is the one moment
//      in this product where a missing sentence is a real cost.
//   2. It must be identical everywhere. E09-06's form check and E09-08's runner
//      import this same string; two wordings of "stop" would read as two
//      different levels of seriousness.
//   3. It must contain NO PROGRAMMING ADVICE. Not "try a lighter weight", not
//      "switch to the machine version" — the whole point is that this is the
//      one signal the software does not reason about.
// =============================================================================

export const PAIN_SAFETY_COPY =
  'Stop this exercise. Sharp pain is not something to train through. If it persists, ' +
  'sharpens, or comes with numbness or weakness, get it checked by a professional before ' +
  'your next session.';

/** What the client should offer. Never "continue with less weight". */
export type PainSafetyAction = 'stop_exercise';

export const PAIN_SAFETY_ACTION: PainSafetyAction = 'stop_exercise';
