// =============================================================================
// The scenario matcher (issue #93, epic E06)
// =============================================================================
//
// `node --test tools/fake-openai/` — zero dependencies, like everything else
// under this directory. It runs outside both workspace suites because the file
// under test is ESM served from a read-only bind mount and belongs to neither.
//
// WHAT THIS ACTUALLY PROTECTS: the e2e suite is the only consumer, and when a
// scenario is wrong the failure surfaces as "the coach degraded" ten minutes
// into a container run. These assertions turn that into a one-second one.
// =============================================================================

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { firstId, matchScenario } from './index.mjs';

const PLAN = '11111111-1111-4111-8111-111111111111';
const ROUTINE = '22222222-2222-4222-8222-222222222222';
const COMMITMENT = '33333333-3333-4333-8333-333333333333';

/** A request shaped the way the gateway sends one. */
const request = (name, input) => ({
  model: 'gpt-5.4',
  store: false,
  instructions: 'You are the coaching reasoner…',
  input: [{ type: 'text', text: input }],
  text: { format: { type: 'json_schema', name, schema: {} } },
});

/** The context lines `renderForPrompt` emits, as the coach would see them. */
const context = [
  'ACTIVE PLANS:',
  `- [HEALTH] Get strong again | planId=${PLAN} | v1 | weeklyLoadMin=120 | why=`,
  `  * Strength workout | routineId=${ROUTINE} | WEEKLY | days=Wed | at=18:30 | 40min (min 10) | fallback= | active=true`,
  "TODAY'S COMMITMENTS:",
  `- [HEALTH] Strength workout | commitmentId=${COMMITMENT} | PLANNED | at=2026-09-09T18:30:00.000Z | full=40 | min=10 | rescheduled=0`,
].join('\n');

describe('matchScenario', () => {
  it('falls back to the generic builder for a schema it says nothing about', () => {
    // `null` is the whole fallback contract: every persona this file is silent
    // about still gets a conforming answer from `buildFromSchema`.
    assert.equal(matchScenario(request('connection_probe', 'hello')), null);
    assert.equal(matchScenario({}), null);
  });

  describe('coach_reply', () => {
    it('proposes the Wednesday move using the ids from the context', () => {
      const reply = matchScenario(
        request('coach_reply', `${context}\nI can't work out Wednesday anymore`),
      );

      assert.equal(reply.intervention_type, 'PLAN_CHALLENGE');
      // The ids come out of the CONTEXT, not out of this file. A canned uuid
      // would be rejected by the hallucination guard, and the e2e would then
      // prove only that the guard works.
      assert.equal(reply.proposal.planId, PLAN);
      assert.equal(reply.proposal.changes[0].target.id, ROUTINE);
      assert.equal(reply.proposal.changes[0].op, 'move');
      assert.equal(reply.proposal.changes[0].after.preferredTime, '09:00');
    });

    it('declines to invent ids when the context has none', () => {
      const reply = matchScenario(
        request('coach_reply', "I can't work out Wednesday anymore"),
      );

      // A made-up uuid would look like a coach failure rather than the seed
      // failure it actually is.
      assert.equal(reply.proposal, null);
      assert.equal(reply.intervention_type, 'NORMAL_REMINDER');
    });

    it('offers a start action for procrastination, keyed to a real commitment', () => {
      const reply = matchScenario(
        request('coach_reply', `${context}\nI'm procrastinating`),
      );

      assert.equal(reply.intervention_type, 'ACTIVATION_REDUCTION');
      assert.equal(reply.recommended_action.commitmentId, COMMITMENT);
      assert.equal(reply.recommended_action.duration_minutes, 10);
    });

    it('nulls the commitment id rather than inventing one', () => {
      const reply = matchScenario(request('coach_reply', "I'm procrastinating"));

      assert.equal(reply.recommended_action.commitmentId, null);
    });

    it('answers anything else with a normal reminder and no proposal', () => {
      const reply = matchScenario(request('coach_reply', `${context}\nhow am I doing`));

      assert.equal(reply.intervention_type, 'NORMAL_REMINDER');
      assert.equal(reply.proposal, null);
      assert.equal(reply.friction_question, null);
    });

    it('always fills every key the strict schema requires', () => {
      for (const text of ['Wednesday', 'procrastinating', 'anything']) {
        const reply = matchScenario(request('coach_reply', `${context}\n${text}`));

        // Strict mode makes every declared property required, so a missing key
        // is a validation failure at the gateway rather than a null here.
        for (const key of [
          'intervention_type',
          'reasoning_summary',
          'user_message',
          'recommended_action',
          'fallback_action',
          'proposal',
          'friction_question',
        ]) {
          assert.ok(key in reply, `${text}: missing ${key}`);
        }
      }
    });
  });

  describe('safety_decision', () => {
    it('is conservative about ambiguous soreness', () => {
      const decision = matchScenario(
        request('safety_decision', 'my knee hurts a bit after squats'),
      );

      assert.equal(decision.decision, 'conservative');
      assert.equal(decision.category, 'injury');
    });

    it('allows ordinary coaching language', () => {
      const decision = matchScenario(request('safety_decision', 'help me plan my week'));

      assert.equal(decision.decision, 'allow');
      assert.equal(decision.category, 'none');
    });

    it('is never asked about a definite match', () => {
      // The pre-check decides those with no request at all, so this server
      // never sees "chest pain". Asserted so a future scenario author does not
      // add a redirect branch that could only ever be dead code.
      const decision = matchScenario(
        request('safety_decision', 'I have sharp chest pain when I run'),
      );

      assert.notEqual(decision.decision, 'redirect');
    });
  });

  it('proposes two insights, each with an observation behind it', () => {
    const proposal = matchScenario(request('insight_proposal', 'stats'));

    assert.equal(proposal.insights.length, 2);
    for (const insight of proposal.insights) {
      // PRD §14.4: the observation is the fact, the statement is the
      // inference, and a proposal without both cannot be reviewed.
      assert.ok(insight.observation.length > 0);
      assert.ok(insight.statement.length > 0);
      assert.ok(insight.confidence > 0 && insight.confidence <= 1);
    }
  });
});

describe('firstId', () => {
  it('reads the first uuid for a key', () => {
    assert.equal(firstId(context, 'planId'), PLAN);
    assert.equal(firstId(context, 'routineId'), ROUTINE);
    assert.equal(firstId(context, 'commitmentId'), COMMITMENT);
  });

  it('is null when the key is absent', () => {
    assert.equal(firstId('nothing here', 'planId'), null);
  });

  it('is not fooled by a longer key ending the same way', () => {
    // `planId` must not be satisfied by `appliedPlanVersionId=`: the uuid it
    // found would belong to something else, and the guard would reject it —
    // turning a scenario bug into an apparent coach failure.
    assert.equal(firstId(`appliedPlanVersionId=${PLAN}`, 'planId'), null);
    assert.equal(
      firstId(`appliedPlanVersionId=${ROUTINE}\nplanId=${PLAN}`, 'planId'),
      PLAN,
    );
  });
});
