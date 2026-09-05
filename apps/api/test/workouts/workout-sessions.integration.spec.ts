import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';

import { buildDatabaseUrl } from '../../src/common/database-url';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { AiGatewayService } from '../../src/ai/gateway/ai-gateway.service';
import { BehaviourLintService } from '../../src/family/behaviour-lint.service';
import { CommitmentsService } from '../../src/commitments/commitments.service';
import { CommitmentActionsService } from '../../src/commitments/actions/commitment-actions.service';
import { DecompositionService } from '../../src/commitments/decomposition/decomposition.service';
import { OutcomesService } from '../../src/path/outcomes/outcomes.service';
import { PlansService } from '../../src/path/plans/plans.service';
import { PlanVersionsService } from '../../src/path/plans/plan-versions.service';
import { UserProfileService } from '../../src/user-profile/user-profile.service';
import { ExerciseResolverService } from '../../src/workouts/exercises/exercise-resolver.service';
import { WorkoutProgramGeneratorService } from '../../src/workouts/programs/workout-program-generator.service';
import { WorkoutProgramsService } from '../../src/workouts/programs/workout-programs.service';
import { WorkoutSessionsService } from '../../src/workouts/sessions/workout-sessions.service';
import { ProgressionExplainerService } from '../../src/workouts/progression/progression-explainer.service';
import { PAIN_SAFETY_COPY } from '../../src/workouts/safety/workout-safety-copy';
import { validProposal } from '../../src/workouts/programs/__fixtures__/proposal.fixture';
import { seedExercises } from '../../prisma/exercise-catalog';
import { closeTestApp, createTestApp, TestContext } from '../helpers/test-app.helper';

// =============================================================================
// A workout, end to end, against a real database (issue #81, epic E09)
// =============================================================================
//
// The claims a mocked Prisma cannot settle, and every one of them is a promise
// to a user standing in a gym:
//
//   1. THE REPLAY IS IDEMPOTENT. PRD §121 has the phone re-sending a queue it
//      never got an answer for. One `client_id`, one row — and the guarantee is
//      the unique index, so only a real index can prove it.
//   2. "LAST TIME" ACTUALLY APPEARS NEXT SESSION (VISION §14, PRD §106). It is
//      a query across sessions, and it is the whole reason set logs are rows
//      rather than a blob on the session.
//   3. FINISHING SETTLES THE COMMITMENT through E05's actions, so the status,
//      the timer and both evidence rows agree.
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

describe('Workout session routes are authenticated', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestApp();
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  it('GET /api/workouts/sessions answers 401 without a token', async () => {
    await request(context.app.getHttpServer()).get('/api/workouts/sessions').expect(401);
  });

  it('POST /api/workouts/sessions answers 401 without a token', async () => {
    await request(context.app.getHttpServer())
      .post('/api/workouts/sessions')
      .send({ templateId: randomUUID() })
      .expect(401);
  });
});

