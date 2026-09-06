import {
  clampRestartMinutes,
  pickForDomain,
  pickRestart,
  RESTART_MAX_MINUTES,
  RESTART_MIN_MINUTES,
  type RestartCandidate,
} from './restart-picker';

// =============================================================================
// The one thing to offer (issue #112, epic E11)
// =============================================================================
//
// PRD §56 asks for ONE restart action. The ordering is the product decision, so
// it is pinned here rather than left to whatever the query returned first.
// =============================================================================

const NOW = new Date('2026-03-06T12:00:00.000Z');
const DAY = 86_400_000;

function candidate(over: Partial<RestartCandidate> = {}): RestartCandidate {
  return {
    domain: 'HEALTH',
    mode: 'GROW',
    outcomeId: 'o1',
    outcomeTitle: 'Feel strong again',
    outcomeImportance: 3,
    planVersionId: 'v1',
    routineId: 'r1',
    routineTitle: 'Strength workout',
    minimumDurationMin: 12,
    fallbackBehavior: '12-minute bodyweight circuit',
    preferredTime: '07:00',
    lastCompletionAt: null,
    ...over,
  };
}

describe('pickRestart (#112)', () => {
  it('follows outcome importance first', () => {
    const plan = pickRestart([
      candidate({ domain: 'HEALTH', outcomeImportance: 3 }),
      candidate({ domain: 'WORK', outcomeImportance: 5, routineId: 'r2', routineTitle: 'Focus block' }),
    ]);

    expect(plan.domain).toBe('WORK');
    expect(plan.routineId).toBe('r2');
  });

  it('breaks a tie on the most recent completion — rebuild what worked', () => {
    const plan = pickRestart([
      candidate({ domain: 'HEALTH', lastCompletionAt: new Date(NOW.getTime() - 9 * DAY) }),
      candidate({
        domain: 'WORK',
        routineId: 'r2',
        lastCompletionAt: new Date(NOW.getTime() - 2 * DAY),
      }),
    ]);

    expect(plan.domain).toBe('WORK');
  });

  it('breaks a remaining tie on the fixed HEALTH > WORK > FAMILY order', () => {
    const plan = pickRestart([
      candidate({ domain: 'FAMILY', routineId: 'r3' }),
      candidate({ domain: 'WORK', routineId: 'r2' }),
      candidate({ domain: 'HEALTH', routineId: 'r1' }),
    ]);

    expect(plan.domain).toBe('HEALTH');
  });

  it('never offers a domain the user deliberately paused', () => {
    const plan = pickRestart([
      candidate({ domain: 'HEALTH', mode: 'PAUSE', outcomeImportance: 5 }),
      candidate({ domain: 'WORK', routineId: 'r2', outcomeImportance: 2 }),
    ]);

    expect(plan.domain).toBe('WORK');
    expect(plan.alternatives.map((alt) => alt.domain)).not.toContain('HEALTH');
  });

  it('prefers the routine’s own fallback wording over its full title', () => {
    expect(pickRestart([candidate()]).title).toBe('12-minute bodyweight circuit');
    expect(pickRestart([candidate({ fallbackBehavior: null })]).title).toBe(
      'Strength workout',
    );
  });

  it('clamps the restart to something winnable on the first day', () => {
    expect(clampRestartMinutes(5)).toBe(RESTART_MIN_MINUTES);
    expect(clampRestartMinutes(40)).toBe(RESTART_MAX_MINUTES);
    expect(clampRestartMinutes(12)).toBe(12);
    expect(clampRestartMinutes(null)).toBe(RESTART_MIN_MINUTES);
  });

  it('offers the best routine of each OTHER domain, and no more', () => {
    const plan = pickRestart([
      candidate({ domain: 'HEALTH', outcomeImportance: 5 }),
      candidate({ domain: 'WORK', routineId: 'r2', outcomeImportance: 4, routineTitle: 'Focus block', fallbackBehavior: null }),
      candidate({ domain: 'WORK', routineId: 'r4', outcomeImportance: 1, routineTitle: 'Inbox zero', fallbackBehavior: null }),
      candidate({ domain: 'FAMILY', routineId: 'r3', routineTitle: 'Phone-free dinner', fallbackBehavior: null }),
    ]);

    expect(plan.domain).toBe('HEALTH');
    expect(plan.alternatives).toEqual([
      { domain: 'WORK', title: 'Focus block', minutes: 12 },
      { domain: 'FAMILY', title: 'Phone-free dinner', minutes: 12 },
    ]);
  });

  it('still offers something to a user with no active routine at all', () => {
    const plan = pickRestart([]);

    expect(plan).toMatchObject({
      domain: 'HEALTH',
      routineId: null,
      title: 'A 10-minute walk',
      minutes: RESTART_MIN_MINUTES,
      alternatives: [],
    });
  });

  it('names the rule that actually chose, so "why this?" has an answer', () => {
    const byImportance = pickRestart([
      candidate({ domain: 'WORK', routineId: 'r2', outcomeImportance: 5, outcomeTitle: 'Ship the proposal' }),
      candidate({ domain: 'HEALTH', outcomeImportance: 2 }),
    ]);

    expect(byImportance.reason).toContain('Ship the proposal');
  });
});

describe('pickForDomain (#112)', () => {
  it('returns that domain’s restart, keeping the other domains as alternatives', () => {
    const candidates = [
      candidate({ domain: 'HEALTH', outcomeImportance: 5 }),
      candidate({ domain: 'WORK', routineId: 'r2', routineTitle: 'Focus block', fallbackBehavior: null }),
    ];

    const plan = pickForDomain(candidates, 'WORK');

    expect(plan?.domain).toBe('WORK');
    expect(plan?.alternatives.map((alt) => alt.domain)).toEqual(['HEALTH']);
  });

  it('is null for a domain with nothing to rebuild', () => {
    expect(pickForDomain([candidate({ domain: 'HEALTH' })], 'FAMILY')).toBeNull();
    expect(
      pickForDomain([candidate({ domain: 'FAMILY', mode: 'PAUSE' })], 'FAMILY'),
    ).toBeNull();
  });
});
