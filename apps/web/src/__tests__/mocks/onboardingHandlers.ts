import { http, HttpResponse } from 'msw';

import type {
  OnboardingAnswersPatch,
  OnboardingProposal,
  OnboardingState,
  OnboardingStep,
} from '../../types';

// =============================================================================
// A stateful in-memory Onboarding API (issue #102, epic E04)
// =============================================================================
//
// STATEFUL, like `pathHandlers` and for the same reason: every assertion about
// this wizard is about a SEQUENCE. "A refresh reopens on the saved step" is
// only a real test if the mock actually saved it, and "Back preserves the
// answers" is only real if the answers came back from somewhere.
//
// The rules the API enforces are enforced here too, or a page spec passes
// against behaviour the server rejects:
//
//   * `PATCH` is a merge — an absent key is left alone
//   * `step: 'DONE'` is a 400
//   * `propose` stores a proposal and NOTHING else
//   * a second `approve` is a 409 with `details.reason`
//
// `resetOnboardingState()` runs from the global `afterEach`.
// =============================================================================

const API_BASE = '*/api';

interface StoredState extends OnboardingState {
  timezone: string | null;
  locale: string | null;
}

function emptyState(): StoredState {
  return {
    step: 'PROMISE',
    completed: false,
    answers: {
      sixMonthVision: null,
      domains: [],
      domainReflections: null,
      obstacles: [],
      weekdayMinutes: null,
      healthBaseline: null,
      coachingStyle: 'BALANCED',
    },
    pendingProposal: null,
    proposalSource: null,
    confidenceScore: null,
    timezone: null,
    locale: null,
  };
}

let state: StoredState = emptyState();

/** Every `PATCH` body the wizard sent, in order — the wire assertions read it. */
let patches: OnboardingAnswersPatch[] = [];

/** Every `POST /onboarding/start` body. */
let starts: Array<{ timezone: string; locale?: string }> = [];

/** The proposal bodies `approve` was called with. */
let approvals: OnboardingProposal[] = [];

export function resetOnboardingState(): void {
  state = emptyState();
  patches = [];
  starts = [];
  approvals = [];
}

/** Seed the state a returning user resumes from. */
export function seedOnboardingState(over: Partial<OnboardingState>): void {
  state = { ...state, ...over } as StoredState;
}

export function onboardingPatches(): OnboardingAnswersPatch[] {
  return patches;
}

export function onboardingStarts(): Array<{ timezone: string; locale?: string }> {
  return starts;
}

export function onboardingApprovals(): OnboardingProposal[] {
  return approvals;
}

export function onboardingState(): OnboardingState {
  return state;
}

/** A proposal shaped like the server's, for whichever domains were selected. */
export function buildMockProposal(
  domains: OnboardingState['answers']['domains'],
  over: Partial<OnboardingProposal> = {},
): OnboardingProposal {
  const chosen = domains.length > 0 ? domains : (['WORK'] as OnboardingState['answers']['domains']);
  const tomorrow = new Date(Date.now() + 24 * 3_600_000).toISOString();

  return {
    bestSelf: {
      identityStatement: 'Someone who starts before the day starts on them.',
      workIdentity: chosen.includes('WORK') ? 'Focused in the morning' : null,
      familyIdentity: chosen.includes('FAMILY') ? 'Present at the table' : null,
      healthIdentity: chosen.includes('HEALTH') ? 'Training consistently' : null,
      sixMonthVision: 'Mornings back, dinners phone-free, training three times a week',
    },
    outcomes: chosen.map((domain) => ({
      domain,
      title: `${domain} outcome`,
      whyItMatters: 'Because it is the thing that slips first.',
      successDefinition: 'Three times a week, even the short version.',
    })),
    routines: chosen.map((domain) => ({
      domain,
      title: `${domain} routine`,
      triggerType: 'WEEKDAYS' as const,
      triggerValue: 'Mon,Wed,Fri',
      frequency: '3x per week',
      idealMinutes: 25,
      minimumMinutes: 10,
      fallbackBehavior: 'The smallest version that still counts',
    })),
    firstWeekCommitments: chosen.map((domain) => ({
      domain,
      title: `${domain} routine`,
      scheduledStart: tomorrow,
      durationMinutes: 25,
      fullVersion: 'The full version',
      shortVersion: 'The short version',
      minimumVersion: 'The minimum version',
    })),
    rationale: 'Small on purpose. This is what a normal week can carry.',
    reducedFromRequest: false,
    ...over,
  };
}

