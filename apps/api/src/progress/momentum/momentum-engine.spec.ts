import {
  BUILDING_MAX_HISTORY_DAYS,
  MIN_PLANNED,
  computeMomentum,
  type DomainWindow,
  type WindowCommitment,
} from './momentum-engine';

// =============================================================================
// The momentum state machine (issue #98, epic E11)
// =============================================================================
//
// Every state gets a fixture, and the PRECEDENCE gets two overlap cases —
// because the order of the rules is the part a refactor silently reverses, and
// a user who came back after three misses being told they are SLIPPING is the
// exact failure VISION §31 exists to prevent.
// =============================================================================

const NOW = new Date('2026-03-02T12:00:00.000Z');
const DAY = 86_400_000;

type DayInput = {
  /** Days before `now` the row was scheduled for. */
  offset: number;
  status: WindowCommitment['status'];
  fallback?: boolean;
  reschedules?: number;
  type?: string | null;
};

function window(over: {
  now?: Date;
  domain?: DomainWindow['domain'];
  firstActivityDaysAgo?: number | null;
  days: DayInput[];
}): DomainWindow {
  const now = over.now ?? NOW;
  const domain = over.domain ?? 'HEALTH';

  return {
    domain,
    now,
    timeZone: 'UTC',
    firstActivityAt:
      over.firstActivityDaysAgo === null
        ? null
        : new Date(now.getTime() - (over.firstActivityDaysAgo ?? 200) * DAY),
    commitments: over.days.map((day, index) => ({
      id: `c${index}`,
      domain,
      scheduledStart: new Date(now.getTime() - day.offset * DAY),
      status: day.status,
      rescheduleCount: day.reschedules ?? 0,
      fallbackUsed: day.fallback ?? false,
      completedAt:
        day.status === 'COMPLETED' || day.status === 'PARTIALLY_COMPLETED'
          ? new Date(now.getTime() - day.offset * DAY + 3_600_000)
          : null,
      commitmentType: day.type === undefined ? 'workout' : day.type,
    })),
  };
}

