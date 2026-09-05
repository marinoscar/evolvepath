import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';

import { buildDatabaseUrl } from '../../src/common/database-url';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { BehaviourLintService } from '../../src/family/behaviour-lint.service';
import { CommitmentsService } from '../../src/commitments/commitments.service';
import { UserProfileService } from '../../src/user-profile/user-profile.service';
import { NutritionService } from '../../src/health-domain/nutrition/nutrition.service';
import { BodyWeightService } from '../../src/health-domain/weight/body-weight.service';
import { NUTRITION_BEHAVIORS } from '../../src/health-domain/nutrition/nutrition-behaviors';
import { closeTestApp, createTestApp, TestContext } from '../helpers/test-app.helper';

// =============================================================================
// Nutrition behaviours and weight, against a real database (issue #113)
// =============================================================================
//
// The two claims worth a real database:
//
//   1. A BEHAVIOUR BECOMES AN ORDINARY COMMITMENT, with the registry's own
//      copy and its three sizes — not a second kind of intention that Today,
//      the weekly review and the momentum engine would each have to learn
//      about separately.
//   2. THE AUDIT ROW NEVER HOLDS THE WEIGHT. A person's body weight in an
//      operational log is a thing they did not agree to, and no support
//      question needs it.
// =============================================================================

const hasDatabase = Boolean(process.env.POSTGRES_HOST ?? process.env.DATABASE_URL);
const describeWithDb = hasDatabase ? describe : describe.skip;

describe('Health domain routes are authenticated', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestApp();
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  it('GET /api/nutrition/behaviors answers 401 without a token', async () => {
    await request(context.app.getHttpServer()).get('/api/nutrition/behaviors').expect(401);
  });

  it('GET /api/health/weight answers 401 without a token', async () => {
    await request(context.app.getHttpServer()).get('/api/health/weight').expect(401);
  });

  it('leaves the liveness probe public, sharing the prefix and nothing else', async () => {
    await request(context.app.getHttpServer()).get('/api/health/live').expect(200);
  });
});

