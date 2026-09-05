import { Test } from '@nestjs/testing';

import { AiGatewayService } from '../../ai/gateway/ai-gateway.service';
import { SafetyPolicyService } from '../../coach/safety/safety-policy.service';
import type { SafetyDecision } from '../../coach/safety/safety.types';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService } from '../../../test/mocks/prisma.mock';
import { ExerciseResolverService } from '../exercises/exercise-resolver.service';
import type { GenerateProgramRequest } from '../dto/workout-program.dtos';
import { validProposal } from './__fixtures__/proposal.fixture';
import { WorkoutProgramGeneratorService } from './workout-program-generator.service';

// =============================================================================
// Every branch of "what happens when the model does not cooperate" (issue #77)
//
// The one that matters most is the LAST one: a proposal that parsed perfectly
// and is still unsafe. A schema cannot catch it, and it is the whole reason
// `workout-program-rules.ts` exists.
// =============================================================================

const ALLOW: SafetyDecision = { decision: 'allow', category: 'none', source: 'precheck' };

const REQUEST: GenerateProgramRequest = {
  goal: 'Get stronger and look better',
  experience: 'BEGINNER',
  daysPerWeek: 2,
  minutesPerSession: 45,
  equipment: ['DUMBBELL', 'BENCH'],
};

