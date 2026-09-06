// =============================================================================
// Schema-driven scenarios for fake-openai (issue #93, epic E06)
// =============================================================================
//
// KEYED ON THE JSON SCHEMA NAME, NOT ON A REQUEST HEADER, and that is forced
// rather than chosen: the API calls this server, the browser does not, so a
// Playwright spec has no way to set a header on the request that matters. The
// only thing a spec can influence is what the USER types — which reaches here
// inside the serialized input — so scenario selection is (schema name, keyword
// in the input) and nothing else.
//
// PLACEHOLDERS ARE FILLED FROM THE CONTEXT, WHICH IS THE POINT. A canned
// proposal carrying a made-up planId would be rejected by the hallucination
// guard (E06-03) and the e2e would prove nothing except that the guard works.
// Reading the ids back out of the rendered context is what makes the fake
// coach a coach that answers about THIS user's plan — and it is why
// `renderForPrompt` emits `planId=`, `routineId=` and `commitmentId=` lines.
//
// Returning `null` means "no scenario": the caller falls back to the generic
// schema-driven placeholder generator, so every persona this file says nothing
// about still gets a conforming answer.
//
// ZERO DEPENDENCIES, ESM. Same constraints as `server.mjs`: it runs from a
// read-only bind mount with no install step.
// =============================================================================

/**
 * Pull the first `key=<uuid>` the context renderer emitted.
 *
 * The lookbehind is load-bearing: without it `planId` would also match
 * `appliedPlanVersionId=` or any other key ending in the same letters, and the
 * uuid it found would belong to something else — which the hallucination guard
 * would reject, turning a scenario bug into an apparent coach failure.
 */
export function firstId(input, key) {
  const match = new RegExp(`(?<![A-Za-z])${key}=([0-9a-fA-F-]{36})`).exec(input);
  return match ? match[1] : null;
}

