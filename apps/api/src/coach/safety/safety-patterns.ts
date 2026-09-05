import type { SafetyCategory } from './safety.types';

// =============================================================================
// The rule table (issue #82, epic E06)
// =============================================================================
//
// PRD §14.8 wants a safety layer over health, eating, emotional-distress,
// relationship and professional-sensitivity requests. Most of that traffic does
// not need a model to classify: "I have sharp chest pain when I run" is not an
// ambiguous case, and routing it through a provider means a user in trouble
// waits on an API — and gets nothing at all when that API is down.
//
// So the table has two strengths, and they mean different things:
//
//   * `definite`  — decide here, now, with no model call. Redirect.
//   * `ambiguous` — a word that OFTEN appears in an unsafe request and also
//                   appears constantly in ordinary coaching. Ask the `safety`
//                   persona.
//
// THE HARD PART IS NOT CATCHING ENOUGH, IT IS NOT CATCHING TOO MUCH. PRD §82
// explicitly allows ordinary behaviour-change language, and a product that
// answers "my legs are sore" with a professional-care redirect is one the user
// stops telling things to — which costs far more safety than it buys. That is
// why `sore`, `tired` and `stressed` are not rules on their own, and why
// `sore` only becomes ambiguous next to `sharp`, `severe` or `worse`.
//
// IDS ARE STABLE. They are written to `ai_invocations.safetyDecision`, to
// `coach_messages.safetyDecision` and to the log line. Add ids freely; do not
// rename one.
//
// ORDER IS PRECEDENCE. When several `definite` rules match, the first in this
// array decides the category, so crisis rules come first: a message that
// mentions both self-harm and a sore knee is a crisis message.
// =============================================================================

export interface SafetyRule {
  id: string;
  category: Exclude<SafetyCategory, 'none'>;
  strength: 'definite' | 'ambiguous';
  pattern: RegExp;
}

