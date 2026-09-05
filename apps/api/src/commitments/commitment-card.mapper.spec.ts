import type { Commitment } from '@prisma/client';

import { commitmentCardSchema } from './commitment-card.schema';
import {
  DEFAULT_FULL_MINUTES,
  MINIMUM_VERSION_MINUTES,
  stepsOf,
  toCommitmentCard,
  versionsOf,
} from './commitment-card.mapper';

const NOW = new Date('2026-03-01T09:10:00.000Z');

function row(overrides: Partial<Commitment> = {}): Commitment {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    domain: 'WORK',
    title: 'Draft the proposal storyline',
    outcomeId: null,
    planVersionId: null,
    routineId: null,
    scheduledStart: new Date('2026-03-01T09:00:00.000Z'),
    scheduledEnd: null,
    importance: 5,
    commitmentType: null,
    fullVersion: null,
    shortVersion: null,
    minimumVersion: null,
    fullMinutes: null,
    shortMinutes: null,
    minimumMinutes: null,
    status: 'PLANNED',
    rescheduleCount: 0,
    rescheduledFromId: null,
    skipReason: null,
    skipNote: null,
    userConfirmed: false,
    startedAt: null,
    completedAt: null,
    activeSince: null,
    activeSeconds: 0,
    timerMinutes: null,
    versionUsed: null,
    minutesSpent: null,
    steps: null,
    decomposedFromId: null,
    createdAt: new Date('2026-02-28T00:00:00.000Z'),
    updatedAt: new Date('2026-02-28T00:00:00.000Z'),
    ...overrides,
  } as Commitment;
}

describe('toCommitmentCard (#40)', () => {
  it('produces a body that satisfies the published schema', () => {
    expect(commitmentCardSchema.safeParse(toCommitmentCard(row(), NOW)).success).toBe(true);
  });

  describe('versions', () => {
    it('falls back to the commitment title and the default duration', () => {
      expect(versionsOf(row())).toEqual({
        full: { title: 'Draft the proposal storyline', minutes: DEFAULT_FULL_MINUTES },
        short: null,
        minimum: null,
      });
    });

    it('prefers the scheduled window over the default', () => {
      const versions = versionsOf(
        row({ scheduledEnd: new Date('2026-03-01T09:45:00.000Z') }),
      );

      expect(versions.full.minutes).toBe(45);
    });

    it('prefers the declared minutes over the scheduled window', () => {
      const versions = versionsOf(
        row({ fullMinutes: 25, scheduledEnd: new Date('2026-03-01T10:00:00.000Z') }),
      );

      expect(versions.full.minutes).toBe(25);
    });

    // Inventing a short version would let the sizer offer the user a smaller
    // commitment they never agreed to — the opposite of PRD §57's point.
    it('leaves short and minimum null when they were never declared', () => {
      const versions = versionsOf(row({ fullMinutes: 60 }));

      expect(versions.short).toBeNull();
      expect(versions.minimum).toBeNull();
    });

    it('derives minutes for a declared version that has none', () => {
      const versions = versionsOf(
        row({ fullMinutes: 60, shortVersion: 'Write the decision statement', minimumVersion: 'One sentence' }),
      );

      expect(versions.short).toEqual({ title: 'Write the decision statement', minutes: 30 });
      expect(versions.minimum).toEqual({ title: 'One sentence', minutes: MINIMUM_VERSION_MINUTES });
    });

    it('never derives a short version below its ten-minute floor', () => {
      const versions = versionsOf(row({ fullMinutes: 10, shortVersion: 'A quick pass' }));

      expect(versions.short?.minutes).toBe(10);
    });
  });

  describe('timer', () => {
    // An all-zero timer would render as a stopped stopwatch, which reads as
    // "you started and did nothing".
    it('is null for a commitment nobody has started', () => {
      expect(toCommitmentCard(row(), NOW).timer).toBeNull();
    });

    it('derives elapsed and remaining seconds while running', () => {
      const card = toCommitmentCard(
        row({
          status: 'STARTED',
          startedAt: new Date('2026-03-01T09:00:00.000Z'),
          activeSince: new Date('2026-03-01T09:00:00.000Z'),
          activeSeconds: 0,
          timerMinutes: 25,
        }),
        NOW,
      );

      expect(card.timer).toEqual({
        activeSince: '2026-03-01T09:00:00.000Z',
        activeSeconds: 0,
        elapsedSeconds: 600,
        timerMinutes: 25,
        remainingSeconds: 900,
      });
    });

    it('reports the banked total while paused', () => {
      const card = toCommitmentCard(
        row({
          status: 'STARTED',
          startedAt: new Date('2026-03-01T09:00:00.000Z'),
          activeSince: null,
          activeSeconds: 120,
          timerMinutes: 25,
        }),
        NOW,
      );

      expect(card.timer?.elapsedSeconds).toBe(120);
      expect(card.timer?.activeSince).toBeNull();
    });
  });

  describe('steps', () => {
    it('is null when the column is empty', () => {
      expect(stepsOf(row())).toBeNull();
    });

    it('reads applied decomposition steps back', () => {
      expect(stepsOf(row({ steps: [{ title: 'Open the doc', minutes: 5 }] as never }))).toEqual([
        { title: 'Open the doc', minutes: 5 },
      ]);
    });

    // A card must render for a row whose steps predate a schema change.
    it('treats a malformed column as absent rather than throwing', () => {
      expect(stepsOf(row({ steps: [{ nope: true }] as never }))).toBeNull();
      expect(stepsOf(row({ steps: 'not an array' as never }))).toBeNull();
    });
  });

  it('carries the actions the server will accept', () => {
    expect(toCommitmentCard(row(), NOW).availableActions).toContain('start');
    expect(toCommitmentCard(row({ status: 'COMPLETED' }), NOW).availableActions).toEqual([]);
  });
});