/** The whole request, flattened to one searchable string. */
function serialize(body) {
  const parts = [];
  const walk = (value) => {
    if (typeof value === 'string') parts.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  walk(body?.input);
  walk(body?.instructions);
  return parts.join('\n');
}

/**
 * The E07-03 friction reply (issue #122, epic E07).
 *
 * Selected by `requiredInterventionType`, which `FrictionService` puts in the
 * input — the coach is being asked for WORDING for a decision that has already
 * been made, and echoing the type is what a well-behaved model does.
 *
 * The sentinel `force-wrong-intervention` in the user's own free text makes it
 * misbehave instead, claiming `GOAL_CHALLENGE`. A HEADER would have been the
 * obvious lever and is unusable here for the reason this file's header gives:
 * the API calls this server, the browser does not, so the only thing a
 * Playwright spec can influence is what the user types.
 */
function workFrictionReply(input) {
  const required = /"requiredInterventionType":"([A-Z_]+)"/.exec(input)?.[1];
  if (!required) return null;

  const commitmentId = /"commitment":\{"id":"([0-9a-fA-F-]{36})"/.exec(input)?.[1] ?? null;
  const misbehave = /force-wrong-intervention/i.test(input);

  return {
    intervention_type: misbehave ? 'GOAL_CHALLENGE' : required,
    reasoning_summary: 'They said what is making it hard; this is the smallest next move.',
    user_message:
      "Let's stop treating this like one task. Write only the storyline: decision, recommendation, three arguments.",
    recommended_action: {
      title: 'Write only the storyline: decision, recommendation, three arguments',
      duration_minutes: 10,
      commitmentId,
    },
    fallback_action: null,
    proposal: null,
    friction_question: null,
  };
}

function coachReply(input) {
  // E07-03's friction turn, which is the coach being asked for wording rather
  // than for a decision. Checked first: its input carries a required
  // intervention type that no other coach call does.
  const friction = workFrictionReply(input);
  if (friction) return friction;

  // "My schedule changed. I can't work out Wednesday anymore." — PRD §68's
  // sentence, and the one the epic's whole loop is named after.
  if (/wednesday/i.test(input)) {
    const planId = firstId(input, 'planId');
    const routineId = firstId(input, 'routineId');

    // Without both ids there is no honest proposal to make. Falling through to
    // the normal reply is better than emitting a made-up uuid the guard would
    // reject — that would look like a coach failure rather than a seed failure.
    if (planId && routineId) {
      return {
        intervention_type: 'PLAN_CHALLENGE',
        reasoning_summary:
          'You said Wednesday evenings no longer work, and Wednesday is the only slot this routine has.',
        user_message:
          'Wednesday is the only slot this has. Want to move it to Saturday morning instead?',
        recommended_action: null,
        fallback_action: null,
        proposal: {
          kind: 'plan_change',
          planId,
          summary: 'Move Wednesday workout to Saturday morning',
          changes: [
            {
              op: 'move',
              target: { type: 'routine', id: routineId },
              before: { preferredTime: '18:30', triggerValue: 'WED' },
              after: { preferredTime: '09:00', triggerValue: 'SAT' },
              reason: 'You said Wednesday no longer works.',
            },
          ],
        },
        friction_question: null,
      };
    }
  }

  if (/procrastinat/i.test(input)) {
    return {
      intervention_type: 'ACTIVATION_REDUCTION',
      reasoning_summary:
        'The full session is the thing being avoided, so the smallest version of it is the one worth naming.',
      user_message: 'Ten minutes is enough to break the stall. Want to start there?',
      recommended_action: {
        title: 'Ten minutes of the session',
        duration_minutes: 10,
        // Null when the context has no commitment today: an invented id would
        // be rejected by the guard and the reply would degrade for the wrong
        // reason.
        commitmentId: firstId(input, 'commitmentId'),
      },
      fallback_action: null,
      proposal: null,
      friction_question: null,
    };
  }

  return {
    intervention_type: 'NORMAL_REMINDER',
    reasoning_summary: 'Nothing is blocked; the next action just needs naming.',
    user_message: 'Your plan is on track. The next thing on it is the thing to do.',
    recommended_action: null,
    fallback_action: null,
    proposal: null,
    friction_question: null,
  };
}

/**
 * The weekly reviewer's six outputs (issue #89, epic E10).
 *
 * The proposal's ids are read back out of the rendered context for the same
 * reason the coach's are: `guardReviewOutput` drops any proposal naming a plan
 * or routine the user does not have, so a canned uuid would make the e2e prove
 * only that the guard works. `droppedProposals: 0` in the audit meta is the
 * assertion that the ids resolved.
 *
 * `routineIdFor` prefers the routine on the HEALTH plan block, because the
 * proposal is about the workout and a WORK routine listed first would produce a
 * change whose summary and target disagree.
 */
function weeklyReview(input) {
  const planId = healthPlanId(input) ?? firstId(input, 'planId');
  const routineId = routineIdFor(input, 'Strength workout') ?? firstId(input, 'routineId');

  const base = {
    whatWorked: [
      'Morning focus blocks: 4 of 5 done',
      'Health: fallback used once instead of skipping',
    ],
    whatDidNot: [
      'Evening workouts were moved twice',
      'One family dinner skipped for an unexpected conflict',
    ],
    patterns: [
      {
        observation: '4 of 5 morning commitments were completed; 1 of 3 evening ones',
        inference: 'Plans after 18:00 are less reliable than mornings',
        recommendation: 'Move the Wednesday workout to Saturday morning',
        confidence: 0.8,
        domain: 'HEALTH',
      },
    ],
    keepUnchanged: ['Morning focus block routine'],
    doNotAddYet: ['Do not add a second workout day yet'],
  };

  // Without both ids there is no honest proposal to make. Returning the five
  // other outputs is better than emitting a made-up uuid: the guard would drop
  // it, and the spec would report a coach failure rather than a seed failure.
  if (!planId || !routineId) return { ...base, proposedChanges: [] };

  return {
    ...base,
    proposedChanges: [
      {
        planId,
        summary: 'Move Wednesday workout to Saturday morning',
        changes: [
          {
            op: 'move',
            target: { type: 'routine', id: routineId },
            before: { preferredTime: '18:30', triggerValue: 'WED' },
            after: { preferredTime: '09:00', triggerValue: 'SAT' },
            reason: 'Evening sessions were moved twice; mornings held.',
          },
        ],
      },
    ],
  };
}

/** The `planId=` on the HEALTH plan line, if the context has one. */
function healthPlanId(input) {
  const line = input.split('\n').find((row) => /\[HEALTH\]/.test(row) && /planId=/.test(row));

  return line ? firstId(line, 'planId') : null;
}

/** The `routineId=` on the line naming this routine. */
function routineIdFor(input, title) {
  const line = input
    .split('\n')
    .find((row) => row.includes(title) && /routineId=/.test(row));

  return line ? firstId(line, 'routineId') : null;
}

function safetyDecision(input) {
  // Only the AMBIGUOUS middle reaches the model at all — a definite match is
  // decided by the pre-check with no request. So this only ever sees words
  // like "hurts".
  if (/hurts?|sore|tweak/i.test(input)) {
    return {
      decision: 'conservative',
      category: 'injury',
      rationale: 'minor post-exercise discomfort',
    };
  }

  return { decision: 'allow', category: 'none', rationale: 'ordinary coaching language' };
}

function insightProposal() {
  return {
    insights: [
      {
        category: 'HEALTH',
        statement: 'Morning workouts are more reliable than evening ones.',
        observation: '9 of 12 kept commitments were scheduled before noon.',
        evidenceCount: 12,
        confidence: 0.8,
      },
      {
        category: 'WORK',
        statement: 'Large ambiguous tasks get postponed.',
        observation: 'Every commitment rescheduled more than once had no named first step.',
        evidenceCount: 5,
        confidence: 0.5,
      },
    ],
  };
}


// ---------------------------------------------------------------------------
// The Health domain (epic E09, issue #114)
// ---------------------------------------------------------------------------

/**
 * A three-day upper/lower/upper week, using catalog names only.
 *
 * CATALOG NAMES MATTER. The resolver creates a custom exercise for anything it
 * cannot match, which would still pass — and would quietly stop testing the
 * resolution the e2e is there to prove.
 *
 * The `workout_program_unsafe` variant is selected by the word "shoulder" in
 * the request, which is what the user actually types into the limitations box.
 * It returns five training days for a beginner AND a barbell overhead press —
 * two independent rule violations, so the spec still fails loudly if one of
 * them is ever dropped.
 */
function workoutProgram(input) {
  const unsafe = /shoulder/i.test(input);

  const day = (name, exercises) => [
    { name, variant: 'FULL', targetMinutes: 40, exercises },
    {
      name,
      variant: 'SHORT',
      targetMinutes: 24,
      exercises: exercises.slice(0, 2),
    },
    {
      name,
      variant: 'MINIMUM',
      targetMinutes: 10,
      exercises: [{ ...exercises[0], sets: 2 }],
    },
  ];

  const exercise = (exerciseName, extra = {}) => ({
    exerciseName,
    sets: 3,
    repMin: 8,
    repMax: 12,
    restSeconds: 90,
    notes: null,
    ...extra,
  });

  const upperA = unsafe
    ? [exercise('Barbell Overhead Press'), exercise('Dumbbell Row')]
    : [exercise('Dumbbell Bench Press'), exercise('Dumbbell Row')];

  const templates = [
    ...day('Upper A', upperA),
    ...day('Lower', [exercise('Goblet Squat'), exercise('Dumbbell Romanian Deadlift')]),
    ...day('Upper B', [exercise('Incline Dumbbell Press'), exercise('Band Row')]),
  ];

  const weekdays = unsafe ? [1, 2, 3, 4, 5] : [1, 3, 5];
  const names = ['Upper A', 'Lower', 'Upper B', 'Upper A', 'Lower'];

  return {
    programName: unsafe ? 'Five-day split' : 'Three-day upper/lower',
    durationWeeks: 6,
    weeklyStructure: weekdays.map((weekday, index) => ({
      weekday,
      templateName: names[index],
    })),
    templates,
    progressionMethod: 'DOUBLE_PROGRESSION',
    substitutions: [
      { exerciseName: 'Dumbbell Bench Press', alternatives: ['Push-Up'] },
      { exerciseName: 'Dumbbell Row', alternatives: ['Band Row'] },
    ],
    rationale:
      'Three sessions a week on the movements that carry the most, with room to add ' +
      'weight once every set reaches the top of its range.',
  };
}

/**
 * A form check.
 *
 * "pain" anywhere in the request selects the redirecting variant — the word the
 * user's own discomfort report puts into the input. The API's post-processing
 * empties the cues either way; returning cues here is deliberate, so the spec
 * proves the SERVER withheld them rather than the model never offering any.
 */
function formCheck(input) {
  const painful = /pain|SHARP_PAIN/i.test(input);

  return {
    observations: painful
      ? ['The knee travels inward on the way up.']
      : [
          'The bar drifts forward as you stand up.',
          'The last rep is noticeably slower than the first.',
        ],
    cues: [
      'Think about pushing the floor away rather than lifting the bar.',
      'Stop one rep before the bar slows down.',
    ],
    riskFlags: painful ? ['pain_reported'] : ['none'],
    safetyNote: null,
    confidence: 'medium',
  };
}

function equipmentCheck() {
  return {
    equipmentDetected: ['DUMBBELL', 'BENCH'],
    notes: ['A corner of a room with a bench and a rack of dumbbells.'],
  };
}

/** No number appears anywhere here, and the API's guard would reject one. */
function mealCheck() {
  return {
    observations: [
      'A protein source and a green vegetable on the plate.',
      'Eaten at a table rather than at a desk.',
    ],
    behaviorSuggestions: [
      {
        key: 'vegetables_with_dinner',
        text: 'Keep something green on the plate at dinner like this.',
      },
    ],
  };
}

/**
 * The generic "ask the coach about this" answer (issue #96, epic E03).
 *
 * Two branches, both selected by what the USER TYPED, because that is the only
 * thing a Playwright spec can influence — the API calls this server, the
 * browser does not.
 *
 * The MEAL branch contains no number of any kind. A photograph of food invites
 * a calorie count, PRD §46 is the answer to it, and a fixture that quietly
 * produced one would make the e2e assertion pass against the wrong behaviour.
 */
function mediaAdvice(input) {
  const seekProfessional = /pain|numb|gave way|instability/i.test(input);
  const meal = /breakfast|meal|plate|eat|food/i.test(input);

  if (seekProfessional) {
    return {
      summary: 'Something is happening at the bottom of the movement.',
      observations: ['The left knee moves inward and the rep stalls.'],
      advice: ['Stop here for today.'],
      safetyFlag: {
        level: 'seek_professional',
        reason: 'You describe pain, and a joint that gives way under load.',
      },
    };
  }

  if (meal) {
    return {
      summary: 'A reasonable plate — there is a protein source and some colour.',
      observations: [
        'There is a clear protein source.',
        'About a third of the plate is vegetables.',
      ],
      advice: ['Add something green to the other meals of the day too.'],
      safetyFlag: { level: 'none', reason: '' },
    };
  }

  return {
    summary: 'Your setup looks steady through the whole rep.',
    observations: [
      'Your feet stay under the bar.',
      'The bar path is close to vertical.',
    ],
    advice: [
      'Brace hard before you unrack.',
      'Stop one rep before the bar slows down.',
    ],
    safetyFlag: {
      level: 'caution',
      reason: 'Your back rounds slightly on the last rep.',
    },
  };
}

function progressionExplanation() {
  return {
    sentence: 'Two sessions at the top of the range and comfortable — 22.5 kg today.',
  };
}

/**
 * A five-session work plan (issue #122, epic E07).
 *
 * DATES ARE COMPUTED AT REQUEST TIME, from the `today` the planner was given,
 * so the guardrails hold whenever the suite runs. A canned set of timestamps
 * would pass on the day it was written and turn into a 503 the following week —
 * a failure that reads like a broken planner rather than a stale fixture.
 *
 * Times are NOON UTC. It is the one hour that lands on the same calendar day in
 * every zone from UTC-11 to UTC+11, which is what keeps the "at most two
 * sessions per local day" and "not in the past" rules satisfied without this
 * server having to resolve a wall-clock time in an arbitrary timezone.
 */
function workSessionPlan(input) {
  const today = /"today":"(\d{4}-\d{2}-\d{2})"/.exec(input)?.[1];
  if (!today) return null;

  const targetDate = /"targetDate":"(\d{4}-\d{2}-\d{2})"/.exec(input)?.[1] ?? null;
  const budget = Number(/"availableMinutesPerDay":(\d+)/.exec(input)?.[1] ?? 45);

  // 25/45/30/30/15 as the epic asks, clamped to what the user said they have
  // and never below the contract's ten-minute floor.
  const durations = [25, 45, 30, 30, 15].map((minutes) =>
    Math.max(10, Math.min(minutes, budget)),
  );

  const titles = [
    'Storyline: decision, recommendation, three arguments',
    'Build the evidence slides for the recommendation',
    'Draft the financial case',
    'Tighten the narrative and cut the filler',
    'Read it end to end and fix what jars',
  ];

  const days = [];
  const cursor = new Date(`${today}T12:00:00.000Z`);

  while (days.length < 5) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);

    const weekday = cursor.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;

    const iso = cursor.toISOString();
    if (targetDate && iso.slice(0, 10) > targetDate) break;

    days.push(iso);
  }

  if (days.length === 0) return null;

  return {
    milestones: [
      { title: 'One-page storyline exists', order: 0 },
      { title: 'A complete rough deck exists', order: 1 },
      { title: 'The deck is ready to present', order: 2 },
    ],
    sessions: days.map((scheduledStart, index) => ({
      title: `${durations[index]} min — ${titles[index]}`,
      scheduledStart,
      durationMinutes: durations[index],
      milestoneIndex: Math.min(2, Math.floor((index * 3) / days.length)),
      minimumStart: {
        title: 'Open the deck and write the decision sentence',
        minutes: Math.max(2, Math.min(10, durations[index] - 5)),
      },
    })),
    implementationIntention: {
      when: 'After I sit down with coffee',
      then: 'I open the deck and start the next session',
    },
    reviewCadence: 'WEEKLY',
    rationale:
      'Five weekday blocks, front-loaded on the storyline: the argument has to exist before ' +
      'the slides are worth making.',
  };
}


