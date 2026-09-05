import { http, HttpResponse } from 'msw';

import { seedProposal } from './coachHandlers';
import type {
  Domain,
  DomainCounts,
  ExtraCommitment,
  LoadWarning,
  ProposedCommitment,
  WeekAggregates,
  WeeklyPlanDetail,
  WeeklyReviewDetail,
  WeeklySettings,
} from '../../types';

// =============================================================================
// A stateful in-memory weekly API (issue #84, epic E10)
// =============================================================================
//
// Enforces the rules the real API enforces, for the reason `pathHandlers`
// gives: a mock that accepted everything would let page tests pass against
// behaviour the server rejects, which reads as coverage and is worse than no
// test. The four that matter to these screens:
//
//   * `PATCH` CLEARS THE PROPOSAL. The wizard's commitments step re-proposes on
//     entry because of this; a mock that kept the stale proposal would let a
//     page that never called `/propose` pass.
//   * `/propose` RECOMPUTES the warnings from the extras it is given, so the
//     "9th recurring item" assertion exercises a real threshold rather than a
//     canned response.
//   * `/approve` REFUSES with 422 while warnings are unacknowledged.
//   * `GET /weekly/reviews/current` answers `null`, never 404.
//
// `resetWeeklyState()` runs from the global `afterEach`.
// =============================================================================

const API_BASE = '*/api';

/** Matches the API's default. The tests read it rather than hard-coding 9. */
export const SOFT_CAP = 8;

interface WeeklyState {
  review: WeeklyReviewDetail | null;
  plan: WeeklyPlanDetail | null;
  settings: WeeklySettings;
  /** Set by a test to make the next generation return a template summary. */
  nextGenerateIsTemplate: boolean;
  /** Recorded so a spec can assert what the page actually sent. */
  patches: Array<Record<string, unknown>>;
  proposeCalls: Array<{ extras: ExtraCommitment[] }>;
  approveCalls: Array<{ acknowledgeWarnings: boolean }>;
}

const initialSettings = (): WeeklySettings => ({
  weeklyReviewWeekday: 0,
  weeklyReviewTime: '17:00',
  timezone: 'America/Costa_Rica',
  nextReviewAt: '2026-09-13T23:00:00.000Z',
});

const initial = (): WeeklyState => ({
  review: null,
  plan: null,
  settings: initialSettings(),
  nextGenerateIsTemplate: false,
  patches: [],
  proposeCalls: [],
  approveCalls: [],
});

let state: WeeklyState = initial();

export function resetWeeklyState(): void {
  state = initial();
}

export function weeklyState(): Readonly<WeeklyState> {
  return state;
}

export function setNextGenerateTemplate(value = true): void {
  state.nextGenerateIsTemplate = value;
}

function counts(over: Partial<DomainCounts> = {}): DomainCounts {
  return {
    planned: 0,
    completed: 0,
    partial: 0,
    missed: 0,
    unresolved: 0,
    skipped: 0,
    rescheduled: 0,
    started: 0,
    fallbackUsed: 0,
    minutesPlanned: 0,
    minutesSpent: 0,
    completionRate: 0,
    ...over,
  };
}

export function makeAggregates(over: Partial<WeekAggregates> = {}): WeekAggregates {
  return {
    weekStart: '2026-08-31',
    timezone: 'America/Costa_Rica',
    coverage: {
      from: '2026-08-31T06:00:00.000Z',
      to: '2026-09-07T06:00:00.000Z',
      partial: false,
    },
    domains: {
      WORK: counts({ planned: 5, completed: 4, skipped: 1, completionRate: 0.8 }),
      FAMILY: counts({ planned: 3, completed: 2, skipped: 1 }),
      HEALTH: counts({ planned: 3, completed: 2, fallbackUsed: 1, rescheduled: 1 }),
    },
    totals: counts({ planned: 11, completed: 8 }),
    timeWindows: [{ window: 'morning', planned: 5, completed: 4, successRate: 0.8 }],
    weekdays: Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      planned: 0,
      completed: 0,
    })),
    rescheduleLeaders: [
      {
        commitmentId: 'commitment-1',
        title: 'Strength workout',
        domain: 'HEALTH',
        rescheduleCount: 2,
      },
    ],
    focusStarts: { planned: 5, started: 4, completed: 4 },
    workouts: { planned: 3, completed: 2, fallbackUsed: 1, sessionsLogged: 0 },
    frictionTags: [{ tag: 'BAD_TIMING', count: 2 }],
    ...over,
  };
}

