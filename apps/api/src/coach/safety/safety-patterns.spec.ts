import { SAFETY_RULES, matchRules } from './safety-patterns';

// =============================================================================
// Properties of the rule table itself (issue #82)
// =============================================================================
//
// Every assertion here is about a mistake that is easy to make when ADDING a
// rule, which is the only thing anyone will ever do to this file. A duplicate
// id silently overwrites another rule's audit trail; a missing `i` flag makes a
// rule fail on the one message that is shouted; a regex that matches the empty
// string redirects every user in the product.
// =============================================================================

describe('SAFETY_RULES (#82)', () => {
  it('gives every rule a unique id', () => {
    const ids = SAFETY_RULES.map((rule) => rule.id);

    // Ids are written to `ai_invocations.safetyDecision` and to the log line;
    // two rules sharing one makes "which rule fired?" unanswerable.
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('makes every pattern case-insensitive', () => {
    for (const rule of SAFETY_RULES) {
      expect(rule.pattern.flags).toContain('i');
    }
  });

  it('matches nothing on the empty string', () => {
    for (const rule of SAFETY_RULES) {
      expect(rule.pattern.test('')).toBe(false);
    }
    expect(matchRules('')).toEqual([]);
  });

  it('never carries the global flag', () => {
    // `/g` makes `test()` stateful via lastIndex: the same rule would match on
    // one call and not the next. Nothing in the table needs it.
    for (const rule of SAFETY_RULES) {
      expect(rule.pattern.flags).not.toContain('g');
    }
  });

  it('leaves ordinary coaching language alone', () => {
    // PRD §82: the product may use ordinary behavior-change language. A layer
    // that redirects "my legs are sore" is one the user stops talking to.
    const ordinary = [
      'legs are sore from yesterday',
      "I'm tired today",
      'work has been stressful',
      'I want to lose some weight this year',
      'help me plan my week',
      'I keep putting off the report',
    ];

    for (const text of ordinary) {
      expect(matchRules(text)).toEqual([]);
    }
  });

  it('puts crisis rules first so they win every tie', () => {
    const firstNonCrisis = SAFETY_RULES.findIndex(
      (rule) => rule.category !== 'crisis',
    );
    const lastCrisis = SAFETY_RULES.map((r) => r.category).lastIndexOf('crisis');

    expect(lastCrisis).toBeLessThan(firstNonCrisis);

    // The property that ordering buys: a message about both is a crisis message.
    const matched = matchRules('my knee hurts and I want to end my life');
    expect(matched[0].category).toBe('crisis');
  });
});
