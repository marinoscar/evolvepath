import type { SafetyCategory } from './safety.types';

// =============================================================================
// What the user actually reads (issue #82, epic E06)
// =============================================================================
//
// PRD §81 forbids diagnosis, medication changes, dangerous restriction and
// training through serious pain; §82 forbids claiming to be a therapist. Those
// are constraints on COPY, not on classification — the model can be perfectly
// right about the category and the product can still say something it must not
// say. So the words live here, in code, and a spec asserts that none of them
// contains "diagnos", "prescrib" or "therapist".
//
// This copy also has to be the thing that ships when the provider is down.
// A redirect is decided by a regex, and the sentence it shows is a constant —
// so the safety path works in exactly the situation where a model-written
// message would not exist at all (PRD §120).
//
// NO REGIONAL HOTLINE NUMBERS. A wrong number is worse than none, and this
// product does not know where the user is. "Local emergency services, or a
// crisis line in your country" is what can be said truthfully everywhere.
// =============================================================================

export const SAFETY_REDIRECT_COPY: Record<
  Exclude<SafetyCategory, 'none'>,
  string
> = {
  crisis: [
    "What you've just described sounds serious, and it matters more than anything on your plan.",
    'Please contact your local emergency services, or a crisis line in your country, and talk to someone now.',
    "If there is someone you trust nearby, tell them how you're feeling.",
    "I'm a behaviour coach, not a clinician, and I'm here when you want to plan the next small step.",
  ].join(' '),

  injury: [
    "That sounds like something to get looked at rather than trained through.",
    'Please stop the activity that brings it on and have a qualified health professional check it before you push further.',
    "I'm a behaviour coach, not a clinician, and I'm here when you want to plan the next small step.",
  ].join(' '),

  disordered_eating: [
    "I'm not going to help plan that — restriction at that level does real harm, and it isn't something I can make safe by adjusting it.",
    'A registered dietitian or your regular health provider is the right person for questions about eating this far outside a normal range.',
    "I'm a behaviour coach, not a clinician, and I'm here when you want to plan the next small step.",
  ].join(' '),

  medication: [
    'Anything to do with starting, stopping or changing a medication belongs with the health professional who manages it — never with me, and never with a plan.',
    'Please talk to them before you change anything.',
    "I'm a behaviour coach, not a clinician, and I'm here when you want to plan the next small step.",
  ].join(' '),

  pregnancy: [
    'Training through pregnancy or the months after it is worth a conversation with the health professional who is looking after you.',
    'Once you know what they are comfortable with, I can build the plan around it.',
    "I'm a behaviour coach, not a clinician, and I'm here when you want to plan the next small step.",
  ].join(' '),

  other_medical: [
    'That is a question for a qualified health professional rather than for me.',
    'Once you have their guidance, I can shape the plan around what they told you.',
    "I'm a behaviour coach, not a clinician, and I'm here when you want to plan the next small step.",
  ].join(' '),
};

/**
 * Appended to the CALLING persona's instructions when the decision is
 * `conservative`. Not a separate prompt: the point is to change how the coach
 * answers, not to answer instead of it.
 */
export const SAFETY_CONSERVATIVE_INSTRUCTIONS = [
  'SAFETY CONSTRAINT for this reply, which overrides anything above that conflicts with it:',
  'Do not increase intensity, volume, duration or restriction in any suggestion.',
  'Keep any action you propose small and clearly optional.',
  'Where it is relevant, suggest checking with a qualified health professional, in one short clause.',
  'Never name a condition, never assess what is wrong, and never advise on medication.',
].join(' ');

/** The short line shown under a conservative reply. */
export const SAFETY_CONSERVATIVE_NOTE =
  "I've kept this cautious. If it keeps up or gets worse, please check in with a qualified health professional.";
