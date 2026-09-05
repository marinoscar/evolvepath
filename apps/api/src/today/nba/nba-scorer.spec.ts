import {
  CONFLICT_PENALTY,
  CONTEXTUAL_FIT_WEIGHT,
  DOMAIN_BALANCE_WEIGHT,
  EFFORT_MISMATCH_PENALTY,
  FATIGUE_PENALTY,
  IMPORTANCE_WEIGHT,
  PLAN_RELEVANCE_WEIGHT,
  REPEATED_AVOIDANCE_WEIGHT,
  URGENCY_WEIGHT,
  confidenceOf,
  rankCandidates,
  scoreCandidate,
  type CandidateCommitment,
  type CandidateInput,
  type ScoringContext,
} from './nba-scorer';

const NOW = new Date('2026-03-02T09:00:00.000Z');

function commitment(over: Partial<CandidateCommitment> = {}): CandidateCommitment {
  return {
    id: 'c1',
    domain: 'WORK',
    importance: 5,
    scheduledStart: NOW,
    scheduledEnd: null,
    status: 'PLANNED',
    rescheduleCount: 0,
    planId: null,
    planIsActive: false,
    outcomeTargetDate: null,
    versions: { full: { title: 'Draft', minutes: 25 }, short: null, minimum: null },
    createdAt: new Date('2026-03-01T00:00:00.000Z'),
    ...over,
  };
}

function context(over: Partial<ScoringContext> = {}): ScoringContext {
  return {
    now: NOW,
    checkIn: null,
    domainModes: { WORK: 'GROW', FAMILY: 'GROW', HEALTH: 'GROW' },
    completedTodayByDomain: { WORK: 0, FAMILY: 0, HEALTH: 0 },
    availableMinutesRemaining: 600,
    startedCommitmentId: null,
    ...over,
  };
}

const input = (over: Partial<CandidateInput> = {}): CandidateInput => ({
  commitment: commitment(),
  context: context(),
  chosenMinutes: 25,
  ...over,
});

