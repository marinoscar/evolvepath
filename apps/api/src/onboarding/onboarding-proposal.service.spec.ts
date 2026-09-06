import { AiKeyRequiredException } from '../ai/gateway/ai-errors';
import { OnboardingProposalService } from './onboarding-proposal.service';
import {
  ONBOARDING_PROPOSAL_PROMPT_VERSION,
  ONBOARDING_PROPOSAL_SCHEMA_NAME,
} from './onboarding-proposal.schema';
import { buildTemplateProposal } from './onboarding-templates';
import type { GuardrailContext } from './onboarding.guardrails';
import type { OnboardingAnswers } from './onboarding.types';

// =============================================================================
// The planner call (issue #101, epic E04)
// =============================================================================
//
// The gateway is mocked, so what is asserted here is everything this service
// decides ON ITS OWN: which persona, which prompt version, whether the reduce
// instruction went out, and — the one that matters — that a guardrail failure
// is treated as a schema failure and nothing is returned.
// =============================================================================

const MONDAY = new Date('2026-09-07T08:00:00.000Z');

const guardrails: GuardrailContext = {
  now: MONDAY,
  timezone: 'America/Costa_Rica',
  domains: ['WORK', 'FAMILY', 'HEALTH'],
  weekdayMinutes: 60,
};

const answers: OnboardingAnswers = {
  sixMonthVision: 'Stop wasting mornings',
  domains: ['WORK', 'FAMILY', 'HEALTH'],
  domainReflections: null,
  obstacles: ['PROCRASTINATE'],
  weekdayMinutes: 60,
  healthBaseline: null,
  coachingStyle: 'BALANCED',
};

const proposal = () =>
  buildTemplateProposal(
    {
      sixMonthVision: 'Stop wasting mornings',
      domains: ['WORK', 'FAMILY', 'HEALTH'],
      weekdayMinutes: 60,
      healthBaseline: null,
    },
    MONDAY,
    'America/Costa_Rica',
  );

describe('OnboardingProposalService', () => {
  const gateway = { invoke: jest.fn() };
  const service = new OnboardingProposalService(gateway as never);

  beforeEach(() => gateway.invoke.mockReset());

  function ok(output: unknown) {
    gateway.invoke.mockResolvedValue({ ok: true, invocationId: 'inv-1', output });
  }

  function fail(code: string) {
    gateway.invoke.mockResolvedValue({
      ok: false,
      invocationId: 'inv-1',
      error: { code, message: 'nope' },
    });
  }

  it('calls the planner persona with the versioned prompt and the named schema', async () => {
    ok(proposal());

    await service.propose({ userId: 'u1', answers, guardrails });

    expect(gateway.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        persona: 'planner',
        userId: 'u1',
        promptVersion: ONBOARDING_PROPOSAL_PROMPT_VERSION,
        schemaName: ONBOARDING_PROPOSAL_SCHEMA_NAME,
      }),
    );
  });

  it('sends the answers and the user’s own today, not the server’s', async () => {
    ok(proposal());

    await service.propose({ userId: 'u1', answers, guardrails });

    const sent = JSON.parse(gateway.invoke.mock.calls[0][0].input);

    expect(sent.timezone).toBe('America/Costa_Rica');
    expect(sent.today).toBe('2026-09-07');
    expect(sent.answers.obstacles).toEqual(['PROCRASTINATE']);
    expect(sent.reduceLoad).toBeUndefined();
  });

  it('asks for a smaller plan only when it is given one to shrink', async () => {
    ok({ ...proposal(), reducedFromRequest: true });

    await service.propose({
      userId: 'u1',
      answers,
      guardrails,
      previousProposal: proposal(),
    });

    const call = gateway.invoke.mock.calls[0][0];

    expect(call.instructions).toContain('Make it smaller');
    expect(JSON.parse(call.input).reduceLoad).toBe(true);
    expect(JSON.parse(call.input).previousProposal).toBeDefined();
  });

  it('turns a missing key into the one AI failure the user can fix', async () => {
    fail('no_user_key');

    await expect(service.propose({ userId: 'u1', answers, guardrails })).rejects.toBeInstanceOf(
      AiKeyRequiredException,
    );
  });

  it('turns a timeout into a retryable 503', async () => {
    fail('timeout');

    const error = await service.propose({ userId: 'u1', answers, guardrails }).catch((e) => e);

    expect(error.getStatus()).toBe(503);
    expect(error.getResponse().details).toEqual({
      reason: 'AI_UNAVAILABLE',
      code: 'timeout',
      retryable: true,
    });
  });

  it('marks a disabled provider as not worth retrying', async () => {
    fail('ai_disabled');

    const error = await service.propose({ userId: 'u1', answers, guardrails }).catch((e) => e);

    expect(error.getResponse().details.retryable).toBe(false);
  });

  it('discards a well-formed plan that breaks a guardrail, rather than correcting it', async () => {
    const tooBig = proposal();
    tooBig.routines = [...tooBig.routines, { ...tooBig.routines[0], title: 'A fourth' }].slice(0, 3);
    // Three routines is legal; a fourth outcome in an unselected domain is not.
    tooBig.outcomes = [...tooBig.outcomes, { ...tooBig.outcomes[0], title: 'Another work one' }];

    ok(tooBig);

    const error = await service.propose({ userId: 'u1', answers, guardrails }).catch((e) => e);

    expect(error.getStatus()).toBe(503);
    expect(error.getResponse().details.code).toBe('schema');
  });
});
