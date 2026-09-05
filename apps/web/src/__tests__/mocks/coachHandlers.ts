import { http, HttpResponse } from 'msw';

import type {
  CoachConversation,
  CoachMessage,
  CoachReply,
  PlanChange,
  ProposalSummary,
} from '../../types';

// =============================================================================
// A stateful in-memory Coach API (issue #86, epic E06)
// =============================================================================
//
// STATEFUL, and it enforces the rules the real API enforces, for the reason
// `pathHandlers` gives: a mock that accepted everything would let page tests
// pass against behaviour the server rejects, which reads as coverage and is
// worse than no test.
//
// What is enforced here, matching `apps/api/src/coach`:
//
//   * `POST /coach/messages` without a `conversationId` CREATES one, titled
//     from the first 60 characters — the page relies on the returned id.
//   * A message whose text mentions Wednesday comes back with a proposal that
//     already has a `proposalId`, exactly as the API returns it once the row
//     exists.
//   * A degraded turn has `structured: null` and `degraded: true`. That pair
//     is the contract the "Why this?" expander branches on.
//   * Accepting a proposal returns the version it produced and flips the
//     stored status, so a second accept is a 409 like the real one.
//
// `resetCoachState()` runs from the global `afterEach`.
// =============================================================================

const API_BASE = '*/api';

interface CoachState {
  conversations: CoachConversation[];
  messages: Record<string, CoachMessage[]>;
  proposals: Record<string, ProposalSummary>;
  /** Set by a test to make the next send degrade. */
  nextDegraded: boolean;
  /** Set by a test to make the next send fail at the transport. */
  nextFails: boolean;
}

const initial = (): CoachState => ({
  conversations: [],
  messages: {},
  proposals: {},
  nextDegraded: false,
  nextFails: false,
});

let state: CoachState = initial();

export function resetCoachState(): void {
  state = initial();
}

export function seedConversation(
  conversation: Partial<CoachConversation> = {},
): CoachConversation {
  const row: CoachConversation = {
    id: conversation.id ?? `conv-${state.conversations.length + 1}`,
    title: conversation.title ?? 'Schedule change',
    createdAt: conversation.createdAt ?? new Date().toISOString(),
    lastMessageAt: conversation.lastMessageAt ?? new Date().toISOString(),
  };

  state.conversations = [row, ...state.conversations];
  state.messages[row.id] ??= [];

  return row;
}

export function seedMessage(conversationId: string, message: Partial<CoachMessage>): CoachMessage {
  const row: CoachMessage = {
    id: message.id ?? `msg-${Math.random().toString(36).slice(2, 8)}`,
    role: message.role ?? 'COACH',
    content: message.content ?? 'Here is a thought.',
    structured: message.structured ?? null,
    attachmentIds: message.attachmentIds ?? [],
    safety: message.safety ?? null,
    createdAt: message.createdAt ?? new Date().toISOString(),
  };

  state.messages[conversationId] ??= [];
  state.messages[conversationId].push(row);

  return row;
}

export function failNextSend(): void {
  state.nextFails = true;
}

export function degradeNextSend(): void {
  state.nextDegraded = true;
}

/**
 * Put a proposal in the store without a conversation.
 *
 * A weekly review's recommendation is created by the reviewer, not by a chat
 * turn (E10), but it is decided through the SAME `/proposals/:id/*` routes. One
 * store, so a spec cannot accept a proposal the accept route has never heard of.
 */
export function seedProposal(proposal: ProposalSummary): void {
  state.proposals[proposal.id] = proposal;
}

export function coachState(): Readonly<CoachState> {
  return state;
}

const SUGGESTED_PROMPTS = [
  { key: 'plan_week', label: 'Plan my week', text: 'Help me plan my week' },
  { key: 'procrastinating', label: "I'm procrastinating", text: "I'm procrastinating" },
  { key: 'shorter_workout', label: 'Make today shorter', text: "Make today's workout shorter" },
  { key: 'fell_off', label: 'I fell off', text: 'I fell off' },
  { key: 'review_progress', label: 'Review my progress', text: 'Review my progress' },
  { key: 'decide_what_matters', label: 'What matters most?', text: 'Help me decide what matters' },
  { key: 'change_plan', label: 'Change my plan', text: 'Change my plan' },
];

const MOVE_CHANGE: PlanChange = {
  op: 'move',
  target: { type: 'routine', id: '11111111-1111-4111-8111-111111111111' },
  before: { preferredTime: '18:30', triggerValue: 'WED' },
  after: { preferredTime: '09:00', triggerValue: 'SAT' },
  reason: 'Wednesday evenings stopped working',
};

function replyFor(text: string, proposalId?: string): CoachReply {
  const wantsPlanChange = /wednesday/i.test(text);

  return {
    intervention_type: wantsPlanChange ? 'PLAN_CHALLENGE' : 'ACTIVATION_REDUCTION',
    reasoning_summary: 'Wednesday has been missed three weeks running.',
    user_message: wantsPlanChange
      ? 'Want to move it to Saturday morning?'
      : 'Ten minutes now would keep the week alive.',
    recommended_action: wantsPlanChange
      ? null
      : {
          title: 'Ten-minute mobility',
          duration_minutes: 10,
          commitmentId: '22222222-2222-4222-8222-222222222222',
        },
    fallback_action: null,
    proposal: wantsPlanChange
      ? {
          kind: 'plan_change',
          planId: '33333333-3333-4333-8333-333333333333',
          summary: 'Move the Wednesday workout to Saturday morning.',
          changes: [MOVE_CHANGE],
          proposalId,
        }
      : null,
    friction_question: null,
  };
}

