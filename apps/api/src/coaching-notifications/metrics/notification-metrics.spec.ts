import { findBannedPhrases } from '../copy/banned-phrases';
import {
  aggregateNotificationMetrics,
  bucketFor,
  independenceFrom,
  insightsFrom,
  localMonth,
  MIN_BUCKET_SENDS,
  type CompletionRow,
  type InteractionRow,
  type PerEventMetrics,
  type ReminderTrendPoint,
} from './notification-metrics';

const CR = 'America/Costa_Rica';
const NOW = new Date('2026-09-30T12:00:00.000Z');
const FROM = new Date('2026-09-01T12:00:00.000Z');

let sequence = 0;
const row = (over: Partial<InteractionRow> = {}): InteractionRow => {
  sequence += 1;
  return {
    id: `i${sequence}`,
    eventKey: 'coach.commitment_upcoming',
    kind: 'SENT',
    commitmentId: 'c1',
    sentInteractionId: null,
    action: null,
    suppressReason: null,
    createdAt: new Date('2026-09-15T12:00:00.000Z'),
    meta: null,
    ...over,
  };
};

const completion = (over: Partial<CompletionRow> = {}): CompletionRow => ({
  commitmentId: 'c1',
  domain: 'HEALTH',
  completedAt: new Date('2026-09-15T14:00:00.000Z'),
  ...over,
});

const aggregate = (
  interactions: InteractionRow[],
  completions: CompletionRow[] = [],
  timeZone = CR,
) =>
  aggregateNotificationMetrics({
    interactions,
    completions,
    timeZone,
    window: { from: FROM, to: NOW },
  });

const forEvent = (metrics: ReturnType<typeof aggregate>, key: string): PerEventMetrics =>
  metrics.perEvent.find((event) => event.eventKey === key)!;

beforeEach(() => {
  sequence = 0;
});