export function makeReview(over: Partial<WeeklyReviewDetail> = {}): WeeklyReviewDetail {
  const aggregates = over.aggregates ?? makeAggregates();

  return {
    id: 'review-1',
    weekStart: aggregates.weekStart,
    status: 'READY',
    counts: {
      WORK: { planned: 5, completed: 4 },
      FAMILY: { planned: 3, completed: 2 },
      HEALTH: { planned: 3, completed: 2 },
    },
    generatedAt: '2026-09-06T22:00:00.000Z',
    approvedAt: null,
    createdAt: '2026-09-06T22:00:00.000Z',
    aggregates,
    aiSummary: {
      whatWorked: ['Morning focus blocks: 4 of 5 done'],
      whatDidNot: ['Evening workouts were moved twice'],
      patterns: [
        {
          observation: '4 of 5 morning commitments were done; 1 of 3 in the evening',
          inference: 'Plans after 18:00 are less reliable than mornings',
          recommendation: 'Move the Wednesday workout to Saturday morning',
          confidence: 0.8,
          domain: 'HEALTH',
        },
      ],
      proposedChanges: [],
      keepUnchanged: ['Morning focus block routine'],
      doNotAddYet: [],
      source: 'ai',
      promptVersion: 'weekly_reviewer.v1',
      generatedAt: '2026-09-06T22:00:00.000Z',
    },
    proposals: [],
    plan: null,
    ...over,
  };
}

export function makeProposal(over: Record<string, unknown> = {}) {
  return {
    id: 'proposal-1',
    planId: 'plan-health',
    sourceKind: 'WEEKLY_REVIEW',
    status: 'PROPOSED' as const,
    summary: 'Move Wednesday workout to Saturday morning',
    changeCount: 1,
    edited: false,
    expiresAt: '2026-09-13T22:00:00.000Z',
    decidedAt: null,
    decisionReason: null,
    appliedPlanVersionId: null,
    createdAt: '2026-09-06T22:00:00.000Z',
    plan: { id: 'plan-health', outcomeTitle: 'Get strong again', domain: 'HEALTH' as Domain },
    changes: [
      {
        op: 'move' as const,
        target: { type: 'routine' as const, id: 'routine-health' },
        before: { preferredTime: '18:30' },
        after: { preferredTime: '09:00' },
        reason: 'Evening sessions were moved twice; mornings held.',
      },
    ],
    originalChanges: null,
    preview: {
      diff: [
        {
          op: 'move' as const,
          target: { type: 'routine' as const, id: 'routine-health', title: 'Strength workout' },
          reason: 'Evening sessions were moved twice; mornings held.',
          fields: [{ field: 'preferredTime', before: '18:30', after: '09:00' }],
        },
      ],
      errors: [],
    },
    activeVersion: { id: 'version-1', version: 1 },
    ...over,
  };
}

export function seedReview(review: WeeklyReviewDetail): void {
  state.review = review;
  // The accept/edit/reject routes belong to the coach handlers' store: a
  // review's recommendation is decided through exactly the same endpoints.
  for (const proposal of review.proposals) seedProposal(proposal);
}

export function seedPlan(plan: Partial<WeeklyPlanDetail> = {}): WeeklyPlanDetail {
  state.plan = makePlan(plan);
  return state.plan;
}

export function makePlan(over: Partial<WeeklyPlanDetail> = {}): WeeklyPlanDetail {
  return {
    id: 'plan-1',
    weekStart: '2026-09-07',
    status: 'DRAFT',
    primaryFocus: null,
    reviewId: 'review-1',
    approvedAt: null,
    createdAt: '2026-09-06T22:00:00.000Z',
    constraints: { travelDays: [], fixedEvents: [], notes: null },
    domainModes: { WORK: 'GROW', FAMILY: 'GROW', HEALTH: 'GROW' },
    proposal: null,
    review: { id: 'review-1', weekStart: '2026-08-31', status: 'READY' },
    ...over,
  };
}

