import { onboardingProposalSchema } from './onboarding-proposal.schema';
import { buildTemplateProposal } from './onboarding-templates';
import { validateOnboardingProposal, type GuardrailContext } from './onboarding.guardrails';

// =============================================================================
// The first-Path contract (issue #101, epic E04)
// =============================================================================
//
// The schema says what SHAPE a proposal has; the guardrails say what a first
// Path may CONTAIN. Both are asserted here, together, because the interesting
// failures are the ones that pass one and fail the other — four routines is
// perfectly valid JSON and is the exact thing PRD §70 forbids.
// =============================================================================

// A Monday, 08:00 UTC.
const MONDAY = new Date('2026-09-07T08:00:00.000Z');

const ctx: GuardrailContext = {
  now: MONDAY,
  timezone: 'UTC',
  domains: ['WORK', 'FAMILY', 'HEALTH'],
  weekdayMinutes: 240,
};

const base = () =>
  buildTemplateProposal(
    {
      sixMonthVision: 'Stop wasting mornings, be present at dinner, get back in shape',
      domains: ['WORK', 'FAMILY', 'HEALTH'],
      weekdayMinutes: 45,
      healthBaseline: null,
    },
    MONDAY,
    'UTC',
  );

describe('onboardingProposalSchema', () => {
  it('accepts a complete proposal', () => {
    expect(onboardingProposalSchema.safeParse(base()).success).toBe(true);
  });

  it('rejects an identity statement too short to mean anything', () => {
    const proposal = base();
    proposal.bestSelf.identityStatement = 'nope';

    expect(onboardingProposalSchema.safeParse(proposal).success).toBe(false);
  });

  it('rejects more than three routines at the type level', () => {
    const proposal = base();
    proposal.routines = [...proposal.routines, { ...proposal.routines[0], title: 'A fourth' }];

    expect(onboardingProposalSchema.safeParse(proposal).success).toBe(false);
  });

  it('rejects a proposal with no commitments at all', () => {
    const proposal = base();
    proposal.firstWeekCommitments = [];

    expect(onboardingProposalSchema.safeParse(proposal).success).toBe(false);
  });
});

describe('validateOnboardingProposal', () => {
  it('passes a template built from the same answers', () => {
    expect(validateOnboardingProposal(base(), ctx)).toEqual([]);
  });

  it('names the cap when a fourth routine is added', () => {
    const proposal = base();
    proposal.routines = [
      ...proposal.routines,
      { ...proposal.routines[0], title: 'A fourth behaviour' },
    ];

    const rules = validateOnboardingProposal(proposal, ctx);

    expect(rules.join(' ')).toContain('at most 3 behaviours');
  });

  it('rejects two outcomes in one domain', () => {
    const proposal = base();
    proposal.outcomes = [...proposal.outcomes, { ...proposal.outcomes[0], title: 'Another' }];

    expect(validateOnboardingProposal(proposal, ctx).join(' ')).toContain('more than one WORK');
  });

  it('rejects an outcome in a domain the user did not select', () => {
    const rules = validateOnboardingProposal(base(), { ...ctx, domains: ['WORK'] });

    expect(rules.some((r) => r.includes('which you did not select'))).toBe(true);
  });

  it('rejects a minimum longer than the full version', () => {
    const proposal = base();
    proposal.routines[0].minimumMinutes = proposal.routines[0].idealMinutes + 5;

    expect(validateOnboardingProposal(proposal, ctx).join(' ')).toContain(
      'a minimum longer than its full version',
    );
  });

  it('rejects a commitment scheduled thirty days out', () => {
    const proposal = base();
    proposal.firstWeekCommitments[0].scheduledStart = new Date(
      MONDAY.getTime() + 30 * 24 * 3_600_000,
    ).toISOString();

    expect(validateOnboardingProposal(proposal, ctx).join(' ')).toContain(
      'outside your first week',
    );
  });

  it('rejects a day that asks for more minutes than the user has', () => {
    const proposal = base();
    const day = proposal.firstWeekCommitments[0].scheduledStart;

    // Three 60-minute commitments on one day against a 45-minute budget.
    proposal.firstWeekCommitments = proposal.firstWeekCommitments
      .slice(0, 3)
      .map((c) => ({ ...c, scheduledStart: day, durationMinutes: 60 }));

    const rules = validateOnboardingProposal(proposal, { ...ctx, weekdayMinutes: 45 });

    expect(rules.join(' ')).toContain('you said you have about 45');
  });

  it('has no opinion about the load when the user never answered', () => {
    const proposal = base();
    const day = proposal.firstWeekCommitments[0].scheduledStart;

    proposal.firstWeekCommitments = proposal.firstWeekCommitments
      .slice(0, 3)
      .map((c) => ({ ...c, scheduledStart: day, durationMinutes: 60 }));

    expect(validateOnboardingProposal(proposal, { ...ctx, weekdayMinutes: null })).toEqual([]);
  });
});
