import { http, HttpResponse } from 'msw';

// =============================================================================
// A stateful in-memory account-reset API (epic #220)
// =============================================================================
//
// STATEFUL, and — more importantly — it ENFORCES THE PHRASE RULE, answering 400
// on a mismatch exactly as `AccountResetService.reset` does.
//
// That is the whole reason this is not a table of canned responses. The one
// behaviour worth testing on this screen is a REFUSAL: that a wrong phrase sends
// nothing, and that what does get sent is the string the user typed rather than
// the phrase the page already holds. A mock that accepted any body would let
// both of those pass while broken, which is worse than no test because it reads
// as coverage.
//
// `recordedResets` is the second half of that: a test asserts what reached the
// wire, not merely that a spy fired.
//
// `resetAccountState()` runs from the global `afterEach`, so no test inherits
// another's counts.
// =============================================================================

const API_BASE = '*/api';

/** Mirrors `ACCOUNT_RESET_PHRASES` on the API. Served, never hardcoded client-side. */
export const MOCK_RESET_PHRASES = {
  data: 'DELETE MY DATA',
  data_and_key: 'DELETE EVERYTHING',
} as const;

export type MockResetScope = keyof typeof MOCK_RESET_PHRASES;

/** One reset request as it actually arrived. */
export interface RecordedReset {
  scope: string;
  confirmationPhrase: string;
}

interface AccountState {
  counts: Record<string, number>;
  aiKeyConfigured: boolean;
  /** Every `POST /account/reset` that arrived, accepted or refused. */
  recordedResets: RecordedReset[];
}

function emptyState(): AccountState {
  return {
    counts: {
      outcomes: 2,
      commitments: 4,
      evidence_items: 9,
      coach_conversations: 1,
      memory_insights: 3,
      storage_objects: 1,
      media_attachments: 1,
      // A zero, deliberately: the dialog must not render it, and a store with
      // no zero in it could never prove that.
      weekly_reviews: 0,
    },
    aiKeyConfigured: true,
    recordedResets: [],
  };
}

let state: AccountState = emptyState();

export function resetAccountState(): void {
  state = emptyState();
}

export function seedAccountState(patch: Partial<AccountState>): void {
  state = { ...state, ...patch };
}

export function getAccountState(): AccountState {
  return state;
}

export const accountHandlers = [
  http.get(`${API_BASE}/account/data-summary`, () =>
    HttpResponse.json({
      data: { counts: state.counts, phrases: MOCK_RESET_PHRASES },
    }),
  ),

  http.post(`${API_BASE}/account/reset`, async ({ request }) => {
    const body = (await request.json()) as {
      scope?: string;
      confirmationPhrase?: string;
    };

    const scope = body.scope ?? '';
    const confirmationPhrase = body.confirmationPhrase ?? '';

    // Recorded BEFORE the check, so a test can assert that a refused request
    // still shows what was sent — and, more usefully, that a request the UI
    // should never have made was never made at all.
    state.recordedResets.push({ scope, confirmationPhrase });

    const expected = MOCK_RESET_PHRASES[scope as MockResetScope];

    if (expected === undefined) {
      return HttpResponse.json(
        { message: 'Validation failed', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // The real service's comparison: `.trim()` only, case-sensitive.
    if (confirmationPhrase.trim() !== expected) {
      return HttpResponse.json(
        {
          message: `The confirmation phrase did not match. Type "${expected}" exactly to continue.`,
          code: 'BAD_REQUEST',
        },
        { status: 400 },
      );
    }

    const deleted = { ...state.counts };
    state.counts = Object.fromEntries(
      Object.keys(state.counts).map((table) => [table, 0]),
    );

    const aiKeyRemoved = scope === 'data_and_key';
    if (aiKeyRemoved) state.aiKeyConfigured = false;

    return HttpResponse.json({ data: { scope, deleted, aiKeyRemoved } });
  }),
];
