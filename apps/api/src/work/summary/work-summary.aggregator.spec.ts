import {
  MIN_PLANNED_FOR_WINDOW_VERDICT,
  aggregateWorkWeek,
  type AggregateInput,
  type CommitmentRow,
  type FocusSessionRow,
} from './work-summary.aggregator';

// =============================================================================
// The week's arithmetic (issue #120)
// =============================================================================
//
// Two families of case matter more than the counting: the NULL rates (a week
// with nothing planned must not read as a week where nothing got done), and the
// timezone (the same instant is a different day, and a different part of the
// day, either side of the date line).
// =============================================================================

// 2026-09-07 is a Monday.
const WEEK = '2026-09-07';

/** `n` days after Monday, at the given UTC wall-clock time. */
const dayOfWeek = (offset: number, time: string): Date =>
  new Date(new Date(`2026-09-07T${time}:00.000Z`).getTime() + offset * 86_400_000);

function commitment(over: Partial<CommitmentRow> = {}): CommitmentRow {
  return {
    id: 'c1',
    domain: 'WORK',
    title: 'Storyline',
    outcomeId: 'outcome-1',
    commitmentType: 'FOCUS_SESSION',
    status: 'PLANNED',
    scheduledStart: new Date('2026-09-08T09:00:00.000Z'),
    scheduledEnd: null,
    startedAt: null,
    rescheduleCount: 0,
    fullMinutes: 25,
    ...over,
  };
}

function session(over: Partial<FocusSessionRow> = {}): FocusSessionRow {
  return {
    id: 's1',
    commitmentId: 'c1',
    startedAt: new Date('2026-09-08T09:00:00.000Z'),
    endedAt: new Date('2026-09-08T09:25:00.000Z'),
    outcome: 'DONE',
    actualMinutes: 25,
    distractionNotes: [],
    ...over,
  };
}

function makeWeek(over: Partial<AggregateInput> = {}): AggregateInput {
  return {
    weekStart: WEEK,
    timezone: 'UTC',
    commitments: [],
    focusSessions: [],
    evidence: [],
    outcomes: [],
    assessments: new Map(),
    ...over,
  };
}

describe('aggregateWorkWeek — an empty week', () => {
  const summary = aggregateWorkWeek(makeWeek());

  it('counts zeros', () => {
    expect(summary.focusSessions).toEqual({
      planned: 0,
      started: 0,
      done: 0,
      partial: 0,
      abandoned: 0,
      plannedMinutes: 0,
      actualMinutes: 0,
    });
    expect(summary.starts.commitmentsDue).toBe(0);
  });

  it('reports null rates, not zero — nothing planned is not nothing done', () => {
    expect(summary.starts.startRate).toBeNull();
    expect(summary.starts.completionRate).toBeNull();

    for (const window of ['morning', 'afternoon', 'evening'] as const) {
      expect(summary.timeWindows[window].successRate).toBeNull();
    }
  });

  it('names no best or worst window', () => {
    expect(summary.bestWindow).toBeNull();
    expect(summary.worstWindow).toBeNull();
  });

  it('echoes the week it was asked about', () => {
    expect(summary.weekStart).toBe(WEEK);
    expect(summary.weekEnd).toBe('2026-09-13');
    expect(summary.timezone).toBe('UTC');
  });
});