describe('computeMomentum (#98)', () => {
  describe('INSUFFICIENT_DATA', () => {
    it('is the answer below three decided rows, with exactly one bullet', () => {
      const result = computeMomentum(
        window({ days: [{ offset: 3, status: 'COMPLETED' }, { offset: 5, status: 'MISSED' }] }),
      );

      expect(result.state).toBe('INSUFFICIENT_DATA');
      expect(result.evidence).toHaveLength(1);
      expect(result.evidence[0]).toContain(`momentum appears after ${MIN_PLANNED}`);
    });

    it('ignores CANCELLED and RESCHEDULED rows when counting to the threshold', () => {
      const result = computeMomentum(
        window({
          days: [
            { offset: 2, status: 'COMPLETED' },
            { offset: 4, status: 'CANCELLED' },
            { offset: 6, status: 'RESCHEDULED' },
            { offset: 8, status: 'CANCELLED' },
          ],
        }),
      );

      // Only one decided row survives, so there is nothing honest to report.
      expect(result.state).toBe('INSUFFICIENT_DATA');
      expect(result.signals.planned).toBe(1);
    });
  });

  describe('BUILDING', () => {
    it('describes a new user who is mostly keeping their commitments', () => {
      const result = computeMomentum(
        window({
          firstActivityDaysAgo: 10,
          days: [
            { offset: 1, status: 'COMPLETED' },
            { offset: 3, status: 'COMPLETED' },
            { offset: 5, status: 'MISSED' },
            { offset: 7, status: 'COMPLETED' },
            { offset: 9, status: 'COMPLETED' },
            { offset: 10, status: 'MISSED' },
          ],
        }),
      );

      expect(result.state).toBe('BUILDING');
      expect(result.signals.historyDays).toBeLessThan(BUILDING_MAX_HISTORY_DAYS);
      expect(result.evidence[0]).toBe('4 of 6 planned workouts completed');
    });
  });

  describe('IMPROVING and SLIPPING', () => {
    it('reads a rising second half as IMPROVING and names both halves', () => {
      const result = computeMomentum(
        window({
          days: [
            ...[16, 18, 20, 22, 24, 26, 27].map((offset, i) => ({
              offset,
              status: (i < 3 ? 'COMPLETED' : 'MISSED') as WindowCommitment['status'],
            })),
            ...[1, 3, 5, 7, 9, 11, 13].map((offset, i) => ({
              offset,
              status: (i < 6 ? 'COMPLETED' : 'MISSED') as WindowCommitment['status'],
            })),
          ],
        }),
      );

      expect(result.state).toBe('IMPROVING');
      expect(result.evidence.join(' ')).toContain('Last two weeks: 6 of 7, before that 3 of 7');
    });

    it('reads a falling second half as SLIPPING', () => {
      const result = computeMomentum(
        window({
          days: [
            ...[16, 18, 20, 22, 24, 26, 27].map((offset, i) => ({
              offset,
              status: (i < 6 ? 'COMPLETED' : 'MISSED') as WindowCommitment['status'],
            })),
            ...[3, 5, 7, 9, 11, 13, 14].map((offset, i) => ({
              offset,
              status: (i < 2 ? 'COMPLETED' : 'SKIPPED') as WindowCommitment['status'],
            })),
          ],
        }),
      );

      expect(result.state).toBe('SLIPPING');
    });

    it('reads three not-started in a row as SLIPPING and says so plainly', () => {
      const result = computeMomentum(
        window({
          days: [
            { offset: 9, status: 'COMPLETED' },
            { offset: 7, status: 'COMPLETED' },
            { offset: 5, status: 'MISSED' },
            { offset: 3, status: 'SKIPPED' },
            { offset: 1, status: 'MISSED' },
          ],
        }),
      );

      expect(result.state).toBe('SLIPPING');
      expect(result.evidence).toContain('3 in a row not started');
    });
  });

  describe('RECOVERING', () => {
    it('beats SLIPPING — a return is the fact worth reporting', () => {
      const result = computeMomentum(
        window({
          days: [
            { offset: 12, status: 'COMPLETED' },
            { offset: 9, status: 'MISSED' },
            { offset: 7, status: 'MISSED' },
            { offset: 5, status: 'MISSED' },
            { offset: 1, status: 'COMPLETED' },
          ],
        }),
      );

      expect(result.state).toBe('RECOVERING');
      expect(result.evidence).toContain('Returned 11 days after a miss');
    });

    it('beats BUILDING for a new user who lapsed and came back', () => {
      const result = computeMomentum(
        window({
          firstActivityDaysAgo: 12,
          days: [
            { offset: 11, status: 'COMPLETED' },
            { offset: 9, status: 'COMPLETED' },
            { offset: 6, status: 'MISSED' },
            { offset: 1, status: 'COMPLETED' },
          ],
        }),
      );

      expect(result.state).toBe('RECOVERING');
    });

    it('is not awarded for a planned rest — a gap with no miss in it', () => {
      const result = computeMomentum(
        window({
          days: [
            { offset: 20, status: 'COMPLETED' },
            { offset: 14, status: 'COMPLETED' },
            { offset: 7, status: 'COMPLETED' },
            { offset: 1, status: 'COMPLETED' },
          ],
        }),
      );

      expect(result.state).not.toBe('RECOVERING');
      expect(result.signals.returnedAfterIdleDays).toBeNull();
    });
  });

  describe('STEADY', () => {
    it('is what an even split across both halves is called', () => {
      const result = computeMomentum(
        window({
          days: [
            ...[16, 18, 20, 22, 24, 26, 27].map((offset, i) => ({
              offset,
              status: (i < 5 ? 'COMPLETED' : 'MISSED') as WindowCommitment['status'],
            })),
            ...[2, 4, 6, 8, 10, 12, 13].map((offset, i) => ({
              offset,
              status: (i < 5 ? 'COMPLETED' : 'MISSED') as WindowCommitment['status'],
            })),
          ],
        }),
      );

      expect(result.state).toBe('STEADY');
    });
  });

  describe('the rules that keep the count honest', () => {
    it('counts a fallback completion as a completion and names it', () => {
      const result = computeMomentum(
        window({
          days: [
            { offset: 1, status: 'COMPLETED', fallback: true },
            { offset: 3, status: 'COMPLETED' },
            { offset: 5, status: 'COMPLETED' },
            { offset: 7, status: 'MISSED' },
          ],
        }),
      );

      expect(result.signals.fallback).toBe(1);
      expect(result.evidence).toContain('1 completed with the short or minimum version');
    });

    it('reports rows moved more than once', () => {
      const result = computeMomentum(
        window({
          days: [
            { offset: 1, status: 'COMPLETED', reschedules: 2 },
            { offset: 3, status: 'COMPLETED' },
            { offset: 5, status: 'COMPLETED' },
          ],
        }),
      );

      expect(result.evidence).toContain('1 moved more than once');
    });

    it('gives a past-due PLANNED row the same answer as the same row MISSED', () => {
      const days: DayInput[] = [
        { offset: 9, status: 'COMPLETED' },
        { offset: 7, status: 'COMPLETED' },
        { offset: 5, status: 'MISSED' },
        { offset: 3, status: 'MISSED' },
      ];

      const beforeSweep = computeMomentum(
        window({ days: [...days, { offset: 1, status: 'PLANNED' }] }),
      );
      const afterSweep = computeMomentum(
        window({ days: [...days, { offset: 1, status: 'MISSED' }] }),
      );

      expect(beforeSweep.state).toBe(afterSweep.state);
      expect(beforeSweep.signals.planned).toBe(afterSweep.signals.planned);
      expect(beforeSweep.signals.consecutiveMisses).toBe(
        afterSweep.signals.consecutiveMisses,
      );
    });

    it('does not count a future PLANNED row against the user', () => {
      const result = computeMomentum(
        window({
          days: [
            { offset: 1, status: 'COMPLETED' },
            { offset: 3, status: 'COMPLETED' },
            { offset: 5, status: 'COMPLETED' },
            { offset: -2, status: 'PLANNED' },
          ],
        }),
      );

      expect(result.signals.planned).toBe(3);
    });

    it('names the domain generically when the rows are not all one type', () => {
      const result = computeMomentum(
        window({
          domain: 'WORK',
          days: [
            { offset: 1, status: 'COMPLETED', type: 'focus_session' },
            { offset: 3, status: 'COMPLETED', type: null },
            { offset: 5, status: 'MISSED', type: 'focus_session' },
          ],
        }),
      );

      expect(result.evidence[0]).toBe('2 of 3 planned work actions completed');
    });
  });

  describe('the promises the whole epic rests on', () => {
    const busy = window({
      days: [
        { offset: 1, status: 'COMPLETED', fallback: true },
        { offset: 3, status: 'MISSED' },
        { offset: 5, status: 'COMPLETED', reschedules: 2 },
        { offset: 9, status: 'PARTIALLY_COMPLETED' },
        { offset: 20, status: 'SKIPPED' },
      ],
    });

    it('is deterministic: the same window twice is deep-equal', () => {
      expect(computeMomentum(busy)).toEqual(computeMomentum(busy));
    });

    it('never renders a percentage or an out-of-100 score (PRD P13, §54)', () => {
      const states: DomainWindow[] = [
        busy,
        window({ days: [{ offset: 1, status: 'COMPLETED' }] }),
        window({
          days: [
            { offset: 1, status: 'MISSED' },
            { offset: 3, status: 'MISSED' },
            { offset: 5, status: 'MISSED' },
          ],
        }),
      ];

      for (const input of states) {
        for (const bullet of computeMomentum(input).evidence) {
          expect(bullet).not.toMatch(/\d+\s*%|\/\s*100/);
        }
      }
    });

    it('caps the evidence at three bullets', () => {
      expect(computeMomentum(busy).evidence.length).toBeLessThanOrEqual(3);
    });
  });
});