/** The `{ data, meta }` envelope every response carries. */
function envelope<T>(data: T, status = 200) {
  return HttpResponse.json({ data, meta: { timestamp: new Date().toISOString() } }, { status });
}

function view(): OnboardingState {
  const { timezone: _tz, locale: _locale, ...rest } = state;
  return rest;
}

function conflict() {
  return HttpResponse.json(
    {
      message: 'You have already built your first Path.',
      details: { reason: 'ONBOARDING_ALREADY_COMPLETED' },
    },
    { status: 409 },
  );
}

export const onboardingHandlers = [
  http.get(`${API_BASE}/onboarding`, () => envelope(view())),

  http.post(`${API_BASE}/onboarding/start`, async ({ request }) => {
    if (state.completed) return conflict();

    const body = (await request.json()) as { timezone: string; locale?: string };
    starts.push(body);

    state.timezone = body.timezone;
    state.locale = body.locale ?? null;
    if (state.step === 'PROMISE') state.step = 'VISION';

    return envelope(view());
  }),

  http.patch(`${API_BASE}/onboarding/answers`, async ({ request }) => {
    if (state.completed) return conflict();

    const patch = (await request.json()) as OnboardingAnswersPatch & { step?: OnboardingStep };

    if (patch.step === 'DONE') {
      return HttpResponse.json(
        { message: 'Completion is approve to declare.', details: { reason: 'INVALID_STEP' } },
        { status: 400 },
      );
    }

    patches.push(patch);

    if (patch.step) state.step = patch.step;
    if (patch.sixMonthVision !== undefined) state.answers.sixMonthVision = patch.sixMonthVision;
    if (patch.domains !== undefined) state.answers.domains = patch.domains;
    if (patch.domainReflections !== undefined) {
      state.answers.domainReflections = patch.domainReflections;
    }
    if (patch.obstacles !== undefined) state.answers.obstacles = patch.obstacles;
    if (patch.weekdayMinutes !== undefined) state.answers.weekdayMinutes = patch.weekdayMinutes;
    if (patch.healthBaseline !== undefined) state.answers.healthBaseline = patch.healthBaseline;
    if (patch.coachingStyle !== undefined) state.answers.coachingStyle = patch.coachingStyle;

    return envelope(view());
  }),

  http.post(`${API_BASE}/onboarding/propose`, () => {
    const proposal = buildMockProposal(state.answers.domains);

    state.pendingProposal = proposal;
    state.proposalSource = 'ai';
    state.step = 'PROPOSAL';

    return envelope({ proposal, source: 'ai' });
  }),

  http.post(`${API_BASE}/onboarding/skip-ai`, () => {
    const proposal = buildMockProposal(state.answers.domains);

    state.pendingProposal = proposal;
    state.proposalSource = 'template';
    state.step = 'PROPOSAL';

    return envelope({ proposal, source: 'template' });
  }),

  http.post(`${API_BASE}/onboarding/confidence`, async ({ request }) => {
    const { score } = (await request.json()) as { score: number };

    state.confidenceScore = score;

    if (score > 2 || !state.pendingProposal) {
      return envelope({
        proposal: state.pendingProposal ?? buildMockProposal(state.answers.domains),
        source: state.proposalSource ?? 'ai',
        reproposed: false,
      });
    }

    const smaller: OnboardingProposal = {
      ...state.pendingProposal,
      routines: state.pendingProposal.routines.slice(0, -1),
      firstWeekCommitments: state.pendingProposal.firstWeekCommitments.slice(0, -1),
      reducedFromRequest: true,
    };

    state.pendingProposal = smaller;

    return envelope({ proposal: smaller, source: state.proposalSource ?? 'ai', reproposed: true });
  }),

  http.post(`${API_BASE}/onboarding/approve`, async ({ request }) => {
    if (state.completed) return conflict();

    const { proposal } = (await request.json()) as { proposal: OnboardingProposal };
    approvals.push(proposal);

    state.completed = true;
    state.step = 'DONE';
    state.pendingProposal = null;

    return envelope(
      {
        bestSelfId: 'best-self-1',
        outcomeIds: proposal.outcomes.map((_o, i) => `outcome-${i}`),
        planVersionIds: proposal.outcomes.map((_o, i) => `version-${i}`),
        routineIds: proposal.routines.map((_r, i) => `routine-${i}`),
        commitmentIds: proposal.firstWeekCommitments.map((_c, i) => `commitment-${i}`),
      },
      201,
    );
  }),
];
