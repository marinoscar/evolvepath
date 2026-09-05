import { http, HttpResponse } from 'msw';

import type {
  CheckInFeel,
  CommitmentActionName,
  CommitmentCard,
  DailyCheckIn,
  DayReflection,
  DecompositionProposal,
  Domain,
  DomainModeKind,
  NextBestAction,
  TodayInsight,
  TodayResponse,
} from '../../types';

// =============================================================================
// A stateful in-memory Today API (issue #46, epic E05)
// =============================================================================
//
// STATEFUL, for the same reason `pathHandlers` is: every assertion on this
// screen is about a SEQUENCE. "Tapping Low energy re-sizes the recommendation"
// is only a real test if the mock actually re-sizes it, and "an action updates
// the row" is only real if the row changes. Canned responses would let a page
// test pass against behaviour the API rejects, which reads as coverage and is
// worse than nothing.
//
// THE RULES THE API ENFORCES ARE ENFORCED HERE:
//
//   * `availableActions` is recomputed from status and timer after every
//     action, so a menu can never show something this mock would refuse.
//   * A terminal commitment offers nothing and answers 409 with
//     `details.reason: 'INVALID_TRANSITION'`, exactly as the API does.
//   * `LOW_ENERGY` sizes the next best action to the minimum version.
//   * A reschedule returns a NEW commitment and closes the original.
//
// `resetTodayState()` runs from the global `afterEach`.
// =============================================================================

const API_BASE = '*/api';

interface TodayState {
  commitments: CommitmentCard[];
  modes: Record<Domain, DomainModeKind>;
  checkIn: DailyCheckIn | null;
  reflection: DayReflection | null;
  insight: TodayInsight | null;
  /** Set to make `/today/insight` fail, to prove the page survives it. */
  insightFails: boolean;
  /** Set to make the coach unavailable, so `decompose` answers a template. */
  coachDown: boolean;
  dateLocal: string;
  /** What the Start screen shows under the title. */
  whyItMatters: string | null;
  sequence: number;
}

const DEFAULT_INSIGHT: TodayInsight = {
  text: 'One good block on the proposal is the whole day.',
  source: 'ai',
  generatedAt: '2026-03-02T09:00:00.000Z',
};

function emptyState(): TodayState {
  return {
    commitments: [],
    modes: { WORK: 'GROW', FAMILY: 'GROW', HEALTH: 'GROW' },
    checkIn: null,
    reflection: null,
    insight: DEFAULT_INSIGHT,
    insightFails: false,
    coachDown: false,
    dateLocal: '2026-03-02',
    whyItMatters: 'Free my evenings',
    sequence: 0,
  };
}

let state: TodayState = emptyState();

export function resetTodayState(): void {
  state = emptyState();
}

export function seedTodayState(patch: Partial<TodayState>): void {
  state = { ...state, ...patch };
}

export function getTodayState(): Readonly<TodayState> {
  return state;
}

function nextId(prefix: string): string {
  state.sequence += 1;
  return `${prefix}-${state.sequence}`;
}

/** A commitment card with sensible defaults; override anything. */
export function makeCard(overrides: Partial<CommitmentCard> = {}): CommitmentCard {
  const card: CommitmentCard = {
    id: nextId('commitment'),
    title: 'Draft the proposal storyline',
    domain: 'WORK',
    status: 'PLANNED',
    scheduledStart: '2026-03-02T09:00:00.000Z',
    scheduledEnd: null,
    durationMinutes: 25,
    versions: {
      full: { title: 'Draft the storyline', minutes: 25 },
      short: { title: 'Write the decision statement', minutes: 10 },
      minimum: { title: 'Open the doc and write one sentence', minutes: 5 },
    },
    importance: 5,
    rescheduleCount: 0,
    startedAt: null,
    completedAt: null,
    versionUsed: null,
    minutesSpent: null,
    outcomeId: null,
    decomposedFromId: null,
    steps: null,
    timer: null,
    availableActions: [],
    ...overrides,
  };

  return { ...card, availableActions: overrides.availableActions ?? actionsFor(card) };
}

/** The API's own derivation, reproduced so the mock cannot drift from it. */
function actionsFor(card: CommitmentCard): CommitmentActionName[] {
  const terminal = [
    'COMPLETED',
    'PARTIALLY_COMPLETED',
    'RESCHEDULED',
    'SKIPPED',
    'MISSED',
    'CANCELLED',
  ];
  if (terminal.includes(card.status)) return [];

  const actions: CommitmentActionName[] = [];

  if (card.status === 'STARTED') {
    actions.push(card.timer?.activeSince ? 'pause' : 'continue');
  } else {
    actions.push('start');
  }

  actions.push('complete', 'partial', 'fallback');
  if (card.status !== 'STARTED') actions.push('reschedule');
  actions.push('skip', 'decompose');

  return actions;
}