export const coachHandlers = [
  http.get(`${API_BASE}/coach/suggested-prompts`, () =>
    HttpResponse.json({ prompts: SUGGESTED_PROMPTS }),
  ),

  http.get(`${API_BASE}/coach/conversations`, () =>
    HttpResponse.json({ items: state.conversations, nextCursor: null }),
  ),

  http.post(`${API_BASE}/coach/conversations`, async ({ request }) => {
    const body = (await request.json()) as { title?: string };
    return HttpResponse.json(seedConversation({ title: body.title ?? null }), {
      status: 201,
    });
  }),

  http.get(`${API_BASE}/coach/conversations/:id/messages`, ({ params }) => {
    const id = params.id as string;
    if (!state.messages[id]) {
      return HttpResponse.json({ message: 'Conversation not found' }, { status: 404 });
    }
    return HttpResponse.json({ items: state.messages[id] });
  }),

  http.delete(`${API_BASE}/coach/conversations/:id`, ({ params }) => {
    const id = params.id as string;
    state.conversations = state.conversations.filter((c) => c.id !== id);
    delete state.messages[id];
    return new HttpResponse(null, { status: 204 });
  }),

  http.post(`${API_BASE}/coach/messages`, async ({ request }) => {
    if (state.nextFails) {
      state.nextFails = false;
      return HttpResponse.json({ message: 'Network trouble' }, { status: 500 });
    }

    const body = (await request.json()) as {
      conversationId?: string;
      text: string;
      attachmentIds?: string[];
    };

    const conversation = body.conversationId
      ? state.conversations.find((c) => c.id === body.conversationId)
      : seedConversation({ title: body.text.slice(0, 60) });

    if (!conversation) {
      return HttpResponse.json({ message: 'Conversation not found' }, { status: 404 });
    }

    const userMessage = seedMessage(conversation.id, {
      role: 'USER',
      content: body.text,
      attachmentIds: body.attachmentIds ?? [],
    });

    if (state.nextDegraded) {
      state.nextDegraded = false;

      // `structured: null` with `degraded: true` — the pair the UI branches
      // on, and the reason a fallback is indistinguishable from "no output".
      const coachMessage = seedMessage(conversation.id, {
        role: 'COACH',
        content: 'The coach is unavailable right now. Your plan still works.',
        structured: null,
      });

      return HttpResponse.json(
        { conversationId: conversation.id, userMessage, coachMessage, degraded: true },
        { status: 201 },
      );
    }

    const wantsPlanChange = /wednesday/i.test(body.text);
    let proposal: ProposalSummary | undefined;

    if (wantsPlanChange) {
      proposal = {
        id: `proposal-${Object.keys(state.proposals).length + 1}`,
        planId: '33333333-3333-4333-8333-333333333333',
        sourceKind: 'COACH',
        status: 'PROPOSED',
        summary: 'Move the Wednesday workout to Saturday morning.',
        changeCount: 1,
        edited: false,
        expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        decidedAt: null,
        decisionReason: null,
        appliedPlanVersionId: null,
        createdAt: new Date().toISOString(),
        plan: {
          id: '33333333-3333-4333-8333-333333333333',
          outcomeTitle: 'Get strong again',
          domain: 'HEALTH',
        },
      };
      state.proposals[proposal.id] = proposal;
    }

    const coachMessage = seedMessage(conversation.id, {
      role: 'COACH',
      content: replyFor(body.text).user_message,
      structured: replyFor(body.text, proposal?.id),
      safety: { decision: 'allow', category: 'none' },
    });

    return HttpResponse.json(
      {
        conversationId: conversation.id,
        userMessage,
        coachMessage,
        ...(proposal ? { proposal } : {}),
        degraded: false,
      },
      { status: 201 },
    );
  }),

  http.post(`${API_BASE}/proposals/:id/accept`, ({ params }) => {
    const proposal = state.proposals[params.id as string];

    if (!proposal) {
      return HttpResponse.json({ message: 'Proposal not found' }, { status: 404 });
    }
    if (proposal.status !== 'PROPOSED' && proposal.status !== 'EDITED') {
      return HttpResponse.json({ code: 'proposal_not_actionable' }, { status: 409 });
    }

    proposal.status = 'ACCEPTED';
    proposal.decidedAt = new Date().toISOString();

    return HttpResponse.json({
      proposal,
      planVersion: { id: 'version-2', version: 2, status: 'ACTIVE' },
    });
  }),

  http.post(`${API_BASE}/proposals/:id/edit`, async ({ params, request }) => {
    const proposal = state.proposals[params.id as string];
    if (!proposal) {
      return HttpResponse.json({ message: 'Proposal not found' }, { status: 404 });
    }

    const body = (await request.json()) as { changes: PlanChange[] };
    proposal.status = 'EDITED';
    proposal.edited = true;
    proposal.changeCount = body.changes.length;

    return HttpResponse.json({ ...proposal, changes: body.changes });
  }),

  http.post(`${API_BASE}/proposals/:id/reject`, ({ params }) => {
    const proposal = state.proposals[params.id as string];
    if (!proposal) {
      return HttpResponse.json({ message: 'Proposal not found' }, { status: 404 });
    }

    proposal.status = 'REJECTED';
    proposal.decidedAt = new Date().toISOString();

    return HttpResponse.json(proposal);
  }),

  http.get(`${API_BASE}/proposals`, () =>
    HttpResponse.json(Object.values(state.proposals)),
  ),
];
