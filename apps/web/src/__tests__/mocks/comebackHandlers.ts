import { http, HttpResponse } from 'msw';

import type {
  ComebackCompletion,
  ComebackStatus,
  CommitmentCard,
  Domain,
} from '../../types';

// =============================================================================
// A stateful in-memory comeback API (issue #119, epic E11)
// =============================================================================
//
// STATEFUL because every assertion in this flow is about a SEQUENCE: choosing a
// different domain has to change the restart, starting has to move the state,
// and the SECOND complete has to be a 409 — which is the whole of "idempotent
// by refusal" and cannot be tested against a canned response.
//
// `resetComebackState()` runs from the global `afterEach`.
// =============================================================================

const API_BASE = '*/api';

function card(over: Partial<CommitmentCard> = {}): CommitmentCard {
  return {
    id: 'restart-1',
    title: '12-minute bodyweight circuit',
    domain: 'HEALTH',
    status: 'PLANNED',
    scheduledStart: '2026-03-06T13:00:00.000Z',
    scheduledEnd: null,
    durationMinutes: 12,
    versions: {
      full: { title: '12-minute bodyweight circuit', minutes: 12 },
      short: null,
      minimum: { title: '12-minute bodyweight circuit', minutes: 5 },
    },
    importance: 3,
    rescheduleCount: 0,
    startedAt: null,
    completedAt: null,
    versionUsed: null,
    minutesSpent: null,
    outcomeId: null,
    ritualId: null,
    familyMemberId: null,
    workoutTemplateId: null,
    workoutSessionId: null,
    timer: null,
    availableActions: ['start', 'complete', 'partial', 'skip', 'reschedule'],
    allowedTransitions: [],
    ...over,
  } as CommitmentCard;
}

function offered(): ComebackStatus {
  return {
    state: 'OFFERED',
    trigger: 'INACTIVITY',
    offeredAt: '2026-03-06T04:00:00.000Z',
    idleDays: 4,
    closedCount: 3,
    planReviewSuggested: false,
    restart: card(),
    recommendation: {
      domain: 'HEALTH',
      reason: 'You were keeping health going before the pause, so it is the easiest to rebuild.',
    },
    alternatives: [{ domain: 'WORK', title: 'Morning focus block', minutes: 10 }],
    wording: { note: 'No catching up. We start from today.' },
  };
}

function completion(): ComebackCompletion {
  return {
    celebration: {
      title: 'Back on Path.',
      body: 'The important part was not that you missed. It was that you returned.',
    },
    evidenceId: 'ev-1',
    milestone: {
      id: 'm-1',
      kind: 'FIRST_COMEBACK',
      sequence: 1,
      domain: null,
      achievedAt: '2026-03-06T14:00:00.000Z',
      acknowledgedAt: null,
      title: 'First comeback',
      body: 'You returned.',
      meta: {},
    },
    nextCommitment: card({ id: 'next-1', title: 'Morning focus block', domain: 'WORK' }),
    planReviewSuggested: false,
  };
}

interface ComebackState {
  status: ComebackStatus;
  completions: number;
  acknowledged: string[];
}

let state: ComebackState = {
  status: offered(),
  completions: 0,
  acknowledged: [],
};

export function resetComebackState(): void {
  state = { status: offered(), completions: 0, acknowledged: [] };
}

export function setComebackStatus(patch: Partial<ComebackStatus>): void {
  state.status = { ...state.status, ...patch };
}

export function comebackCompletions(): number {
  return state.completions;
}

export function acknowledgedMilestones(): string[] {
  return state.acknowledged;
}

const NO_OFFER = () =>
  HttpResponse.json(
    { message: 'There is no comeback offer open', details: { reason: 'NO_COMEBACK_OFFER' } },
    { status: 409 },
  );

export const comebackHandlers = [
  http.get(`${API_BASE}/comeback`, () => HttpResponse.json({ data: state.status })),

  http.post(`${API_BASE}/comeback/choose`, async ({ request }) => {
    if (state.status.state === 'NONE') return NO_OFFER();

    const { domain } = (await request.json()) as { domain: Domain };
    const alternative = state.status.alternatives.find((alt) => alt.domain === domain);
    if (!alternative) {
      return HttpResponse.json(
        { details: { reason: 'NO_RESTART_IN_DOMAIN' } },
        { status: 400 },
      );
    }

    // The API cancels the old restart and creates a new one; what a client can
    // observe is that the card and the alternatives both change.
    state.status = {
      ...state.status,
      state: 'IN_PROGRESS',
      restart: card({
        id: 'restart-2',
        title: alternative.title,
        domain,
        durationMinutes: alternative.minutes,
      }),
      recommendation: { domain, reason: 'You chose this one.' },
      alternatives: [{ domain: 'HEALTH', title: '12-minute bodyweight circuit', minutes: 12 }],
    };

    return HttpResponse.json({ data: state.status });
  }),

  http.post(`${API_BASE}/comeback/start`, () => {
    if (state.status.state === 'NONE') return NO_OFFER();

    state.status = { ...state.status, state: 'IN_PROGRESS' };
    return HttpResponse.json({ data: state.status });
  }),

  http.post(`${API_BASE}/comeback/complete`, () => {
    // Idempotent BY REFUSAL, exactly as the API is: the second call is a 409,
    // never a second recovery row.
    if (state.status.state === 'NONE') return NO_OFFER();

    state.completions += 1;
    state.status = { ...offered(), state: 'NONE', trigger: null, restart: null };
    return HttpResponse.json({ data: completion() });
  }),

  http.post(`${API_BASE}/comeback/dismiss`, () => {
    if (state.status.state === 'NONE') return NO_OFFER();

    state.status = { ...offered(), state: 'NONE', trigger: null, restart: null };
    return new HttpResponse(null, { status: 204 });
  }),
];
