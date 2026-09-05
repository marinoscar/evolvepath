import { assessFatigue, FATIGUE_THRESHOLD } from './fatigue';

describe('assessFatigue (#59)', () => {
  it('is inactive below the threshold', () => {
    expect(assessFatigue(FATIGUE_THRESHOLD - 1, 4)).toEqual({
      active: false,
      effectiveDailyCap: 4,
    });
  });

  it('halves the cap at the threshold', () => {
    expect(assessFatigue(FATIGUE_THRESHOLD, 4)).toEqual({
      active: true,
      effectiveDailyCap: 2,
    });
  });

  it('rounds up, so the coach is quietened rather than silenced', () => {
    // Only the user silences the coach. Reducing a cap of 1 to 0 would remove
    // the only mechanism that could earn the attention back.
    expect(assessFatigue(9, 1).effectiveDailyCap).toBe(1);
    expect(assessFatigue(9, 3).effectiveDailyCap).toBe(2);
  });

  it('leaves a configured cap of zero at zero', () => {
    expect(assessFatigue(9, 0).effectiveDailyCap).toBe(0);
  });

  // Recovery is one action, not a decay curve: `history()` counts only since
  // the last ACTIONED row, so acting once passes 0 here.
  it('clears the moment the streak is broken', () => {
    expect(assessFatigue(0, 4)).toEqual({ active: false, effectiveDailyCap: 4 });
  });
});
