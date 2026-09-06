import { INTERVENTION_TYPES } from '../../coach/contracts/coach-reply.contract';
import {
  AvoidanceLevel,
  INTERVENTION_TYPE_BY_LEVEL,
  detectAvoidance,
  type AvoidanceSignals,
} from './avoidance-detector';

// =============================================================================
// One case per level, and one per rule (issue #116)
// =============================================================================
//
// The most important cases in this file are the first four: a single
// reschedule, a single skip and a single "later" must each yield level 0. PRD
// §25 says avoidance must not be inferred from one miss, and everything else
// the ladder does is only defensible if that holds.
// =============================================================================

const zero: AvoidanceSignals = {
  rescheduleCount: 0,
  daysUnchanged: 0,
  shortSkipCount: 0,
  explicitLaterCount: 0,
  displacedByLowerImportanceCount: 0,
  sameWindowFailureCount: 0,
  weeksOfEvidence: 0,
};

const s = (over: Partial<AvoidanceSignals> = {}): AvoidanceSignals => ({ ...zero, ...over });

describe('detectAvoidance — one occurrence is never avoidance (PRD §25)', () => {
  it.each([
    ['nothing at all', s()],
    ['a single reschedule', s({ rescheduleCount: 1 })],
    ['a single skip', s({ shortSkipCount: 1 })],
    ['a single "later" on its own', s({ explicitLaterCount: 1 })],
    ['two days untouched', s({ daysUnchanged: 2 })],
    ['one displacement', s({ displacedByLowerImportanceCount: 1 })],
    ['two same-window failures', s({ sameWindowFailureCount: 2 })],
  ])('%s stays at level 0', (_label, signals) => {
    const result = detectAvoidance(signals);

    expect(result.level).toBe(AvoidanceLevel.NORMAL_REMINDER);
    expect(result.signals).toEqual([]);
    expect(result.suggestedAction).toBe('NONE');
  });
});

describe('detectAvoidance — the levels', () => {
  it('three days untouched is level 1 and asks for the minimum', () => {
    const result = detectAvoidance(s({ daysUnchanged: 3 }));

    expect(result.level).toBe(AvoidanceLevel.ACTIVATION_REDUCTION);
    expect(result.signals).toEqual(['UNCHANGED_3_DAYS']);
    expect(result.suggestedAction).toBe('MINIMUM');
  });

  it('a fourth untouched day steps to level 2', () => {
    expect(detectAvoidance(s({ daysUnchanged: 4 })).level).toBe(AvoidanceLevel.DECOMPOSITION);
  });

  it('two short skips is level 2 and asks to break it down', () => {
    const result = detectAvoidance(s({ shortSkipCount: 2 }));

    expect(result.level).toBe(AvoidanceLevel.DECOMPOSITION);
    expect(result.suggestedAction).toBe('DECOMPOSE');
  });

  it('moved twice is level 3 and asks the VISION §9 question', () => {
    const result = detectAvoidance(s({ rescheduleCount: 2 }));

    expect(result.level).toBe(AvoidanceLevel.FRICTION_DIAGNOSIS);
    expect(result.interventionType).toBe('FRICTION_DIAGNOSIS');
    expect(result.signals).toEqual(['RESCHEDULED_TWICE']);
    expect(result.suggestedAction).toBe('FRICTION_QUESTION');
  });

  it('having asked once, level 3 offers decomposition instead', () => {
    const result = detectAvoidance(s({ rescheduleCount: 2 }), { askedRecently: true });

    expect(result.level).toBe(AvoidanceLevel.FRICTION_DIAGNOSIS);
    expect(result.suggestedAction).toBe('DECOMPOSE');
  });

  it('a third reschedule steps to level 4', () => {
    expect(detectAvoidance(s({ rescheduleCount: 3 })).level).toBe(
      AvoidanceLevel.ENVIRONMENT_CHANGE,
    );
  });

  it('two explicit "laters" is level 3 on its own', () => {
    expect(detectAvoidance(s({ explicitLaterCount: 2 })).level).toBe(
      AvoidanceLevel.FRICTION_DIAGNOSIS,
    );
  });

  it('one "later" alongside another signal corroborates without carrying its rung', () => {
    const result = detectAvoidance(s({ explicitLaterCount: 1, daysUnchanged: 3 }));

    // base 1 from UNCHANGED_3_DAYS, plus 1 for the corroborating "later".
    expect(result.level).toBe(AvoidanceLevel.DECOMPOSITION);
    expect(result.signals).toEqual(['EXPLICIT_LATER', 'UNCHANGED_3_DAYS']);
  });

  it('two displacements is level 4 and asks about the environment', () => {
    const result = detectAvoidance(s({ displacedByLowerImportanceCount: 2 }));

    expect(result.level).toBe(AvoidanceLevel.ENVIRONMENT_CHANGE);
    expect(result.suggestedAction).toBe('ENVIRONMENT');
  });
});