/** Two routine occurrences, matching the epic-script week. */
function routineItems(): ProposedCommitment[] {
  return [
    item({ key: 'routine-work:2026-09-07', domain: 'WORK', title: 'Morning focus block' }),
    item({
      key: 'routine-health:2026-09-07',
      domain: 'HEALTH',
      title: 'Strength workout',
      routineId: 'routine-health',
      startTime: '18:30',
      estimatedMinutes: 40,
    }),
  ];
}

function item(over: Partial<ProposedCommitment>): ProposedCommitment {
  return {
    key: 'routine-work:2026-09-07',
    source: 'routine',
    include: true,
    domain: 'WORK',
    title: 'Morning focus block',
    date: '2026-09-07',
    startTime: '07:30',
    estimatedMinutes: 50,
    minimumMinutes: 10,
    routineId: 'routine-work',
    planVersionId: 'version-work',
    outcomeId: 'outcome-work',
    fullVersion: 'Morning focus block',
    shortVersion: null,
    minimumVersion: '10-minute version',
    recurring: true,
    excludedBy: null,
    ...over,
  };
}

/**
 * The real load check, in miniature: distinct routines plus recurring extras,
 * compared against the soft cap. A canned warning would make the "9th recurring
 * item" assertion prove nothing at all.
 */
function buildProposal(plan: WeeklyPlanDetail, extras: ExtraCommitment[]) {
  const routines = routineItems().map((row) =>
    plan.domainModes[row.domain] === 'PAUSE'
      ? { ...row, include: false, excludedBy: 'paused_domain' as const }
      : plan.constraints.travelDays.includes(row.date)
        ? { ...row, include: false, excludedBy: 'travel_day' as const }
        : row,
  );

  const extraItems = extras.map((extra, index) =>
    item({
      key: `extra:${index}`,
      source: 'extra',
      domain: extra.domain,
      title: extra.title,
      date: extra.date,
      startTime: extra.startTime,
      estimatedMinutes: extra.estimatedMinutes,
      routineId: null,
      planVersionId: null,
      outcomeId: null,
      recurring: extra.recurring,
    }),
  );

  const items = [...routines, ...extraItems];
  const included = items.filter((row) => row.include);
  const recurringCount =
    new Set(
      included.filter((row) => row.routineId).map((row) => row.routineId as string),
    ).size + included.filter((row) => !row.routineId && row.recurring).length;

  const warnings: LoadWarning[] =
    recurringCount > SOFT_CAP
      ? [
          {
            code: 'RECURRING_OVER_CAP',
            message: `You already have ${recurringCount} recurring commitments this week. I recommend replacing something rather than adding another habit.`,
            suggestion: 'Untick one recurring commitment or move it to a later week.',
            detail: { recurringCount, softCap: SOFT_CAP },
          },
        ]
      : [];

  return {
    items,
    extras,
    summary: {
      recurringCount,
      estimatedMinutes: included.reduce((total, row) => total + row.estimatedMinutes, 0),
      byDomain: {
        WORK: { count: 0, minutes: 0 },
        FAMILY: { count: 0, minutes: 0 },
        HEALTH: { count: 0, minutes: 0 },
      },
      softCap: SOFT_CAP,
      capacityMinutes: null,
    },
    warnings,
    proposedAt: '2026-09-06T22:10:00.000Z',
  };
}