function refreshActions(card: CommitmentCard): CommitmentCard {
  return { ...card, availableActions: actionsFor(card) };
}

export function seedCommitments(...cards: CommitmentCard[]): void {
  state.commitments = cards;
}

function find(id: string): CommitmentCard | undefined {
  return state.commitments.find((card) => card.id === id);
}

function replace(card: CommitmentCard): CommitmentCard {
  const updated = refreshActions(card);
  state.commitments = state.commitments.map((existing) =>
    existing.id === updated.id ? updated : existing,
  );
  return updated;
}

function conflict(message: string, reason = 'INVALID_TRANSITION') {
  return HttpResponse.json(
    { statusCode: 409, code: 'CONFLICT', message, details: { reason } },
    { status: 409 },
  );
}

/** The API's sizing rule, so the check-in actually changes the recommendation. */
function chooseVersion(card: CommitmentCard, feel: CheckInFeel | null) {
  const { versions } = card;

  if (feel === 'LOW_ENERGY') {
    const chosen = versions.minimum ?? versions.short ?? versions.full;
    return {
      version: (versions.minimum ? 'minimum' : versions.short ? 'short' : 'full') as
        | 'full'
        | 'short'
        | 'minimum',
      chosen,
    };
  }

  if (feel === 'PACKED' || feel === 'UNEXPECTED_PROBLEM') {
    const chosen = versions.short ?? versions.minimum ?? versions.full;
    return {
      version: (versions.short ? 'short' : versions.minimum ? 'minimum' : 'full') as
        | 'full'
        | 'short'
        | 'minimum',
      chosen,
    };
  }

  return { version: 'full' as const, chosen: versions.full };
}

function buildNextBestAction(): NextBestAction | null {
  const feel = state.checkIn?.feel ?? null;

  const candidates = state.commitments.filter(
    (card) =>
      state.modes[card.domain] !== 'PAUSE' &&
      ['PLANNED', 'READY', 'STARTED'].includes(card.status),
  );
  if (candidates.length === 0) return null;

  const started = candidates.find((card) => card.status === 'STARTED');
  const top =
    started ??
    [...candidates].sort(
      (a, b) => b.importance - a.importance || a.scheduledStart.localeCompare(b.scheduledStart),
    )[0];

  const { version, chosen } = chooseVersion(top, feel);

  const mode = started
    ? 'ACT'
    : feel === 'LOW_ENERGY'
      ? 'RECONNECT'
      : feel === 'PACKED' || feel === 'UNEXPECTED_PROBLEM'
        ? 'REDUCE'
        : top.rescheduleCount >= 2
          ? 'DIAGNOSE'
          : 'ACT';

  return {
    commitmentId: top.id,
    title: started ? top.title : chosen.title,
    domain: top.domain,
    durationMinutes: chosen.minutes,
    version,
    rationale: started
      ? 'You already started this — continue.'
      : `This is the most useful ${chosen.minutes} minutes you have right now.`,
    fallback:
      version === 'full' && top.versions.short
        ? { title: top.versions.short.title, durationMinutes: top.versions.short.minutes }
        : { title: '5-minute start', durationMinutes: 5 },
    interventionMode: mode,
    confidence: 0.8,
  };
}

function buildToday(): TodayResponse {
  const count = state.commitments.length;
  const paused = (Object.keys(state.modes) as Domain[]).filter(
    (domain) => state.modes[domain] === 'PAUSE',
  );

  return {
    greeting: 'morning',
    stateLine:
      count === 0
        ? 'Nothing scheduled today.'
        : `${count} commitment${count === 1 ? '' : 's'} today.${
            paused.length ? ` ${paused.length} domain paused.` : ''
          }`,
    dateLocal: state.dateLocal,
    timeZone: 'UTC',
    checkIn: state.checkIn ? { feel: state.checkIn.feel } : null,
    nextBestAction: buildNextBestAction(),
    domains: (['WORK', 'FAMILY', 'HEALTH'] as Domain[]).map((domain) => ({
      domain,
      mode: state.modes[domain],
      commitments: state.commitments.filter((card) => card.domain === domain),
    })),
    momentum: null,
    coachInsight: null,
  };
}

const ok = <T,>(data: T) => HttpResponse.json({ data });

