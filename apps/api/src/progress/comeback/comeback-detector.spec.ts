import { detectComeback, idleDaysOf, suggestsPlanReview } from './comeback-detector';

// =============================================================================
// Is this person coming back? (issue #112, epic E11)
// =============================================================================
//
// Two of these cases are the whole reason the function is pure and separate:
// a brand-new user is never told "welcome back", and an open offer never
// becomes two.
// =============================================================================

const NOW = new Date('2026-03-06T12:00:00.000Z');
const DAY = 86_400_000;

const input = (over: Partial<Parameters<typeof detectComeback>[0]> = {}) => ({
  now: NOW,
  lastActiveAt: new Date(NOW.getTime() - DAY),
  hasHistory: true,
  missedLast7: 0,
  comebackState: 'NONE' as const,
  ...over,
});

describe('detectComeback (#112)', () => {
  it('opens on three days of silence', () => {
    expect(
      detectComeback(input({ lastActiveAt: new Date(NOW.getTime() - 3 * DAY) })),
    ).toBe('INACTIVITY');
  });

  it('does not open on two — a quiet weekend is not an absence', () => {
    expect(
      detectComeback(input({ lastActiveAt: new Date(NOW.getTime() - 2 * DAY) })),
    ).toBeNull();
  });

  it('treats a user with history and no recorded activity as idle', () => {
    expect(detectComeback(input({ lastActiveAt: null }))).toBe('INACTIVITY');
  });

  it('never greets a user who has not started yet', () => {
    expect(
      detectComeback(input({ lastActiveAt: null, hasHistory: false })),
    ).toBeNull();
  });

  it('opens on four misses in a week even when the user is still around', () => {
    expect(detectComeback(input({ missedLast7: 4 }))).toBe('REPEATED_MISSES');
    expect(detectComeback(input({ missedLast7: 3 }))).toBeNull();
  });

  it('prefers INACTIVITY when both are true — silence is the bigger fact', () => {
    expect(
      detectComeback(input({ lastActiveAt: null, missedLast7: 9 })),
    ).toBe('INACTIVITY');
  });

  it('never stacks offers, whatever the signals say', () => {
    for (const comebackState of ['OFFERED', 'IN_PROGRESS'] as const) {
      expect(
        detectComeback(input({ comebackState, lastActiveAt: null, missedLast7: 9 })),
      ).toBeNull();
    }
  });
});

describe('idleDaysOf (#112)', () => {
  it('counts whole days of silence', () => {
    expect(idleDaysOf(NOW, new Date(NOW.getTime() - 4 * DAY - 3_600_000))).toBe(4);
  });

  it('assumes the threshold for a user with no recorded activity', () => {
    expect(idleDaysOf(NOW, null)).toBe(3);
  });
});

describe('suggestsPlanReview (#112)', () => {
  it('is a flag about the PLAN, raised at four misses or five closed rows', () => {
    expect(suggestsPlanReview(4, 0)).toBe(true);
    expect(suggestsPlanReview(0, 5)).toBe(true);
    expect(suggestsPlanReview(3, 4)).toBe(false);
  });
});
