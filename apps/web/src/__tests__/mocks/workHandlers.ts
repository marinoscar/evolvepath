import { http, HttpResponse } from 'msw';

import { applyStart, applyStop } from './todayHandlers';
import type {
  ActiveFocusSession,
  AvoidanceAssessment,
  FocusSession,
  FrictionAnswer,
  FrictionAnswerResult,
  OutcomeWorkPlan,
  WorkSessionPlan,
  WorkSessionPlanProposal,
} from '../../types';

// =============================================================================
// A stateful in-memory Work API (issue #118, epic E07)
// =============================================================================
//
// STATEFUL, like `todayHandlers` and for the same reason: every assertion on
// these surfaces is about a SEQUENCE. "Adding a note persists it" is only a
// real test if the mock actually stores it, and "start then extend then stop"
// is only real if each call sees the last one's effect.
//
// The rules the API enforces are enforced here too:
//
//   * a second `POST /focus-sessions` while one is open answers 409 with
//     `FOCUS_SESSION_ACTIVE`
//   * `extend` raises both counters, `stop` ends the session and returns the
//     minutes actually focused
//   * `plan-sessions` writes nothing until `apply`
//   * the intervention type comes from the ANSWER, never from the request
//
// `resetWorkState()` runs from the global `afterEach`.
// =============================================================================

const API_BASE = '*/api';

/** The server's routing table, mirrored so the dialog's copy can be asserted. */
const INTERVENTION_BY_ANSWER: Record<FrictionAnswer, string> = {
  DONT_KNOW_WHERE_TO_BEGIN: 'ACTIVATION_REDUCTION',
  TOO_BIG: 'DECOMPOSITION',
  TIRED: 'REDUCE_SCOPE',
  DONT_WANT_TO: 'RECONNECT_REASON',
  SOMETHING_URGENT: 'PROTECTED_RESCHEDULE',
  WORRIED_ABOUT_QUALITY: 'PERFECTIONISM_REFRAME',
  NEED_MORE_INFO: 'CLARIFY',
  OTHER: 'FRICTION_DIAGNOSIS',
};

interface WorkState {
  workPlan: OutcomeWorkPlan;
  /** Proposals by id, so `apply` can find the one it was given. */
  proposals: Map<string, WorkSessionPlanProposal & { status: string }>;
  sessions: FocusSession[];
  avoidance: AvoidanceAssessment | null;
  /** Set to make `plan-sessions` answer 503, as with the provider down. */
  coachDown: boolean;
  /** Set to make `plan-sessions` answer 412, as with no key saved. */
  keyMissing: boolean;
  /** Set to make the next `apply` reject with PROPOSAL_INVALID. */
  applyRejects: string[] | null;
  interventionSource: 'ai' | 'template';
  sequence: number;
}

function emptyPlan(): OutcomeWorkPlan {
  return {
    milestones: [],
    sessions: [],
    implementationIntention: null,
    reviewCadence: null,
    latestProposal: null,
  };
}

function emptyState(): WorkState {
  return {
    workPlan: emptyPlan(),
    proposals: new Map(),
    sessions: [],
    avoidance: null,
    coachDown: false,
    keyMissing: false,
    applyRejects: null,
    interventionSource: 'ai',
    sequence: 0,
  };
}

let state: WorkState = emptyState();

export function resetWorkState(): void {
  state = emptyState();
}

