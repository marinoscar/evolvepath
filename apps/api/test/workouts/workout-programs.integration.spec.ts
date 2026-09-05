import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';

import { buildDatabaseUrl } from '../../src/common/database-url';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { PlansService } from '../../src/path/plans/plans.service';
import { PlanVersionsService } from '../../src/path/plans/plan-versions.service';
import { OutcomesService } from '../../src/path/outcomes/outcomes.service';
import { UserProfileService } from '../../src/user-profile/user-profile.service';
import { ExerciseResolverService } from '../../src/workouts/exercises/exercise-resolver.service';
import { WorkoutProgramGeneratorService } from '../../src/workouts/programs/workout-program-generator.service';
import { WorkoutProgramsService } from '../../src/workouts/programs/workout-programs.service';
import { validProposal } from '../../src/workouts/programs/__fixtures__/proposal.fixture';
import { seedExercises } from '../../prisma/exercise-catalog';
import { closeTestApp, createTestApp, TestContext } from '../helpers/test-app.helper';

// =============================================================================
// Generating and approving a program, against a real database (issue #77)
// =============================================================================
//
// The three claims that only a real transaction can settle:
//
//   1. GENERATION WRITES NOTHING BUT `workout_programs`. PRD §15 says AI output
//      becomes a plan only when a human approves it, and the way that promise
//      dies is a helpful `create` somebody adds to the generator later. Counting
//      `plans`, `plan_versions`, `routines` and `commitments` around a generate
//      is the only assertion that would notice.
//   2. APPROVE IS ONE TRANSACTION with five parts, and the part most likely to
//      be quietly wrong is the 1:1 `workout_templates.routine_id` link — it is
//      stitched after a `createMany` that cannot return ids.
//   3. THE FALLBACK IS APPROVABLE. A starter program the user cannot actually
//      start is not a fallback (PRD §120).
// =============================================================================

const hasDatabase = Boolean(process.env.POSTGRES_HOST ?? process.env.DATABASE_URL);
const describeWithDb = hasDatabase ? describe : describe.skip;

const TZ = 'America/Costa_Rica';

const REQUEST = {
  goal: 'Get stronger and look better',
  experience: 'BEGINNER' as const,
  daysPerWeek: 2,
  minutesPerSession: 45,
  equipment: ['DUMBBELL', 'BENCH'] as Array<'DUMBBELL' | 'BENCH'>,
};

describe('Workouts routes are authenticated', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestApp();
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  it.each([
    ['get', '/api/workouts/programs'],
    ['get', '/api/workouts/exercises'],
  ])('%s %s answers 401 without a token', async (method, path) => {
    await request(context.app.getHttpServer())
      [method as 'get'](path)
      .expect(401);
  });

  it('POST /api/workouts/programs/generate answers 401 without a token', async () => {
    await request(context.app.getHttpServer())
      .post('/api/workouts/programs/generate')
      .send(REQUEST)
      .expect(401);
  });
});