describe('scoreCandidate (#38)', () => {
  // The property the whole additive design rests on: nothing is hidden in the
  // total that is not in the breakdown.
  it('always sums the breakdown to the score', () => {
    const { score, breakdown } = scoreCandidate(
      input({
        commitment: commitment({ importance: 3, rescheduleCount: 2, planIsActive: true }),
        context: context({ checkIn: 'LOW_ENERGY', availableMinutesRemaining: 5 }),
        chosenMinutes: 60,
      }),
    );

    expect(Object.values(breakdown).reduce((a, b) => a + b, 0)).toBeCloseTo(score, 10);
  });

  it('is reproducible: the same inputs give the same score', () => {
    const a = scoreCandidate(input());
    const b = scoreCandidate(input());

    expect(a.score).toBe(b.score);
  });

  describe('importance', () => {
    it.each([
      [1, IMPORTANCE_WEIGHT * 0.2],
      [3, IMPORTANCE_WEIGHT * 0.6],
      [5, IMPORTANCE_WEIGHT],
    ])('importance %i contributes %f', (importance, expected) => {
      const { breakdown } = scoreCandidate(input({ commitment: commitment({ importance }) }));

      expect(breakdown.importance).toBeCloseTo(expected, 10);
    });
  });

  describe('urgency', () => {
    it('is full weight for an overdue commitment', () => {
      const { breakdown } = scoreCandidate(
        input({
          commitment: commitment({ scheduledStart: new Date('2026-03-02T07:00:00.000Z') }),
        }),
      );

      expect(breakdown.urgency).toBeCloseTo(URGENCY_WEIGHT, 10);
    });

    it('is zero a full day away with no deadline', () => {
      const { breakdown } = scoreCandidate(
        input({
          commitment: commitment({ scheduledStart: new Date('2026-03-03T09:00:00.000Z') }),
        }),
      );

      expect(breakdown.urgency).toBe(0);
    });

    it('is half weight six hours out', () => {
      const { breakdown } = scoreCandidate(
        input({
          commitment: commitment({ scheduledStart: new Date('2026-03-02T15:00:00.000Z') }),
        }),
      );

      expect(breakdown.urgency).toBeCloseTo(URGENCY_WEIGHT * 0.5, 10);
    });

    // The larger of the two ramps wins, so a distant appointment on a near
    // deadline is still urgent.
    it('takes the deadline ramp when it beats the schedule ramp', () => {
      const { breakdown } = scoreCandidate(
        input({
          commitment: commitment({
            scheduledStart: new Date('2026-03-04T09:00:00.000Z'),
            outcomeTargetDate: new Date('2026-03-05T09:00:00.000Z'),
          }),
        }),
      );

      expect(breakdown.urgency).toBeCloseTo(URGENCY_WEIGHT * (4 / 7), 6);
    });
  });

  describe('repeatedAvoidance', () => {
    it.each([
      [0, 0],
      [1, REPEATED_AVOIDANCE_WEIGHT / 3],
      [3, REPEATED_AVOIDANCE_WEIGHT],
      [7, REPEATED_AVOIDANCE_WEIGHT],
    ])('a count of %i contributes %f (capped at three)', (rescheduleCount, expected) => {
      const { breakdown } = scoreCandidate(
        input({ commitment: commitment({ rescheduleCount }) }),
      );

      expect(breakdown.repeatedAvoidance).toBeCloseTo(expected, 10);
    });
  });

  describe('planRelevance', () => {
    it('is full for an active plan, half for an inactive one, zero for none', () => {
      expect(
        scoreCandidate(input({ commitment: commitment({ planId: 'p', planIsActive: true }) }))
          .breakdown.planRelevance,
      ).toBe(PLAN_RELEVANCE_WEIGHT);
      expect(
        scoreCandidate(input({ commitment: commitment({ planId: 'p', planIsActive: false }) }))
          .breakdown.planRelevance,
      ).toBe(PLAN_RELEVANCE_WEIGHT * 0.5);
      expect(scoreCandidate(input()).breakdown.planRelevance).toBe(0);
    });
  });

  describe('domainBalance', () => {
    it('is full weight for an untouched GROW domain', () => {
      expect(scoreCandidate(input()).breakdown.domainBalance).toBe(DOMAIN_BALANCE_WEIGHT);
    });

    it('is a quarter once that domain already had a completion today', () => {
      const { breakdown } = scoreCandidate(
        input({ context: context({ completedTodayByDomain: { WORK: 1, FAMILY: 0, HEALTH: 0 } }) }),
      );

      expect(breakdown.domainBalance).toBeCloseTo(DOMAIN_BALANCE_WEIGHT * 0.25, 10);
    });

    it('scales by the domain mode', () => {
      const recover = scoreCandidate(
        input({ context: context({ domainModes: { WORK: 'RECOVER', FAMILY: 'GROW', HEALTH: 'GROW' } }) }),
      ).breakdown.domainBalance;
      const maintain = scoreCandidate(
        input({ context: context({ domainModes: { WORK: 'MAINTAIN', FAMILY: 'GROW', HEALTH: 'GROW' } }) }),
      ).breakdown.domainBalance;

      expect(recover).toBeCloseTo(DOMAIN_BALANCE_WEIGHT * 0.75, 10);
      expect(maintain).toBeCloseTo(DOMAIN_BALANCE_WEIGHT * 0.5, 10);
    });

    // The loader excludes paused domains; a paused one arriving here means the
    // two disagree, which would surface as a suggestion to do something the user
    // explicitly put down.
    it('throws for a PAUSED domain rather than scoring it', () => {
      expect(() =>
        scoreCandidate(
          input({ context: context({ domainModes: { WORK: 'PAUSE', FAMILY: 'GROW', HEALTH: 'GROW' } }) }),
        ),
      ).toThrow(/PAUSED/);
    });
  });

  describe('contextualFit', () => {
    it('is full weight inside the hour either side of the window', () => {
      expect(scoreCandidate(input()).breakdown.contextualFit).toBe(CONTEXTUAL_FIT_WEIGHT);
    });

    it('is zero well outside it', () => {
      const { breakdown } = scoreCandidate(
        input({
          commitment: commitment({ scheduledStart: new Date('2026-03-02T20:00:00.000Z') }),
        }),
      );

      expect(breakdown.contextualFit).toBe(0);
    });
  });

  describe('penalties', () => {
    it('penalises an action longer than the time left', () => {
      const { breakdown } = scoreCandidate(
        input({ context: context({ availableMinutesRemaining: 10 }), chosenMinutes: 25 }),
      );

      expect(breakdown.effortMismatch).toBe(-EFFORT_MISMATCH_PENALTY);
    });

    it('penalises a candidate when a DIFFERENT commitment is already running', () => {
      expect(
        scoreCandidate(input({ context: context({ startedCommitmentId: 'other' }) })).breakdown
          .conflict,
      ).toBe(-CONFLICT_PENALTY);
    });

    // Self-started is not a conflict — it is the thing in progress.
    it('does not penalise the running commitment itself', () => {
      expect(
        scoreCandidate(input({ context: context({ startedCommitmentId: 'c1' }) })).breakdown
          .conflict,
      ).toBe(0);
    });

    it('applies full fatigue for a one-hour action on low energy', () => {
      const { breakdown } = scoreCandidate(
        input({ context: context({ checkIn: 'LOW_ENERGY' }), chosenMinutes: 60 }),
      );

      expect(breakdown.fatigue).toBe(-FATIGUE_PENALTY);
    });

    it('applies half fatigue on a packed day', () => {
      const { breakdown } = scoreCandidate(
        input({ context: context({ checkIn: 'PACKED' }), chosenMinutes: 60 }),
      );

      expect(breakdown.fatigue).toBeCloseTo(-FATIGUE_PENALTY * 0.5, 10);
    });

    it('applies none on a normal day', () => {
      const { breakdown } = scoreCandidate(
        input({ context: context({ checkIn: 'NORMAL' }), chosenMinutes: 60 }),
      );

      expect(breakdown.fatigue).toBe(0);
    });

    it('scales fatigue with the length of the action', () => {
      const { breakdown } = scoreCandidate(
        input({ context: context({ checkIn: 'LOW_ENERGY' }), chosenMinutes: 30 }),
      );

      expect(breakdown.fatigue).toBeCloseTo(-FATIGUE_PENALTY * 0.5, 10);
    });
  });
});

