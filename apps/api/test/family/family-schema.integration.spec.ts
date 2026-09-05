import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { buildDatabaseUrl } from '../../src/common/database-url';
import { FamilyModule } from '../../src/family/family.module';
import { createTestApp, closeTestApp, TestContext } from '../helpers/test-app.helper';

// =============================================================================
// The family schema — guarantees only a real database can prove (issue #37)
// =============================================================================
//
// Two properties, and neither of them exists anywhere except in Postgres:
//
//   1. THE UNIQUE INDEX ON `(ritual_id, scheduled_start)` IS THE IDEMPOTENCY
//      GUARANTEE the materializer (issue #41) is built on, and it only works
//      because Postgres treats NULLs as distinct. If that were ever untrue,
//      every commitment without a ritual would collide with every other one at
//      the same instant — a catastrophic failure that no unit test can see.
//   2. THE PRIVACY BOUNDARY IS ENFORCED BY COLUMN WIDTH. `VarChar(40)` on the
//      nickname is not decoration; it is the reason a paragraph about a child
//      cannot be stored in the one text column the record has.
//
// Plus the cheap boot assertion: a broken relation graph fails `AppModule`
// compilation, which is worth catching in a spec rather than at `npm start`.
// =============================================================================

const hasDatabase = Boolean(process.env.POSTGRES_HOST ?? process.env.DATABASE_URL);
const describeWithDb = hasDatabase ? describe : describe.skip;

if (!hasDatabase) {
  // eslint-disable-next-line no-console
  console.warn(
    '[family-schema] skipped: no POSTGRES_HOST or DATABASE_URL. Start the test ' +
      'database and set the POSTGRES_* vars in apps/api/.env.test to run these.',
  );
}

describe('FamilyModule', () => {
  let context: TestContext;

  afterEach(async () => {
    if (context) await closeTestApp(context);
  });

  it('resolves inside the application graph', async () => {
    context = await createTestApp();

    expect(context.module.get(FamilyModule)).toBeDefined();
  });
});

describeWithDb('family schema (integration, real DB)', () => {
  let prisma: PrismaClient;
  const seededUserIds: string[] = [];

  async function createUser(): Promise<string> {
    const user = await prisma.user.create({
      data: { email: `family-${randomBytes(6).toString('hex')}@example.test` },
    });
    seededUserIds.push(user.id);
    return user.id;
  }

  async function createRitual(userId: string): Promise<string> {
    const ritual = await prisma.ritual.create({
      data: {
        userId,
        title: 'Phone-free dinner',
        recurrence: { weekdays: [2, 4, 0], time: '18:30', everyNWeeks: 1 },
        idealMinutes: 45,
        minimumMinutes: 10,
      },
    });
    return ritual.id;
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

  it('rejects a second commitment for the same ritual at the same instant', async () => {
    const userId = await createUser();
    const ritualId = await createRitual(userId);
    const scheduledStart = new Date('2026-09-08T00:30:00.000Z');

    await prisma.commitment.create({
      data: { userId, domain: 'FAMILY', title: 'Phone-free dinner', scheduledStart, ritualId },
    });

    await expect(
      prisma.commitment.create({
        data: { userId, domain: 'FAMILY', title: 'Phone-free dinner', scheduledStart, ritualId },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('leaves commitments without a ritual unaffected by that index', async () => {
    const userId = await createUser();
    const scheduledStart = new Date('2026-09-08T00:30:00.000Z');

    await prisma.commitment.create({
      data: { userId, domain: 'FAMILY', title: 'Dinner', scheduledStart },
    });

    await expect(
      prisma.commitment.create({
        data: { userId, domain: 'FAMILY', title: 'Another dinner', scheduledStart },
      }),
    ).resolves.toMatchObject({ ritualId: null });
  });

  it('rejects a nickname longer than the column', async () => {
    const userId = await createUser();

    await expect(
      prisma.familyMember.create({
        data: { userId, nickname: 'x'.repeat(41), relationship: 'CHILD' },
      }),
    ).rejects.toThrow();
  });

  it('cascades family members and rituals when the user is deleted', async () => {
    const userId = await createUser();
    await prisma.familyMember.create({ data: { userId, nickname: 'Mia', relationship: 'CHILD' } });
    await createRitual(userId);

    await prisma.user.delete({ where: { id: userId } });

    expect(await prisma.familyMember.count({ where: { userId } })).toBe(0);
    expect(await prisma.ritual.count({ where: { userId } })).toBe(0);
  });

  it('nulls the links instead of deleting history when a ritual or member goes', async () => {
    const userId = await createUser();
    const member = await prisma.familyMember.create({
      data: { userId, nickname: 'Mia', relationship: 'CHILD' },
    });
    const ritualId = await createRitual(userId);
    const commitment = await prisma.commitment.create({
      data: {
        userId,
        domain: 'FAMILY',
        title: 'Phone-free dinner',
        scheduledStart: new Date('2026-09-08T00:30:00.000Z'),
        status: 'COMPLETED',
        ritualId,
        familyMemberId: member.id,
      },
    });

    await prisma.ritual.delete({ where: { id: ritualId } });
    await prisma.familyMember.delete({ where: { id: member.id } });

    // The record of what the user actually did survives both deletions.
    await expect(
      prisma.commitment.findUnique({ where: { id: commitment.id } }),
    ).resolves.toMatchObject({ ritualId: null, familyMemberId: null, status: 'COMPLETED' });
  });

  it('stores the birthday as a calendar date, unshifted by any zone', async () => {
    const userId = await createUser();

    const member = await prisma.familyMember.create({
      data: {
        userId,
        nickname: 'Mia',
        relationship: 'CHILD',
        birthday: new Date('2018-05-09T00:00:00.000Z'),
      },
    });

    expect(member.birthday?.toISOString().slice(0, 10)).toBe('2018-05-09');
  });
});