describe('detectAvoidance — the caps on challenging the plan and the goal', () => {
  it('caps at 4 with less than three weeks of evidence', () => {
    expect(detectAvoidance(s({ rescheduleCount: 4, weeksOfEvidence: 1 })).level).toBe(
      AvoidanceLevel.ENVIRONMENT_CHANGE,
    );
  });

  it('caps at 4 without the same-window signal, even after three weeks', () => {
    expect(
      detectAvoidance(s({ rescheduleCount: 4, weeksOfEvidence: 3, sameWindowFailureCount: 0 }))
        .level,
    ).toBe(AvoidanceLevel.ENVIRONMENT_CHANGE);
  });

  it('three failures in the same window after three weeks is level 5', () => {
    const result = detectAvoidance(s({ sameWindowFailureCount: 3, weeksOfEvidence: 3 }));

    expect(result.level).toBe(AvoidanceLevel.PLAN_CHALLENGE);
    expect(result.suggestedAction).toBe('PLAN_REVIEW');
  });

  it('the same window plus repeated moves reaches level 6', () => {
    const result = detectAvoidance(
      s({ sameWindowFailureCount: 4, rescheduleCount: 3, weeksOfEvidence: 3 }),
    );

    expect(result.level).toBe(AvoidanceLevel.GOAL_CHALLENGE);
    expect(result.interventionType).toBe('GOAL_CHALLENGE');
  });

  it('the same window with only two weeks of evidence stays at 4', () => {
    expect(
      detectAvoidance(s({ sameWindowFailureCount: 3, weeksOfEvidence: 2 })).level,
    ).toBe(AvoidanceLevel.ENVIRONMENT_CHANGE);
  });

  it('never exceeds 6', () => {
    expect(
      detectAvoidance(
        s({
          rescheduleCount: 20,
          daysUnchanged: 40,
          shortSkipCount: 20,
          explicitLaterCount: 20,
          displacedByLowerImportanceCount: 20,
          sameWindowFailureCount: 20,
          weeksOfEvidence: 50,
        }),
      ).level,
    ).toBe(AvoidanceLevel.GOAL_CHALLENGE);
  });
});

describe('detectAvoidance — the shape of what it returns', () => {
  it.each([0, 1, 2, 3, 4, 5, 6])(
    'level %i names an INTERVENTION_TYPES member matching AvoidanceLevel',
    (level) => {
      expect(INTERVENTION_TYPE_BY_LEVEL[level]).toBe(AvoidanceLevel[level]);
      expect(INTERVENTION_TYPES).toContain(INTERVENTION_TYPE_BY_LEVEL[level]);
    },
  );

  it('lists exactly the active keys', () => {
    const result = detectAvoidance(
      s({ rescheduleCount: 2, daysUnchanged: 3, shortSkipCount: 1 }),
    );

    expect(result.signals).toEqual(['RESCHEDULED_TWICE', 'UNCHANGED_3_DAYS']);
  });

  it('puts the numbers in the rationale', () => {
    const result = detectAvoidance(s({ rescheduleCount: 2, daysUnchanged: 4 }));

    expect(result.rationale).toContain('moved 2 times');
    expect(result.rationale).toContain('untouched for 4 days');
  });

  it('is pure: the same input twice is deep-equal', () => {
    const signals = s({ rescheduleCount: 3, sameWindowFailureCount: 3, weeksOfEvidence: 4 });

    expect(detectAvoidance(signals)).toEqual(detectAvoidance(signals));
  });
});
