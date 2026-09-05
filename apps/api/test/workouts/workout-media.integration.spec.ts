import { randomBytes } from 'node:crypto';
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
import { MediaCheckService } from '../../src/workouts/media/media-check.service';
import { MediaSummaryService } from '../../src/workouts/media/media-summary.service';
import { PAIN_SAFETY_COPY } from '../../src/workouts/safety/workout-safety-copy';
import { validProposal } from '../../src/workouts/programs/__fixtures__/proposal.fixture';
import { seedExercises } from '../../prisma/exercise-catalog';

// =============================================================================
// Media coaching, against a real database (issue #92, epic E09)
// =============================================================================
//
// Three claims worth a database:
//
//   1. THE SAFETY REDIRECT REALLY WITHHOLDS THE CUES. It is a post-processing
//      step over model output, and the case that matters most — the session
//      already carries `discomfortFlag`, so the redirect fires even on a clean
//      answer — cannot be checked without the session row.
//   2. THE MEAL GUARD REJECTS THE WHOLE ANSWER, and stores nothing.
//   3. THE EQUIPMENT CHECK RAISES A PROPOSAL RATHER THAN EDITING THE PROGRAM
//      (PRD §15). Counting the template rows around it is the only assertion
//      that would notice a helpful update added later.
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

describeWithDb('Media coaching (integration, real DB)', () => {
  let prisma: PrismaClient;
  let media: MediaCheckService;
  let generator: WorkoutProgramGeneratorService;
  let programs: WorkoutProgramsService;
  let ai: { invoke: jest.Mock };
  let objects: { getOwnedById: jest.Mock };
  const seededUserIds: string[] = [];

  async function createUser(): Promise<string> {
    const user = await prisma.user.create({
      data: { email: `media-${randomBytes(6).toString('hex')}@example.test` },
    });
    seededUserIds.push(user.id);

    await prisma.userProfile.create({
      data: { userId: user.id, timezone: 'UTC', onboardingCompletedAt: new Date() },
    });

    return user.id;
  }

  async function createObject(userId: string): Promise<string> {
    const object = await prisma.storageObject.create({
      data: {
        name: 'clip.mp4',
        size: BigInt(1024),
        mimeType: 'video/mp4',
        storageKey: `k/${randomBytes(8).toString('hex')}`,
        status: 'ready',
        uploadedById: userId,
      },
    });

    objects.getOwnedById.mockResolvedValue({ id: object.id, status: 'ready' });

    return object.id;
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
    await programs.approve(userId, draft.program.id, { startDate: '2026-09-07' });

    return draft.program;
  }

  function aiReturns(output: unknown) {
    ai.invoke.mockResolvedValue({
      ok: true,
      invocationId: randomBytes(8).toString('hex'),
      output,
      usage: {},
      model: 'gpt-test',
      latencyMs: 1,
    });
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg(buildDatabaseUrl()) });
    await prisma.$connect();
    await seedExercises(prisma);

    const service = prisma as unknown as PrismaService;
    ai = { invoke: jest.fn() };
    objects = { getOwnedById: jest.fn() };

    const versions = new PlanVersionsService(
      service,
      new PlansService(service, new OutcomesService(service)),
    );
    const proposals = new ProposalsService(service, versions, [new WorkoutProposalEffect()]);
    const adaptation = new WorkoutAdaptationService(service, proposals, {
      notify: async () => undefined,
    } as never);

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

    media = new MediaCheckService(
      service,
      ai as unknown as AiGatewayService,
      objects as never,
      new MediaSummaryService(service),
      adaptation,
    );
  });

  afterAll(async () => {
    if (seededUserIds.length > 0) {
      await prisma.auditEvent.deleteMany({ where: { actorUserId: { in: seededUserIds } } });
      await prisma.storageObject.deleteMany({ where: { uploadedById: { in: seededUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: seededUserIds } } });
      await prisma.exercise.deleteMany({ where: { scope: { in: seededUserIds } } });
    }
    await prisma.$disconnect();
  });

  async function sessionFor(userId: string, program: { templates: Array<{ id: string; variant: string; exercises: Array<{ exerciseId: string }> }> }) {
    const template = program.templates.find((row) => row.variant === 'FULL')!;

    const session = await prisma.workoutSession.create({
      data: { userId, templateId: template.id, variant: 'FULL', startedAt: new Date() },
    });

    return { session, exerciseId: template.exercises[0].exerciseId };
  }

  it('returns observations and cues for a clean set', async () => {
    const userId = await createUser();
    const program = await approvedProgram(userId);
    const { session, exerciseId } = await sessionFor(userId, program);
    const objectId = await createObject(userId);

    aiReturns({
      observations: ['The bar drifts forward on the way up.'],
      cues: ['Keep it over your mid-foot.'],
      riskFlags: ['none'],
      safetyNote: null,
      confidence: 'medium',
    });

    const result = await media.formCheck(userId, session.id, { storageObjectId: objectId, exerciseId });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.result.cues).toHaveLength(1);
    expect(result.result.redirected).toBe(false);

    const stored = await prisma.storageObject.findUniqueOrThrow({ where: { id: objectId } });
    expect((stored.metadata as { _coaching?: { kind?: string } })._coaching?.kind).toBe(
      'form_check',
    );
  });

  it('withholds the cues when the model flags pain', async () => {
    const userId = await createUser();
    const program = await approvedProgram(userId);
    const { session, exerciseId } = await sessionFor(userId, program);
    const objectId = await createObject(userId);

    aiReturns({
      observations: ['The knee collapses inward under load.'],
      cues: ['Push the knee out.'],
      riskFlags: ['joint_instability'],
      safetyNote: null,
      confidence: 'high',
    });

    const result = await media.formCheck(userId, session.id, { storageObjectId: objectId, exerciseId });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Cues alongside "get this looked at" would read as permission to keep
    // going, which is exactly what PRD §45 is trying to prevent.
    expect(result.result.cues).toEqual([]);
    expect(result.result.safetyNote).toBe(PAIN_SAFETY_COPY);
    expect(result.result.redirected).toBe(true);
  });

  it('redirects on a session that already reported pain, however clean the answer', async () => {
    const userId = await createUser();
    const program = await approvedProgram(userId);
    const { session, exerciseId } = await sessionFor(userId, program);
    await prisma.workoutSession.update({
      where: { id: session.id },
      data: { discomfortFlag: true },
    });
    const objectId = await createObject(userId);

    aiReturns({
      observations: ['Looks steady.'],
      cues: ['Nothing to change.'],
      riskFlags: ['none'],
      safetyNote: null,
      confidence: 'high',
    });

    const result = await media.formCheck(userId, session.id, { storageObjectId: objectId, exerciseId });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.redirected).toBe(true);
  });

  it('passes a provider failure through as a readable answer rather than an error', async () => {
    const userId = await createUser();
    const program = await approvedProgram(userId);
    const { session, exerciseId } = await sessionFor(userId, program);
    const objectId = await createObject(userId);

    ai.invoke.mockResolvedValue({
      ok: false,
      invocationId: 'inv-down',
      error: { code: 'timeout', message: 'no answer' },
      model: null,
      latencyMs: 1,
    });

    const result = await media.formCheck(userId, session.id, { storageObjectId: objectId, exerciseId });

    expect(result).toMatchObject({ ok: false, error: { code: 'timeout' } });

    // Nothing stored: a failed check leaves the attachment as it found it.
    const stored = await prisma.storageObject.findUniqueOrThrow({ where: { id: objectId } });
    expect((stored.metadata as { _coaching?: unknown } | null)?._coaching).toBeUndefined();
  });

  it('refuses an upload that has not finished', async () => {
    const userId = await createUser();
    const program = await approvedProgram(userId);
    const { session, exerciseId } = await sessionFor(userId, program);
    const objectId = await createObject(userId);

    objects.getOwnedById.mockResolvedValue({ id: objectId, status: 'uploading' });

    await expect(
      media.formCheck(userId, session.id, { storageObjectId: objectId, exerciseId }),
    ).rejects.toMatchObject({ response: { code: 'MEDIA_NOT_READY' } });
  });

  it('answers 404 for another user\'s session', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const program = await approvedProgram(owner);
    const { session, exerciseId } = await sessionFor(owner, program);
    const objectId = await createObject(stranger);

    await expect(
      media.formCheck(stranger, session.id, { storageObjectId: objectId, exerciseId }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('turns a photographed room into a proposal, not an edit', async () => {
    const userId = await createUser();
    const program = await approvedProgram(userId);
    const objectId = await createObject(userId);

    const before = await prisma.workoutTemplateExercise.findMany({
      where: { template: { programId: program.id } },
      select: { id: true, exerciseId: true },
    });

    // Bodyweight only: every dumbbell movement in the program is now impossible.
    aiReturns({ equipmentDetected: ['BODYWEIGHT'], notes: ['A small room, no rack.'] });

    const result = await media.equipmentCheck(userId, { storageObjectId: objectId });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.result.substitutions.length).toBeGreaterThan(0);
    expect(result.result.proposalId).not.toBeNull();

    const proposal = await prisma.planChangeProposal.findUniqueOrThrow({
      where: { id: result.result.proposalId! },
    });
    expect(proposal).toMatchObject({ sourceKind: 'WORKOUT', status: 'PROPOSED' });

    // The check itself changed nothing.
    const after = await prisma.workoutTemplateExercise.findMany({
      where: { template: { programId: program.id } },
      select: { id: true, exerciseId: true },
    });
    expect(after).toEqual(before);
  });

  it('says nothing to propose when the room already fits the program', async () => {
    const userId = await createUser();
    await approvedProgram(userId);
    const objectId = await createObject(userId);

    aiReturns({
      equipmentDetected: ['DUMBBELL', 'BENCH', 'BODYWEIGHT'],
      notes: [],
    });

    const result = await media.equipmentCheck(userId, { storageObjectId: objectId });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.substitutions).toEqual([]);
    expect(result.result.proposalId).toBeNull();
  });

  it('reads a meal at the level of behaviour', async () => {
    const userId = await createUser();
    const objectId = await createObject(userId);

    aiReturns({
      observations: ['A protein source and a green vegetable on the plate.'],
      behaviorSuggestions: [
        { key: 'vegetables_with_dinner', text: 'Keep the greens on the plate at dinner.' },
      ],
    });

    const result = await media.mealCheck(userId, { storageObjectId: objectId });

    expect(result.ok).toBe(true);

    const stored = await prisma.storageObject.findUniqueOrThrow({ where: { id: objectId } });
    expect((stored.metadata as { _coaching?: { kind?: string } })._coaching?.kind).toBe(
      'meal_check',
    );
  });

  it('rejects a meal answer that started counting, and stores none of it', async () => {
    const userId = await createUser();
    const objectId = await createObject(userId);

    aiReturns({
      observations: ['Roughly 600 kcal, mostly from the rice.'],
      behaviorSuggestions: [
        { key: 'protein_with_meals', text: 'Add about 30 grams of protein.' },
      ],
    });

    const result = await media.mealCheck(userId, { storageObjectId: objectId });

    expect(result).toMatchObject({ ok: false, error: { code: 'schema' } });

    // Rejected WHOLE, not edited: a stripped sentence reads as an omission.
    const stored = await prisma.storageObject.findUniqueOrThrow({ where: { id: objectId } });
    expect((stored.metadata as { _coaching?: unknown } | null)?._coaching).toBeUndefined();

    const audit = await prisma.auditEvent.findFirst({
      where: { actorUserId: userId, action: 'nutrition:meal_check' },
    });
    expect(audit?.meta).toMatchObject({ rejected: 'accounting' });
  });
});
