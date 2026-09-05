import { elapsedSeconds, isRunning, remainingSeconds } from './commitment-timer';

const at = (iso: string) => new Date(iso);

describe('commitment timer (#40)', () => {
  const start = at('2026-03-01T09:00:00.000Z');

  describe('elapsedSeconds', () => {
    it('is the banked total while paused — no clock is running', () => {
      expect(
        elapsedSeconds({ activeSince: null, activeSeconds: 90 }, at('2026-03-01T12:00:00.000Z')),
      ).toBe(90);
    });

    it('adds the current run to the banked total while running', () => {
      expect(
        elapsedSeconds({ activeSince: start, activeSeconds: 90 }, at('2026-03-01T09:00:30.000Z')),
      ).toBe(120);
    });

    it('is zero for a commitment that has never run', () => {
      expect(elapsedSeconds({ activeSince: null, activeSeconds: 0 }, start)).toBe(0);
    });

    it('floors partial seconds rather than rounding up', () => {
      expect(
        elapsedSeconds({ activeSince: start, activeSeconds: 0 }, at('2026-03-01T09:00:01.900Z')),
      ).toBe(1);
    });

    // Clock skew between the app server and the database can put `activeSince`
    // marginally in the future; a negative elapsed time would render as a timer
    // counting up from below zero.
    it('never returns a negative number when activeSince is in the future', () => {
      expect(
        elapsedSeconds({ activeSince: at('2026-03-01T09:00:05.000Z'), activeSeconds: 0 }, start),
      ).toBe(0);
    });

    it('survives a full pause/continue cycle, banking each run', () => {
      // Run for 60s.
      const afterFirstRun = elapsedSeconds(
        { activeSince: start, activeSeconds: 0 },
        at('2026-03-01T09:01:00.000Z'),
      );
      expect(afterFirstRun).toBe(60);

      // Paused for an hour: the number does not move.
      expect(
        elapsedSeconds(
          { activeSince: null, activeSeconds: afterFirstRun },
          at('2026-03-01T10:01:00.000Z'),
        ),
      ).toBe(60);

      // Continue at 10:01, read at 10:01:30.
      expect(
        elapsedSeconds(
          { activeSince: at('2026-03-01T10:01:00.000Z'), activeSeconds: afterFirstRun },
          at('2026-03-01T10:01:30.000Z'),
        ),
      ).toBe(90);
    });
  });

  describe('isRunning', () => {
    it('is true exactly when activeSince is set', () => {
      expect(isRunning({ activeSince: start, activeSeconds: 0 })).toBe(true);
      expect(isRunning({ activeSince: null, activeSeconds: 500 })).toBe(false);
    });
  });

  describe('remainingSeconds', () => {
    it('counts down against the target', () => {
      expect(
        remainingSeconds(
          { activeSince: start, activeSeconds: 0 },
          5,
          at('2026-03-01T09:01:00.000Z'),
        ),
      ).toBe(240);
    });

    it('floors at zero once the target is passed', () => {
      expect(
        remainingSeconds(
          { activeSince: start, activeSeconds: 0 },
          5,
          at('2026-03-01T09:30:00.000Z'),
        ),
      ).toBe(0);
    });

    // An open-ended session has nothing to count down to; reporting 0 would
    // make the Start screen claim the user ran out of time they never asked for.
    it('is null when no target was chosen', () => {
      expect(remainingSeconds({ activeSince: start, activeSeconds: 0 }, null, start)).toBeNull();
    });
  });
});
