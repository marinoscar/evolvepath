import { validProposal } from './__fixtures__/proposal.fixture';
import { workoutProgramProposalSchema } from './workout-program.schema';

// The four ways a syntactically perfect program is still nonsense. Each of them
// is something a model produces occasionally and a user would otherwise have to
// notice on our behalf.
describe('workoutProgramProposalSchema', () => {
  it('accepts a well-formed proposal', () => {
    expect(workoutProgramProposalSchema.safeParse(validProposal()).success).toBe(true);
  });

  it('rejects a FULL template with no SHORT sibling', () => {
    const proposal = validProposal();
    proposal.templates = proposal.templates.filter(
      (t) => !(t.name === 'Upper A' && t.variant === 'SHORT'),
    );

    const result = workoutProgramProposalSchema.safeParse(proposal);

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('has no SHORT version');
  });

  it('rejects a FULL template with no MINIMUM sibling', () => {
    const proposal = validProposal();
    proposal.templates = proposal.templates.filter(
      (t) => !(t.name === 'Lower A' && t.variant === 'MINIMUM'),
    );

    expect(workoutProgramProposalSchema.safeParse(proposal).success).toBe(false);
  });

  it('rejects the same weekday scheduled twice', () => {
    const proposal = validProposal({
      weeklyStructure: [
        { weekday: 1, templateName: 'Upper A' },
        { weekday: 1, templateName: 'Lower A' },
      ],
    });

    const result = workoutProgramProposalSchema.safeParse(proposal);

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('scheduled twice');
  });

  it('rejects repMin above repMax', () => {
    const proposal = validProposal();
    proposal.templates[0].exercises[0].repMin = 15;
    proposal.templates[0].exercises[0].repMax = 8;

    const result = workoutProgramProposalSchema.safeParse(proposal);

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('is above repMax');
  });

  it('rejects a training day naming a template that is not FULL', () => {
    const proposal = validProposal({
      weeklyStructure: [
        { weekday: 1, templateName: 'Upper A' },
        { weekday: 4, templateName: 'Not A Workout' },
      ],
    });

    const result = workoutProgramProposalSchema.safeParse(proposal);

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('is not a FULL template');
  });
});
