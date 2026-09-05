import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { buildDatabaseUrl } from '../../src/common/database-url';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { AiGatewayService } from '../../src/ai/gateway/ai-gateway.service';
import { ProposalsService } from '../../src/coach/proposals/proposals.service';
import { OutcomesService } from '../../src/path/outcomes/outcomes.service';
import { PlansService } from '../../src/path/plans/plans.service';
import { PlanVersionsService } from '../../src/path/plans/plan-versions.service';
import { UserProfileService } from '../../src/user-profile/user-profile.service';
import { ExerciseResolverService } from '../../src/workouts/exercises/exercise-resolver.service';
import { WorkoutProgramGeneratorService } from '../../src/workouts/programs/workout-program-generator.service';
import { WorkoutProgramsService } from '../../src/workouts/programs/workout-programs.service';
import { WorkoutAdaptationService } from '../../src/workouts/adaptation/workout-adaptation.service';
import { WorkoutProposalEffect } from '../../src/workouts/adaptation/workout-proposal-effects';
import { validProposal } from '../../src/workouts/programs/__fixtures__/proposal.fixture';
import { seedExercises } from '../../prisma/exercise-catalog';

// =============================================================================
// Adaptation, end to end, against a real database (issue #88, epic E09)
// =============================================================================
//
// The claim this suite exists to settle is PRD §15's, and it is a claim about a
// write that does NOT happen: the detector produces a proposal and changes
// nothing. Counting the workout tables around a run is the only assertion that
// would notice a helpful `update` somebody adds to the detector later.
//
// The other one is the accept path, where three things have to move together —
// the routine on the new plan version (E06), the template's own minutes, and
// the 1:1 `routine_id` link, which would otherwise point at a routine on a
// version nothing schedules any more.
// =============================================================================

const hasDatabase = Boolean(process.env.POSTGRES_HOST ?? process.env.DATABASE_URL);
const describeWithDb = hasDatabase ? describe : describe.skip;

const REQUEST = {
  goal: 'Get stronger',
  experience: 'BEGINNER' as const,
  daysPerWeek: 2,
  minutesPerSession: 45,
  equipment: ['DUMBBELL', 'BENCH'] as Array<'DUMBBELL' | 'BENCH'>,
};

