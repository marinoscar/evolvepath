import { decompositionProposalSchema, templateProposal } from './decomposition.schema';

const valid = {
  steps: [
    { title: 'Open the doc', minutes: 5 },
    { title: 'Write the decision statement', minutes: 10 },
  ],
  firstStep: { title: 'Open the doc', minutes: 5 },
  message: 'Start by opening the doc.',
  source: 'ai' as const,
};

describe('decompositionProposalSchema (#40)', () => {
  it('accepts a well-formed proposal', () => {
    expect(decompositionProposalSchema.parse(valid)).toEqual(valid);
  });

  // A decomposition that needs six steps is a plan, and PRD §15 says a plan
  // change needs the user's approval through the plan editor, not a coach reply.
  it('rejects six steps', () => {
    const steps = Array.from({ length: 6 }, (_, i) => ({ title: `Step ${i}`, minutes: 5 }));

    expect(decompositionProposalSchema.safeParse({ ...valid, steps }).success).toBe(false);
  });

  it('rejects an empty step list', () => {
    expect(decompositionProposalSchema.safeParse({ ...valid, steps: [] }).success).toBe(false);
  });

  // The whole purpose of this flow is to make starting cheap; a 20-minute first
  // step has reproduced the problem the user asked for help with.
  it('rejects a first step longer than fifteen minutes', () => {
    expect(
      decompositionProposalSchema.safeParse({
        ...valid,
        firstStep: { title: 'Open the doc', minutes: 20 },
      }).success,
    ).toBe(false);
  });

  it('rejects an empty step title', () => {
    expect(
      decompositionProposalSchema.safeParse({
        ...valid,
        steps: [{ title: '', minutes: 5 }],
      }).success,
    ).toBe(false);
  });

  it('rejects a zero-minute step', () => {
    expect(
      decompositionProposalSchema.safeParse({
        ...valid,
        steps: [{ title: 'Open the doc', minutes: 0 }],
      }).success,
    ).toBe(false);
  });

  it('rejects a source it did not produce', () => {
    expect(decompositionProposalSchema.safeParse({ ...valid, source: 'guess' }).success).toBe(
      false,
    );
  });
});

describe('templateProposal (#40)', () => {
  it('is itself a valid proposal — the fallback goes through the same contract', () => {
    expect(decompositionProposalSchema.safeParse(templateProposal()).success).toBe(true);
  });

  it('offers a real first move rather than an apology', () => {
    const proposal = templateProposal();

    expect(proposal.source).toBe('template');
    expect(proposal.firstStep.minutes).toBe(5);
    expect(proposal.message).toContain('5 minutes');
  });
});