describe('aggregateNotificationMetrics (#69)', () => {
  it('reports every coaching event, in registry order, even at zero', () => {
    const metrics = aggregate([]);

    expect(metrics.perEvent).toHaveLength(9);
    expect(metrics.perEvent[0].eventKey).toBe('coach.commitment_upcoming');
    expect(metrics.perEvent.at(-1)?.eventKey).toBe('coach.plan_issue');
    expect(metrics.perEvent.every((event) => event.sent === 0)).toBe(true);
  });

  it('carries the PRD category alongside the key', () => {
    expect(forEvent(aggregate([]), 'coach.family_presence').category).toBe('N5');
  });

  it('reports the window it was asked for', () => {
    const metrics = aggregate([]);

    expect(metrics.window.days).toBe(29);
    expect(metrics.window.from).toBe(FROM.toISOString());
  });

  describe('per-event counts', () => {
    it('counts each kind against its event', () => {
      const sent = row();
      const metrics = aggregate([
        sent,
        row({ kind: 'OPENED', sentInteractionId: sent.id }),
        row({ kind: 'ACTIONED', sentInteractionId: sent.id, action: 'START' }),
        row({ kind: 'SUPPRESSED', suppressReason: 'QUIET_HOURS' }),
        row({ eventKey: 'coach.rescue' }),
      ]);

      const upcoming = forEvent(metrics, 'coach.commitment_upcoming');
      expect(upcoming).toMatchObject({ sent: 1, opened: 1, actioned: 1, dismissed: 0 });
      expect(upcoming.suppressed.QUIET_HOURS).toBe(1);
      expect(forEvent(metrics, 'coach.rescue').sent).toBe(1);
    });

    it('breaks suppressions down by reason, with every reason present', () => {
      const metrics = aggregate([
        row({ kind: 'SUPPRESSED', suppressReason: 'SKIPPED' }),
        row({ kind: 'SUPPRESSED', suppressReason: 'SKIPPED' }),
        row({ kind: 'SUPPRESSED', suppressReason: 'DAILY_CAP' }),
      ]);

      const upcoming = forEvent(metrics, 'coach.commitment_upcoming');
      expect(upcoming.suppressed.SKIPPED).toBe(2);
      expect(upcoming.suppressed.DAILY_CAP).toBe(1);
      expect(upcoming.suppressed.FATIGUE).toBe(0);
    });

    it('counts a send nothing answered as ignored', () => {
      expect(forEvent(aggregate([row(), row()]), 'coach.commitment_upcoming').ignored).toBe(2);
    });

    // A response can outlive the window its send fell outside of, and a
    // negative "ignored" would be nonsense rather than a signal.
    it('never reports a negative ignored count', () => {
      const metrics = aggregate([
        row({ kind: 'OPENED' }),
        row({ kind: 'ACTIONED', action: 'START' }),
      ]);

      expect(forEvent(metrics, 'coach.commitment_upcoming').ignored).toBe(0);
    });

    it('reports an action rate, and null when nothing was sent', () => {
      const sent = row();
      const metrics = aggregate([
        sent,
        row(),
        row({ kind: 'ACTIONED', sentInteractionId: sent.id, action: 'START' }),
      ]);

      expect(forEvent(metrics, 'coach.commitment_upcoming').actionRate).toBe(0.5);
      expect(forEvent(metrics, 'coach.rescue').actionRate).toBeNull();
    });
  });

  describe('bestLeadMinutes', () => {
    const sendsAt = (lead: number, count: number, actionedCount: number) => {
      const rows: InteractionRow[] = [];
      for (let i = 0; i < count; i += 1) {
        const sent = row({ meta: { leadMinutes: lead } });
        rows.push(sent);
        if (i < actionedCount) {
          rows.push(row({ kind: 'ACTIONED', sentInteractionId: sent.id, action: 'START' }));
        }
      }
      return rows;
    };

    it('picks the bucket with the best action rate', () => {
      const metrics = aggregate([...sendsAt(20, 4, 3), ...sendsAt(5, 4, 1)]);

      expect(forEvent(metrics, 'coach.commitment_upcoming').bestLeadMinutes).toBe(20);
    });

    // One send that happened to be acted on is a 100% action rate, and calling
    // that a finding would be worse than saying nothing.
    it('ignores a bucket with too few sends to mean anything', () => {
      const metrics = aggregate([
        ...sendsAt(30, MIN_BUCKET_SENDS - 1, MIN_BUCKET_SENDS - 1),
        ...sendsAt(10, 4, 1),
      ]);

      expect(forEvent(metrics, 'coach.commitment_upcoming').bestLeadMinutes).toBe(10);
    });

    it('is null when no bucket qualifies', () => {
      expect(forEvent(aggregate(sendsAt(20, 2, 2)), 'coach.commitment_upcoming')
        .bestLeadMinutes).toBeNull();
    });

    // A bucket everyone ignored is not a recommendation.
    it('is null when the best bucket was never acted on', () => {
      expect(forEvent(aggregate(sendsAt(20, 5, 0)), 'coach.commitment_upcoming')
        .bestLeadMinutes).toBeNull();
    });

    it('is null when no send recorded a lead time', () => {
      expect(forEvent(aggregate([row(), row(), row()]), 'coach.commitment_upcoming')
        .bestLeadMinutes).toBeNull();
    });
  });

  describe('the trend', () => {
    it('groups by calendar month and domain', () => {
      const metrics = aggregate(
        [
          row({ createdAt: new Date('2026-08-10T12:00:00.000Z') }),
          row({ createdAt: new Date('2026-09-10T12:00:00.000Z') }),
        ],
        [
          completion({ completedAt: new Date('2026-08-10T14:00:00.000Z') }),
          completion({ completedAt: new Date('2026-09-10T14:00:00.000Z') }),
        ],
      );

      expect(metrics.reminderTrend).toEqual([
        { month: '2026-08', domain: 'HEALTH', sent: 1, completions: 1 },
        { month: '2026-09', domain: 'HEALTH', sent: 1, completions: 1 },
      ]);
    });

    // The bug this exists to prevent: a UTC month boundary files a Costa Rican
    // user's 30 September evening under October.
    it('uses the user’s months, not UTC’s', () => {
      const at = new Date('2026-10-01T05:30:00.000Z'); // 23:30 on 30 Sep in CR

      expect(localMonth(at, CR)).toBe('2026-09');
      expect(localMonth(at, 'UTC')).toBe('2026-10');
    });

    // Guessing one would put reminders in a column the user's own history does
    // not support.
    it('files no send whose commitment was never completed', () => {
      const metrics = aggregate([row({ commitmentId: 'never-done' })], []);

      expect(metrics.reminderTrend).toEqual([]);
    });
  });
});