describe('aggregateWorkWeek — focus sessions', () => {
  it('counts planned, started and each outcome, and sums both kinds of minutes', () => {
    const commitments = Array.from({ length: 5 }, (_, i) =>
      commitment({
        id: `c${i}`,
        scheduledStart: dayOfWeek(i + 1, '09:00'),
        fullMinutes: 30,
      }),
    );

    const summary = aggregateWorkWeek(
      makeWeek({
        commitments,
        focusSessions: [
          session({ id: 's0', commitmentId: 'c0', outcome: 'DONE', actualMinutes: 30 }),
          session({ id: 's1', commitmentId: 'c1', outcome: 'DONE', actualMinutes: 28 }),
          session({ id: 's2', commitmentId: 'c2', outcome: 'PARTIAL', actualMinutes: 12 }),
          session({ id: 's3', commitmentId: 'c3', outcome: 'ABANDONED', actualMinutes: 4 }),
        ],
      }),
    );

    expect(summary.focusSessions).toEqual({
      planned: 5,
      started: 4,
      done: 2,
      partial: 1,
      abandoned: 1,
      plannedMinutes: 150,
      actualMinutes: 74,
    });
  });

  it('lets the latest session decide how a commitment ended', () => {
    const summary = aggregateWorkWeek(
      makeWeek({
        commitments: [commitment()],
        focusSessions: [
          session({
            id: 's1',
            outcome: 'ABANDONED',
            startedAt: new Date('2026-09-08T09:00:00.000Z'),
            actualMinutes: 4,
          }),
          session({
            id: 's2',
            outcome: 'DONE',
            startedAt: new Date('2026-09-08T16:00:00.000Z'),
            actualMinutes: 25,
          }),
        ],
      }),
    );

    expect(summary.focusSessions.done).toBe(1);
    expect(summary.focusSessions.abandoned).toBe(0);
    // Both sessions still count towards the minutes actually focused.
    expect(summary.focusSessions.actualMinutes).toBe(29);
  });

  it('counts only FOCUS_SESSION commitments as planned sessions', () => {
    const summary = aggregateWorkWeek(
      makeWeek({
        commitments: [
          commitment({ id: 'c1' }),
          commitment({ id: 'c2', commitmentType: null }),
        ],
      }),
    );

    expect(summary.focusSessions.planned).toBe(1);
    expect(summary.starts.commitmentsDue).toBe(2);
  });
});

describe('aggregateWorkWeek — starting is not completing (PRD §104)', () => {
  it('counts a started-but-unfinished commitment as started', () => {
    const summary = aggregateWorkWeek(
      makeWeek({
        commitments: [commitment({ status: 'STARTED', startedAt: new Date('2026-09-08T09:05:00.000Z') })],
      }),
    );

    expect(summary.starts.started).toBe(1);
    expect(summary.starts.completed).toBe(0);
    expect(summary.starts.startRate).toBe(1);
    expect(summary.starts.completionRate).toBe(0);
  });

  it('counts a start from the APP_FLOW evidence when the column is empty', () => {
    const summary = aggregateWorkWeek(
      makeWeek({
        commitments: [commitment()],
        evidence: [{ commitmentId: 'c1', evidenceType: 'started', source: 'APP_FLOW' }],
      }),
    );

    expect(summary.starts.started).toBe(1);
  });

  it('does not count a paused or completed evidence row as a start', () => {
    const summary = aggregateWorkWeek(
      makeWeek({
        commitments: [commitment()],
        evidence: [{ commitmentId: 'c1', evidenceType: 'paused', source: 'APP_FLOW' }],
      }),
    );

    expect(summary.starts.started).toBe(0);
  });
});

