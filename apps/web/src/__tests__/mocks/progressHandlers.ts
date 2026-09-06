import { http, HttpResponse } from 'msw';

import type {
  Domain,
  Milestone,
  ProgressResponse,
  TimelineEvent,
} from '../../types';

// =============================================================================
// A stateful in-memory Progress API (issue #117, epic E11)
// =============================================================================
//
// STATEFUL for one reason that matters: acknowledging a milestone has to remove
// it from the unacknowledged list, or "the toast appears once" is not a test of
// anything. The timeline is paginated for the same reason — a canned single
// page would let "Load more appends page 2" pass without either happening.
//
// `resetProgressState()` runs from the global `afterEach`.
// =============================================================================

const API_BASE = '*/api';

const MOMENTUM: ProgressResponse['momentum'] = {
  WORK: {
    domain: 'WORK',
    state: 'SLIPPING',
    evidence: ['3 of 6 planned work actions completed', '3 in a row not started'],
    signals: {
      planned: 6,
      completed: 3,
      partial: 0,
      fallback: 0,
      missed: 3,
      skipped: 0,
      consecutiveMisses: 3,
      rescheduledTwice: 0,
      lastCompletionAt: '2026-02-24T09:00:00.000Z',
      lastMissAt: '2026-03-02T09:00:00.000Z',
      returnedAfterIdleDays: null,
    },
    trend: [
      { weekStart: '2026-02-09', planned: 2, completed: 2 },
      { weekStart: '2026-02-16', planned: 2, completed: 1 },
      { weekStart: '2026-02-23', planned: 1, completed: 0 },
      { weekStart: '2026-03-02', planned: 1, completed: 0 },
    ],
  },
  FAMILY: {
    domain: 'FAMILY',
    state: 'INSUFFICIENT_DATA',
    evidence: ['Not enough planned family commitments yet — momentum appears after 3'],
    signals: {
      planned: 1,
      completed: 1,
      partial: 0,
      fallback: 0,
      missed: 0,
      skipped: 0,
      consecutiveMisses: 0,
      rescheduledTwice: 0,
      lastCompletionAt: null,
      lastMissAt: null,
      returnedAfterIdleDays: null,
    },
    trend: [
      { weekStart: '2026-02-09', planned: 0, completed: 0 },
      { weekStart: '2026-02-16', planned: 1, completed: 1 },
      { weekStart: '2026-02-23', planned: 0, completed: 0 },
      { weekStart: '2026-03-02', planned: 0, completed: 0 },
    ],
  },
  HEALTH: {
    domain: 'HEALTH',
    state: 'STEADY',
    evidence: [
      '5 of 6 planned workouts completed',
      '1 completed with the short or minimum version',
    ],
    signals: {
      planned: 6,
      completed: 5,
      partial: 0,
      fallback: 1,
      missed: 1,
      skipped: 0,
      consecutiveMisses: 0,
      rescheduledTwice: 0,
      lastCompletionAt: '2026-03-04T07:00:00.000Z',
      lastMissAt: '2026-02-16T07:00:00.000Z',
      returnedAfterIdleDays: null,
    },
    trend: [
      { weekStart: '2026-02-09', planned: 2, completed: 2 },
      { weekStart: '2026-02-16', planned: 2, completed: 1 },
      { weekStart: '2026-02-23', planned: 1, completed: 1 },
      { weekStart: '2026-03-02', planned: 1, completed: 1 },
    ],
  },
};

function defaultProgress(): ProgressResponse {
  return {
    generatedAt: '2026-03-06T12:00:00.000Z',
    windowDays: 28,
    momentum: MOMENTUM,
    consistencyRun: {
      weeks: 3,
      graceUsed: 1,
      weekly: [
        {
          weekStart: '2026-02-09',
          planned: 4,
          completed: 4,
          success: true,
          graced: false,
          current: false,
        },
        {
          weekStart: '2026-02-16',
          planned: 4,
          completed: 1,
          success: false,
          graced: true,
          current: false,
        },
        {
          weekStart: '2026-02-23',
          planned: 3,
          completed: 3,
          success: true,
          graced: false,
          current: false,
        },
        {
          weekStart: '2026-03-02',
          planned: 2,
          completed: 1,
          success: false,
          graced: false,
          current: true,
        },
      ],
    },
    recovery: { medianDays: 1.5, samples: 4 },
    independence: { ratio: null, completedWithoutReminder: 0, sampleSize: 0 },
    milestones: [],
    insights: [],
  };
}

