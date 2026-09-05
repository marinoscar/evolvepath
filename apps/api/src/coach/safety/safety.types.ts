// =============================================================================
// The safety decision (issue #82, epic E06)
// =============================================================================
//
// ONE TYPE, RECORDED IN THREE PLACES: `ai_invocations.safetyDecision` (the
// telemetry row for whatever call the decision governed), `coach_messages
// .safetyDecision` (what the user was actually shown), and the Pino line. PRD
// §88 asks for the decision to be logged; the reason it is one type rather
// than three shapes is that "why did the coach say that?" has to be answerable
// from any of the three without joining a fourth.
//
// `source` is the field that makes an audit possible at all. It separates
// "a regex decided this, no model was called" from "the safety persona
// decided this" from "the provider was down and we chose caution" — three very
// different levels of confidence in the same word.
// =============================================================================

export type SafetyDecisionKind = 'allow' | 'conservative' | 'redirect';

export type SafetyCategory =
  | 'none'
  | 'injury'
  | 'disordered_eating'
  | 'crisis'
  | 'medication'
  | 'pregnancy'
  | 'other_medical';

/** Which product surface handed the text over. Logged, never shown. */
export type SafetySurface = 'coach' | 'planner' | 'workout' | 'media';

export interface SafetyDecision {
  decision: SafetyDecisionKind;
  category: SafetyCategory;
  /** The copy shown under (or instead of) the reply. Always set on redirect. */
  userFacingNote?: string;
  source: 'precheck' | 'model' | 'model_unavailable';
  /** The `SAFETY_RULES` id that fired. Stable — it is logged. */
  matchedRule?: string;
  promptVersion?: string;
}
