import {
  GRACE_EVERY_N_WEEKS,
  computeConsistencyRun,
  WEEK_SUCCESS_RATIO,
} from './consistency-run';
import type { WindowCommitment } from './momentum-engine';

// =============================================================================
// The run counted in weeks (issue #98, epic E11)
// =============================================================================
//
// The two things a reviewer cannot see by reading the function: that an empty
// week is neutral rather than a break, and that the week boundary follows the
// user's own timezone. Both are the difference between a run people trust and
// a number that resets while they sleep.
// =============================================================================

const DAY = 86_400_000;
// A Monday, so week arithmetic in the fixtures is legible.
const MONDAY = new Date('2026-03-02T12:00:00.000Z');

function row(over: Partial<WindowCommitment> & { scheduledStart: Date }): WindowCommitment {
  return {
    id: Math.random().toString(36).slice(2),
    domain: 'WORK',
    status: 'COMPLETED',
    rescheduleCount: 0,
    fallbackUsed: false,
    completedAt: over.scheduledStart,
    commitmentType: null,
    ...over,
  };
}

/** `weeksAgo` counted back from the week `now` is in; index 0 is that week. */
function weekRows(
  now: Date,
  weeksAgo: number,
  completed: number,
  missed: number,
): WindowCommitment[] {
  // Wednesday of that week, safely inside it in every zone.
  const base = new Date(now.getTime() - weeksAgo * 7 * DAY + 2 * DAY);
  const rows: WindowCommitment[] = [];

  for (let i = 0; i < completed; i += 1) {
    rows.push(row({ scheduledStart: new Date(base.getTime() + i * 3_600_000) }));
  }
  for (let i = 0; i < missed; i += 1) {
    rows.push(
      row({
        scheduledStart: new Date(base.getTime() + (completed + i) * 3_600_000),
        status: 'MISSED',
        completedAt: null,
      }),
    );
  }

  return rows;
}

describe('computeConsistencyRun (#98)', () => {
  it('counts consecutive successful weeks and leaves the current one out', () => {
    const rows = [
      ...weekRows(MONDAY, 0, 5, 0), // the week in progress
      ...weekRows(MONDAY, 1, 4, 1),
      ...weekRows(MONDAY, 2, 4, 1),
      ...weekRows(MONDAY, 3, 4, 1),
    ];

    const run = computeConsistencyRun(rows, MONDAY, 'UTC');

    expect(run.weeks).toBe(3);
    expect(run.graceUsed).toBe(0);
    expect(run.weekly.find((week) => week.current)?.planned).toBe(5);
  });

  it('needs at least the success ratio, not merely one completion', () => {
    // 1 of 4 is below the ratio; the week is a failure even though something
    // happened in it.
    const run = computeConsistencyRun(weekRows(MONDAY, 1, 1, 3), MONDAY, 'UTC');

    expect(WEEK_SUCCESS_RATIO).toBeGreaterThan(0.25);
    expect(run.weeks).toBe(0);
  });

  it('treats a week with nothing planned as neutral, not as a break', () => {
    const rows = [
      ...weekRows(MONDAY, 1, 3, 0),
      // week 2: nothing planned at all
      ...weekRows(MONDAY, 3, 3, 0),
    ];

    const run = computeConsistencyRun(rows, MONDAY, 'UTC');

    expect(run.weeks).toBe(2);
    expect(run.graceUsed).toBe(0);
  });

  it(`forgives one bad week per ${GRACE_EVERY_N_WEEKS} counted weeks`, () => {
    // S S G S S, newest first — the run survives the graced week.
    const rows = [
      ...weekRows(MONDAY, 1, 3, 0),
      ...weekRows(MONDAY, 2, 3, 0),
      ...weekRows(MONDAY, 3, 0, 3),
      ...weekRows(MONDAY, 4, 3, 0),
      ...weekRows(MONDAY, 5, 3, 0),
    ];

    const run = computeConsistencyRun(rows, MONDAY, 'UTC');

    expect(run.weeks).toBe(4);
    expect(run.graceUsed).toBe(1);
  });

  it('spends the grace once — a second bad week inside the window ends the run', () => {
    // S G G, newest first.
    const rows = [
      ...weekRows(MONDAY, 1, 3, 0),
      ...weekRows(MONDAY, 2, 0, 3),
      ...weekRows(MONDAY, 3, 0, 3),
      ...weekRows(MONDAY, 4, 3, 0),
    ];

    const run = computeConsistencyRun(rows, MONDAY, 'UTC');

    expect(run.weeks).toBe(1);
    expect(run.graceUsed).toBe(1);
  });

  it('renders at most twelve weeks, ascending', () => {
    const rows = Array.from({ length: 20 }, (_, i) => weekRows(MONDAY, i + 1, 3, 0)).flat();

    const run = computeConsistencyRun(rows, MONDAY, 'UTC');

    expect(run.weekly.length).toBeLessThanOrEqual(12);
    const labels = run.weekly.map((week) => week.weekStart);
    expect(labels).toEqual([...labels].sort());
  });

  it('files a Sunday 23:30 completion in that week, in the user’s own zone', () => {
    // 2026-03-01 is a Sunday. 23:30 in America/Costa_Rica (UTC−6) is Monday
    // 05:30 UTC — the same instant belongs to different weeks in the two zones.
    const sundayNight = new Date('2026-03-02T05:30:00.000Z');
    const rows = [row({ scheduledStart: sundayNight })];
    const now = new Date('2026-03-04T12:00:00.000Z');

    const local = computeConsistencyRun(rows, now, 'America/Costa_Rica');
    const utc = computeConsistencyRun(rows, now, 'UTC');

    const localWeek = local.weekly.find((week) => week.planned === 1);
    const utcWeek = utc.weekly.find((week) => week.planned === 1);

    expect(localWeek?.current).toBe(false);
    expect(utcWeek?.current).toBe(true);
  });
});