describe('rankCandidates (#38)', () => {
  it('orders by score, best first', () => {
    const ranked = rankCandidates([
      input({ commitment: commitment({ id: 'low', importance: 1 }) }),
      input({ commitment: commitment({ id: 'high', importance: 5 }) }),
    ]);

    expect(ranked.map((c) => c.commitment.id)).toEqual(['high', 'low']);
  });

  // Without a stable tie-break a user refreshing Today would watch the
  // suggestion flicker between two equally good commitments.
  it('breaks a tie by earlier scheduledStart', () => {
    const ranked = rankCandidates([
      input({
        commitment: commitment({ id: 'later', scheduledStart: new Date('2026-03-02T09:30:00.000Z') }),
      }),
      input({
        commitment: commitment({ id: 'earlier', scheduledStart: new Date('2026-03-02T09:00:00.000Z') }),
      }),
    ]);

    expect(ranked[0].commitment.id).toBe('earlier');
  });

  it('then by createdAt, then by id', () => {
    const older = new Date('2026-02-01T00:00:00.000Z');
    const newer = new Date('2026-02-02T00:00:00.000Z');

    expect(
      rankCandidates([
        input({ commitment: commitment({ id: 'b', createdAt: newer }) }),
        input({ commitment: commitment({ id: 'a', createdAt: older }) }),
      ])[0].commitment.id,
    ).toBe('a');

    expect(
      rankCandidates([
        input({ commitment: commitment({ id: 'zzz', createdAt: older }) }),
        input({ commitment: commitment({ id: 'aaa', createdAt: older }) }),
      ])[0].commitment.id,
    ).toBe('aaa');
  });

  it('does not mutate the array it was given', () => {
    const candidates = [
      input({ commitment: commitment({ id: 'low', importance: 1 }) }),
      input({ commitment: commitment({ id: 'high', importance: 5 }) }),
    ];
    rankCandidates(candidates);

    expect(candidates.map((c) => c.commitment.id)).toEqual(['low', 'high']);
  });
});

describe('confidenceOf (#38)', () => {
  it('is 0.9 for a single candidate — there is nothing to be unsure between', () => {
    expect(confidenceOf([50])).toBe(0.9);
  });

  it('rises with the gap and is capped below certainty', () => {
    expect(confidenceOf([100, 50])).toBeCloseTo(0.5, 10);
    expect(confidenceOf([100, 0])).toBe(0.95);
  });

  it('never falls below 0.2 — a close call is still a real recommendation', () => {
    expect(confidenceOf([100, 99.9])).toBe(0.2);
  });

  it('is zero with nothing to rank', () => {
    expect(confidenceOf([])).toBe(0);
  });
});
