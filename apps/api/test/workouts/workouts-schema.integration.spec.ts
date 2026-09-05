import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { buildDatabaseUrl } from '../../src/common/database-url';
import { EXERCISES, exerciseNameKey, seedExercises } from '../../prisma/exercise-catalog';

// =============================================================================
// The workout schema — guarantees only a real database can prove (issue #72)
// =============================================================================
//
// Four properties, and none of them exists anywhere except in Postgres:
//
//   1. `set_logs.client_id` IS THE OFFLINE STORY. PRD §121 has the runner
//      replaying a queue it is not sure was accepted, and the replay is
//      idempotent because a duplicate raises P2002 — not because the client
//      keeps careful books.
//   2. `exercises (scope, name_key)` LETS TWO USERS OWN THE SAME NAME while the
//      catalog keeps exactly one. A global unique on the name would make one
//      user's invented movement collide with another's.
//   3. THE CASCADE GRAPH decides what survives a delete. Deleting a program must
//      take its templates and sessions; deleting a USER must take their
//      programs and weight logs but only NULL their authorship of a custom
//      exercise, which somebody else's template may still reference.
//   4. `Restrict` ON A PRESCRIBED EXERCISE is the one deliberate hard stop: a
//      program that quietly lost a movement is worse than a delete that failed.
// =============================================================================

const hasDatabase = Boolean(process.env.POSTGRES_HOST ?? process.env.DATABASE_URL);
const describeWithDb = hasDatabase ? describe : describe.skip;

if (!hasDatabase) {
  // eslint-disable-next-line no-console
  console.warn(
    '[workouts-schema] skipped: no POSTGRES_HOST or DATABASE_URL. Start the test ' +
      'database and set the POSTGRES_* vars in apps/api/.env.test to run these.',
  );
}

