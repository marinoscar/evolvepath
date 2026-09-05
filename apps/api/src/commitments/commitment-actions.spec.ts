import { CommitmentStatus } from '@prisma/client';

import { availableActionsFor, isActionAvailable } from './commitment-actions';
import { TERMINAL_STATUSES } from './commitment-transitions';

const running = new Date('2026-03-01T09:00:00.000Z');

describe('availableActionsFor (#40)', () => {
  it('offers start on a PLANNED commitment, and pause on nothing', () => {
    expect(availableActionsFor({ status: 'PLANNED', activeSince: null })).toEqual([
      'start',
      'complete',
      'partial',
      'fallback',
      'reschedule',
      'skip',
      'decompose',
    ]);
  });

  it('offers the same set from READY', () => {
    expect(availableActionsFor({ status: 'READY', activeSince: null })).toContain('start');
  });

  // The distinction the status matrix cannot express: one button, two
  // operations, chosen by a column the user cannot see.
  it('offers pause while the timer runs and continue while it is paused', () => {
    expect(availableActionsFor({ status: 'STARTED', activeSince: running })).toContain('pause');
    expect(availableActionsFor({ status: 'STARTED', activeSince: running })).not.toContain(
      'continue',
    );

    expect(availableActionsFor({ status: 'STARTED', activeSince: null })).toContain('continue');
    expect(availableActionsFor({ status: 'STARTED', activeSince: null })).not.toContain('pause');
  });

  it('never offers start on a STARTED commitment — it is pause or continue', () => {
    expect(availableActionsFor({ status: 'STARTED', activeSince: running })).not.toContain(
      'start',
    );
  });

  // Its evidence belongs to today; carrying it to tomorrow would carry that
  // evidence with it.
  it('never offers reschedule once the commitment has been started', () => {
    expect(availableActionsFor({ status: 'STARTED', activeSince: running })).not.toContain(
      'reschedule',
    );
    expect(availableActionsFor({ status: 'PLANNED', activeSince: null })).toContain('reschedule');
  });

  it('offers nothing at all for every terminal status', () => {
    for (const status of TERMINAL_STATUSES) {
      expect(availableActionsFor({ status, activeSince: null })).toEqual([]);
    }
  });

  it('covers every status in the enum without throwing', () => {
    for (const status of Object.values(CommitmentStatus)) {
      expect(Array.isArray(availableActionsFor({ status, activeSince: null }))).toBe(true);
    }
  });

  describe('isActionAvailable', () => {
    it('agrees with the list it is derived from', () => {
      expect(isActionAvailable({ status: 'PLANNED', activeSince: null }, 'start')).toBe(true);
      expect(isActionAvailable({ status: 'PLANNED', activeSince: null }, 'pause')).toBe(false);
      expect(isActionAvailable({ status: 'COMPLETED', activeSince: null }, 'complete')).toBe(
        false,
      );
    });
  });
});