// ---------------------------------------------------------------------------
// The first Path (epic E04, issue #107)
// ---------------------------------------------------------------------------

/**
 * A first-week plan for whichever domains the user selected.
 *
 * DATES ARE COMPUTED AT REQUEST TIME, from the `today` the planner was given,
 * for the same reason `workSessionPlan` does it: the API's guardrails reject
 * anything outside `[today - 1, today + 8]` in the user's own zone, so a canned
 * set of timestamps would pass on the day it was written and turn into a 503
 * the following week — a failure that reads like a broken planner rather than a
 * stale fixture.
 *
 * Times are NOON UTC, the one hour that lands on the same calendar day in every
 * zone from UTC-11 to UTC+11. That keeps the first-week window satisfied
 * without this server having to resolve a wall-clock time in an arbitrary
 * timezone.
 *
 * `reduceLoad: true` in the input — which only the confidence path sends — makes
 * it return one fewer routine with `reducedFromRequest: true`, so the e2e can
 * prove PRD §72's loop end to end.
 */
function onboardingProposal(input) {
  const today = /"today":"(\d{4}-\d{2}-\d{2})"/.exec(input)?.[1];
  if (!today) return null;

  const reduce = /"reduceLoad":true/.test(input);

  // The domains the user actually chose, in the order the answers list them.
  // A proposal naming a domain they did not select is rejected by the
  // guardrails, so reading them back out is what makes this a fixture rather
  // than a coin toss.
  const selected = (/"domains":\[([^\]]*)\]/.exec(input)?.[1] ?? '')
    .split(',')
    .map((entry) => entry.replace(/[^A-Z_]/g, ''))
    .filter((entry) => ['WORK', 'FAMILY', 'HEALTH'].includes(entry));

  const domains = selected.length > 0 ? selected : ['WORK'];

  // Minutes the user said they have. Split across the domains that share a day
  // so no single day exceeds it — the guardrail the API checks last.
  const budget = Number(/"weekdayMinutes":(\d+)/.exec(input)?.[1] ?? 45);
  const minutes = Math.max(10, Math.min(25, Math.floor(budget / domains.length)));

  const SPEC = {
    WORK: {
      identity: 'Someone who protects the work that matters',
      outcome: 'Protect my most important work',
      why: 'The day fills with other people\u2019s priorities unless the first hour is mine.',
      success: 'Three mornings a week begin with the most important task.',
      routine: 'Start the most important task before email',
      trigger: 'Mon,Wed,Fri',
      fallback: 'Open the task and write the first sentence',
      short: '15 minutes on the most important task',
    },
    FAMILY: {
      identity: 'Someone who is present with the people at the table',
      outcome: 'Be present with the people I care about',
      why: 'Attention is what they will remember, and it is the first thing work takes.',
      success: 'Three evenings a week are phone-free.',
      routine: 'Phone-free dinner',
      trigger: 'Tue,Thu,Sun',
      fallback: 'Ten minutes of undivided attention',
      short: 'Phone-free for the first fifteen minutes',
    },
    HEALTH: {
      identity: 'Someone who trains whether or not the week cooperates',
      outcome: 'Train consistently',
      why: 'Consistency is what changes, and it is what stops first when the week gets hard.',
      success: 'Three sessions a week happen, even the short ones.',
      routine: 'Strength session',
      trigger: 'Mon,Wed,Sat',
      fallback: 'A 10-minute walk',
      short: 'A 15-minute session',
    },
  };

  // One routine per domain, minus one when asked to reduce — never fewer than
  // one, because the contract requires at least one commitment.
  const withRoutines = reduce && domains.length > 1 ? domains.slice(0, -1) : domains;

  const dayAfter = (offset) => {
    const at = new Date(`${today}T12:00:00.000Z`);
    at.setUTCDate(at.getUTCDate() + offset);
    return at.toISOString();
  };

  return {
    bestSelf: {
      identityStatement: domains.map((d) => SPEC[d].identity).join('. ') + '.',
      workIdentity: domains.includes('WORK') ? SPEC.WORK.identity : null,
      familyIdentity: domains.includes('FAMILY') ? SPEC.FAMILY.identity : null,
      healthIdentity: domains.includes('HEALTH') ? SPEC.HEALTH.identity : null,
      sixMonthVision: /"sixMonthVision":"([^"]*)"/.exec(input)?.[1] ?? 'A steadier six months',
    },
    outcomes: domains.map((domain) => ({
      domain,
      title: SPEC[domain].outcome,
      whyItMatters: SPEC[domain].why,
      successDefinition: SPEC[domain].success,
    })),
    routines: withRoutines.map((domain) => ({
      domain,
      title: SPEC[domain].routine,
      triggerType: 'WEEKDAYS',
      triggerValue: SPEC[domain].trigger,
      frequency: '3x per week',
      idealMinutes: minutes,
      minimumMinutes: 10,
      fallbackBehavior: SPEC[domain].fallback,
    })),
    // One commitment per routine, on consecutive days inside the first week, so
    // no single day carries more than one domain's minutes.
    firstWeekCommitments: withRoutines.map((domain, index) => ({
      domain,
      title: SPEC[domain].routine,
      scheduledStart: dayAfter(index + 1),
      durationMinutes: minutes,
      fullVersion: SPEC[domain].routine,
      shortVersion: SPEC[domain].short,
      minimumVersion: SPEC[domain].fallback,
    })),
    rationale: reduce
      ? 'I took one thing out. What is left is what a difficult week can still carry.'
      : 'Three behaviours at most, each with a version that survives a bad day.',
    reducedFromRequest: reduce,
  };
}

const SCENARIOS = {
  coach_reply: coachReply,
  onboarding_proposal: onboardingProposal,
  work_session_plan: workSessionPlan,
  safety_decision: safetyDecision,
  insight_proposal: insightProposal,
  weekly_review: weeklyReview,
  workout_program: workoutProgram,
  form_check: formCheck,
  equipment_check: equipmentCheck,
  meal_check: mealCheck,
  progression_explanation: progressionExplanation,
  media_advice: mediaAdvice,
};

/**
 * The answer for this request, or `null` to fall back to the generic builder.
 *
 * @param {object} body The `/v1/responses` request body.
 */
export function matchScenario(body) {
  const name = body?.text?.format?.name;
  const scenario = SCENARIOS[name];

  return scenario ? scenario(serialize(body)) : null;
}