describeWithDb('Health domain (integration, real DB)', () => {
  let prisma: PrismaClient;
  let nutrition: NutritionService;
  let weight: BodyWeightService;
  const seededUserIds: string[] = [];

  async function createUser(timezone = 'UTC'): Promise<string> {
    const user = await prisma.user.create({
      data: { email: `health-${randomBytes(6).toString('hex')}@example.test` },
    });
    seededUserIds.push(user.id);

    await prisma.userProfile.create({
      data: { userId: user.id, timezone, onboardingCompletedAt: new Date() },
    });

    return user.id;
  }

  function today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  function daysAgo(n: number): string {
    return new Date(Date.now() - n * 24 * 3600_000).toISOString().slice(0, 10);
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg(buildDatabaseUrl()) });
    await prisma.$connect();

    const service = prisma as unknown as PrismaService;
    const profiles = new UserProfileService(service);

    nutrition = new NutritionService(
      service,
      new CommitmentsService(service, new BehaviourLintService(null as never, null as never)),
      profiles,
    );
    weight = new BodyWeightService(service, profiles);
  });

  afterAll(async () => {
    if (seededUserIds.length > 0) {
      await prisma.auditEvent.deleteMany({ where: { actorUserId: { in: seededUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: seededUserIds } } });
    }
    await prisma.$disconnect();
  });

  it('turns a behaviour into ordinary commitments with all three sizes', async () => {
    const userId = await createUser();

    const result = await nutrition.commit(userId, 'vegetables_with_dinner', { repeatDays: 3 });

    expect(result.commitmentIds).toHaveLength(3);

    const commitments = await prisma.commitment.findMany({
      where: { id: { in: result.commitmentIds } },
      orderBy: { scheduledStart: 'asc' },
    });

    expect(commitments[0]).toMatchObject({
      domain: 'HEALTH',
      title: 'Vegetables with dinner',
      commitmentType: 'nutrition:vegetables_with_dinner',
      fullMinutes: 10,
      minimumMinutes: 3,
      status: 'PLANNED',
    });

    // Three consecutive days, not three copies of the same evening.
    const days = new Set(commitments.map((row) => row.scheduledStart.toISOString().slice(0, 10)));
    expect(days.size).toBe(3);

    const audit = await prisma.auditEvent.findFirst({
      where: { actorUserId: userId, action: 'nutrition:commit' },
    });
    expect(audit?.meta).toMatchObject({ key: 'vegetables_with_dinner', days: 3 });
  });

  it('answers 404 for a behaviour that does not exist', async () => {
    const userId = await createUser();

    await expect(nutrition.commit(userId, 'eat_more_cake', { repeatDays: 1 })).rejects.toMatchObject({
      status: 404,
    });
  });

  it('serves the registry in order', () => {
    expect(nutrition.list().map((b) => b.key)).toEqual(NUTRITION_BEHAVIORS.map((b) => b.key));
  });

  it('keeps one weight row per local day', async () => {
    const userId = await createUser();

    await weight.put(userId, { dateLocal: today(), weightKg: 82.4 });
    const second = await weight.put(userId, { dateLocal: today(), weightKg: 82.1 });

    expect(second.weightKg).toBe(82.1);
    expect(await prisma.bodyWeightLog.count({ where: { userId } })).toBe(1);
  });

  it('never puts the weight in the audit row', async () => {
    const userId = await createUser();
    await weight.put(userId, { dateLocal: today(), weightKg: 82.4 });

    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { actorUserId: userId, action: 'health_weight:log' },
    });

    expect(audit.meta).toEqual({ dateLocal: today() });
    expect(JSON.stringify(audit.meta)).not.toContain('82.4');
  });

  it('refuses a weight for a day that has not happened', async () => {
    const userId = await createUser();

    await expect(
      weight.put(userId, { dateLocal: '2099-01-01', weightKg: 80 }),
    ).rejects.toMatchObject({ response: { code: 'WEIGHT_DATE_IN_FUTURE' } });
  });

  it('refuses a weight from more than a year ago', async () => {
    const userId = await createUser();

    await expect(
      weight.put(userId, { dateLocal: daysAgo(400), weightKg: 80 }),
    ).rejects.toMatchObject({ response: { code: 'WEIGHT_DATE_TOO_OLD' } });
  });

  it('reports thirty days, a trend and a delta', async () => {
    const userId = await createUser();

    for (const [offset, kg] of [
      [10, 83],
      [9, 83.2],
      [1, 82.4],
      [0, 82.2],
    ] as const) {
      await weight.put(userId, { dateLocal: daysAgo(offset), weightKg: kg });
    }

    const result = await weight.list(userId, {} as never);

    expect(result.items).toHaveLength(4);
    expect(result.trend).toHaveLength(30);
    expect(result.summary?.deltaKg).toBeLessThan(0);

    // PRD §47: no field a client could use to call one day bad.
    expect(Object.keys(result.items[0]).sort()).toEqual(['dateLocal', 'weightKg']);
    expect(Object.keys(result.trend[0]).sort()).toEqual(['dateLocal', 'rolling7Kg']);
  });

  it('says nothing about a trend from a single reading', async () => {
    const userId = await createUser();
    await weight.put(userId, { dateLocal: today(), weightKg: 82.4 });

    const result = await weight.list(userId, {} as never);

    expect(result.summary).toBeNull();
    expect(result.trend.every((point) => point.rolling7Kg === null)).toBe(true);
  });

  it('shows one user nothing of another\'s', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    await weight.put(owner, { dateLocal: today(), weightKg: 82.4 });

    await expect(weight.list(stranger, {} as never)).resolves.toMatchObject({ items: [], summary: null });
  });

  it('deletes a day, and shrugs at one that was never there', async () => {
    const userId = await createUser();
    await weight.put(userId, { dateLocal: today(), weightKg: 82.4 });

    await weight.remove(userId, today());
    await weight.remove(userId, today());

    expect(await prisma.bodyWeightLog.count({ where: { userId } })).toBe(0);
  });
});
