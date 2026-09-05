import { describe, it, expect, vi } from 'vitest';

import {
  elapsedSeconds,
  formatDuration,
  isRunning,
  remainingSeconds,
} from '../../utils/commitmentTimer';
import type { CommitmentTimer } from '../../types';

const timer = (over: Partial<CommitmentTimer> = {}): CommitmentTimer => ({
  activeSince: '2026-03-02T09:00:00.000Z',
  activeSeconds: 0,
  elapsedSeconds: 0,
  timerMinutes: 25,
  remainingSeconds: 1500,
  ...over,
});

const at = (iso: string) => new Date(iso);

describe('commitmentTimer', () => {
  describe('elapsedSeconds', () => {
    it('adds the current run to what was banked', () => {
      expect(
        elapsedSeconds(timer({ activeSeconds: 90 }), at('2026-03-02T09:00:30.000Z')),
      ).toBe(120);
    });

    it('is the banked total while paused, however long ago that was', () => {
      expect(
        elapsedSeconds(
          timer({ activeSince: null, activeSeconds: 90 }),
          at('2026-03-02T18:00:00.000Z'),
        ),
      ).toBe(90);
    });

    it('is zero for a commitment with no timer at all', () => {
      expect(elapsedSeconds(null, at('2026-03-02T09:00:00.000Z'))).toBe(0);
    });

    it('floors partial seconds rather than rounding up', () => {
      expect(elapsedSeconds(timer(), at('2026-03-02T09:00:01.900Z'))).toBe(1);
    });

    // A countdown running backwards is worse than one that is a second out.
    it('ignores a small future activeSince rather than going negative', () => {
      expect(elapsedSeconds(timer(), at('2026-03-02T08:59:58.000Z'))).toBe(0);
    });

    it('warns and falls back to the banked total on real clock skew', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      expect(
        elapsedSeconds(timer({ activeSeconds: 42 }), at('2026-03-02T08:55:00.000Z')),
      ).toBe(42);
      expect(warn).toHaveBeenCalled();

      warn.mockRestore();
    });
  });

  describe('remainingSeconds', () => {
    it('counts down against the target', () => {
      expect(remainingSeconds(timer({ timerMinutes: 5 }), at('2026-03-02T09:01:00.000Z'))).toBe(
        240,
      );
    });

    it('floors at zero once the target is passed', () => {
      expect(remainingSeconds(timer({ timerMinutes: 5 }), at('2026-03-02T09:30:00.000Z'))).toBe(
        0,
      );
    });

    // Showing 00:00 would tell the user they ran out of time they never asked for.
    it('is null for an open-ended session', () => {
      expect(
        remainingSeconds(timer({ timerMinutes: null }), at('2026-03-02T09:00:00.000Z')),
      ).toBeNull();
    });

    it('is null when there is no timer', () => {
      expect(remainingSeconds(null, at('2026-03-02T09:00:00.000Z'))).toBeNull();
    });
  });

  describe('isRunning', () => {
    it('is true exactly while activeSince is set', () => {
      expect(isRunning(timer())).toBe(true);
      expect(isRunning(timer({ activeSince: null }))).toBe(false);
      expect(isRunning(null)).toBe(false);
    });
  });

  describe('formatDuration', () => {
    it.each([
      [0, '0:00'],
      [9, '0:09'],
      [60, '1:00'],
      [1500, '25:00'],
      [3600, '1:00:00'],
      [3661, '1:01:01'],
    ])('renders %i seconds as %s', (seconds, expected) => {
      expect(formatDuration(seconds)).toBe(expected);
    });

    it('never renders a negative time', () => {
      expect(formatDuration(-30)).toBe('0:00');
    });
  });
});
