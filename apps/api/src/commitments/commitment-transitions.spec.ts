import { CommitmentStatus } from '@prisma/client';

import { allowedTransitions, canTransition, TERMINAL_STATUSES } from './commitment-transitions';

const ALL = Object.values(CommitmentStatus);

/**
 * The expected matrix, written out independently of the implementation so the
 * test is a second statement of the rule rather than a restatement of the code.
 */
const EXPECTED: Record<string, string[]> = {
  PLANNED: ['READY', 'STARTED', 'RESCHEDULED', 'SKIPPED', 'MISSED', 'CANCELLED'],
  READY: ['PLANNED', 'STARTED', 'RESCHEDULED', 'SKIPPED', 'MISSED', 'CANCELLED'],
  STARTED: ['COMPLETED', 'PARTIALLY_COMPLETED', 'RESCHEDULED', 'SKIPPED', 'CANCELLED'],
  COMPLETED: [],
  PARTIALLY_COMPLETED: [],
  RESCHEDULED: [],
  SKIPPED: [],
  MISSED: [],
  CANCELLED: [],
};

describe('commitment transition matrix', () => {
  it('covers every status the schema defines', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...ALL].sort());
    expect(ALL).toHaveLength(9);
  });

  // Exhaustive, not sampled: a matrix is only as trustworthy as the pairs
  // nobody thought to check. All 81 of them run.
  describe.each(ALL)('from %s', (from) => {
    it.each(ALL)('to %s', (to) => {
      const expected = from !== to && EXPECTED[from].includes(to);
      expect(canTransition(from, to)).toBe(expected);
    });
  });

  it('never allows a status to transition to itself', () => {
    for (const status of ALL) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  it('gives every terminal status zero exits', () => {
    for (const status of TERMINAL_STATUSES) {
      expect(allowedTransitions(status)).toEqual([]);
      for (const to of ALL) {
        expect(canTransition(status, to)).toBe(false);
      }
    }
  });

  it('marks exactly PLANNED, READY and STARTED as non-terminal', () => {
    const open = ALL.filter((status) => !TERMINAL_STATUSES.has(status));
    expect(open.sort()).toEqual(['PLANNED', 'READY', 'STARTED']);
  });

  it('offers exactly what it honours', () => {
    for (const from of ALL) {
      for (const to of allowedTransitions(from)) {
        expect(canTransition(from, to)).toBe(true);
      }
    }
  });

  // PRD P4: the start is worth recording whenever it happens, so it must not
  // be gated behind a READY step the product would otherwise have to invent.
  it('lets a PLANNED commitment be started directly', () => {
    expect(canTransition('PLANNED', 'STARTED')).toBe(true);
  });

  // Something started and not finished is PARTIALLY_COMPLETED or SKIPPED —
  // both chosen by the user. MISSED is for time that passed untouched.
  it('does not let a started commitment be marked missed', () => {
    expect(canTransition('STARTED', 'MISSED')).toBe(false);
  });

  it('never lets a finished commitment reopen', () => {
    expect(canTransition('COMPLETED', 'STARTED')).toBe(false);
    expect(canTransition('SKIPPED', 'COMPLETED')).toBe(false);
  });
});
