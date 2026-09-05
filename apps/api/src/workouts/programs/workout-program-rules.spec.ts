import { validProposal } from './__fixtures__/proposal.fixture';
import {
  checkProgram,
  contraindicationTagsFor,
  estimateMinutes,
  type RuleContext,
} from './workout-program-rules';

/** The catalog facts the rules need, for the movements the fixture uses. */
const CONTRAINDICATIONS = new Map<string, string[]>([
  ['dumbbell bench press', ['shoulder']],
  ['dumbbell row', []],
  ['goblet squat', ['knee']],
  ['glute bridge', []],
  ['barbell overhead press', ['shoulder', 'overhead', 'lower_back']],
]);

function context(overrides: Partial<RuleContext> = {}): RuleContext {
  return {
    experience: 'BEGINNER',
    daysPerWeek: 2,
    minutesPerSession: 45,
    contraindicationsByName: CONTRAINDICATIONS,
    ...overrides,
  };
}

describe('contraindicationTagsFor', () => {
  it('reads the tags out of ordinary sentences', () => {
    expect(contraindicationTagsFor('My left shoulder clicks and my knees ache')).toEqual(
      expect.arrayContaining(['shoulder', 'knee']),
    );
  });

  it('is empty for no limitations at all', () => {
    expect(contraindicationTagsFor(null)).toEqual([]);
    expect(contraindicationTagsFor('')).toEqual([]);
  });

  it('errs towards caution — a resolved problem still matches', () => {
    // Deliberate. The cost of the false positive is one overhead press.
    expect(contraindicationTagsFor('my shoulder is completely fine now')).toEqual(['shoulder']);
  });
});

describe('estimateMinutes', () => {
  it('counts rest, which is most of a session', () => {
    const minutes = estimateMinutes({
      exercises: [{ sets: 3, repMin: 8, repMax: 12, restSeconds: 90 }],
    });

    // 3 × (10 reps × 3 s + 90 s) = 360 s = 6 min, plus 5 min of overhead.
    expect(minutes).toBe(11);
  });
});

describe('checkProgram', () => {
  it('passes a clean proposal', () => {
    expect(checkProgram(validProposal(), context())).toEqual([]);
  });

  it('rejects a beginner scheduled five days a week', () => {
    const proposal = validProposal({
      weeklyStructure: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, templateName: 'Upper A' })),
    });

    const codes = checkProgram(proposal, context({ daysPerWeek: 5 })).map((v) => v.code);

    expect(codes).toContain('BEGINNER_MAX_DAYS');
  });

  it('allows an intermediate five days a week', () => {
    const proposal = validProposal({
      weeklyStructure: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, templateName: 'Upper A' })),
    });

    const codes = checkProgram(
      proposal,
      context({ experience: 'INTERMEDIATE', daysPerWeek: 5 }),
    ).map((v) => v.code);

    expect(codes).not.toContain('BEGINNER_MAX_DAYS');
  });

  it('rejects a movement tagged for the body part the user reported', () => {
    const violations = checkProgram(
      validProposal(),
      context({ limitations: 'bad left shoulder, avoid pressing overhead' }),
    );

    expect(violations).toContainEqual(
      expect.objectContaining({ code: 'CONTRAINDICATED', subject: 'Dumbbell Bench Press' }),
    );
  });

  it('says nothing about a contraindication the user did not report', () => {
    expect(checkProgram(validProposal(), context({ limitations: 'sore wrists' }))).toEqual([]);
  });

  it('rejects a session that will not fit the time the user has', () => {
    const proposal = validProposal();
    proposal.templates[0].exercises.push({
      exerciseName: 'Dumbbell Row',
      sets: 6,
      repMin: 12,
      repMax: 12,
      restSeconds: 240,
      notes: null,
    });

    const codes = checkProgram(proposal, context({ minutesPerSession: 20 })).map((v) => v.code);

    expect(codes).toContain('OVER_TIME_BUDGET');
  });

  it('measures FULL templates only — a short version is meant to be short', () => {
    const codes = checkProgram(validProposal(), context({ minutesPerSession: 45 })).map(
      (v) => v.code,
    );

    expect(codes).toEqual([]);
  });

  it('rejects a week that is not the number of days the user asked for', () => {
    const codes = checkProgram(validProposal(), context({ daysPerWeek: 3 })).map((v) => v.code);

    expect(codes).toContain('DAYS_MISMATCH');
  });
});
