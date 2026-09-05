import {
  CHALLENGE_PLAN_FAILURES,
  DIAGNOSE_RESCHEDULES,
  INTERVENTION_MODES,
  RECOVER_DAYS,
  REINFORCE_COMPLETIONS,
  resolveInterventionMode,
  type InterventionContext,
} from './intervention-mode';

const base = (over: Partial<InterventionContext> = {}): InterventionContext => ({
  daysSinceLastEvidence: 0,
  hasAnyEvidence: true,
  routineFailuresLast14Days: 0,
  topRescheduleCount: 0,
  checkIn: null,
  chosenMinutes: 25,
  availableMinutesRemaining: 600,
  outcomeLacksMeaning: false,
  completionsLast7Days: 0,
  missesLast7Days: 0,
  ...over,
});

describe('resolveInterventionMode (#38)', () => {
  it('defaults to ACT when nothing else applies', () => {
    expect(resolveInterventionMode(base())).toBe('ACT');
  });

  describe('one case per rule', () => {
    it('RECOVER after a gap', () => {
      expect(resolveInterventionMode(base({ daysSinceLastEvidence: RECOVER_DAYS }))).toBe(
        'RECOVER',
      );
    });

    it('CHALLENGE_PLAN when the routine keeps failing', () => {
      expect(
        resolveInterventionMode(base({ routineFailuresLast14Days: CHALLENGE_PLAN_FAILURES })),
      ).toBe('CHALLENGE_PLAN');
    });

    it('DIAGNOSE when this one keeps moving', () => {
      expect(resolveInterventionMode(base({ topRescheduleCount: DIAGNOSE_RESCHEDULES }))).toBe(
        'DIAGNOSE',
      );
    });

    it.each(['PACKED', 'UNEXPECTED_PROBLEM'] as const)('REDUCE on a %s day', (checkIn) => {
      expect(resolveInterventionMode(base({ checkIn }))).toBe('REDUCE');
    });

    it('REDUCE when the arithmetic says the day is full, even with no check-in', () => {
      expect(
        resolveInterventionMode(base({ chosenMinutes: 60, availableMinutesRemaining: 15 })),
      ).toBe('REDUCE');
    });

    it('RECONNECT on low energy', () => {
      expect(resolveInterventionMode(base({ checkIn: 'LOW_ENERGY' }))).toBe('RECONNECT');
    });

    it('CLARIFY when the outcome says neither why nor what done looks like', () => {
      expect(resolveInterventionMode(base({ outcomeLacksMeaning: true }))).toBe('CLARIFY');
    });

    it('REINFORCE on a clean week', () => {
      expect(
        resolveInterventionMode(
          base({ completionsLast7Days: REINFORCE_COMPLETIONS, missesLast7Days: 0 }),
        ),
      ).toBe('REINFORCE');
    });

    it('does not REINFORCE a week with a miss in it', () => {
      expect(
        resolveInterventionMode(
          base({ completionsLast7Days: REINFORCE_COMPLETIONS, missesLast7Days: 1 }),
        ),
      ).toBe('ACT');
    });
  });

  describe('precedence', () => {
    // Order is the design: every rule can be true at once for a user having a
    // hard week, and the winner decides what the product says to them.
    it('RECOVER beats DIAGNOSE', () => {
      expect(
        resolveInterventionMode(
          base({ daysSinceLastEvidence: 5, topRescheduleCount: 3 }),
        ),
      ).toBe('RECOVER');
    });

    it('CHALLENGE_PLAN beats DIAGNOSE', () => {
      expect(
        resolveInterventionMode(
          base({ routineFailuresLast14Days: 5, topRescheduleCount: 3 }),
        ),
      ).toBe('CHALLENGE_PLAN');
    });

    it('DIAGNOSE beats REDUCE', () => {
      expect(
        resolveInterventionMode(base({ topRescheduleCount: 2, checkIn: 'PACKED' })),
      ).toBe('DIAGNOSE');
    });

    it('REDUCE beats RECONNECT when the day is also over budget', () => {
      expect(
        resolveInterventionMode(
          base({ checkIn: 'LOW_ENERGY', chosenMinutes: 60, availableMinutesRemaining: 5 }),
        ),
      ).toBe('REDUCE');
    });

    it('RECONNECT beats CLARIFY', () => {
      expect(
        resolveInterventionMode(base({ checkIn: 'LOW_ENERGY', outcomeLacksMeaning: true })),
      ).toBe('RECONNECT');
    });

    it('CLARIFY beats REINFORCE', () => {
      expect(
        resolveInterventionMode(
          base({ outcomeLacksMeaning: true, completionsLast7Days: 5 }),
        ),
      ).toBe('CLARIFY');
    });
  });

  // A brand-new account has no evidence and has not lapsed; those are different
  // states and only one deserves a "welcome back".
  it('never says RECOVER to an account that has never logged anything', () => {
    expect(
      resolveInterventionMode(base({ hasAnyEvidence: false, daysSinceLastEvidence: null })),
    ).toBe('ACT');
  });

  it('only ever returns a declared mode', () => {
    expect(INTERVENTION_MODES).toContain(resolveInterventionMode(base()));
  });
});
