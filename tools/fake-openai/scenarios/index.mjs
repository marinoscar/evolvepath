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

function coachReply(input) {
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

const SCENARIOS = {
  coach_reply: coachReply,
  safety_decision: safetyDecision,
  insight_proposal: insightProposal,
  weekly_review: weeklyReview,
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
