import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { buildDatabaseUrl } from '../../src/common/database-url';

// =============================================================================
// The E10 weekly tables — schema guarantees against a real database (issue #65)
// =============================================================================
//
// Requires a live Postgres reachable via the individual POSTGRES_* env vars
// (loaded from apps/api/.env.test by test/setup.ts) with the schema migrated,
// exactly like test/prisma/coach-and-memory-schema.integration.spec.ts.
//
// WHAT ONLY THE DATABASE CAN PROVE, and therefore what is asserted here:
//
//   1. One review per user per week, and two users may share a week. The
//      generator upserts on that key; without the index a retry would produce a
//      second review and the screen would show whichever one it read first.
//   2. Deleting a review leaves its plan standing with a null reference. An
//      approved week must survive the deletion of the review it came from.
//   3. The weekday range is enforced by the DATABASE. Zod guards the endpoint,
//      but an out-of-range weekday written any other way fails silently — the
//      hourly sweep just never matches it and the user's review stops arriving.
//   4. Account deletion is whole: one DELETE on `users` takes both tables.
// =============================================================================

describe('weekly review and plan tables (integration, real DB)', () => {
  let prisma: PrismaClient;
  const seededUserIds: string[] = [];

  const uniqueEmail = () => `weekly-schema-${randomBytes(6).toString('hex')}@example.test`;

  async function seedUser() {
    const user = await prisma.user.create({ data: { email: uniqueEmail() } });
    seededUserIds.push(user.id);
    return user;
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

  it('applies the defaults every E10 writer relies on', async () => {
    const user = await seedUser();

    const review = await prisma.weeklyReview.create({
      data: { userId: user.id, weekStart: '2026-08-31' },
    });

    expect(review.status).toBe('GENERATING');
    expect(review.aggregates).toEqual({});
    expect(review.aiSummary).toBeNull();
    expect(review.proposalIds).toEqual([]);
    expect(review.invocationId).toBeNull();
    expect(review.generatedAt).toBeNull();
    expect(review.approvedAt).toBeNull();

    const plan = await prisma.weeklyPlan.create({
      data: { userId: user.id, weekStart: '2026-09-07', reviewId: review.id },
    });

    expect(plan.status).toBe('DRAFT');
    expect(plan.constraints).toEqual({});
    expect(plan.domainModes).toEqual({});
    expect(plan.proposal).toBeNull();
    expect(plan.primaryFocus).toBeNull();
    expect(plan.approvedAt).toBeNull();

    const profile = await prisma.userProfile.create({ data: { userId: user.id } });

    expect(profile.weeklyReviewWeekday).toBe(0);
    expect(profile.weeklyReviewTime).toBe('17:00');
  });

  it('allows one review per user per week and lets two users share a week', async () => {
    const user = await seedUser();
    const other = await seedUser();

    await prisma.weeklyReview.create({ data: { userId: user.id, weekStart: '2026-08-31' } });

    await expect(
      prisma.weeklyReview.create({ data: { userId: user.id, weekStart: '2026-08-31' } }),
    ).rejects.toMatchObject({ code: 'P2002' });

    // The same Monday for somebody else is a different week entirely.
    await expect(
      prisma.weeklyReview.create({ data: { userId: other.id, weekStart: '2026-08-31' } }),
    ).resolves.toBeTruthy();
  });

  it('keeps the plan when its review is deleted', async () => {
    const user = await seedUser();

    const review = await prisma.weeklyReview.create({
      data: { userId: user.id, weekStart: '2026-08-31', status: 'READY' },
    });
    const plan = await prisma.weeklyPlan.create({
      data: {
        userId: user.id,
        weekStart: '2026-09-07',
        reviewId: review.id,
        status: 'APPROVED',
        approvedAt: new Date(),
      },
    });

    await prisma.weeklyReview.delete({ where: { id: review.id } });

    const after = await prisma.weeklyPlan.findUnique({ where: { id: plan.id } });

    expect(after).not.toBeNull();
    expect(after?.reviewId).toBeNull();
    expect(after?.status).toBe('APPROVED');
  });

  it('rejects a review weekday outside 0-6 at the database, not only at Zod', async () => {
    const user = await seedUser();
    await prisma.userProfile.create({ data: { userId: user.id } });

    await expect(
      prisma.userProfile.update({
        where: { userId: user.id },
        data: { weeklyReviewWeekday: 7 },
      }),
    ).rejects.toThrow(/user_profiles_weekly_review_weekday_range/);

    await expect(
      prisma.userProfile.update({
        where: { userId: user.id },
        data: { weeklyReviewWeekday: -1 },
      }),
    ).rejects.toThrow(/user_profiles_weekly_review_weekday_range/);

    // 6 (Saturday) is the last legal value, not the first illegal one.
    await expect(
      prisma.userProfile.update({
        where: { userId: user.id },
        data: { weeklyReviewWeekday: 6 },
      }),
    ).resolves.toMatchObject({ weeklyReviewWeekday: 6 });
  });

  it('removes both tables when the user is deleted', async () => {
    const user = await seedUser();

    const review = await prisma.weeklyReview.create({
      data: { userId: user.id, weekStart: '2026-08-31' },
    });
    await prisma.weeklyPlan.create({
      data: { userId: user.id, weekStart: '2026-09-07', reviewId: review.id },
    });

    await prisma.user.delete({ where: { id: user.id } });
    seededUserIds.splice(seededUserIds.indexOf(user.id), 1);

    await expect(
      prisma.weeklyReview.count({ where: { userId: user.id } }),
    ).resolves.toBe(0);
    await expect(prisma.weeklyPlan.count({ where: { userId: user.id } })).resolves.toBe(0);
  });

  it('stores the JSON columns as jsonb and the proposal ids as text[]', async () => {
    const user = await seedUser();

    await prisma.weeklyReview.create({
      data: {
        userId: user.id,
        weekStart: '2026-08-31',
        aggregates: { totals: { planned: 11 } },
        aiSummary: { source: 'template' },
        proposalIds: ['a', 'b'],
      },
    });

    const columns = await prisma.$queryRawUnsafe<
      Array<{ table_name: string; column_name: string; data_type: string }>
    >(
      `SELECT table_name, column_name, data_type FROM information_schema.columns
         WHERE table_name IN ('weekly_reviews','weekly_plans')
           AND column_name IN ('aggregates','ai_summary','constraints','domain_modes','proposal','proposal_ids')`,
    );

    const typeOf = (table: string, column: string) =>
      columns.find((c) => c.table_name === table && c.column_name === column)?.data_type;

    expect(typeOf('weekly_reviews', 'aggregates')).toBe('jsonb');
    expect(typeOf('weekly_reviews', 'ai_summary')).toBe('jsonb');
    expect(typeOf('weekly_plans', 'constraints')).toBe('jsonb');
    expect(typeOf('weekly_plans', 'domain_modes')).toBe('jsonb');
    expect(typeOf('weekly_plans', 'proposal')).toBe('jsonb');
    expect(typeOf('weekly_reviews', 'proposal_ids')).toBe('ARRAY');
  });
});