describeWithDb('Workout sessions (integration, real DB)', () => {
  let prisma: PrismaClient;
  let generator: WorkoutProgramGeneratorService;
  let programs: WorkoutProgramsService;
  let sessions: WorkoutSessionsService;
  let ai: { invoke: jest.Mock };
  const seededUserIds: string[] = [];

  async function createUser(): Promise<string> {
    const user = await prisma.user.create({
      data: { email: `sessions-${randomBytes(6).toString('hex')}@example.test` },
    });
    seededUserIds.push(user.id);

    await prisma.userProfile.create({
      data: { userId: user.id, timezone: 'UTC', onboardingCompletedAt: new Date() },
    });

    return user.id;
  }

  /** An approved program, with a commitment on its first training day. */
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

    const upper = draft.program.templates.find(
      (t) => t.name === 'Upper A' && t.variant === 'FULL',
    )!;
    const commitmentId = (
      await prisma.commitment.findFirstOrThrow({
        where: { userId, workoutTemplateId: upper.id },
        orderBy: { scheduledStart: 'asc' },
      })
    ).id;

    return { program: draft.program, upper, commitmentId, planVersionId: approved.planVersionId };
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg(buildDatabaseUrl()) });
    await prisma.$connect();
    await seedExercises(prisma);

    const service = prisma as unknown as PrismaService;
    ai = { invoke: jest.fn() };

    const commitments = new CommitmentsService(
      service,
      new BehaviourLintService(null as never, null as never),
    );
    const actions = new CommitmentActionsService(
      service,
      commitments,
      // Nothing in this suite decomposes anything; the runner never reaches it.
      new DecompositionService(
        ai as unknown as AiGatewayService,
        new UserProfileService(service),
      ),
    );

    generator = new WorkoutProgramGeneratorService(
      service,
      ai as never,
      { evaluate: async () => ({ decision: 'allow', category: 'none', source: 'precheck' }) } as never,
      new ExerciseResolverService(service),
    );
    programs = new WorkoutProgramsService(
      service,
      new PlanVersionsService(service, new PlansService(service, new OutcomesService(service))),
      new UserProfileService(service),
      { notify: async () => undefined } as never,
    );
    sessions = new WorkoutSessionsService(
      service,
      actions,
      new ProgressionExplainerService(ai as unknown as AiGatewayService),
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

  it('starts from a commitment, moves it to STARTED and numbers the session', async () => {
    const userId = await createUser();
    const { commitmentId } = await approvedProgram(userId);

    const view = await sessions.start(userId, { commitmentId, variant: 'FULL' });

    expect(view.status).toBe('IN_PROGRESS');
    expect(view.header).toMatchObject({ title: 'Upper A', sessionIndex: 1, sessionTotal: 12 });
    expect(view.exercises).toHaveLength(2);
    expect(view.availableVariants).toEqual(['FULL', 'MINIMUM', 'SHORT']);

    await expect(
      prisma.commitment.findUnique({ where: { id: commitmentId } }),
    ).resolves.toMatchObject({ status: 'STARTED' });

    const started = await prisma.evidence.findFirst({
      where: { commitmentId, evidenceType: 'started' },
    });
    expect(started).not.toBeNull();
  });

  it('refuses a second workout while one is open, and says which', async () => {
    const userId = await createUser();
    const { commitmentId } = await approvedProgram(userId);
    const open = await sessions.start(userId, { commitmentId, variant: 'FULL' });

    await expect(sessions.start(userId, { commitmentId, variant: 'FULL' })).rejects.toMatchObject({
      status: 409,
      response: { code: 'SESSION_IN_PROGRESS', details: { sessionId: open.id } },
    });
  });

  it('refuses to start a workout from a commitment that is not one', async () => {
    const userId = await createUser();
    const commitment = await prisma.commitment.create({
      data: { userId, domain: 'WORK', title: 'Write the memo', scheduledStart: new Date() },
    });

    await expect(
      sessions.start(userId, { commitmentId: commitment.id, variant: 'FULL' }),
    ).rejects.toMatchObject({ response: { code: 'NOT_A_WORKOUT_COMMITMENT' } });
  });

  it('writes one row for a replayed clientId', async () => {
    const userId = await createUser();
    const { commitmentId } = await approvedProgram(userId);
    const view = await sessions.start(userId, { commitmentId, variant: 'FULL' });
    const exerciseId = view.exercises[0].exerciseId;
    const clientId = randomUUID();

    const payload = {
      clientId,
      exerciseId,
      setNumber: 1,
      weightKg: 20,
      reps: 12,
      discomfort: 'NONE' as const,
    };
    const first = await sessions.logSet(userId, view.id, payload);
    const second = await sessions.logSet(userId, view.id, payload);

    expect(second.set.id).toBe(first.set.id);
    expect(await prisma.setLog.count({ where: { sessionId: view.id } })).toBe(1);
  });

  it('overwrites a corrected set rather than adding a second one', async () => {
    const userId = await createUser();
    const { commitmentId } = await approvedProgram(userId);
    const view = await sessions.start(userId, { commitmentId, variant: 'FULL' });
    const exerciseId = view.exercises[0].exerciseId;

    await sessions.logSet(userId, view.id, {
      clientId: randomUUID(),
      exerciseId,
      setNumber: 1,
      weightKg: 20,
      reps: 12,
      discomfort: 'NONE',
    });
    const corrected = await sessions.logSet(userId, view.id, {
      clientId: randomUUID(),
      exerciseId,
      setNumber: 1,
      weightKg: 22.5,
      reps: 12,
      discomfort: 'NONE',
    });

    expect(corrected.set.weightKg).toBe(22.5);
    expect(await prisma.setLog.count({ where: { sessionId: view.id } })).toBe(1);
  });

  it('flags sharp pain, answers with the PRD §45 copy, and calls no model', async () => {
    const userId = await createUser();
    const { commitmentId } = await approvedProgram(userId);
    const view = await sessions.start(userId, { commitmentId, variant: 'FULL' });
    ai.invoke.mockClear();

    const result = await sessions.logSet(userId, view.id, {
      clientId: randomUUID(),
      exerciseId: view.exercises[0].exerciseId,
      setNumber: 1,
      weightKg: 20,
      reps: 6,
      discomfort: 'SHARP_PAIN',
    });

    expect(result.safety).toEqual({ copy: PAIN_SAFETY_COPY, action: 'stop_exercise' });
    expect(ai.invoke).not.toHaveBeenCalled();

    await expect(
      prisma.workoutSession.findUnique({ where: { id: view.id } }),
    ).resolves.toMatchObject({ discomfortFlag: true });

    const audit = await prisma.auditEvent.findFirst({
      where: { actorUserId: userId, action: 'workout_session:discomfort' },
    });
    expect(audit).not.toBeNull();
  });

  it('accepts, de-duplicates and rejects per item in a replayed queue', async () => {
    const userId = await createUser();
    const { commitmentId } = await approvedProgram(userId);
    const view = await sessions.start(userId, { commitmentId, variant: 'FULL' });
    const exerciseId = view.exercises[0].exerciseId;
    const replayed = randomUUID();

    await sessions.logSet(userId, view.id, {
      clientId: replayed,
      exerciseId,
      setNumber: 1,
      weightKg: 20,
      reps: 12,
      discomfort: 'NONE',
    });

    const result = await sessions.logSets(userId, view.id, [
      { clientId: replayed, exerciseId, setNumber: 1, weightKg: 20, reps: 12, discomfort: 'NONE' },
      { clientId: randomUUID(), exerciseId, setNumber: 2, weightKg: 20, reps: 11, discomfort: 'NONE' },
      {
        clientId: randomUUID(),
        exerciseId: (
          await prisma.exercise.findFirstOrThrow({ where: { nameKey: 'farmer\'s carry' } })
        ).id,
        setNumber: 1,
        reps: 10,
        discomfort: 'NONE',
      },
    ]);

    expect(result.accepted).toHaveLength(1);
    expect(result.duplicates).toEqual([replayed]);
    expect(result.rejected).toEqual([
      expect.objectContaining({ reason: 'EXERCISE_NOT_IN_PROGRAM' }),
    ]);
  });

  it('rejects a set timestamped outside the workout', async () => {
    const userId = await createUser();
    const { commitmentId } = await approvedProgram(userId);
    const view = await sessions.start(userId, { commitmentId, variant: 'FULL' });

    await expect(
      sessions.logSet(userId, view.id, {
        clientId: randomUUID(),
        exerciseId: view.exercises[0].exerciseId,
        setNumber: 1,
        reps: 10,
        discomfort: 'NONE',
        loggedAt: '2020-01-01T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({ response: { code: 'LOGGED_AT_OUT_OF_RANGE' } });
  });

  it('completes the commitment when every movement of a FULL session was logged', async () => {
    const userId = await createUser();
    const { commitmentId } = await approvedProgram(userId);
    const view = await sessions.start(userId, { commitmentId, variant: 'FULL' });

    for (const exercise of view.exercises) {
      await sessions.logSet(userId, view.id, {
        clientId: randomUUID(),
        exerciseId: exercise.exerciseId,
        setNumber: 1,
        weightKg: 20,
        reps: 12,
        discomfort: 'NONE',
      });
    }

    const finished = await sessions.finish(userId, view.id, { status: 'COMPLETED' });

    expect(finished.commitmentStatus).toBe('COMPLETED');
    expect(finished.summary).toMatchObject({ sets: 2, volumeKg: 480, exercisesCompleted: 2 });

    await expect(
      prisma.commitment.findUnique({ where: { id: commitmentId } }),
    ).resolves.toMatchObject({ status: 'COMPLETED' });

    const evidence = await prisma.evidence.findFirst({
      where: { commitmentId, source: 'WORKOUT_LOG' },
    });
    expect(evidence).toMatchObject({ evidenceType: 'workout_completed', quantitativeUnit: 'kg' });
    expect(JSON.parse(evidence!.qualitativeValue!)).toMatchObject({ sets: 2, variant: 'FULL' });
  });

  it('settles a short-version workout as partial', async () => {
    const userId = await createUser();
    const { commitmentId } = await approvedProgram(userId);
    const view = await sessions.start(userId, { commitmentId, variant: 'FULL' });

    await sessions.logSet(userId, view.id, {
      clientId: randomUUID(),
      exerciseId: view.exercises[0].exerciseId,
      setNumber: 1,
      weightKg: 20,
      reps: 12,
      discomfort: 'NONE',
    });

    const short = await sessions.switchVariant(userId, view.id, { variant: 'SHORT' });
    expect(short.variant).toBe('SHORT');

    const finished = await sessions.finish(userId, view.id, { status: 'COMPLETED' });

    expect(finished.commitmentStatus).toBe('PARTIALLY_COMPLETED');
    await expect(
      prisma.commitment.findUnique({ where: { id: commitmentId } }),
    ).resolves.toMatchObject({ status: 'PARTIALLY_COMPLETED', versionUsed: 'SHORT' });
  });

  it('leaves the commitment open when a workout is abandoned with nothing logged', async () => {
    const userId = await createUser();
    const { commitmentId } = await approvedProgram(userId);
    const view = await sessions.start(userId, { commitmentId, variant: 'FULL' });

    const finished = await sessions.finish(userId, view.id, { status: 'ABANDONED' });

    expect(finished.commitmentStatus).toBeNull();
    await expect(
      prisma.commitment.findUnique({ where: { id: commitmentId } }),
    ).resolves.toMatchObject({ status: 'STARTED' });
  });

  it('shows last time on the next session, in set order', async () => {
    const userId = await createUser();
    const { commitmentId, upper } = await approvedProgram(userId);
    const first = await sessions.start(userId, { commitmentId, variant: 'FULL' });
    const exerciseId = first.exercises[0].exerciseId;

    for (const [index, reps] of [12, 11, 10].entries()) {
      await sessions.logSet(userId, first.id, {
        clientId: randomUUID(),
        exerciseId,
        setNumber: index + 1,
        weightKg: 20,
        reps,
        discomfort: 'NONE',
      });
    }
    await sessions.finish(userId, first.id, { status: 'COMPLETED' });

    const second = await sessions.start(userId, { templateId: upper.id, variant: 'FULL' });
    const bench = second.exercises.find((e) => e.exerciseId === exerciseId)!;

    expect(bench.lastTime?.sets.map((s) => s.reps)).toEqual([12, 11, 10]);
    expect(bench.lastTime?.sets[0].weightKg).toBe(20);
    expect(second.header.sessionIndex).toBe(2);
  });

  it('ignores an abandoned session when reporting last time', async () => {
    const userId = await createUser();
    const { commitmentId, upper } = await approvedProgram(userId);
    const first = await sessions.start(userId, { commitmentId, variant: 'FULL' });
    const exerciseId = first.exercises[0].exerciseId;

    await sessions.logSet(userId, first.id, {
      clientId: randomUUID(),
      exerciseId,
      setNumber: 1,
      weightKg: 20,
      reps: 12,
      discomfort: 'NONE',
    });
    await sessions.finish(userId, first.id, { status: 'COMPLETED' });

    const abandoned = await sessions.start(userId, { templateId: upper.id, variant: 'FULL' });
    await sessions.logSet(userId, abandoned.id, {
      clientId: randomUUID(),
      exerciseId,
      setNumber: 1,
      weightKg: 60,
      reps: 1,
      discomfort: 'NONE',
    });
    await sessions.finish(userId, abandoned.id, { status: 'ABANDONED' });

    const third = await sessions.start(userId, { templateId: upper.id, variant: 'FULL' });
    const bench = third.exercises.find((e) => e.exerciseId === exerciseId)!;

    expect(bench.lastTime?.sets[0].weightKg).toBe(20);
  });

  it('suggests an increase after two comfortable sessions at the top of the range', async () => {
    const userId = await createUser();
    const { commitmentId, upper } = await approvedProgram(userId);

    // Two COMPLETED sessions, every prescribed set at the top of the range.
    for (let round = 0; round < 2; round += 1) {
      const view = await sessions.start(
        userId,
        round === 0 ? { commitmentId, variant: 'FULL' } : { templateId: upper.id, variant: 'FULL' },
      );

      for (const exercise of view.exercises) {
        for (let setNumber = 1; setNumber <= exercise.sets; setNumber += 1) {
          await sessions.logSet(userId, view.id, {
            clientId: randomUUID(),
            exerciseId: exercise.exerciseId,
            setNumber,
            weightKg: 20,
            reps: exercise.repMax,
            rpe: 7,
            discomfort: 'NONE',
          });
        }
      }

      await sessions.finish(userId, view.id, { status: 'COMPLETED' });
    }

    const third = await sessions.start(userId, { templateId: upper.id, variant: 'FULL' });

    expect(third.exercises[0].progression).toMatchObject({
      action: 'increase',
      reason: 'top_of_range_twice',
      currentWeightKg: 20,
      suggestedWeightKg: 22.5,
    });
  });

  it('says first_session for a movement that has never been logged', async () => {
    const userId = await createUser();
    const { commitmentId } = await approvedProgram(userId);

    const view = await sessions.start(userId, { commitmentId, variant: 'FULL' });

    expect(view.exercises[0].progression).toMatchObject({
      action: 'hold',
      reason: 'first_session',
      suggestedWeightKg: null,
    });
  });

  it('explains the suggestion, falling back to the template when the model is unavailable', async () => {
    const userId = await createUser();
    const { commitmentId } = await approvedProgram(userId);
    const view = await sessions.start(userId, { commitmentId, variant: 'FULL' });

    ai.invoke.mockResolvedValue({
      ok: false,
      invocationId: 'inv-down',
      error: { code: 'timeout', message: 'no answer' },
      model: null,
      latencyMs: 1,
    });

    const explanation = await sessions.explain(userId, view.id, view.exercises[0].exerciseId);

    expect(explanation.source).toBe('template');
    expect(explanation.sentence.length).toBeGreaterThan(10);
  });

  it('answers 404 for another user\'s session, never 403', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const { commitmentId } = await approvedProgram(owner);
    const view = await sessions.start(owner, { commitmentId, variant: 'FULL' });

    await expect(sessions.get(stranger, view.id)).rejects.toMatchObject({ status: 404 });
  });

  it('refuses to log into a finished workout', async () => {
    const userId = await createUser();
    const { commitmentId } = await approvedProgram(userId);
    const view = await sessions.start(userId, { commitmentId, variant: 'FULL' });
    await sessions.finish(userId, view.id, { status: 'ABANDONED' });

    await expect(
      sessions.logSet(userId, view.id, {
        clientId: randomUUID(),
        exerciseId: view.exercises[0].exerciseId,
        setNumber: 1,
        reps: 10,
        discomfort: 'NONE',
      }),
    ).rejects.toMatchObject({ response: { code: 'SESSION_NOT_OPEN' } });
  });
});
