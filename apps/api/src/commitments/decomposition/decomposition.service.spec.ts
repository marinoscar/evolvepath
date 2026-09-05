import { Test, TestingModule } from '@nestjs/testing';

import { AiGatewayService } from '../../ai/gateway/ai-gateway.service';
import { UserProfileService } from '../../user-profile/user-profile.service';
import {
  buildDecompositionInstructions,
  DECOMPOSITION_PROMPT_VERSION,
  DecompositionService,
} from './decomposition.service';
import { decompositionProposalSchema } from './decomposition.schema';

describe('DecompositionService (#40)', () => {
  let service: DecompositionService;
  let ai: { invoke: jest.Mock };
  let userProfile: { find: jest.Mock };

  const userId = 'user-123';

  const commitment = (over: Record<string, unknown> = {}) =>
    ({
      id: 'c1',
      userId,
      domain: 'WORK',
      title: 'Draft the proposal storyline',
      scheduledStart: new Date('2026-03-01T09:00:00.000Z'),
      scheduledEnd: null,
      fullVersion: null,
      shortVersion: null,
      minimumVersion: null,
      fullMinutes: 25,
      shortMinutes: null,
      minimumMinutes: null,
      rescheduleCount: 2,
      outcome: { motivation: 'Free my evenings' },
      ...over,
    }) as never;

  const aiProposal = {
    steps: [{ title: 'Open the doc', minutes: 5 }],
    firstStep: { title: 'Open the doc', minutes: 5 },
    message: 'Just open it.',
    source: 'ai' as const,
  };

  beforeEach(async () => {
    ai = { invoke: jest.fn() };
    userProfile = { find: jest.fn().mockResolvedValue({ coachingStyle: 'BALANCED' }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DecompositionService,
        { provide: AiGatewayService, useValue: ai },
        { provide: UserProfileService, useValue: userProfile },
      ],
    }).compile();

    service = module.get(DecompositionService);
  });

  it('asks the coach persona with the versioned prompt and the strict schema', async () => {
    ai.invoke.mockResolvedValue({ ok: true, output: aiProposal, invocationId: 'inv-1' });

    await service.propose(userId, commitment(), 'only ten minutes');

    expect(ai.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        persona: 'coach',
        userId,
        promptVersion: DECOMPOSITION_PROMPT_VERSION,
        schema: decompositionProposalSchema,
        schemaName: 'decomposition_proposal',
      }),
    );
  });

  it('gives the coach the signals that explain why it has not happened', async () => {
    ai.invoke.mockResolvedValue({ ok: true, output: aiProposal, invocationId: 'inv-1' });

    await service.propose(userId, commitment(), 'only ten minutes');

    const input = JSON.parse(ai.invoke.mock.calls[0][0].input);
    expect(input).toMatchObject({
      title: 'Draft the proposal storyline',
      domain: 'WORK',
      rescheduleCount: 2,
      whyItMatters: 'Free my evenings',
      hint: 'only ten minutes',
    });
    expect(input.versions.full).toEqual({
      title: 'Draft the proposal storyline',
      minutes: 25,
    });
  });

  // PRD §120: the deterministic path must keep working.
  it.each(['no_user_key', 'ai_disabled', 'provider_error', 'timeout'])(
    'returns the template proposal with HTTP-safe output for error code %s',
    async (code) => {
      ai.invoke.mockResolvedValue({ ok: false, error: { code, message: 'nope' }, invocationId: 'i' });

      const proposal = await service.propose(userId, commitment(), null);

      expect(proposal.source).toBe('template');
      expect(proposal.firstStep.minutes).toBe(5);
      expect(decompositionProposalSchema.safeParse(proposal).success).toBe(true);
    },
  );

  // A model that answered "template" would make an AI proposal look like a
  // fallback in telemetry.
  it('stamps source from the server, not from the model', async () => {
    ai.invoke.mockResolvedValue({
      ok: true,
      output: { ...aiProposal, source: 'template' },
      invocationId: 'inv-1',
    });

    await expect(service.propose(userId, commitment(), null)).resolves.toMatchObject({
      source: 'ai',
    });
  });

  describe('coaching style', () => {
    it('changes the instructions per stored style', () => {
      const gentle = buildDecompositionInstructions('GENTLE');
      const direct = buildDecompositionInstructions('DIRECT');

      expect(gentle).not.toBe(direct);
      expect(gentle).toContain('warm');
      expect(direct).toContain('brief');
    });

    it('falls back to BALANCED for a user with no profile row', async () => {
      userProfile.find.mockResolvedValue(null);
      ai.invoke.mockResolvedValue({ ok: true, output: aiProposal, invocationId: 'inv-1' });

      await service.propose(userId, commitment(), null);

      expect(ai.invoke.mock.calls[0][0].instructions).toBe(
        buildDecompositionInstructions('BALANCED'),
      );
    });

    it('always states the size bounds, whatever the style', () => {
      for (const style of ['GENTLE', 'BALANCED', 'DIRECT']) {
        const instructions = buildDecompositionInstructions(style);
        expect(instructions).toContain('3 to 5');
        expect(instructions).toContain('10 minutes or less');
      }
    });
  });
});