function nextId(prefix: string): string {
  state.sequence += 1;
  return `${prefix}-${state.sequence}`;
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

export function seedWorkPlan(plan: Partial<OutcomeWorkPlan>): void {
  state.workPlan = { ...emptyPlan(), ...plan };
}

export function seedFocusSessions(...sessions: FocusSession[]): void {
  state.sessions = sessions;
}

export function seedAvoidance(assessment: AvoidanceAssessment | null): void {
  state.avoidance = assessment;
}

export function setCoachDown(down: boolean): void {
  state.coachDown = down;
}

export function setAiKeyMissing(missing: boolean): void {
  state.keyMissing = missing;
}

export function setApplyRejects(rules: string[] | null): void {
  state.applyRejects = rules;
}

export function setInterventionSource(source: 'ai' | 'template'): void {
  state.interventionSource = source;
}

/** What `apply` was last given — the spec asserts the user's edits reached it. */
export let lastAppliedPlan: WorkSessionPlan | null = null;

export function resetWorkSpies(): void {
  lastAppliedPlan = null;
}

export function makeFocusSession(overrides: Partial<FocusSession> = {}): FocusSession {
  return {
    id: nextId('focus'),
    commitmentId: 'commitment-1',
    plannedMinutes: 25,
    instruction: null,
    startedAt: '2026-09-08T09:00:00.000Z',
    endedAt: null,
    outcome: null,
    actualMinutes: null,
    continuedCount: 0,
    distractionNotes: [],
    commitment: {
      title: 'Draft the proposal storyline',
      status: 'STARTED',
      timer: {
        activeSince: '2026-09-08T09:00:00.000Z',
        activeSeconds: 0,
        elapsedSeconds: 0,
        timerMinutes: 25,
        remainingSeconds: 1500,
      },
    },
    ...overrides,
  };
}

/** A plan shaped like the planner's, for the review step. */
export function makeSessionPlan(sessionCount = 5): WorkSessionPlan {
  return {
    milestones: [
      { title: 'Clarify what done looks like', order: 0 },
      { title: 'Produce a rough first version', order: 1 },
      { title: 'Refine and finish', order: 2 },
    ],
    sessions: Array.from({ length: sessionCount }, (_, i) => ({
      title: `25 min — storyline part ${i + 1}`,
      scheduledStart: new Date(
        Date.UTC(2026, 8, 8 + i, 9, 0, 0),
      ).toISOString(),
      durationMinutes: 25,
      milestoneIndex: Math.min(2, Math.floor((i * 3) / sessionCount)),
      minimumStart: { title: 'Write the decision sentence', minutes: 10 },
    })),
    implementationIntention: {
      when: 'After I sit down with coffee',
      then: 'I open the deck and start the next session',
    },
    reviewCadence: 'WEEKLY',
    rationale: 'Five weekday mornings, front-loaded on the storyline.',
  };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

const activeSession = (): FocusSession | undefined =>
  state.sessions.find((session) => session.endedAt === null);

function conflict(details: Record<string, unknown>, message: string) {
  return HttpResponse.json(
    { statusCode: 409, code: 'CONFLICT', message, details },
    { status: 409 },
  );
}

export const workHandlers = [
  // ---- session planning ----------------------------------------------------

  http.post(`${API_BASE}/outcomes/:id/plan-sessions`, async () => {
    if (state.keyMissing) {
      return HttpResponse.json(
        { statusCode: 412, code: 'AI_KEY_REQUIRED', message: 'Add an OpenAI key.' },
        { status: 412 },
      );
    }

    if (state.coachDown) {
      return HttpResponse.json(
        {
          statusCode: 503,
          code: 'SERVICE_UNAVAILABLE',
          message: 'The coach is unavailable.',
          details: { reason: 'AI_UNAVAILABLE', code: 'network', retryable: true },
        },
        { status: 503 },
      );
    }

    const proposal: WorkSessionPlanProposal & { status: string } = {
      proposalId: nextId('proposal'),
      proposal: makeSessionPlan(),
      source: 'ai',
      expiresAt: '2026-09-15T09:00:00.000Z',
      status: 'PROPOSED',
    };

    state.proposals.set(proposal.proposalId, proposal);

    return HttpResponse.json({ data: proposal });
  }),

  http.post(`${API_BASE}/outcomes/:id/plan-sessions/template`, async () => {
    const proposal: WorkSessionPlanProposal & { status: string } = {
      proposalId: nextId('proposal'),
      proposal: makeSessionPlan(),
      source: 'template',
      expiresAt: '2026-09-15T09:00:00.000Z',
      status: 'PROPOSED',
    };

    state.proposals.set(proposal.proposalId, proposal);

    return HttpResponse.json({ data: proposal });
  }),

  http.post(`${API_BASE}/outcomes/:id/plan-sessions/apply`, async ({ request }) => {
    const body = (await request.json()) as {
      proposalId: string;
      proposal?: WorkSessionPlan;
    };

    const stored = state.proposals.get(body.proposalId);

    if (!stored || stored.status !== 'PROPOSED') {
      return conflict({ reason: 'PROPOSAL_NOT_PENDING' }, 'Already applied.');
    }

    if (state.applyRejects) {
      return HttpResponse.json(
        {
          statusCode: 400,
          code: 'BAD_REQUEST',
          message: 'This plan does not fit your week.',
          details: { reason: 'PROPOSAL_INVALID', rules: state.applyRejects },
        },
        { status: 400 },
      );
    }

    const applied = body.proposal ?? stored.proposal;
    lastAppliedPlan = applied;
    stored.status = 'APPLIED';

    const milestoneIds = applied.milestones.map(() => nextId('milestone'));
    const commitmentIds = applied.sessions.map(() => nextId('commitment'));

    // Applying rewrites the plan the detail page reads, exactly as the API does.
    state.workPlan = {
      milestones: applied.milestones.map((milestone, index) => ({
        id: milestoneIds[index],
        title: milestone.title,
        order: milestone.order,
        targetDate: null,
        completedAt: null,
      })),
      sessions: applied.sessions.map((session, index) => ({
        id: commitmentIds[index],
        title: session.title,
        status: 'PLANNED',
        scheduledStart: session.scheduledStart,
        durationMinutes: session.durationMinutes,
        milestoneId: milestoneIds[session.milestoneIndex] ?? null,
        rescheduleCount: 0,
      })),
      implementationIntention: applied.implementationIntention,
      reviewCadence: applied.reviewCadence,
      latestProposal: { id: stored.proposalId, status: 'APPLIED', source: stored.source },
    };

    return HttpResponse.json(
      { data: { routineId: nextId('routine'), milestoneIds, commitmentIds } },
      { status: 201 },
    );
  }),

  http.get(`${API_BASE}/outcomes/:id/work-plan`, () =>
    HttpResponse.json({ data: state.workPlan }),
  ),

  // ---- focus sessions ------------------------------------------------------

  http.post(`${API_BASE}/focus-sessions`, async ({ request }) => {
    const body = (await request.json()) as {
      commitmentId: string;
      plannedMinutes: number;
      instruction?: string | null;
      takeOver?: boolean;
    };

    const open = activeSession();

    if (open && !body.takeOver) {
      return conflict(
        {
          reason: 'FOCUS_SESSION_ACTIVE',
          activeSessionId: open.id,
          commitmentId: open.commitmentId,
        },
        'You already have a focus session running.',
      );
    }

    if (open) {
      open.endedAt = '2026-09-08T09:05:00.000Z';
      open.outcome = 'ABANDONED';
    }

    // The real endpoint performs E05's `start` inside this call, so the
    // commitment's own state has to move here too.
    const card = applyStart(body.commitmentId, body.plannedMinutes);

    const session = makeFocusSession({
      commitmentId: body.commitmentId,
      plannedMinutes: body.plannedMinutes,
      instruction: body.instruction ?? null,
      ...(card
        ? { commitment: { title: card.title, status: card.status, timer: card.timer } }
        : {}),
    });

    state.sessions = [session, ...state.sessions];

    return HttpResponse.json({ data: session }, { status: 201 });
  }),

  http.get(`${API_BASE}/focus-sessions/active`, () =>
    HttpResponse.json({
      data: {
        session: activeSession() ?? null,
        serverNow: '2026-09-08T09:00:00.000Z',
      } satisfies ActiveFocusSession,
    }),
  ),

  http.post(`${API_BASE}/focus-sessions/:id/extend`, async ({ params, request }) => {
    const body = (await request.json()) as { minutes: number };
    const session = state.sessions.find((row) => row.id === params.id);

    if (!session) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    if (session.endedAt) {
      return conflict({ reason: 'FOCUS_SESSION_ENDED' }, 'Already ended.');
    }

    session.plannedMinutes += body.minutes;
    session.continuedCount += 1;
    if (session.commitment.timer) {
      session.commitment.timer = {
        ...session.commitment.timer,
        timerMinutes: (session.commitment.timer.timerMinutes ?? 0) + body.minutes,
      };
    }

    return HttpResponse.json({ data: session });
  }),

  http.post(`${API_BASE}/focus-sessions/:id/note`, async ({ params, request }) => {
    const body = (await request.json()) as { text: string };
    const session = state.sessions.find((row) => row.id === params.id);

    if (!session) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    if (session.endedAt) {
      return conflict({ reason: 'FOCUS_SESSION_ENDED' }, 'Already ended.');
    }

    session.distractionNotes = [...session.distractionNotes, body.text];

    return HttpResponse.json({ data: session });
  }),

  http.post(`${API_BASE}/focus-sessions/:id/stop`, async ({ params, request }) => {
    const body = (await request.json()) as { outcome: 'done' | 'partial' | 'abandoned' };
    const session = state.sessions.find((row) => row.id === params.id);

    if (!session) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    if (session.endedAt) {
      return conflict({ reason: 'FOCUS_SESSION_ENDED' }, 'Already ended.');
    }

    session.endedAt = '2026-09-08T09:12:00.000Z';
    session.outcome = body.outcome.toUpperCase() as FocusSession['outcome'];
    session.actualMinutes = 12;

    // As on the server: `stop` closes the commitment through E05's actions.
    const card = applyStop(session.commitmentId, body.outcome);

    session.commitment = {
      ...session.commitment,
      status:
        card?.status ??
        (body.outcome === 'done'
          ? 'COMPLETED'
          : body.outcome === 'partial'
            ? 'PARTIALLY_COMPLETED'
            : 'STARTED'),
    };

    return HttpResponse.json({
      data: {
        session,
        evidenceId: nextId('evidence'),
        commitmentStatus: session.commitment.status,
        actualMinutes: session.actualMinutes,
      },
    });
  }),

  http.get(`${API_BASE}/focus-sessions`, () =>
    HttpResponse.json({ data: { sessions: state.sessions } }),
  ),

  // ---- friction and the ladder ---------------------------------------------

  http.post(`${API_BASE}/commitments/:id/friction`, async ({ request }) => {
    const body = (await request.json()) as { answer: FrictionAnswer; text?: string };
    const interventionType = INTERVENTION_BY_ANSWER[body.answer];

    const result: FrictionAnswerResult = {
      level: 3,
      obstacleId: nextId('obstacle'),
      reflectionId: nextId('reflection'),
      intervention: {
        interventionType,
        userMessage:
          body.answer === 'TOO_BIG'
            ? "Let's stop treating this like one task."
            : 'Here is the smallest next move.',
        recommendedAction:
          body.answer === 'SOMETHING_URGENT'
            ? null
            : { title: 'Write the first three bullets', durationMinutes: 10 },
        fallbackAction: null,
        suggestedReschedule:
          body.answer === 'SOMETHING_URGENT'
            ? {
                scheduledStart: '2026-09-09T09:00:00.000Z',
                scheduledEnd: '2026-09-09T09:25:00.000Z',
              }
            : null,
        source: state.interventionSource,
      },
    };

    // Having answered, the ladder drops to DECOMPOSE for a week.
    if (state.avoidance) {
      state.avoidance = { ...state.avoidance, suggestedAction: 'DECOMPOSE' };
    }

    return HttpResponse.json({ data: result });
  }),

  http.get(`${API_BASE}/commitments/:id/avoidance`, () =>
    HttpResponse.json({
      data:
        state.avoidance ?? {
          level: 0,
          interventionType: 'NORMAL_REMINDER',
          signals: [],
          rationale: 'Nothing here looks avoided.',
          suggestedAction: 'NONE',
        },
    }),
  ),
];
