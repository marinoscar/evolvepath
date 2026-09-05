import { describe, it, expect } from 'vitest';

import { toIsoWithOffset } from '../../../components/path/TransitionDialog';
import { allowedTransitions, canTransition, TERMINAL_STATUSES } from '../../../utils/commitmentTransitions';

// =============================================================================
// The two things the client must get exactly right on the wire (#56)
// =============================================================================

describe('toIsoWithOffset', () => {
  // `<input type="datetime-local">` yields wall-clock text with no timezone.
  // Sending it raw is rejected by the API's `datetime({ offset: true })`;
  // appending a "Z" would silently shift the appointment by the user's offset.
  it('resolves a local wall-clock value into a UTC instant', () => {
    const local = '2026-02-12T06:30';
    const iso = toIsoWithOffset(local);

    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    // Round-tripping through Date lands on the same wall-clock time the user
    // typed, in their own timezone.
    const back = new Date(iso);
    expect(back.getHours()).toBe(6);
    expect(back.getMinutes()).toBe(30);
    expect(back.getFullYear()).toBe(2026);
  });

  it('never emits the raw input value, which the API would reject', () => {
    expect(toIsoWithOffset('2026-02-12T06:30')).not.toBe('2026-02-12T06:30');
  });
});

describe('the web copy of the transition matrix', () => {
  // Kept byte-equivalent to `apps/api/src/commitments/commitment-transitions.ts`
  // by these assertions plus the comment in each file pointing at the other.
  // A UI that offered a move the API refuses would be a bug the user sees.
  it('matches the API matrix for the three open statuses', () => {
    expect([...allowedTransitions('PLANNED')]).toEqual([
      'READY',
      'STARTED',
      'RESCHEDULED',
      'SKIPPED',
      'MISSED',
      'CANCELLED',
    ]);
    expect([...allowedTransitions('READY')]).toEqual([
      'PLANNED',
      'STARTED',
      'RESCHEDULED',
      'SKIPPED',
      'MISSED',
      'CANCELLED',
    ]);
    expect([...allowedTransitions('STARTED')]).toEqual([
      'COMPLETED',
      'PARTIALLY_COMPLETED',
      'RESCHEDULED',
      'SKIPPED',
      'CANCELLED',
    ]);
  });

  it('gives every terminal status zero exits', () => {
    for (const status of TERMINAL_STATUSES) {
      expect(allowedTransitions(status)).toEqual([]);
    }
  });

  it('never allows a status to transition to itself', () => {
    for (const status of ['PLANNED', 'READY', 'STARTED'] as const) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  it('keeps the three deliberate edges', () => {
    // PRD P4: the start is recorded whenever it happens.
    expect(canTransition('PLANNED', 'STARTED')).toBe(true);
    // Started-and-unfinished is the user's call, not the system's.
    expect(canTransition('STARTED', 'MISSED')).toBe(false);
    // A finished commitment is an honest record of a day, not a draft.
    expect(canTransition('COMPLETED', 'STARTED')).toBe(false);
  });
});
