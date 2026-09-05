import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { buildDatabaseUrl } from '../../src/common/database-url';
import { CoachingNotificationsModule } from '../../src/coaching-notifications/coaching-notifications.module';
import { createTestApp, closeTestApp, TestContext } from '../helpers/test-app.helper';

// =============================================================================
// The coaching notification schema — guarantees only Postgres can prove (#49)
// =============================================================================
//
// Three properties, none of which exists anywhere but in the database:
//
//   1. `(user_id, event_key, dedupe_key)` IS THE SCHEDULER'S IDEMPOTENCY. The
//      engine re-scans the same window every tick, so "we already decided about
//      this candidate" has to be enforced where two concurrent ticks can both
//      see it — not by a read-then-write in application code.
//   2. THAT INDEX MUST NOT CONSTRAIN RESPONSES. OPENED/ACTIONED/DISMISSED rows
//      carry a NULL dedupe key, and this only works because Postgres treats
//      NULLs in a unique index as distinct. If that were untrue, a user could
//      open exactly one notification, ever.
//   3. THE DELETION RULES ARE OPPOSITE ON PURPOSE. A deleted user takes their
//      interactions and push endpoints with them (personal data with no reader
//      once the account is gone); a deleted commitment leaves its interaction
//      rows behind with a null id, because the independence metric is a
//      historical fact about what the coach did, not about what still exists.
// =============================================================================

const hasDatabase = Boolean(process.env.POSTGRES_HOST ?? process.env.DATABASE_URL);
const describeWithDb = hasDatabase ? describe : describe.skip;

if (!hasDatabase) {
  // eslint-disable-next-line no-console
  console.warn(
    '[coaching-notifications-schema] skipped: no POSTGRES_HOST or DATABASE_URL. ' +
      'Start the test database and set the POSTGRES_* vars in apps/api/.env.test.',
  );
}

describe('CoachingNotificationsModule', () => {
  let context: TestContext;

  afterEach(async () => {
    if (context) await closeTestApp(context);
  });

  it('resolves inside the application graph', async () => {
    context = await createTestApp();

    expect(context.module.get(CoachingNotificationsModule)).toBeDefined();
  });
});

describeWithDb('coaching notification schema (integration, real DB)', () => {
  let prisma: PrismaClient;
  const seededUserIds: string[] = [];

  async function createUser(): Promise<string> {
    const user = await prisma.user.create({
      data: { email: `coach-${randomBytes(6).toString('hex')}@example.test` },
    });
    seededUserIds.push(user.id);
    return user.id;
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

  it('allows exactly one decision per (user, event, dedupe key)', async () => {
    const userId = await createUser();
    const data = {
      userId,
      eventKey: 'coach.commitment_upcoming',
      kind: 'SENT' as const,
      dedupeKey: 'c1:upcoming',
    };

    await prisma.notificationInteraction.create({ data });

    await expect(prisma.notificationInteraction.create({ data })).rejects.toMatchObject({
      code: 'P2002',
    });
  });

  it('lets the same dedupe key be reused under a different event', async () => {
    const userId = await createUser();

    await prisma.notificationInteraction.create({
      data: { userId, eventKey: 'coach.commitment_upcoming', kind: 'SENT', dedupeKey: 'k' },
    });

    await expect(
      prisma.notificationInteraction.create({
        data: { userId, eventKey: 'coach.commitment_start', kind: 'SENT', dedupeKey: 'k' },
      }),
    ).resolves.toMatchObject({ eventKey: 'coach.commitment_start' });
  });

  it('leaves rows with a null dedupe key — the responses — unconstrained', async () => {
    const userId = await createUser();
    const data = { userId, eventKey: 'coach.commitment_upcoming', kind: 'OPENED' as const };

    await prisma.notificationInteraction.create({ data });

    await expect(prisma.notificationInteraction.create({ data })).resolves.toMatchObject({
      dedupeKey: null,
    });
  });

  it('keeps interaction rows when their commitment is deleted, with a null id', async () => {
    const userId = await createUser();
    const commitment = await prisma.commitment.create({
      data: {
        userId,
        domain: 'HEALTH',
        title: 'Upper A',
        scheduledStart: new Date('2026-09-08T15:00:00.000Z'),
      },
    });
    const interaction = await prisma.notificationInteraction.create({
      data: {
        userId,
        eventKey: 'coach.commitment_upcoming',
        kind: 'SENT',
        commitmentId: commitment.id,
        dedupeKey: `${commitment.id}:upcoming`,
      },
    });

    await prisma.commitment.delete({ where: { id: commitment.id } });

    await expect(
      prisma.notificationInteraction.findUnique({ where: { id: interaction.id } }),
    ).resolves.toMatchObject({ commitmentId: null });
  });

  it('cascades interactions and push subscriptions when the user is deleted', async () => {
    const userId = await createUser();
    await prisma.notificationInteraction.create({
      data: { userId, eventKey: 'coach.day_start', kind: 'SENT', dedupeKey: 'd' },
    });
    await prisma.pushSubscription.create({
      data: {
        userId,
        endpoint: `https://push.example.test/${randomBytes(8).toString('hex')}`,
        keys: { p256dh: 'p', auth: 'a' },
      },
    });

    await prisma.user.delete({ where: { id: userId } });

    expect(await prisma.notificationInteraction.count({ where: { userId } })).toBe(0);
    expect(await prisma.pushSubscription.count({ where: { userId } })).toBe(0);
  });

  it('refuses the same push endpoint for a second user', async () => {
    const first = await createUser();
    const second = await createUser();
    const endpoint = `https://push.example.test/${randomBytes(8).toString('hex')}`;

    await prisma.pushSubscription.create({
      data: { userId: first, endpoint, keys: { p256dh: 'p', auth: 'a' } },
    });

    await expect(
      prisma.pushSubscription.create({
        data: { userId: second, endpoint, keys: { p256dh: 'p', auth: 'a' } },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('stores the notification policy on the profile', async () => {
    const userId = await createUser();

    const profile = await prisma.userProfile.create({
      data: { userId, notificationPolicy: { dailyCap: 3 } },
    });

    expect(profile.notificationPolicy).toEqual({ dailyCap: 3 });
  });
});
