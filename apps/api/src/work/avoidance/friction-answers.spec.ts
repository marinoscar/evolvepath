import { INTERVENTION_TYPES } from '../../coach/contracts/coach-reply.contract';
import { ObstacleType } from '@prisma/client';
import { FRICTION_ANSWERS, FRICTION_ANSWER_KEYS, frictionRuleFor } from './friction-answers';
import { templateInterventionFor } from './friction-templates';

// =============================================================================
// The eight answers (issue #116)
// =============================================================================
//
// The point of the question is that the answers go somewhere DIFFERENT. These
// cases hold that: eight keys, eight rules, and no two answers producing the
// same first move.
// =============================================================================

const ctx = {
  commitmentTitle: 'Finish the strategy presentation',
  minimum: { title: 'Open the deck and write one line', durationMinutes: 5 },
  motivation: 'The board decides budget on it',
  suggestedReschedule: {
    scheduledStart: '2026-09-09T09:00:00.000Z',
    scheduledEnd: '2026-09-09T09:25:00.000Z',
  },
  text: null,
};

describe('FRICTION_ANSWERS', () => {
  it('has exactly the eight VISION §9 answers, in dialog order', () => {
    expect(FRICTION_ANSWERS.map((rule) => rule.key)).toEqual([...FRICTION_ANSWER_KEYS]);
    expect(FRICTION_ANSWERS).toHaveLength(8);
  });

  it.each(FRICTION_ANSWERS)('$key maps to a real intervention type and obstacle', (rule) => {
    expect(INTERVENTION_TYPES).toContain(rule.interventionType);
    expect(Object.values(ObstacleType)).toContain(rule.obstacleType);
    expect(rule.label.length).toBeGreaterThan(3);
  });

  it('follows VISION §9\'s worked example: too big decomposes, not knowing activates', () => {
    expect(frictionRuleFor('TOO_BIG').interventionType).toBe('DECOMPOSITION');
    expect(frictionRuleFor('DONT_KNOW_WHERE_TO_BEGIN').interventionType).toBe(
      'ACTIVATION_REDUCTION',
    );
  });
});

describe('templateInterventionFor', () => {
  it.each(FRICTION_ANSWER_KEYS)('%s produces the mapped intervention type', (answer) => {
    const intervention = templateInterventionFor(answer, ctx);

    expect(intervention.interventionType).toBe(frictionRuleFor(answer).interventionType);
    expect(intervention.source).toBe('template');
    expect(intervention.userMessage.length).toBeGreaterThan(0);
  });

  it.each(FRICTION_ANSWER_KEYS)('%s recommends at most ten minutes', (answer) => {
    const action = templateInterventionFor(answer, ctx).recommendedAction;

    if (action) expect(action.durationMinutes).toBeLessThanOrEqual(10);
  });

  it('TIRED offers the commitment\'s own minimum version', () => {
    expect(templateInterventionFor('TIRED', ctx).recommendedAction).toEqual(ctx.minimum);
  });

  it('DONT_WANT_TO quotes the outcome\'s motivation', () => {
    expect(templateInterventionFor('DONT_WANT_TO', ctx).userMessage).toContain(
      'The board decides budget on it',
    );
  });

  it('DONT_WANT_TO reads sensibly when there is no motivation', () => {
    const message = templateInterventionFor('DONT_WANT_TO', { ...ctx, motivation: null })
      .userMessage;

    expect(message).not.toContain('null');
    expect(message).toContain('five minutes');
  });

  it('TOO_BIG names the commitment in its first move', () => {
    const action = templateInterventionFor('TOO_BIG', ctx).recommendedAction;

    expect(action?.title).toContain('Finish the strategy presentation');
  });

  it('SOMETHING_URGENT offers a slot and no action — the move IS the action', () => {
    const intervention = templateInterventionFor('SOMETHING_URGENT', ctx);

    expect(intervention.recommendedAction).toBeNull();
    expect(intervention.suggestedReschedule).toEqual(ctx.suggestedReschedule);
  });

  it('WORRIED_ABOUT_QUALITY says a rough draft is the goal', () => {
    expect(templateInterventionFor('WORRIED_ABOUT_QUALITY', ctx).userMessage).toContain(
      'rough draft',
    );
  });

  it('falls back to a generic minimum when the commitment declares none', () => {
    const action = templateInterventionFor('TIRED', { ...ctx, minimum: null }).recommendedAction;

    expect(action).toEqual({
      title: 'Open the work and write the next three bullets',
      durationMinutes: 10,
    });
  });

  it('carries no motivational theatre (VISION §9)', () => {
    for (const answer of FRICTION_ANSWER_KEYS) {
      const { userMessage, recommendedAction } = templateInterventionFor(answer, ctx);
      const copy = `${userMessage} ${recommendedAction?.title ?? ''}`;

      expect(copy).not.toMatch(/!/);
      expect(copy).not.toMatch(/you've got this|great job|well done|amazing/i);
    }
  });
});
