import {
  incrementFor,
  roundToStep,
  suggestProgression,
  type Prescription,
  type SessionRecord,
  type SetRecord,
} from './double-progression';

// =============================================================================
// The whole rule, one row of the table per test (issue #85, epic E09)
//
// These are the numbers `docs/specs/health-domain.md` states verbatim. If a
// threshold or an increment moves, this file is where it shows up — which is
// the point of keeping the rule pure.
// =============================================================================

const DUMBBELL: Prescription = { sets: 3, repMin: 8, repMax: 12, equipment: ['DUMBBELL'] };

function set(over: Partial<SetRecord> = {}): SetRecord {
  return { weightKg: 20, reps: 12, rpe: 7, discomfort: 'NONE', ...over };
}

function session(sets: SetRecord[], id = 's'): SessionRecord {
  return { sessionId: id, date: '2026-09-07T13:00:00.000Z', sets };
}

/** Three sets at the top of the range, comfortable. */
const topOut = (weightKg = 20) => session([set({ weightKg }), set({ weightKg }), set({ weightKg })]);

describe('roundToStep', () => {
  it('rounds to the quarter kilo every plate rack can actually make', () => {
    expect(roundToStep(17.3)).toBe(17.25);
    expect(roundToStep(19)).toBe(19);
    expect(roundToStep(22.6)).toBe(22.5);
  });
});

describe('incrementFor', () => {
  it('takes the first loadable implement', () => {
    expect(incrementFor(['DUMBBELL', 'BENCH'])).toBe(2.5);
    expect(incrementFor(['BARBELL'])).toBe(5);
    expect(incrementFor(['MACHINE'])).toBe(5);
    expect(incrementFor(['KETTLEBELL'])).toBe(4);
  });

  it('treats a bench as furniture, not load', () => {
    expect(incrementFor(['BENCH'])).toBeNull();
    expect(incrementFor(['BODYWEIGHT'])).toBeNull();
    expect(incrementFor(['BAND'])).toBeNull();
  });
});