describeWithDb('Workout adaptation (integration, real DB)', () => {
  let prisma: PrismaClient;
  let generator: WorkoutProgramGeneratorService;
  let programs: WorkoutProgramsService;
  let proposals: ProposalsService;
  let adaptation: WorkoutAdaptationService;
  let ai: { invoke: jest.Mock };
  let notify: jest.Mock;
  const seededUserIds: string[] = [];

  async function createUser(): Promise<string> {
    const user = await prisma.user.create({
      data: { email: `adaptation-${randomBytes(6).toString('hex')}@example.test` },
    });
    seededUserIds.push(user.id);

    await prisma.userProfile.create({
      data: { userId: user.id, timezone: 'UTC', onboardingCompletedAt: new Date() },
    });

    return user.id;
  }

  async function approvedProgram(userId: string) {
    ai.invoke.mockResolvedValue({
      ok: true,
      invocationId: randomBytes(8).toString('hex'),
      output: validProposal(),
      usage: {},
      model: 'gpt-test',
      latencyMs: 1,
    });

    const draft = await generator.generate(userId, REQUEST);
    const approved = await programs.approve(userId, draft.program.id, {
      startDate: '2026-09-07',
    });

    const upper = await prisma.workoutTemplate.findFirstOrThrow({
      where: { programId: draft.program.id, name: 'Upper A', variant: 'FULL' },
      include: { exercises: true },
    });

    return { programId: draft.program.id, upper, planVersionId: approved.planVersionId };
  }

  /** Two skipped days for one template inside the window. */
  async function skipTwice(userId: string, templateId: string) {
    const commitments = await prisma.commitment.findMany({
      where: { userId, workoutTemplateId: templateId },
      orderBy: { scheduledStart: 'asc' },
      take: 2,
    });

    await prisma.commitment.updateMany({
      where: { id: { in: commitments.map((row) => row.id) } },
      data: { status: 'SKIPPED', skipReason: 'NO_TIME', scheduledStart: new Date() },
    });
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg(buildDatabaseUrl()) });
    await prisma.$connect();
    await seedExercises(prisma);

    const service = prisma as unknown as PrismaService;
    ai = { invoke: jest.fn() };
    notify = jest.fn(async () => undefined);

    const versions = new PlanVersionsService(
      service,
      new PlansService(service, new OutcomesService(service)),
    );

    proposals = new ProposalsService(service, versions, [new WorkoutProposalEffect()]);
    generator = new WorkoutProgramGeneratorService(
      service,
      ai as unknown as AiGatewayService,
      {
        evaluate: async () => ({ decision: 'allow', category: 'none', source: 'precheck' }),
      } as never,
      new ExerciseResolverService(service),
    );
    programs = new WorkoutProgramsService(service, versions, new UserProfileService(service), {
      notify: async () => undefined,
    } as never);
    adaptation = new WorkoutAdaptationService(service, proposals, { notify } as never);
  });

  afterAll(async () => {
    if (seededUserIds.length > 0) {
      await prisma.auditEvent.deleteMany({ where: { actorUserId: { in: seededUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: seededUserIds } } });
      await prisma.exercise.deleteMany({ where: { scope: { in: seededUserIds } } });
    }
    await prisma.$disconnect();
  });

  beforeEach(() => {
    notify.mockClear();
  });

  it('raises one proposal for a template skipped twice, and changes nothing', async () => {
    const userId = await createUser();
    const { upper } = await approvedProgram(userId);
    await skipTwice(userId, upper.id);

    const before = await prisma.workoutTemplate.findUniqueOrThrow({ where: { id: upper.id } });
    const versionsBefore = await prisma.planVersion.count({ where: { userId } });

    const result = await adaptation.run(userId);

    expect(result.created).toBe(1);

    const proposal = await prisma.planChangeProposal.findUniqueOrThrow({
      where: { id: result.proposalIds[0] },
    });
    expect(proposal).toMatchObject({ sourceKind: 'WORKOUT', status: 'PROPOSED' });
    expect((proposal.changes as Array<{ op: string }>)[0].op).toBe('reduce');

    // The detector proposed. It did not act.
    await expect(
      prisma.workoutTemplate.findUniqueOrThrow({ where: { id: upper.id } }),
    ).resolves.toMatchObject({ targetMinutes: before.targetMinutes });
    expect(await prisma.planVersion.count({ where: { userId } })).toBe(versionsBefore);

    expect(notify).toHaveBeenCalledWith(
      'plan.proposal_created',
      userId,
      expect.objectContaining({ proposalId: proposal.id }),
    );

    const audit = await prisma.auditEvent.findFirst({
      where: { actorUserId: userId, action: 'workout_adaptation:propose' },
    });
    expect(audit?.meta).toMatchObject({ detector: 'SKIPPED_TWICE' });
  });

  it('does not raise a second proposal about the same workout in the same fortnight', async () => {
    const userId = await createUser();
    const { upper } = await approvedProgram(userId);
    await skipTwice(userId, upper.id);

    await adaptation.run(userId);
    const second = await adaptation.run(userId);

    expect(second.created).toBe(0);
  });

  it('applies the change to the plan, the template and the future days on accept', async () => {
    const userId = await createUser();
    const { upper } = await approvedProgram(userId);
    await skipTwice(userId, upper.id);

    const { proposalIds } = await adaptation.run(userId);
    const accepted = await proposals.accept(userId, proposalIds[0]);

    // 65% of 40, to the nearest five.
    const template = await prisma.workoutTemplate.findUniqueOrThrow({ where: { id: upper.id } });
    expect(template.targetMinutes).toBe(25);

    const routine = await prisma.routine.findFirstOrThrow({
      where: { planVersionId: accepted.planVersion.id, title: 'Upper A' },
    });
    expect(routine.estimatedDurationMin).toBe(25);

    // The 1:1 link followed the new version. Without this the next run would
    // target a routine nothing schedules.
    expect(template.routineId).toBe(routine.id);

    const future = await prisma.commitment.findMany({
      where: { userId, workoutTemplateId: upper.id, status: 'PLANNED' },
    });
    expect(future.every((row) => row.fullMinutes === 25)).toBe(true);

    const audit = await prisma.auditEvent.findFirst({
      where: { actorUserId: userId, action: 'workout_adaptation:applied' },
    });
    expect(audit).not.toBeNull();
  });

  it('changes nothing when the proposal is rejected', async () => {
    const userId = await createUser();
    const { upper } = await approvedProgram(userId);
    await skipTwice(userId, upper.id);

    const { proposalIds } = await adaptation.run(userId);
    await proposals.reject(userId, proposalIds[0], 'I like it long');

    await expect(
      prisma.workoutTemplate.findUniqueOrThrow({ where: { id: upper.id } }),
    ).resolves.toMatchObject({ targetMinutes: 40 });
  });

  it('swaps a disliked movement on the full and the short version when accepted', async () => {
    const userId = await createUser();
    const { upper } = await approvedProgram(userId);
    const prescription = upper.exercises[0];

    await adaptation.setDisliked(userId, upper.id, prescription.id, true);

    const { created, proposalIds } = await adaptation.run(userId);
    expect(created).toBe(1);

    const proposal = await prisma.planChangeProposal.findUniqueOrThrow({
      where: { id: proposalIds[0] },
    });
    const change = (proposal.changes as Array<{
      op: string;
      workout?: { replaceExercise?: { alternativeExerciseId: string } };
    }>)[0];
    expect(change.op).toBe('replace');

    const alternativeId = change.workout!.replaceExercise!.alternativeExerciseId;

    await proposals.accept(userId, proposal.id);

    await expect(
      prisma.workoutTemplateExercise.findUniqueOrThrow({ where: { id: prescription.id } }),
    ).resolves.toMatchObject({ exerciseId: alternativeId, dislikedAt: null });

    // The short version prescribes the same first movement, and a swap that
    // only applies on good days is not a swap.
    const short = await prisma.workoutTemplateExercise.findMany({
      where: { template: { fallbackOfTemplateId: upper.id }, exerciseId: alternativeId },
    });
    expect(short.length).toBeGreaterThan(0);
  });

  it('filters proposals by the service that raised them', async () => {
    const userId = await createUser();
    const { upper } = await approvedProgram(userId);
    await skipTwice(userId, upper.id);
    await adaptation.run(userId);

    const workout = await proposals.list(userId, { sourceKind: 'WORKOUT' });
    const coach = await proposals.list(userId, { sourceKind: 'COACH' });

    expect(workout).toHaveLength(1);
    expect(coach).toHaveLength(0);
  });

  it('says nothing for a user with no active program', async () => {
    const userId = await createUser();

    await expect(adaptation.run(userId)).resolves.toEqual({ created: 0, proposalIds: [] });
  });

  it('explains what a run would do without creating anything', async () => {
    const userId = await createUser();
    const { upper } = await approvedProgram(userId);
    await skipTwice(userId, upper.id);

    const candidates = await adaptation.candidates(userId);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].detector).toBe('SKIPPED_TWICE');
    expect(await prisma.planChangeProposal.count({ where: { userId } })).toBe(0);
  });

  it('records a dislike as a timestamp and clears it on request', async () => {
    const userId = await createUser();
    const { upper } = await approvedProgram(userId);
    const prescription = upper.exercises[0];

    const set = await adaptation.setDisliked(userId, upper.id, prescription.id, true);
    expect(set.dislikedAt).not.toBeNull();

    const cleared = await adaptation.setDisliked(userId, upper.id, prescription.id, false);
    expect(cleared.dislikedAt).toBeNull();
  });

  it('answers 404 for another user\'s prescribed exercise', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const { upper } = await approvedProgram(owner);

    await expect(
      adaptation.setDisliked(stranger, upper.id, upper.exercises[0].id, true),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('proposes an equipment substitution through the same protocol', async () => {
    const userId = await createUser();
    const { upper } = await approvedProgram(userId);
    const alternative = await prisma.exercise.findFirstOrThrow({
      where: { nameKey: 'push-up' },
    });

    const result = await adaptation.proposeSubstitution(
      userId,
      upper.id,
      [
        {
          templateExerciseId: upper.exercises[0].id,
          alternativeExerciseId: alternative.id,
        },
      ],
      'a bench',
    );

    expect(result.created).toBe(1);

    const proposal = await prisma.planChangeProposal.findUniqueOrThrow({
      where: { id: result.proposalIds[0] },
    });
    expect(proposal.sourceKind).toBe('WORKOUT');
    expect((proposal.changes as Array<{ reason: string }>)[0].reason).toBe('No a bench available.');
  });
});