describe('aggregateWorkWeek — time windows', () => {
  const morningsAndEvenings = () => {
    const commitments: CommitmentRow[] = [];

    // 5 mornings, 4 completed.
    for (let i = 0; i < 5; i += 1) {
      commitments.push(
        commitment({
          id: `m${i}`,
          scheduledStart: dayOfWeek(i + 1, '08:00'),
          status: i < 4 ? 'COMPLETED' : 'MISSED',
        }),
      );
    }

    // 4 evenings, 1 completed.
    for (let i = 0; i < 4; i += 1) {
      commitments.push(
        commitment({
          id: `e${i}`,
          scheduledStart: dayOfWeek(i + 1, '19:00'),
          status: i < 1 ? 'COMPLETED' : 'MISSED',
        }),
      );
    }

    return commitments;
  };

  it('buckets by the same boundaries the ladder uses, and names best and worst', () => {
    const summary = aggregateWorkWeek(makeWeek({ commitments: morningsAndEvenings() }));

    expect(summary.timeWindows.morning).toMatchObject({ planned: 5, completed: 4 });
    expect(summary.timeWindows.morning.successRate).toBeCloseTo(0.8);
    expect(summary.timeWindows.evening).toMatchObject({ planned: 4, completed: 1 });
    expect(summary.timeWindows.evening.successRate).toBeCloseTo(0.25);
    expect(summary.bestWindow).toBe('morning');
    expect(summary.worstWindow).toBe('evening');
  });

  it(`never lets a window with fewer than ${MIN_PLANNED_FOR_WINDOW_VERDICT} planned win`, () => {
    const summary = aggregateWorkWeek(
      makeWeek({
        commitments: [
          // One perfect afternoon, and a mediocre morning with real volume.
          commitment({
            id: 'a1',
            scheduledStart: new Date('2026-09-08T14:00:00.000Z'),
            status: 'COMPLETED',
          }),
          commitment({
            id: 'm1',
            scheduledStart: new Date('2026-09-08T08:00:00.000Z'),
            status: 'COMPLETED',
          }),
          commitment({
            id: 'm2',
            scheduledStart: new Date('2026-09-09T08:00:00.000Z'),
            status: 'MISSED',
          }),
        ],
      }),
    );

    expect(summary.bestWindow).toBe('morning');
  });

  it('breaks a tie towards the earlier part of the day', () => {
    const summary = aggregateWorkWeek(
      makeWeek({
        commitments: [
          commitment({ id: 'm1', scheduledStart: new Date('2026-09-08T08:00:00.000Z'), status: 'COMPLETED' }),
          commitment({ id: 'm2', scheduledStart: new Date('2026-09-09T08:00:00.000Z'), status: 'COMPLETED' }),
          commitment({ id: 'e1', scheduledStart: new Date('2026-09-08T19:00:00.000Z'), status: 'COMPLETED' }),
          commitment({ id: 'e2', scheduledStart: new Date('2026-09-09T19:00:00.000Z'), status: 'COMPLETED' }),
        ],
      }),
    );

    expect(summary.bestWindow).toBe('morning');
    expect(summary.worstWindow).toBe('morning');
  });
});

describe('aggregateWorkWeek — the timezone', () => {
  // 23:30 UTC on Sunday the 6th.
  const sundayNight = new Date('2026-09-06T23:30:00.000Z');

  it('counts a Sunday 23:30 UTC start as Monday morning in Tokyo', () => {
    const summary = aggregateWorkWeek(
      makeWeek({
        timezone: 'Asia/Tokyo',
        commitments: [commitment({ scheduledStart: sundayNight, status: 'COMPLETED' })],
      }),
    );

    expect(summary.starts.commitmentsDue).toBe(1);
    expect(summary.timeWindows.morning.planned).toBe(1);
  });

  it('counts the same instant as the previous Sunday evening in Costa Rica', () => {
    const summary = aggregateWorkWeek(
      makeWeek({
        timezone: 'America/Costa_Rica',
        commitments: [commitment({ scheduledStart: sundayNight, status: 'COMPLETED' })],
      }),
    );

    // Before this week's Monday 00:00 local, so it belongs to the week before.
    expect(summary.starts.commitmentsDue).toBe(0);
  });
});

describe('aggregateWorkWeek — the week boundary', () => {
  it('includes the first instant of Monday and excludes the first of the next', () => {
    const summary = aggregateWorkWeek(
      makeWeek({
        commitments: [
          commitment({ id: 'in', scheduledStart: new Date('2026-09-07T00:00:00.000Z') }),
          commitment({ id: 'out', scheduledStart: new Date('2026-09-14T00:00:00.000Z') }),
        ],
      }),
    );

    expect(summary.starts.commitmentsDue).toBe(1);
  });
});

