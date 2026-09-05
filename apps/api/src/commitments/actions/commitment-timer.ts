// =============================================================================
// The commitment timer (issue #40, epic E05)
// =============================================================================
//
// DELIBERATELY FREE OF NEST AND PRISMA IMPORTS, for the same reason
// `commitment-transitions.ts` is: the arithmetic below is the whole reason a
// reloaded Start screen shows the right number, and it deserves to be provable
// without a database.
//
// THE MODEL. Two columns, one derived value:
//
//   activeSeconds  time banked at the last pause
//   activeSince    when the current run began, or null while paused
//   elapsed        activeSeconds + (activeSince ? now - activeSince : 0)
//
// Elapsed is NEVER stored. Storing it would mean writing on a schedule to keep
// it true, and a client that never sends the last write would leave a number
// that is quietly wrong forever. Deriving it means the answer is correct for a
// page reload, a second device, and a phone that slept through the session —
// and that a client clock cannot inflate the record.
// =============================================================================

/** The two columns the arithmetic reads. */
export interface TimerState {
  activeSince: Date | null;
  activeSeconds: number;
}

/**
 * Total active seconds as of `now`.
 *
 * Clamped at zero: clock skew between the application server and the database
 * can put `activeSince` marginally in the future, and a negative elapsed time
 * would render as a timer counting up from below zero.
 */
export function elapsedSeconds(state: TimerState, now: Date): number {
  if (!state.activeSince) return Math.max(0, state.activeSeconds);

  const running = Math.floor((now.getTime() - state.activeSince.getTime()) / 1000);

  return Math.max(0, state.activeSeconds + Math.max(0, running));
}

/** Whether the timer is counting right now. */
export function isRunning(state: TimerState): boolean {
  return state.activeSince !== null;
}

/**
 * Seconds left against a `timerMinutes` target, floored at zero.
 *
 * Null when no target was chosen — an open-ended session has nothing to count
 * down to, and reporting `0` for it would make the Start screen claim the user
 * had run out of time they never asked for.
 */
export function remainingSeconds(
  state: TimerState,
  timerMinutes: number | null,
  now: Date,
): number | null {
  if (timerMinutes === null) return null;

  return Math.max(0, timerMinutes * 60 - elapsedSeconds(state, now));
}
