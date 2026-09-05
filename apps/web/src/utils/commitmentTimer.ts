import type { CommitmentTimer } from '../types';

// ===========================================================================
// The countdown, derived rather than counted (epic E05, issue #48)
// ===========================================================================
//
// PURE, and a verbatim mirror of `apps/api/src/commitments/actions/
// commitment-timer.ts`. The server's numbers are authoritative; this file
// exists so the screen can interpolate BETWEEN responses without asking every
// second.
//
// THE ANCHOR IS `activeSince`, NOT A LOCAL COUNTER. A `setInterval` that
// decremented its own number would drift, would reset on reload, and would keep
// counting through a phone's sleep — three different ways to tell the user a
// duration that never happened. Deriving from a server instant survives all
// three, and PRD §10.9's "evidence is what actually happened" is the reason it
// has to.
// ===========================================================================

/** Beyond this, `activeSince` is clock skew rather than a real future start. */
export const MAX_CLOCK_SKEW_SECONDS = 5;

/**
 * Total active seconds as of `now`.
 *
 * A commitment whose `activeSince` is slightly in the future — the app server
 * and this browser disagree by a second or two — is treated as having just
 * started, rather than producing a negative elapsed time that renders as a
 * countdown running backwards.
 */
export function elapsedSeconds(timer: CommitmentTimer | null, now: Date): number {
  if (!timer) return 0;
  if (!timer.activeSince) return Math.max(0, timer.activeSeconds);

  const runningMs = now.getTime() - new Date(timer.activeSince).getTime();

  if (runningMs < -MAX_CLOCK_SKEW_SECONDS * 1000) {
    // Far enough in the future to be a real disagreement about the clock.
    console.warn(
      '[start] activeSince is in the future; anchoring the timer at the local clock instead',
    );
    return Math.max(0, timer.activeSeconds);
  }

  return Math.max(0, timer.activeSeconds + Math.max(0, Math.floor(runningMs / 1000)));
}

/**
 * Seconds left against the chosen target, floored at zero.
 *
 * Null when no target was chosen: an open-ended session has nothing to count
 * down to, and showing `00:00` for it would tell the user they had run out of
 * time they never asked for.
 */
export function remainingSeconds(timer: CommitmentTimer | null, now: Date): number | null {
  if (!timer || timer.timerMinutes === null) return null;

  return Math.max(0, timer.timerMinutes * 60 - elapsedSeconds(timer, now));
}

export function isRunning(timer: CommitmentTimer | null): boolean {
  return Boolean(timer?.activeSince);
}

/** `M:SS` under an hour, `H:MM:SS` past it. */
export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const pad = (n: number) => String(n).padStart(2, '0');

  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}