describe('independenceFrom — PRD §65 (#69)', () => {
  it('counts a completion with no prior send as unprompted', () => {
    expect(independenceFrom([], [completion()])).toEqual({
      completions: 1,
      unprompted: 1,
      ratio: 1,
    });
  });

  it('counts a completion preceded by a send as prompted', () => {
    const sent = row({ createdAt: new Date('2026-09-15T13:00:00.000Z') });

    expect(independenceFrom([sent], [completion()])).toEqual({
      completions: 1,
      unprompted: 0,
      ratio: 0,
    });
  });

  // A celebration (N7) fires after a completion by construction. Counting it
  // would make every celebrated success look prompted, driving the metric down
  // exactly when the user is doing best.
  it('ignores a send that arrived after the completion', () => {
    const after = row({
      eventKey: 'coach.evidence',
      createdAt: new Date('2026-09-15T14:30:00.000Z'),
    });

    expect(independenceFrom([after], [completion()]).unprompted).toBe(1);
  });

  it('ignores a send for a different commitment', () => {
    const other = row({
      commitmentId: 'c2',
      createdAt: new Date('2026-09-15T13:00:00.000Z'),
    });

    expect(independenceFrom([other], [completion()]).unprompted).toBe(1);
  });

  it('ignores anything that is not a send', () => {
    const opened = row({ kind: 'OPENED', createdAt: new Date('2026-09-15T13:00:00.000Z') });

    expect(independenceFrom([opened], [completion()]).unprompted).toBe(1);
  });

  it('computes the ratio over several completions', () => {
    const prompted = row({
      commitmentId: 'c1',
      createdAt: new Date('2026-09-15T13:00:00.000Z'),
    });

    expect(
      independenceFrom(
        [prompted],
        [completion({ commitmentId: 'c1' }), completion({ commitmentId: 'c2' })],
      ),
    ).toEqual({ completions: 2, unprompted: 1, ratio: 0.5 });
  });

  // Nothing happened is not "0% independent" — it is no answer.
  it('is null rather than zero when there were no completions', () => {
    expect(independenceFrom([row()], [])).toEqual({
      completions: 0,
      unprompted: 0,
      ratio: null,
    });
  });
});