export const todayHandlers = [
  http.get(`${API_BASE}/today`, () => ok(buildToday())),

  // The Start screen's read: the card plus why it matters (#48).
  http.get(`${API_BASE}/commitments/:id/actions`, ({ params }) => {
    const card = find(String(params.id));
    if (!card) return HttpResponse.json({ message: 'Not found' }, { status: 404 });

    return ok({ ...card, whyItMatters: state.whyItMatters });
  }),

  http.get(`${API_BASE}/today/insight`, () => {
    // A transport failure, not a coach failure — the endpoint itself never
    // returns non-200 for an unavailable model. The page must survive it.
    if (state.insightFails) return HttpResponse.json({ message: 'boom' }, { status: 500 });
    return ok(state.insight);
  }),

  http.get(`${API_BASE}/today/check-in`, () => ok(state.checkIn)),

  http.post(`${API_BASE}/today/check-in`, async ({ request }) => {
    const body = (await request.json()) as { feel: CheckInFeel };
    state.checkIn = {
      dateLocal: state.dateLocal,
      feel: body.feel,
      updatedAt: new Date().toISOString(),
    };
    return ok(state.checkIn);
  }),

  http.get(`${API_BASE}/today/reflection`, () => ok(state.reflection)),

  http.post(`${API_BASE}/today/reflection`, async ({ request }) => {
    const body = (await request.json()) as DayReflection;
    state.reflection = {
      id: nextId('reflection'),
      dateLocal: state.dateLocal,
      quickOption: body.quickOption,
      text: body.text ?? null,
      createdAt: new Date().toISOString(),
    };
    return HttpResponse.json({ data: state.reflection }, { status: 201 });
  }),

  http.post(`${API_BASE}/commitments/:id/actions/start`, async ({ params, request }) => {
    const card = find(String(params.id));
    if (!card) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    if (card.availableActions.length === 0) return conflict('That commitment is closed');

    const body = (await request.json().catch(() => ({}))) as { minutes?: number | null };
    const activeSince = new Date().toISOString();

    return ok(
      replace({
        ...card,
        status: 'STARTED',
        startedAt: card.startedAt ?? activeSince,
        timer: {
          activeSince,
          activeSeconds: card.timer?.activeSeconds ?? 0,
          elapsedSeconds: card.timer?.activeSeconds ?? 0,
          timerMinutes: body.minutes ?? card.timer?.timerMinutes ?? null,
          remainingSeconds: body.minutes ? body.minutes * 60 : null,
        },
      }),
    );
  }),

  http.post(`${API_BASE}/commitments/:id/actions/pause`, ({ params }) => {
    const card = find(String(params.id));
    if (!card) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    if (card.status !== 'STARTED' || !card.timer?.activeSince) {
      return conflict('Cannot pause a commitment that is not running');
    }

    return ok(
      replace({
        ...card,
        timer: { ...card.timer, activeSince: null, activeSeconds: card.timer.elapsedSeconds },
      }),
    );
  }),

  // Accepted while still running, like the API: "Continue another 15?" fires on
  // a session that has passed its target but never paused.
  http.post(`${API_BASE}/commitments/:id/actions/continue`, async ({ params, request }) => {
    const card = find(String(params.id));
    if (!card) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    if (card.status !== 'STARTED') {
      return conflict(`Cannot continue a ${card.status} commitment`);
    }

    const body = (await request.json().catch(() => ({}))) as { extraMinutes?: number | null };
    const timerMinutes = body.extraMinutes
      ? (card.timer?.timerMinutes ?? 0) + body.extraMinutes
      : (card.timer?.timerMinutes ?? null);

    return ok(
      replace({
        ...card,
        timer: {
          // Already running: keep the anchor, or no accumulated time survives.
          activeSince: card.timer?.activeSince ?? new Date().toISOString(),
          activeSeconds: card.timer?.activeSeconds ?? 0,
          elapsedSeconds: card.timer?.elapsedSeconds ?? 0,
          timerMinutes,
          remainingSeconds: card.timer?.remainingSeconds ?? null,
        },
      }),
    );
  }),

  ...(['complete', 'partial'] as const).map((which) =>
    http.post(`${API_BASE}/commitments/:id/actions/${which}`, async ({ params, request }) => {
      const card = find(String(params.id));
      if (!card) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
      if (card.availableActions.length === 0) return conflict('That commitment is closed');

      const body = (await request.json().catch(() => ({}))) as {
        minutesSpent?: number | null;
      };

      return ok(
        replace({
          ...card,
          status: which === 'complete' ? 'COMPLETED' : 'PARTIALLY_COMPLETED',
          completedAt: new Date().toISOString(),
          minutesSpent: body.minutesSpent ?? Math.round((card.timer?.elapsedSeconds ?? 0) / 60),
          versionUsed: card.versionUsed ?? 'FULL',
          timer: card.timer ? { ...card.timer, activeSince: null } : null,
        }),
      );
    }),
  ),

  http.post(`${API_BASE}/commitments/:id/actions/fallback`, async ({ params, request }) => {
    const card = find(String(params.id));
    if (!card) return HttpResponse.json({ message: 'Not found' }, { status: 404 });

    const body = (await request.json()) as { version: 'short' | 'minimum' };
    const declared = body.version === 'short' ? card.versions.short : card.versions.minimum;
    if (!declared) {
      return HttpResponse.json(
        {
          statusCode: 400,
          message: `This commitment has no ${body.version} version`,
          details: { reason: 'VERSION_NOT_DEFINED' },
        },
        { status: 400 },
      );
    }

    return ok(
      replace({ ...card, versionUsed: body.version === 'short' ? 'SHORT' : 'MINIMUM' }),
    );
  }),

  http.post(`${API_BASE}/commitments/:id/actions/reschedule`, async ({ params, request }) => {
    const card = find(String(params.id));
    if (!card) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    if (card.status === 'STARTED') {
      return conflict('A started commitment cannot be rescheduled', 'ALREADY_STARTED');
    }

    const body = (await request.json()) as { scheduledStart: string };

    // The original CLOSES and a new row carries the intention forward — the
    // API's own model, reproduced so a test can prove the UI follows the new id.
    replace({ ...card, status: 'RESCHEDULED' });

    const replacement = makeCard({
      ...card,
      id: nextId('commitment'),
      status: 'PLANNED',
      scheduledStart: body.scheduledStart,
      rescheduleCount: card.rescheduleCount + 1,
      availableActions: undefined,
    });
    state.commitments = [...state.commitments, replacement];

    return ok(replacement);
  }),

  http.post(`${API_BASE}/commitments/:id/actions/skip`, async ({ params, request }) => {
    const card = find(String(params.id));
    if (!card) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    if (card.availableActions.length === 0) return conflict('That commitment is closed');

    const body = (await request.json()) as { reason: string; text?: string | null };
    state.reflection = {
      id: nextId('reflection'),
      dateLocal: state.dateLocal,
      quickOption: body.reason as DayReflection['quickOption'],
      text: body.text ?? null,
      createdAt: new Date().toISOString(),
    };

    return ok(replace({ ...card, status: 'SKIPPED' }));
  }),

  http.post(`${API_BASE}/commitments/:id/actions/decompose`, ({ params }) => {
    const card = find(String(params.id));
    if (!card) return HttpResponse.json({ message: 'Not found' }, { status: 404 });

    // 200 either way: the endpoint never fails for an unavailable coach.
    const proposal: DecompositionProposal = state.coachDown
      ? {
          steps: [{ title: 'Open it and do the first 5 minutes', minutes: 5 }],
          firstStep: { title: 'Open it and do the first 5 minutes', minutes: 5 },
          message: 'The coach is unavailable — start with 5 minutes instead.',
          source: 'template',
        }
      : {
          steps: [
            { title: 'Open the doc', minutes: 5 },
            { title: 'Write the decision statement', minutes: 10 },
          ],
          firstStep: { title: 'Open the doc', minutes: 5 },
          message: 'Start by opening the doc.',
          source: 'ai',
        };

    return ok(proposal);
  }),

  http.post(
    `${API_BASE}/commitments/:id/actions/decompose/apply`,
    async ({ params, request }) => {
      const card = find(String(params.id));
      if (!card) return HttpResponse.json({ message: 'Not found' }, { status: 404 });

      const proposal = (await request.json()) as DecompositionProposal;
      const child = makeCard({
        id: nextId('commitment'),
        title: proposal.firstStep.title,
        domain: card.domain,
        durationMinutes: proposal.firstStep.minutes,
        versions: {
          full: { title: proposal.firstStep.title, minutes: proposal.firstStep.minutes },
          short: null,
          minimum: {
            title: proposal.firstStep.title,
            minutes: Math.min(5, proposal.firstStep.minutes),
          },
        },
        decomposedFromId: card.id,
        steps: proposal.steps,
        availableActions: undefined,
      });
      state.commitments = [...state.commitments, child];

      return HttpResponse.json({ data: child }, { status: 201 });
    },
  ),
];