export const SAFETY_RULES: SafetyRule[] = [
  // ---------------------------------------------------------------------------
  // Crisis — first, so it wins every tie.
  // ---------------------------------------------------------------------------
  {
    id: 'crisis.kill_myself',
    category: 'crisis',
    strength: 'definite',
    pattern: /\bkill(ing)? myself\b/i,
  },
  {
    id: 'crisis.suicide',
    category: 'crisis',
    strength: 'definite',
    pattern: /suicid/i,
  },
  {
    id: 'crisis.end_my_life',
    category: 'crisis',
    strength: 'definite',
    pattern: /\bend(ing)? my life\b/i,
  },
  {
    id: 'crisis.self_harm',
    category: 'crisis',
    strength: 'definite',
    pattern: /\bself[- ]harm\b|\bhurt(ing)? myself\b/i,
  },
  {
    id: 'crisis.not_alive',
    category: 'crisis',
    strength: 'definite',
    // The apostrophe is optional and both the ASCII and the curly one are
    // accepted: a phone keyboard produces ’ and a laptop produces '.
    pattern: /\bdon['’]?t want to (be alive|live)\b/i,
  },
  {
    id: 'crisis.es_quitarme_la_vida',
    category: 'crisis',
    strength: 'definite',
    pattern: /\bquitarme la vida\b|\bquiero morirme\b|\bno quiero vivir\b/i,
  },
  {
    id: 'crisis.hopeless',
    category: 'crisis',
    strength: 'ambiguous',
    pattern: /\bhopeless\b/i,
  },
  {
    id: 'crisis.cant_go_on',
    category: 'crisis',
    strength: 'ambiguous',
    pattern: /\bcan['’]?t go on\b/i,
  },
  {
    id: 'crisis.worthless',
    category: 'crisis',
    strength: 'ambiguous',
    pattern: /\bworthless\b/i,
  },

  // ---------------------------------------------------------------------------
  // Injury
  // ---------------------------------------------------------------------------
  {
    id: 'injury.chest_pain',
    category: 'injury',
    strength: 'definite',
    pattern: /\bchest pain\b/i,
  },
  {
    id: 'injury.es_dolor_de_pecho',
    category: 'injury',
    strength: 'definite',
    pattern: /\bdolor (en el |de )?pecho\b/i,
  },
  {
    id: 'injury.numbness',
    category: 'injury',
    strength: 'definite',
    pattern: /\bnumb(ness)?\b/i,
  },
  {
    id: 'injury.cannot_bear_weight',
    category: 'injury',
    strength: 'definite',
    pattern: /\bcan['’]?t (put |bear )?weight\b/i,
  },
  {
    id: 'injury.sharp_pain',
    category: 'injury',
    strength: 'definite',
    pattern: /\bsharp pain\b/i,
  },
  {
    id: 'injury.popped',
    category: 'injury',
    strength: 'definite',
    pattern: /\bpop(ped)? (in|my)\b/i,
  },
  {
    id: 'injury.heard_a_crack',
    category: 'injury',
    strength: 'definite',
    pattern: /\bheard a (crack|pop)\b/i,
  },
  {
    id: 'injury.pain',
    category: 'injury',
    strength: 'ambiguous',
    pattern: /\bpain\b/i,
  },
  {
    id: 'injury.hurts',
    category: 'injury',
    strength: 'ambiguous',
    pattern: /\bhurts?\b/i,
  },
  {
    id: 'injury.injury',
    category: 'injury',
    strength: 'ambiguous',
    pattern: /injur/i,
  },
  {
    id: 'injury.tweak',
    category: 'injury',
    strength: 'ambiguous',
    pattern: /\btweak(ed)?\b/i,
  },
  {
    id: 'injury.sore_qualified',
    category: 'injury',
    strength: 'ambiguous',
    // DELIBERATELY NOT a bare `\bsore\b`. "My legs are sore from yesterday" is
    // the most ordinary sentence in strength coaching; only a qualifier makes
    // it worth a second look.
    pattern:
      /\b(sharp|severe|worse|worsening|getting worse)\b[^.!?]{0,40}\bsore\b|\bsore\b[^.!?]{0,40}\b(sharp|severe|worse|worsening|getting worse)\b/i,
  },

  // ---------------------------------------------------------------------------
  // Disordered eating
  // ---------------------------------------------------------------------------
  {
    id: 'eating.purge',
    category: 'disordered_eating',
    strength: 'definite',
    pattern: /purg/i,
  },
  {
    id: 'eating.starve',
    category: 'disordered_eating',
    strength: 'definite',
    pattern: /starv/i,
  },
  {
    id: 'eating.multi_day_fast',
    category: 'disordered_eating',
    strength: 'definite',
    pattern: /\b(fast(ing)?|ayun(ar|o)) (for |por |de )?\d+ ?(days?|d[ií]as?)\b/i,
  },
  {
    id: 'eating.very_low_calories',
    category: 'disordered_eating',
    strength: 'definite',
    pattern: /\bunder [5-8]00 (calories|kcal)\b/i,
  },
  {
    id: 'eating.laxative',
    category: 'disordered_eating',
    strength: 'definite',
    pattern: /laxative/i,
  },
  {
    id: 'eating.throw_up_after',
    category: 'disordered_eating',
    strength: 'definite',
    pattern: /\bthrow(ing)? up after\b|\bvomit(ing)? after\b/i,
  },
  {
    id: 'eating.skip_meals',
    category: 'disordered_eating',
    strength: 'ambiguous',
    pattern: /\bskip(ping)? (a )?(meals?|lunch|dinner|breakfast)\b/i,
  },
  {
    id: 'eating.eat_less',
    category: 'disordered_eating',
    strength: 'ambiguous',
    pattern: /\beat(ing)? less\b/i,
  },
  {
    id: 'eating.rapid_loss_target',
    category: 'disordered_eating',
    strength: 'ambiguous',
    pattern: /\blose \d+ ?(lbs|pounds|kg|kilos)\b/i,
  },

  // ---------------------------------------------------------------------------
  // Medication
  // ---------------------------------------------------------------------------
  {
    id: 'medication.stop_taking',
    category: 'medication',
    strength: 'definite',
    pattern: /\bstop taking\b|\bdejar de tomar\b/i,
  },
  {
    id: 'medication.dose',
    category: 'medication',
    strength: 'definite',
    pattern: /\b(my|the) (dose|dosage)\b/i,
  },
  {
    id: 'medication.named',
    category: 'medication',
    strength: 'definite',
    pattern:
      /\b(insulin|antidepressants?|blood pressure (meds|medication|medicine))\b/i,
  },
  {
    id: 'medication.generic',
    category: 'medication',
    strength: 'ambiguous',
    pattern: /\bmedications?\b|\bmedicine\b/i,
  },
  {
    id: 'medication.pills',
    category: 'medication',
    strength: 'ambiguous',
    pattern: /\bpills?\b/i,
  },

  // ---------------------------------------------------------------------------
  // Pregnancy — never definite. "Can I keep lifting while pregnant?" is a
  // reasonable question with a careful answer, not something to refuse.
  // ---------------------------------------------------------------------------
  {
    id: 'pregnancy.pregnant',
    category: 'pregnancy',
    strength: 'ambiguous',
    pattern: /pregnan|embaraz/i,
  },
  {
    id: 'pregnancy.postpartum',
    category: 'pregnancy',
    strength: 'ambiguous',
    pattern: /postpartum|post-partum/i,
  },
  {
    id: 'pregnancy.trimester',
    category: 'pregnancy',
    strength: 'ambiguous',
    pattern: /trimester/i,
  },

  // ---------------------------------------------------------------------------
  // Other medical
  // ---------------------------------------------------------------------------
  {
    id: 'other_medical.diagnosis',
    category: 'other_medical',
    strength: 'ambiguous',
    pattern: /diagnos/i,
  },
  {
    id: 'other_medical.doctor_said',
    category: 'other_medical',
    strength: 'ambiguous',
    pattern: /\b(doctor|physio|physical therapist) (said|told me)\b/i,
  },
  {
    id: 'other_medical.condition',
    category: 'other_medical',
    strength: 'ambiguous',
    pattern: /\bcondition\b/i,
  },
];

/** Every rule that fires on this text, in table order. */
export function matchRules(text: string): SafetyRule[] {
  if (!text) return [];

  return SAFETY_RULES.filter((rule) => rule.pattern.test(text));
}