describe('insightsFrom (#69)', () => {
  const perEvent = (over: Partial<PerEventMetrics>[] = []): PerEventMetrics[] =>
    aggregate([]).perEvent.map((event) => ({
      ...event,
      ...(over.find((candidate) => candidate.eventKey === event.eventKey) ?? {}),
    }));

  const trend = (points: Partial<ReminderTrendPoint>[]): ReminderTrendPoint[] =>
    points.map((point) => ({
      month: '2026-09',
      domain: 'HEALTH',
      sent: 0,
      completions: 1,
      ...point,
    }));

  // VISION §38, and the reason the whole metrics file exists.
  it('says the sentence when a domain needed fewer reminders', () => {
    const insights = insightsFrom(
      perEvent(),
      trend([
        { month: '2026-08', sent: 9, completions: 4 },
        { month: '2026-09', sent: 2, completions: 4 },
      ]),
    );

    expect(insights[0]).toBe(
      'You needed 9 Health reminders in August. In September you needed 2.',
    );
  });

  // Fewer reminders with no completions is somebody who stopped, and
  // congratulating them for it would be the worst thing this screen could say.
  it('says nothing when the reminders dropped because the user did', () => {
    const insights = insightsFrom(
      perEvent(),
      trend([
        { month: '2026-08', sent: 9, completions: 4 },
        { month: '2026-09', sent: 0, completions: 0 },
      ]),
    );

    expect(insights).toEqual([]);
  });

  it('says nothing when the reminders went up', () => {
    expect(
      insightsFrom(
        perEvent(),
        trend([
          { month: '2026-08', sent: 2, completions: 4 },
          { month: '2026-09', sent: 9, completions: 4 },
        ]),
      ),
    ).toEqual([]);
  });

  it('reports the lead time that works', () => {
    const insights = insightsFrom(
      perEvent([{ eventKey: 'coach.commitment_upcoming', bestLeadMinutes: 20 }]),
      [],
    );

    expect(insights).toContain('Reminders 20 minutes ahead lead to the most starts.');
  });

  // Names the CATEGORY and offers the setting. The message being unhelpful is a
  // fact about the message, not about the person.
  it('offers to turn off a category that is going unused', () => {
    const insights = insightsFrom(
      perEvent([{ eventKey: 'coach.fallback_offer', sent: 10, actionRate: 0 }]),
      [],
    );

    expect(insights.some((line) => line.includes('Fallback offer'))).toBe(true);
    expect(insights.some((line) => line.includes('turn them off'))).toBe(true);
  });

  it('needs enough sends before calling a category unused', () => {
    expect(
      insightsFrom(
        perEvent([{ eventKey: 'coach.fallback_offer', sent: 4, actionRate: 0 }]),
        [],
      ),
    ).toEqual([]);
  });

  it('never offers more than three', () => {
    const insights = insightsFrom(
      perEvent([
        { eventKey: 'coach.commitment_upcoming', bestLeadMinutes: 20 },
        { eventKey: 'coach.fallback_offer', sent: 10, actionRate: 0 },
        { eventKey: 'coach.rescue', sent: 10, actionRate: 0 },
      ]),
      trend([
        { month: '2026-08', sent: 9, completions: 4 },
        { month: '2026-09', sent: 2, completions: 4 },
      ]),
    );

    expect(insights.length).toBeLessThanOrEqual(3);
  });

  // These are read on a progress screen; the same rule the notification copy
  // lives under applies (PRD §129).
  it('uses none of the banned vocabulary', () => {
    const insights = insightsFrom(
      perEvent([
        { eventKey: 'coach.commitment_upcoming', bestLeadMinutes: 20 },
        { eventKey: 'coach.fallback_offer', sent: 10, actionRate: 0 },
      ]),
      trend([
        { month: '2026-08', sent: 9, completions: 4 },
        { month: '2026-09', sent: 2, completions: 4 },
      ]),
    );

    for (const line of insights) expect(findBannedPhrases(line)).toEqual([]);
  });
});

describe('bucketFor (#69)', () => {
  it.each([
    [4, null],
    [5, 5],
    [9, 5],
    [10, 10],
    [19, 10],
    [20, 20],
    [29, 20],
    [30, 30],
    [45, 30],
  ])('files %i minutes under %s', (lead, expected) => {
    expect(bucketFor(lead)).toBe(expected);
  });

  it('is null for an absent lead time', () => {
    expect(bucketFor(undefined)).toBeNull();
  });
});

describe('an empty history', () => {
  it('is a normal response, not an error', () => {
    const metrics = aggregate([], []);

    expect(metrics.independence).toEqual({ completions: 0, unprompted: 0, ratio: null });
    expect(metrics.reminderTrend).toEqual([]);
    expect(metrics.insights).toEqual([]);
    expect(metrics.perEvent).toHaveLength(9);
  });
});
