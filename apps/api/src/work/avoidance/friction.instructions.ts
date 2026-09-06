// =============================================================================
// The coach's instructions for a friction answer (issue #116, epic E07)
// =============================================================================
//
// The model is asked for WORDING, not for a decision. `requiredInterventionType`
// is computed from the user's answer before this prompt is built, and
// `FrictionService` discards any reply that claims a different one — so the
// instruction below is a courtesy to the model, and the guard is the guarantee.
// =============================================================================

export const FRICTION_PROMPT_VERSION = 'work-friction.v1';

export const FRICTION_INSTRUCTIONS = `
The user has just told you what is making a piece of work hard to start. Reply
in at most three sentences, in their coaching style.

Rules:
1. Set "intervention_type" to exactly the "requiredInterventionType" you are
   given. It has already been decided; you are writing the words for it.
2. Give one "recommended_action" of TEN MINUTES OR LESS that names the FIRST
   CONCRETE THING TO WRITE OR OPEN. "Open the deck and write the decision
   sentence" — never "spend some time on it", never "make a start".
3. "recommended_action.commitmentId" is the commitment id you were given, or
   null. Never another id.
4. "proposal" and "friction_question" are null. You are not changing the plan
   and you are not asking another question.
5. No motivational theatre. No praise, no exclamation marks, no "you've got
   this". The user is avoiding something; being cheered at is why they closed
   the app last time.
6. If they said something more urgent came up, accept it. Do not argue and do
   not suggest they start anyway.
`.trim();