describeWithDb('Workout programs (integration, real DB)', () => {
  let prisma: PrismaClient;
  let generator: WorkoutProgramGeneratorService;
  let programs: WorkoutProgramsService;
  let ai: { invoke: jest.Mock };
  let safety: { evaluate: jest.Mock };
  let notifications: { notify: jest.Mock };
  const seededUserIds: string[] = [];

  async function createUser(): Promise<string> {
    const user = await prisma.user.create({
      data: { email: `workouts-api-${randomBytes(6).toString('hex')}@example.test` },
    });
    seededUserIds.push(user.id);

    await prisma.userProfile.create({
      data: { userId: user.id, timezone: TZ, onboardingCompletedAt: new Date() },
    });

    return user.id;
  }

  function aiReturns(output: ReturnType<typeof validProposal>) {
    ai.invoke.mockResolvedValue({
      ok: true,
      invocationId: randomBytes(8).toString('hex'),
      output,
      usage: {},
      model: 'gpt-test',
      latencyMs: 5,
    });
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg(buildDatabaseUrl()) });
    await prisma.$connect();
    await seedExercises(prisma);

    const service = prisma as unknown as PrismaService;
    ai = { invoke: jest.fn() };
    safety = {
      evaluate: jest.fn().mockResolvedValue({
        decision: 'allow',
        category: 'none',
        source: 'precheck',
      }),
    };
    notifications = { notify: jest.fn(async () => undefined) };

    const resolver = new ExerciseResolverService(service);
    generator = new WorkoutProgramGeneratorService(
      service,
      ai as never,
      safety as never,
      resolver,
    );
    programs = new WorkoutProgramsService(
      service,
      new PlanVersionsService(service, new PlansService(service, new OutcomesService(service))),
      new UserProfileService(service),
      notifications as never,
    );
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
    notifications.notify.mockClear();
  });

  it('drafts a program and touches nothing else', async () => {
    const userId = await createUser();
    aiReturns(validProposal());

    const result = await generator.generate(userId, REQUEST);

    expect(result.source).toBe('ai');
    expect(result.program.status).toBe('DRAFT');
    // Two FULL days, each with a SHORT and a MINIMUM sibling.
    expect(result.program.templates).toHaveLength(6);

    expect(await prisma.plan.count({ where: { userId } })).toBe(0);
    expect(await prisma.planVersion.count({ where: { userId } })).toBe(0);
    expect(await prisma.routine.count({ where: { userId } })).toBe(0);
    expect(await prisma.commitment.count({ where: { userId } })).toBe(0);

    const audit = await prisma.auditEvent.findFirst({
      where: { actorUserId: userId, action: 'workout_program:generate' },
    });
    expect(audit?.meta).toMatchObject({ source: 'ai' });
  });

  it('resolves every prescribed movement to a real exercise row', async () => {
    const userId = await createUser();
    aiReturns(validProposal());

    const result = await generator.generate(userId, REQUEST);

    const rows = await prisma.workoutTemplateExercise.findMany({
      where: { template: { programId: result.program.id } },
      include: { exercise: { select: { name: true, scope: true } } },
    });

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.exercise.scope === 'catalog')).toBe(true);
  });

  it('creates a custom exercise, scoped to the user, for a movement nobody has heard of', async () => {
    const userId = await createUser();
    const proposal = validProposal();
    proposal.templates[0].exercises[0].exerciseName = 'Reformer Roll-Down';
    aiReturns(proposal);

    await generator.generate(userId, REQUEST);

    const custom = await prisma.exercise.findFirst({ where: { scope: userId } });

    expect(custom).toMatchObject({
      name: 'Reformer Roll-Down',
      isCustom: true,
      createdByUserId: userId,
      substitutionGroup: 'custom',
    });
  });

  it('approves a draft into a plan version, routines and fourteen days of sessions', async () => {
    const userId = await createUser();
    aiReturns(validProposal());
    const draft = await generator.generate(userId, REQUEST);

    const approved = await programs.approve(userId, draft.program.id, {
      startDate: '2026-09-07',
      preferredTime: '07:00',
    });

    expect(approved.program.status).toBe('ACTIVE');
    expect(approved.program.planId).not.toBeNull();

    const version = await prisma.planVersion.findUniqueOrThrow({
      where: { id: approved.planVersionId },
    });
    expect(version).toMatchObject({ status: 'ACTIVE', userApproved: true, createdBy: 'AI' });

    // One routine per FULL template, linked back 1:1.
    const templates = await prisma.workoutTemplate.findMany({
      where: { programId: draft.program.id, variant: 'FULL' },
    });
    expect(templates).toHaveLength(2);
    expect(templates.every((t) => t.routineId !== null)).toBe(true);

    const routines = await prisma.routine.findMany({ where: { planVersionId: version.id } });
    expect(routines).toHaveLength(2);
    expect(routines.map((r) => r.title).sort()).toEqual(['Lower A', 'Upper A']);

    // Monday and Thursday, over fourteen days from a Monday: 2 + 2.
    const commitments = await prisma.commitment.findMany({
      where: { userId },
      orderBy: { scheduledStart: 'asc' },
    });
    expect(commitments).toHaveLength(4);
    expect(commitments.every((c) => c.workoutTemplateId !== null)).toBe(true);
    expect(commitments[0]).toMatchObject({
      domain: 'HEALTH',
      status: 'PLANNED',
      title: 'Upper A',
    });
    // 07:00 in America/Costa_Rica (UTC-6) is 13:00 UTC.
    expect(commitments[0].scheduledStart.toISOString()).toBe('2026-09-07T13:00:00.000Z');
    // All three sizes travel with the commitment.
    expect(commitments[0].minimumMinutes).toBe(10);

    expect(notifications.notify).toHaveBeenCalledWith(
      'health.program_activated',
      userId,
      expect.objectContaining({ programName: 'Two-day upper/lower' }),
    );

    const audit = await prisma.auditEvent.findFirst({
      where: { actorUserId: userId, action: 'workout_program:approve' },
    });
    expect(audit?.meta).toMatchObject({ commitments: 4 });
  });

  it('refuses a second approve', async () => {
    const userId = await createUser();
    aiReturns(validProposal());
    const draft = await generator.generate(userId, REQUEST);

    await programs.approve(userId, draft.program.id, {});

    await expect(programs.approve(userId, draft.program.id, {})).rejects.toMatchObject({
      status: 409,
    });
  });

  it('archives the previous program and cancels its future days', async () => {
    const userId = await createUser();
    aiReturns(validProposal());
    const first = await generator.generate(userId, REQUEST);
    await programs.approve(userId, first.program.id, { startDate: '2099-01-05' });

    aiReturns(validProposal({ programName: 'Second program' }));
    const second = await generator.generate(userId, REQUEST);
    await programs.approve(userId, second.program.id, { startDate: '2099-01-05' });

    await expect(
      prisma.workoutProgram.findUnique({ where: { id: first.program.id } }),
    ).resolves.toMatchObject({ status: 'ARCHIVED' });

    const cancelled = await prisma.commitment.count({
      where: { userId, status: 'CANCELLED' },
    });
    expect(cancelled).toBeGreaterThan(0);
  });

  it('hands out an approvable starter program when the provider is down', async () => {
    const userId = await createUser();
    ai.invoke.mockResolvedValue({
      ok: false,
      invocationId: 'inv-down',
      error: { code: 'timeout', message: 'no answer' },
      model: null,
      latencyMs: 1,
    });

    const result = await generator.generate(userId, REQUEST);

    expect(result.source).toBe('starter');
    expect(result.reason).toBe('ai_unavailable');

    const approved = await programs.approve(userId, result.program.id, {
      startDate: '2026-09-07',
    });

    expect(approved.commitmentIds.length).toBeGreaterThan(0);
  });

  it('answers 404 for another user\'s program, never 403', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    aiReturns(validProposal());
    const draft = await generator.generate(owner, REQUEST);

    await expect(programs.get(stranger, draft.program.id)).rejects.toMatchObject({ status: 404 });
  });

  it('refuses to delete a live program', async () => {
    const userId = await createUser();
    aiReturns(validProposal());
    const draft = await generator.generate(userId, REQUEST);
    await programs.approve(userId, draft.program.id, {});

    await expect(programs.remove(userId, draft.program.id)).rejects.toMatchObject({ status: 409 });
  });

  it('deletes a draft', async () => {
    const userId = await createUser();
    aiReturns(validProposal());
    const draft = await generator.generate(userId, REQUEST);

    await programs.remove(userId, draft.program.id);

    await expect(
      prisma.workoutProgram.findUnique({ where: { id: draft.program.id } }),
    ).resolves.toBeNull();
  });
});