describe('aggregateWorkWeek — repeatedly postponed', () => {
  it('keeps a commitment rescheduled out of the week, with its ladder level', () => {
    const summary = aggregateWorkWeek(
      makeWeek({
        commitments: [
          commitment({
            id: 'moved',
            status: 'RESCHEDULED',
            rescheduleCount: 2,
            scheduledStart: new Date('2026-09-20T09:00:00.000Z'),
          }),
        ],
        assessments: new Map([
          [
            'moved',
            {
              level: 3,
              interventionType: 'FRICTION_DIAGNOSIS' as const,
              signals: [],
              rationale: '',
              suggestedAction: 'FRICTION_QUESTION' as const,
            },
          ],
        ]),
      }),
    );

    expect(summary.repeatedlyPostponed).toEqual([
      {
        commitmentId: 'moved',
        title: 'Storyline',
        outcomeId: 'outcome-1',
        rescheduleCount: 2,
        level: 3,
      },
    ]);
  });

  it('ignores a commitment moved only once', () => {
    const summary = aggregateWorkWeek(
      makeWeek({ commitments: [commitment({ rescheduleCount: 1 })] }),
    );

    expect(summary.repeatedlyPostponed).toEqual([]);
  });

  it('sorts most-moved first and reports level 0 with no assessment', () => {
    const summary = aggregateWorkWeek(
      makeWeek({
        commitments: [
          commitment({ id: 'a', rescheduleCount: 2 }),
          commitment({ id: 'b', rescheduleCount: 5 }),
        ],
      }),
    );

    expect(summary.repeatedlyPostponed.map((row) => row.commitmentId)).toEqual(['b', 'a']);
    expect(summary.repeatedlyPostponed[0].level).toBe(0);
  });
});

describe('aggregateWorkWeek — outcomes and distractions', () => {
  it('lists WORK outcomes completed inside the week', () => {
    const summary = aggregateWorkWeek(
      makeWeek({
        outcomes: [
          {
            id: 'o1',
            title: 'Win the budget',
            domain: 'WORK',
            state: 'COMPLETED',
            updatedAt: new Date('2026-09-09T10:00:00.000Z'),
          },
          {
            id: 'o2',
            title: 'Last month',
            domain: 'WORK',
            state: 'COMPLETED',
            updatedAt: new Date('2026-08-09T10:00:00.000Z'),
          },
          {
            id: 'o3',
            title: 'Still going',
            domain: 'WORK',
            state: 'ACTIVE',
            updatedAt: new Date('2026-09-09T10:00:00.000Z'),
          },
        ],
      }),
    );

    expect(summary.outcomesCompleted.map((o) => o.outcomeId)).toEqual(['o1']);
  });

  it('sums the distraction notes of sessions started in the week', () => {
    const summary = aggregateWorkWeek(
      makeWeek({
        commitments: [commitment()],
        focusSessions: [
          session({ distractionNotes: ['Checked Slack', 'Phone'] }),
          session({
            id: 's2',
            startedAt: new Date('2026-08-01T09:00:00.000Z'),
            distractionNotes: ['Last month'],
          }),
        ],
      }),
    );

    expect(summary.distractionNoteCount).toBe(2);
  });
});

describe('aggregateWorkWeek — determinism', () => {
  it('is pure: the same input twice is deep-equal', () => {
    const input = makeWeek({
      commitments: [commitment(), commitment({ id: 'c2', rescheduleCount: 3 })],
      focusSessions: [session()],
    });

    expect(aggregateWorkWeek(input)).toEqual(aggregateWorkWeek(input));
  });

  it('ignores commitments from another domain entirely', () => {
    const summary = aggregateWorkWeek(
      makeWeek({ commitments: [commitment({ domain: 'FAMILY' })] }),
    );

    expect(summary.starts.commitmentsDue).toBe(0);
  });
});