describe('suggestProgression', () => {
  it('says nothing at all on a movement with no history', () => {
    expect(suggestProgression([], DUMBBELL)).toMatchObject({
      action: 'hold',
      reason: 'first_session',
      currentWeightKg: null,
      suggestedWeightKg: null,
    });
  });

  it('never increases off a single session — one good day is not a trend', () => {
    expect(suggestProgression([topOut()], DUMBBELL)).toMatchObject({
      action: 'hold',
      reason: 'insufficient_history',
      currentWeightKg: 20,
    });
  });

  it('adds 2.5 kg after two comfortable sessions at the top of the range', () => {
    expect(suggestProgression([topOut(), topOut()], DUMBBELL)).toMatchObject({
      action: 'increase',
      reason: 'top_of_range_twice',
      currentWeightKg: 20,
      suggestedWeightKg: 22.5,
      deltaKg: 2.5,
    });
  });

  it('adds 5 kg on a barbell and 5 on a machine', () => {
    const barbell = suggestProgression([topOut(60), topOut(60)], {
      ...DUMBBELL,
      equipment: ['BARBELL'],
    });
    const machine = suggestProgression([topOut(45), topOut(45)], {
      ...DUMBBELL,
      equipment: ['MACHINE'],
    });

    expect(barbell.suggestedWeightKg).toBe(65);
    expect(machine.suggestedWeightKg).toBe(50);
  });

  it('accepts a missing RPE as comfortable — the field is optional', () => {
    const noRpe = () => session([set({ rpe: null }), set({ rpe: null }), set({ rpe: null })]);

    expect(suggestProgression([noRpe(), noRpe()], DUMBBELL).action).toBe('increase');
  });

  it('holds when the top of the range was a grind', () => {
    const grind = () => session([set({ rpe: 9 }), set({ rpe: 9 }), set({ rpe: 9 })]);

    expect(suggestProgression([grind(), grind()], DUMBBELL)).toMatchObject({
      action: 'hold',
      reason: 'building',
    });
  });

  it('holds when fewer sets were done than the prescription asks for', () => {
    const two = () => session([set(), set()]);

    expect(suggestProgression([two(), two()], DUMBBELL).action).toBe('hold');
  });

  it('holds while the reps are still climbing', () => {
    const middle = session([set({ reps: 10 }), set({ reps: 10 }), set({ reps: 9 })]);

    expect(suggestProgression([topOut(), middle], DUMBBELL)).toMatchObject({
      action: 'hold',
      reason: 'building',
    });
  });

  it('drops 5 % after two sessions under the bottom of the range', () => {
    const short = () => session([set({ reps: 6 }), set({ reps: 6 }), set({ reps: 5 })]);

    expect(suggestProgression([short(), short()], DUMBBELL)).toMatchObject({
      action: 'reduce',
      reason: 'below_min_twice',
      currentWeightKg: 20,
      suggestedWeightKg: 19,
      deltaKg: -1,
    });
  });

  it('holds and says why when the last session had sharp pain', () => {
    const painful = session([set(), set({ discomfort: 'SHARP_PAIN' }), set()]);

    // Two topped-out sessions would otherwise be an increase. Pain outranks it:
    // the runner has just shown the safety copy, and following it with
    // "add 2.5 kg" would undo the whole point of showing it.
    expect(suggestProgression([painful, topOut()], DUMBBELL)).toMatchObject({
      action: 'hold',
      reason: 'discomfort',
    });
  });

  it('lets mild discomfort progress — only sharp pain stops the rule', () => {
    const mild = () =>
      session([set({ discomfort: 'MILD' }), set({ discomfort: 'MILD' }), set()]);

    expect(suggestProgression([mild(), mild()], DUMBBELL).action).toBe('increase');
  });

  it('progresses bodyweight work with no weight to name', () => {
    const pushUps = () =>
      session([
        set({ weightKg: null }),
        set({ weightKg: null }),
        set({ weightKg: null }),
      ]);

    expect(
      suggestProgression([pushUps(), pushUps()], { ...DUMBBELL, equipment: ['BODYWEIGHT'] }),
    ).toMatchObject({
      action: 'increase',
      reason: 'top_of_range_twice',
      suggestedWeightKg: null,
      deltaKg: null,
    });
  });

  it('reads the heaviest working set as the current weight', () => {
    const ramped = () =>
      session([set({ weightKg: 17.5 }), set({ weightKg: 20 }), set({ weightKg: 20 })]);

    expect(suggestProgression([ramped(), ramped()], DUMBBELL).currentWeightKg).toBe(20);
  });

  it('rounds a reduction onto the quarter kilo', () => {
    const short = () => session([set({ weightKg: 17.5, reps: 6 }), set({ weightKg: 17.5, reps: 6 }), set({ weightKg: 17.5, reps: 6 })]);

    // 17.5 × 0.95 = 16.625 → 16.75 at the nearest step upward.
    expect(suggestProgression([short(), short()], DUMBBELL).suggestedWeightKg).toBe(16.75);
  });

  it('ignores anything past the last two sessions', () => {
    const ancient = session([set({ reps: 4 }), set({ reps: 4 }), set({ reps: 4 })], 'old');

    expect(suggestProgression([topOut(), topOut(), ancient], DUMBBELL).action).toBe('increase');
  });

  it('reports what it decided from, so the explanation has something to quote', () => {
    const suggestion = suggestProgression([topOut(), topOut()], DUMBBELL);

    expect(suggestion.basis).toEqual({
      sessions: 2,
      lastReps: [12, 12, 12],
      lastRpe: [7, 7, 7],
    });
  });

  it('is pure — the same input twice gives the same answer', () => {
    const history = [topOut(), topOut()];

    expect(suggestProgression(history, DUMBBELL)).toEqual(suggestProgression(history, DUMBBELL));
  });
});
