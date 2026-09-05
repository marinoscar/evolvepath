import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { buildDatabaseUrl } from '../../src/common/database-url';

// =============================================================================
// EvolvePath core domain schema — guarantees only a real database can prove
// (issue #36)
// =============================================================================
//
// Requires a live Postgres reachable via the individual POSTGRES_* env vars
// (loaded from apps/api/.env.test by test/setup.ts) with the schema migrated,
// exactly like test/prisma/ai-invocations.integration.spec.ts. That spec is
// the convention here: DB-backed specs connect for real, because the
// properties under test do not exist anywhere except in the database.
//
// WHY THESE FOUR ASSERTIONS AND NOTHING ELSE. Column types, defaults and the
// shape of the client are already proved by `prisma validate` and by every
// service that writes these tables (#39, #42, #47). What only Postgres can
// answer is:
//
//   1. The PARTIAL unique index really is partial. Prisma cannot declare it,
//      so it lives as hand-written SQL appended to the migration — the single
//      most fragile line in the schema, and the one a regenerated migration
//      would silently drop. A DRAFT beside an ACTIVE must succeed; a second
//      ACTIVE must not.
//   2. `@@unique([planId, version])` rejects a duplicate version number, so
//      version numbering cannot be corrupted by two concurrent writers.
//   3. Deleting a user really does empty all nine tables. Account deletion is
//      a promise made to the user, and it is kept by nine separate ON DELETE
//      CASCADE clauses, any one of which could be wrong.
//   4. Deleting a commitment NULLS its evidence instead of deleting it
//      (PRD §103). This is the one place the product tables deliberately
//      depart from the cascade, so it is the one worth a real DELETE.
// =============================================================================

const hasDatabase = Boolean(process.env.POSTGRES_HOST ?? process.env.DATABASE_URL);
const describeWithDb = hasDatabase ? describe : describe.skip;

if (!hasDatabase) {
  // eslint-disable-next-line no-console
  console.warn(
    '[core-domain-schema] skipped: no POSTGRES_HOST or DATABASE_URL. ' +
      'Start the test database (infra/compose/test.compose.yml) and set the ' +
      'POSTGRES_* vars in apps/api/.env.test to run these assertions.',
  );
}

describeWithDb('EvolvePath core domain schema (integration, real DB)', () => {
  let prisma: PrismaClient;
  const seededUserIds: string[] = [];

  /** A fresh owner per test, so a failed cleanup cannot leak into the next. */
  async function createUser(): Promise<string> {
    const user = await prisma.user.create({
      data: { email: `core-domain-${randomBytes(6).toString('hex')}@example.test` },
    });
    seededUserIds.push(user.id);
    return user.id;
  }

  /** outcome → plan, the shape every plan-version assertion needs. */
  async function createPlan(userId: string): Promise<string> {
    const outcome = await prisma.outcome.create({
      data: { userId, domain: 'HEALTH', title: 'Three strength workouts per week' },
    });
    const plan = await prisma.plan.create({ data: { userId, outcomeId: outcome.id } });
    return plan.id;
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg(buildDatabaseUrl()) });
    await prisma.$connect();
  });

  afterAll(async () => {
    if (seededUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: seededUserIds } } });
    }
    await prisma.$disconnect();
  });

  it('allows a DRAFT beside an ACTIVE version but rejects a second ACTIVE', async () => {
    const userId = await createUser();
    const planId = await createPlan(userId);

    await prisma.planVersion.create({
      data: { userId, planId, version: 1, status: 'ACTIVE' },
    });

    // A draft alongside the active one is the normal editing state.
    await expect(
      prisma.planVersion.create({
        data: { userId, planId, version: 2, status: 'DRAFT' },
      }),
    ).resolves.toMatchObject({ version: 2, status: 'DRAFT' });

    // A second ACTIVE is what the partial index exists to stop.
    await expect(
      prisma.planVersion.create({
        data: { userId, planId, version: 3, status: 'ACTIVE' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects a duplicate version number within one plan', async () => {
    const userId = await createUser();
    const planId = await createPlan(userId);

    await prisma.planVersion.create({ data: { userId, planId, version: 1 } });

    await expect(
      prisma.planVersion.create({ data: { userId, planId, version: 1 } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('empties all nine tables when the owning user is deleted', async () => {
    const userId = await createUser();

    await prisma.bestSelfProfile.create({
      data: { userId, identityStatement: 'Focused, present, healthy' },
    });
    await prisma.domainMode.create({ data: { userId, domain: 'WORK', mode: 'MAINTAIN' } });

    const outcome = await prisma.outcome.create({
      data: { userId, domain: 'HEALTH', title: 'Three strength workouts per week' },
    });
    const plan = await prisma.plan.create({ data: { userId, outcomeId: outcome.id } });
    const planVersion = await prisma.planVersion.create({
      data: { userId, planId: plan.id, version: 1, status: 'ACTIVE' },
    });
    const routine = await prisma.routine.create({
      data: {
        userId,
        planVersionId: planVersion.id,
        title: 'Morning workout',
        domain: 'HEALTH',
        estimatedDurationMin: 45,
        minimumDurationMin: 10,
      },
    });
    const commitment = await prisma.commitment.create({
      data: {
        userId,
        domain: 'HEALTH',
        title: 'Upper A',
        outcomeId: outcome.id,
        planVersionId: planVersion.id,
        routineId: routine.id,
        scheduledStart: new Date(),
      },
    });
    await prisma.evidence.create({
      data: { userId, commitmentId: commitment.id, evidenceType: 'completion', source: 'USER_LOG' },
    });
    await prisma.reflection.create({
      data: { userId, relatedType: 'commitment', relatedId: commitment.id, commitmentId: commitment.id },
    });

    await prisma.user.delete({ where: { id: userId } });
    seededUserIds.splice(seededUserIds.indexOf(userId), 1);

    const where = { where: { userId } };
    expect([
      await prisma.bestSelfProfile.count(where),
      await prisma.outcome.count(where),
      await prisma.plan.count(where),
      await prisma.planVersion.count(where),
      await prisma.routine.count(where),
      await prisma.commitment.count(where),
      await prisma.evidence.count(where),
      await prisma.reflection.count(where),
      await prisma.domainMode.count(where),
    ]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('keeps evidence when its commitment is deleted, with a null commitment_id', async () => {
    const userId = await createUser();

    const commitment = await prisma.commitment.create({
      data: { userId, domain: 'WORK', title: 'Draft the proposal', scheduledStart: new Date() },
    });
    const evidence = await prisma.evidence.create({
      data: {
        userId,
        commitmentId: commitment.id,
        evidenceType: 'completion',
        source: 'USER_LOG',
        qualitativeValue: 'Finished all sets',
      },
    });

    await prisma.commitment.delete({ where: { id: commitment.id } });

    const after = await prisma.evidence.findUnique({ where: { id: evidence.id } });
    expect(after).not.toBeNull();
    expect(after?.commitmentId).toBeNull();
    // The fact itself survives — that is the point of PRD §103.
    expect(after?.qualitativeValue).toBe('Finished all sets');
  });
});