function timelineEvent(over: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id: 'ev-1',
    at: '2026-03-05T07:00:00.000Z',
    kind: 'completed',
    significance: 'ordinary',
    domain: 'HEALTH',
    title: 'Completed Upper A',
    detail: null,
    commitmentId: 'c-1',
    milestoneId: null,
    ...over,
  };
}

function defaultTimeline(): TimelineEvent[][] {
  return [
    [
      timelineEvent({
        id: 'ev-1',
        kind: 'milestone',
        significance: 'milestone',
        title: 'First comeback',
        detail: 'You returned.',
        milestoneId: 'm-1',
        commitmentId: null,
        domain: null,
      }),
      timelineEvent({
        id: 'ev-2',
        at: '2026-03-04T19:00:00.000Z',
        kind: 'family_kept',
        significance: 'notable',
        domain: 'FAMILY',
        title: 'Protected family dinner',
      }),
      timelineEvent({ id: 'ev-3', at: '2026-03-04T07:00:00.000Z' }),
    ],
    [
      timelineEvent({
        id: 'ev-4',
        at: '2026-03-01T07:00:00.000Z',
        kind: 'completed_fallback',
        title: 'Completed Upper A — minimum version',
      }),
    ],
  ];
}

function defaultMilestones(): Milestone[] {
  return [
    {
      id: 'm-1',
      kind: 'FIRST_COMEBACK',
      sequence: 1,
      domain: null,
      achievedAt: '2026-03-05T18:00:00.000Z',
      acknowledgedAt: null,
      title: 'First comeback',
      body: 'You returned.',
      meta: {},
    },
  ];
}

interface ProgressState {
  progress: ProgressResponse;
  timelinePages: TimelineEvent[][];
  milestones: Milestone[];
  /** Every `domain` the timeline was asked for, in order — asserted by a spec. */
  timelineDomains: Array<Domain | null>;
}

let state: ProgressState = {
  progress: defaultProgress(),
  timelinePages: defaultTimeline(),
  milestones: defaultMilestones(),
  timelineDomains: [],
};

export function resetProgressState(): void {
  state = {
    progress: defaultProgress(),
    timelinePages: defaultTimeline(),
    milestones: defaultMilestones(),
    timelineDomains: [],
  };
}

/** Narrow overrides for a spec that needs one section in a particular shape. */
export function setProgress(patch: Partial<ProgressResponse>): void {
  state.progress = { ...state.progress, ...patch };
}

export function setMilestones(milestones: Milestone[]): void {
  state.milestones = milestones;
}

export function progressTimelineDomains(): Array<Domain | null> {
  return state.timelineDomains;
}

export const progressHandlers = [
  http.get(`${API_BASE}/progress`, () =>
    HttpResponse.json({ data: { ...state.progress, milestones: state.milestones } }),
  ),

  http.get(`${API_BASE}/progress/timeline`, ({ request }) => {
    const url = new URL(request.url);
    state.timelineDomains.push((url.searchParams.get('domain') as Domain) ?? null);

    // The cursor is opaque to the client, so the mock may use the page index —
    // what is being tested is that the client passes it back unchanged.
    const index = Number(url.searchParams.get('cursor') ?? '0');
    const items = state.timelinePages[index] ?? [];
    const hasMore = index + 1 < state.timelinePages.length;

    return HttpResponse.json({
      data: { items, nextCursor: hasMore ? String(index + 1) : null },
    });
  }),

  http.get(`${API_BASE}/progress/milestones`, ({ request }) => {
    const url = new URL(request.url);
    const unacknowledged = url.searchParams.get('unacknowledged') === 'true';

    return HttpResponse.json({
      data: {
        items: unacknowledged
          ? state.milestones.filter((row) => row.acknowledgedAt === null)
          : state.milestones,
      },
    });
  }),

  http.post(`${API_BASE}/progress/milestones/:id/ack`, ({ params }) => {
    const row = state.milestones.find((item) => item.id === params.id);
    if (!row) return new HttpResponse(null, { status: 404 });

    // The state change is the whole point: "celebrated once" is only a test if
    // acknowledging actually removes it from the unacknowledged list.
    row.acknowledgedAt = new Date().toISOString();
    return HttpResponse.json({ data: row });
  }),
];