describe('exercise catalog (pure)', () => {
  it('is 44 movements across 10 substitution groups', () => {
    expect(EXERCISES).toHaveLength(44);
    expect(new Set(EXERCISES.map((e) => e.substitutionGroup)).size).toBe(10);
  });

  it('gives every movement instructions, equipment and a pattern', () => {
    for (const exercise of EXERCISES) {
      expect(exercise.instructions.trim().length).toBeGreaterThan(40);
      expect(exercise.equipment.length).toBeGreaterThanOrEqual(1);
      expect(exercise.movementPattern).toBeTruthy();
    }
  });

  it('has no duplicate name keys', () => {
    const keys = EXERCISES.map((e) => exerciseNameKey(e.name));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('collapses whitespace and case when keying a name', () => {
    expect(exerciseNameKey('  Dumbbell   BENCH Press ')).toBe('dumbbell bench press');
  });
});

describeWithDb('workout schema (integration, real DB)', () => {
  let prisma: PrismaClient;
  const seededUserIds: string[] = [];

  async function createUser(): Promise<string> {
    const user = await prisma.user.create({
      data: { email: `workouts-${randomBytes(6).toString('hex')}@example.test` },
    });
    seededUserIds.push(user.id);
    return user.id;
  }

  async function catalogExerciseId(name = 'Goblet Squat'): Promise<string> {
    const row = await prisma.exercise.findUniqueOrThrow({
      where: { scope_nameKey: { scope: 'catalog', nameKey: exerciseNameKey(name) } },
    });
    return row.id;
  }

  /** A program with one FULL template holding one exercise, and a session on it. */
  async function createProgram(userId: string) {
    const exerciseId = await catalogExerciseId();
    const program = await prisma.workoutProgram.create({
      data: { userId, name: 'Test program', durationWeeks: 6, weeklyStructure: [] },
    });
    const template = await prisma.workoutTemplate.create({
      data: { programId: program.id, name: 'Full Body A', variant: 'FULL', targetMinutes: 40 },
    });
    await prisma.workoutTemplateExercise.create({
      data: {
        templateId: template.id,
        exerciseId,
        order: 1,
        sets: 3,
        repMin: 8,
        repMax: 12,
        restSeconds: 90,
      },
    });
    const session = await prisma.workoutSession.create({
      data: { userId, templateId: template.id, variant: 'FULL', startedAt: new Date() },
    });
    return { program, template, session, exerciseId };
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg(buildDatabaseUrl()) });
    await prisma.$connect();
    await seedExercises(prisma);
  });

  afterAll(async () => {
    if (seededUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: seededUserIds } } });
    }
    await prisma.$disconnect();
  });

  it('seeds exactly 44 catalog rows and is idempotent', async () => {
    await seedExercises(prisma);

    const rows = await prisma.exercise.findMany({ where: { scope: 'catalog' } });
    expect(rows).toHaveLength(44);
    expect(rows.every((r) => r.isCustom === false)).toBe(true);

    const groups = await prisma.exercise.groupBy({
      by: ['substitutionGroup'],
      where: { scope: 'catalog' },
    });
    expect(groups).toHaveLength(10);
  });

  it('seeds the vertical pull group with a band option for a room with no cable machine', async () => {
    const row = await prisma.exercise.findUniqueOrThrow({
      where: { scope_nameKey: { scope: 'catalog', nameKey: 'band pulldown' } },
    });

    expect(row.equipment).toEqual(['BAND']);
    expect(row.movementPattern).toBe('PULL_V');
    expect(row.substitutionGroup).toBe('vertical_pull');
  });

  it('rejects a duplicate catalog name but allows the same name under a user scope', async () => {
    const userId = await createUser();

    await expect(
      prisma.exercise.create({
        data: {
          name: 'Goblet Squat',
          nameKey: 'goblet squat',
          scope: 'catalog',
          equipment: ['DUMBBELL'],
          movementPattern: 'SQUAT',
          instructions: 'x',
          contraindicationTags: [],
          substitutionGroup: 'squat',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    await expect(
      prisma.exercise.create({
        data: {
          name: 'Goblet Squat',
          nameKey: 'goblet squat',
          scope: userId,
          isCustom: true,
          createdByUserId: userId,
          equipment: ['DUMBBELL'],
          movementPattern: 'SQUAT',
          instructions: '',
          contraindicationTags: [],
          substitutionGroup: 'custom',
        },
      }),
    ).resolves.toMatchObject({ isCustom: true });
  });

  it('rejects a replayed set log by its client id', async () => {
    const userId = await createUser();
    const { session, exerciseId } = await createProgram(userId);
    const clientId = randomBytes(8).toString('hex');

    await prisma.setLog.create({
      data: {
        sessionId: session.id,
        exerciseId,
        setNumber: 1,
        reps: 12,
        weightKg: 20,
        loggedAt: new Date(),
        clientId,
      },
    });

    await expect(
      prisma.setLog.create({
        data: {
          sessionId: session.id,
          exerciseId,
          setNumber: 2,
          reps: 10,
          loggedAt: new Date(),
          clientId,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects a second row for the same set number of the same exercise', async () => {
    const userId = await createUser();
    const { session, exerciseId } = await createProgram(userId);

    await prisma.setLog.create({
      data: {
        sessionId: session.id,
        exerciseId,
        setNumber: 1,
        reps: 12,
        loggedAt: new Date(),
        clientId: randomBytes(8).toString('hex'),
      },
    });

    await expect(
      prisma.setLog.create({
        data: {
          sessionId: session.id,
          exerciseId,
          setNumber: 1,
          reps: 11,
          loggedAt: new Date(),
          clientId: randomBytes(8).toString('hex'),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects two weight entries for the same local day', async () => {
    const userId = await createUser();
    await prisma.bodyWeightLog.create({ data: { userId, dateLocal: '2026-09-05', weightKg: 82.4 } });

    await expect(
      prisma.bodyWeightLog.create({
        data: { userId, dateLocal: '2026-09-05', weightKg: 82.1 },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('cascades templates, template exercises and sessions when a program is deleted', async () => {
    const userId = await createUser();
    const { program, template } = await createProgram(userId);

    await prisma.workoutProgram.delete({ where: { id: program.id } });

    expect(await prisma.workoutTemplate.count({ where: { programId: program.id } })).toBe(0);
    expect(await prisma.workoutTemplateExercise.count({ where: { templateId: template.id } })).toBe(
      0,
    );
    expect(await prisma.workoutSession.count({ where: { templateId: template.id } })).toBe(0);
  });

  it('cascades programs and weight logs on user delete but only nulls custom exercise authorship', async () => {
    const userId = await createUser();
    await createProgram(userId);
    await prisma.bodyWeightLog.create({ data: { userId, dateLocal: '2026-09-01', weightKg: 80 } });
    const custom = await prisma.exercise.create({
      data: {
        name: 'Sled Push',
        nameKey: 'sled push',
        scope: userId,
        isCustom: true,
        createdByUserId: userId,
        equipment: ['MACHINE'],
        movementPattern: 'ACCESSORY',
        instructions: '',
        contraindicationTags: [],
        substitutionGroup: 'custom',
      },
    });

    await prisma.user.delete({ where: { id: userId } });

    expect(await prisma.workoutProgram.count({ where: { userId } })).toBe(0);
    expect(await prisma.bodyWeightLog.count({ where: { userId } })).toBe(0);
    await expect(prisma.exercise.findUnique({ where: { id: custom.id } })).resolves.toMatchObject({
      createdByUserId: null,
    });

    await prisma.exercise.delete({ where: { id: custom.id } });
  });

  it('refuses to delete an exercise a template still prescribes', async () => {
    const userId = await createUser();
    const { exerciseId } = await createProgram(userId);

    await expect(prisma.exercise.delete({ where: { id: exerciseId } })).rejects.toMatchObject({
      code: 'P2003',
    });
  });

  it('nulls the workout link on a commitment when its template goes away', async () => {
    const userId = await createUser();
    const { program, template } = await createProgram(userId);
    const commitment = await prisma.commitment.create({
      data: {
        userId,
        domain: 'HEALTH',
        title: 'Full Body A',
        scheduledStart: new Date(),
        workoutTemplateId: template.id,
      },
    });

    await prisma.workoutProgram.delete({ where: { id: program.id } });

    await expect(
      prisma.commitment.findUnique({ where: { id: commitment.id } }),
    ).resolves.toMatchObject({ workoutTemplateId: null });
  });
});