export const weeklyHandlers = [
  http.get(`${API_BASE}/weekly/reviews/current`, () =>
    // Null, never 404: an empty screen is a state, not an error.
    HttpResponse.json({ data: state.review }),
  ),

  http.get(`${API_BASE}/weekly/reviews`, ({ request }) => {
    const weekStart = new URL(request.url).searchParams.get('weekStart');
    const match =
      state.review && (!weekStart || state.review.weekStart === weekStart)
        ? [state.review]
        : [];

    return HttpResponse.json({ data: { items: match } });
  }),

  http.post(`${API_BASE}/weekly/reviews/generate`, () => {
    const review = makeReview();

    state.review = state.nextGenerateIsTemplate
      ? {
          ...review,
          proposals: [],
          aiSummary: {
            ...review.aiSummary!,
            // The template never guesses and never proposes.
            patterns: [
              {
                observation: '4 of 5 morning commitments were done; 1 of 3 in the evening.',
                inference: null,
                recommendation: null,
                confidence: 0.5,
                domain: null,
              },
            ],
            source: 'template',
            promptVersion: null,
          },
        }
      : review;

    return HttpResponse.json({ data: state.review });
  }),

  http.get(`${API_BASE}/weekly/reviews/:id`, ({ params }) =>
    state.review && state.review.id === params.id
      ? HttpResponse.json({ data: state.review })
      : HttpResponse.json({ message: 'Not found' }, { status: 404 }),
  ),

  http.post(`${API_BASE}/weekly/reviews/:id/skip`, () => {
    if (!state.review) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    state.review = { ...state.review, status: 'SKIPPED' };

    return HttpResponse.json({ data: state.review });
  }),

  http.get(`${API_BASE}/weekly/settings`, () => HttpResponse.json({ data: state.settings })),

  http.put(`${API_BASE}/weekly/settings`, async ({ request }) => {
    const body = (await request.json()) as {
      weeklyReviewWeekday: number;
      weeklyReviewTime: string;
    };

    state.settings = { ...state.settings, ...body };

    return HttpResponse.json({ data: state.settings });
  }),

  http.post(`${API_BASE}/weekly/plans`, () => {
    // Idempotent, like the real one: a second call returns the same DRAFT.
    state.plan ??= makePlan();

    return HttpResponse.json({ data: state.plan }, { status: 201 });
  }),

  http.get(`${API_BASE}/weekly/plans/:id`, () =>
    state.plan
      ? HttpResponse.json({ data: state.plan })
      : HttpResponse.json({ message: 'Not found' }, { status: 404 }),
  ),

  http.patch(`${API_BASE}/weekly/plans/:id`, async ({ request }) => {
    if (!state.plan) return HttpResponse.json({ message: 'Not found' }, { status: 404 });

    const patch = (await request.json()) as Record<string, unknown>;
    state.patches.push(patch);

    state.plan = {
      ...state.plan,
      ...(patch.constraints ? { constraints: patch.constraints as never } : {}),
      ...(patch.primaryFocus !== undefined
        ? { primaryFocus: patch.primaryFocus as string | null }
        : {}),
      ...(patch.domainModes
        ? { domainModes: { ...state.plan.domainModes, ...(patch.domainModes as object) } }
        : {}),
      // A change invalidates the previous proposal, exactly as the API does.
      proposal: null,
    };

    return HttpResponse.json({ data: state.plan });
  }),

  http.post(`${API_BASE}/weekly/plans/:id/propose`, async ({ request }) => {
    if (!state.plan) return HttpResponse.json({ message: 'Not found' }, { status: 404 });

    const body = (await request.json()) as { extras?: ExtraCommitment[] };
    const extras = body.extras ?? [];
    state.proposeCalls.push({ extras });

    state.plan = { ...state.plan, proposal: buildProposal(state.plan, extras) };

    return HttpResponse.json({ data: state.plan });
  }),

  http.post(`${API_BASE}/weekly/plans/:id/approve`, async ({ request }) => {
    if (!state.plan?.proposal) {
      return HttpResponse.json(
        { message: 'Propose the week first', code: 'WEEKLY_PLAN_NOT_PROPOSED' },
        { status: 409 },
      );
    }

    const body = (await request.json()) as { acknowledgeWarnings?: boolean };
    const acknowledgeWarnings = body.acknowledgeWarnings ?? false;
    state.approveCalls.push({ acknowledgeWarnings });

    if (state.plan.proposal.warnings.length > 0 && !acknowledgeWarnings) {
      return HttpResponse.json(
        {
          message: 'Acknowledge the load warnings',
          code: 'LOAD_WARNINGS_UNACKNOWLEDGED',
          details: { warnings: state.plan.proposal.warnings },
        },
        { status: 422 },
      );
    }

    const included = state.plan.proposal.items.filter((row) => row.include);
    state.plan = { ...state.plan, status: 'APPROVED', approvedAt: new Date().toISOString() };
    if (state.review) state.review = { ...state.review, plan: { id: state.plan.id, status: 'APPROVED' } };

    return HttpResponse.json({
      data: {
        plan: state.plan,
        createdCommitmentIds: included.map((row) => row.key),
        skippedExisting: 0,
        warnings: state.plan.proposal?.warnings ?? [],
      },
    });
  }),
];