describe('WorkoutProgramGeneratorService', () => {
  const userId = 'user-1';
  let prisma: ReturnType<typeof createMockPrismaService>;
  let ai: { invoke: jest.Mock };
  let safety: { evaluate: jest.Mock };
  let resolver: { resolveMany: jest.Mock; visibleWhere: jest.Mock };
  let service: WorkoutProgramGeneratorService;

  /**
   * The catalog rows both reads see: the prompt's movement list and the map the
   * rules intersect limitations against. One stub, because the service asks the
   * same table twice with different `select`s.
   */
  function catalogIs(rows: Array<{ nameKey: string; contraindicationTags: string[] }>) {
    prisma.exercise.findMany.mockResolvedValue(
      rows.map((row) => ({
        ...row,
        name: row.nameKey,
        equipment: ['DUMBBELL'],
        substitutionGroup: 'horizontal_push',
      })) as never,
    );
  }

  beforeEach(async () => {
    prisma = createMockPrismaService();
    ai = { invoke: jest.fn() };
    safety = { evaluate: jest.fn().mockResolvedValue(ALLOW) };
    resolver = {
      resolveMany: jest.fn().mockResolvedValue(new Map()),
      visibleWhere: jest.fn().mockReturnValue({}),
    };

    // Persistence is not what these specs are about; the transaction returns a
    // stand-in program so every branch can be asserted on its decision.
    prisma.$transaction.mockImplementation((async (fn: any) => fn(prisma)) as never);
    prisma.workoutProgram.create.mockResolvedValue({ id: 'program-1' } as never);
    prisma.workoutProgram.update.mockResolvedValue({
      id: 'program-1',
      templates: [],
    } as never);
    prisma.workoutTemplate.create.mockResolvedValue({ id: 'template-1' } as never);
    prisma.auditEvent.create.mockResolvedValue({} as never);
    catalogIs([]);

    const module = await Test.createTestingModule({
      providers: [
        WorkoutProgramGeneratorService,
        { provide: PrismaService, useValue: prisma },
        { provide: AiGatewayService, useValue: ai },
        { provide: SafetyPolicyService, useValue: safety },
        { provide: ExerciseResolverService, useValue: resolver },
      ],
    }).compile();

    service = module.get(WorkoutProgramGeneratorService);
  });

  function lastAudit(): Record<string, unknown> {
    const calls = prisma.auditEvent.create.mock.calls;
    return (calls[calls.length - 1][0].data as { meta: Record<string, unknown> }).meta;
  }

  it('never calls the model when the safety pre-check says redirect', async () => {
    safety.evaluate.mockResolvedValue({
      decision: 'redirect',
      category: 'injury',
      source: 'precheck',
      userFacingNote: 'Please speak to a professional about that.',
    });

    const result = await service.generate(userId, REQUEST);

    expect(ai.invoke).not.toHaveBeenCalled();
    expect(result.source).toBe('starter');
    expect(result.reason).toBe('safety_redirect');
    expect(result.message).toBe('Please speak to a professional about that.');
  });

  it('appends the conservative instructions rather than refusing', async () => {
    safety.evaluate.mockResolvedValue({
      decision: 'conservative',
      category: 'injury',
      source: 'model',
    });
    ai.invoke.mockResolvedValue({
      ok: true,
      invocationId: 'inv-1',
      output: validProposal(),
      usage: {},
      model: 'x',
      latencyMs: 1,
    });

    await service.generate(userId, REQUEST);

    expect(ai.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: expect.stringContaining('lower the total volume'),
        safetyDecision: expect.objectContaining({ decision: 'conservative' }),
      }),
    );
  });

  it('raises 412 when the caller has no key — that is theirs to fix', async () => {
    ai.invoke.mockResolvedValue({
      ok: false,
      invocationId: 'inv-2',
      error: { code: 'no_user_key', message: 'no key' },
      model: null,
      latencyMs: 1,
    });

    await expect(service.generate(userId, REQUEST)).rejects.toMatchObject({ status: 412 });
  });

  it('falls back to the starter for any other provider failure', async () => {
    ai.invoke.mockResolvedValue({
      ok: false,
      invocationId: 'inv-3',
      error: { code: 'timeout', message: 'took too long' },
      model: null,
      latencyMs: 1,
    });

    const result = await service.generate(userId, REQUEST);

    expect(result.source).toBe('starter');
    expect(result.reason).toBe('ai_unavailable');
    expect(lastAudit()).toMatchObject({ source: 'starter', reason: 'ai_unavailable' });
  });

  it('rejects a well-formed proposal that breaks a safety rule, and says which', async () => {
    catalogIs([{ nameKey: 'dumbbell bench press', contraindicationTags: ['shoulder'] }]);
    ai.invoke.mockResolvedValue({
      ok: true,
      invocationId: 'inv-4',
      output: validProposal(),
      usage: {},
      model: 'x',
      latencyMs: 1,
    });

    const result = await service.generate(userId, {
      ...REQUEST,
      limitations: 'torn rotator cuff, shoulder still bad',
    });

    expect(result.source).toBe('starter');
    expect(result.reason).toBe('invalid_output');
    expect(lastAudit().violations).toEqual(
      expect.arrayContaining([{ code: 'CONTRAINDICATED', subject: 'Dumbbell Bench Press' }]),
    );
  });

  it('leaves no custom exercise rows behind for a proposal it rejects', async () => {
    catalogIs([{ nameKey: 'dumbbell bench press', contraindicationTags: ['shoulder'] }]);
    ai.invoke.mockResolvedValue({
      ok: true,
      invocationId: 'inv-5',
      output: validProposal(),
      usage: {},
      model: 'x',
      latencyMs: 1,
    });

    await service.generate(userId, { ...REQUEST, limitations: 'bad shoulder' });

    // The starter persists and resolves ITS names — once. The rejected
    // proposal's movements never reach the resolver at all, which is what keeps
    // a discarded draft from leaving custom exercise rows behind.
    expect(resolver.resolveMany).toHaveBeenCalledTimes(1);
    expect(prisma.workoutProgram.create).toHaveBeenCalledTimes(1);
    expect(prisma.workoutProgram.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'Starter Full Body' }) }),
    );
  });

  it('calls the gateway with the persona, prompt version and schema name it must', async () => {
    ai.invoke.mockResolvedValue({
      ok: true,
      invocationId: 'inv-6',
      output: validProposal(),
      usage: {},
      model: 'x',
      latencyMs: 1,
    });

    const result = await service.generate(userId, REQUEST);

    expect(ai.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        persona: 'workout_programmer',
        promptVersion: 'workout_programmer.v1',
        schemaName: 'workout_program',
        userId,
      }),
    );
    expect(result.source).toBe('ai');
    expect(result.reason).toBeNull();
  });

  it('skips the model entirely when the user asked for the starter', async () => {
    const result = await service.generate(userId, { ...REQUEST, useStarter: true });

    expect(safety.evaluate).not.toHaveBeenCalled();
    expect(ai.invoke).not.toHaveBeenCalled();
    expect(result.reason).toBe('requested');
  });
});
