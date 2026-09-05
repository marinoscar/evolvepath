import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { buildDatabaseUrl } from '../../src/common/database-url';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { BehaviourLintService } from '../../src/family/behaviour-lint.service';
import { CommitmentsService } from '../../src/commitments/commitments.service';
import { DomainModesService } from '../../src/path/domain-modes/domain-modes.service';
import { UserProfileService } from '../../src/user-profile/user-profile.service';
import { WeeklyPlanService } from '../../src/weekly/weekly-plan.service';
import { localTimeToInstant } from '../../src/weekly/week-bounds';
import type { ExtraCommitment } from '../../src/weekly/weekly.schema';

// =============================================================================
// Approving next week against a real database (issue #80, epic E10)
// =============================================================================
//
// What a mocked transaction cannot prove, and what is therefore asserted here:
//
//   1. Approve is ATOMIC and IDEMPOTENT. A second approve creates nothing; a
//      week that was half materialised by an earlier run is completed rather
//      than duplicated.
//   2. The commitments really are linked to their routine and plan version, and
//      really do land at the user's local wall-clock time in UTC.
//   3. Domain modes are written through `DomainModesService`, so the
//      `domain_mode:set` audit row exists — and only for the domains that
//      actually changed.
//   4. The previous week's review is closed by the approve, in the same
//      transaction.
// =============================================================================

const hasDatabase = Boolean(process.env.POSTGRES_HOST ?? process.env.DATABASE_URL);
const describeWithDb = hasDatabase ? describe : describe.skip;

const TZ = 'America/Costa_Rica';
/** Sunday 2026-09-06, local. Next week is the one starting Monday the 7th. */
const NOW = new Date('2026-09-07T02:00:00.000Z');
const NEXT_WEEK = '2026-09-07';
const THIS_WEEK = '2026-08-31';

describeWithDb('Weekly planning (integration, real DB)', () => {
  let prisma: PrismaClient;
  let plans: WeeklyPlanService;
  let reviews: { markApproved: jest.Mock };
  const seededUserIds: string[] = [];

  /** A user with the epic-script routines: HEALTH Mon/Wed/Sat, WORK weekdays. */
  async function seed(weekdayMinutes: number | null = 240) {
    const user = await prisma.user.create({
      data: { email: `weekly-plan-${randomBytes(6).toString('hex')}@example.test` },
    });
    seededUserIds.push(user.id);

    await prisma.userProfile.create({
      data: {
        userId: user.id,
        timezone: TZ,
        weekdayMinutes,
        onboardingCompletedAt: new Date(),
      },
    });

    const health = await buildPlan(user.id, 'HEALTH', 'Get strong again', {
      title: 'Strength workout',
      frequency: 'CUSTOM',
      daysOfWeek: [1, 3, 6],
      preferredTime: '18:30',
      estimatedDurationMin: 40,
      minimumDurationMin: 15,
      fallbackBehavior: '10-minute circuit',
    });
    const work = await buildPlan(user.id, 'WORK', 'Ship the proposal', {
      title: 'Morning focus block',
      frequency: 'WEEKDAYS',
      daysOfWeek: [],
      preferredTime: '07:30',
      estimatedDurationMin: 50,
      minimumDurationMin: 10,
      fallbackBehavior: null,
    });

    return { user, health, work };
  }

  async function buildPlan(
    userId: string,
    domain: 'WORK' | 'FAMILY' | 'HEALTH',
    title: string,
    routine: {
      title: string;
      frequency: 'DAILY' | 'WEEKDAYS' | 'WEEKENDS' | 'WEEKLY' | 'CUSTOM';
      daysOfWeek: number[];
      preferredTime: string;
      estimatedDurationMin: number;
      minimumDurationMin: number;
      fallbackBehavior: string | null;
    },
  ) {
    const outcome = await prisma.outcome.create({ data: { userId, domain, title } });
    const plan = await prisma.plan.create({ data: { userId, outcomeId: outcome.id } });
    const version = await prisma.planVersion.create({
      data: { userId, planId: plan.id, version: 1, status: 'ACTIVE', userApproved: true },
    });
    const row = await prisma.routine.create({
      data: { userId, planVersionId: version.id, domain, triggerType: 'TIME', ...routine },
    });

    return { outcome, plan, version, routine: row };
  }

  const extra = (over: Partial<ExtraCommitment> = {}): ExtraCommitment => ({
    domain: 'WORK',
    title: 'Reading block',
    date: NEXT_WEEK,
    startTime: '20:00',
    estimatedMinutes: 20,
    minimumVersion: null,
    recurring: true,
    ...over,
  });

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg(buildDatabaseUrl()) });
    await prisma.$connect();

    const service = prisma as unknown as PrismaService;
    const profiles = new UserProfileService(service);
    const domainModes = new DomainModesService(service);
    // The lint's deterministic half needs neither the gateway nor the
    // throttle: nothing in this suite asks it for an AI rewrite.
    const commitments = new CommitmentsService(
      service,
      new BehaviourLintService(null as never, null as never),
    );

    reviews = { markApproved: jest.fn(async () => undefined) };
    plans = new WeeklyPlanService(
      service,
      commitments,
      domainModes,
      reviews as never,
      profiles,
      { get: () => 8 } as never,
    );
  });

  afterAll(async () => {
    if (seededUserIds.length > 0) {
      await prisma.auditEvent.deleteMany({ where: { actorUserId: { in: seededUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: seededUserIds } } });
    }
    await prisma.$disconnect();
  });

  beforeEach(() => {
    // Only `Date` is faked; faking `setTimeout` freezes the pg driver's timers.
    jest
      .useFakeTimers({
        doNotFake: [
          'nextTick',
          'setImmediate',
          'setTimeout',
          'setInterval',
          'clearTimeout',
          'clearInterval',
          'queueMicrotask',
        ],
      })
      .setSystemTime(NOW);
    reviews.markApproved.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('the draft', () => {
    it('defaults to next Monday and mirrors the current domain modes', async () => {
      const { user } = await seed();
      await prisma.domainMode.create({
        data: { userId: user.id, domain: 'FAMILY', mode: 'RECOVER' },
      });

      const { plan, created } = await plans.create(user.id, {});

      expect(created).toBe(true);
      expect(plan.weekStart).toBe(NEXT_WEEK);
      // Step 4 opens on the truth, so a user who changes nothing keeps what
      // they had. A domain with no row reads GROW, synthesised by E02-02.
      expect(plan.domainModes).toEqual({ WORK: 'GROW', FAMILY: 'RECOVER', HEALTH: 'GROW' });
    });

    it('returns the same draft on a second call', async () => {
      const { user } = await seed();

      const first = await plans.create(user.id, {});
      const second = await plans.create(user.id, {});

      expect(second.created).toBe(false);
      expect(second.plan.id).toBe(first.plan.id);
      await expect(prisma.weeklyPlan.count({ where: { userId: user.id } })).resolves.toBe(1);
    });

    it('refuses a week that has already ended', async () => {
      const { user } = await seed();

      await expect(plans.create(user.id, { weekStart: '2026-08-24' })).rejects.toThrow(
        /this week or later/,
      );
    });

    it('refuses a weekStart that is not a Monday', async () => {
      const { user } = await seed();

      await expect(plans.create(user.id, { weekStart: '2026-09-08' })).rejects.toThrow(
        /Monday/,
      );
    });

    it('links the previous week’s review when there is one', async () => {
      const { user } = await seed();
      const review = await prisma.weeklyReview.create({
        data: { userId: user.id, weekStart: THIS_WEEK, status: 'READY' },
      });

      const { plan } = await plans.create(user.id, {});

      expect(plan.reviewId).toBe(review.id);
      expect(plan.review).toMatchObject({ weekStart: THIS_WEEK, status: 'READY' });
    });
  });

  describe('editing', () => {
    it('replaces constraints whole and merges domain modes', async () => {
      const { user } = await seed();
      const { plan } = await plans.create(user.id, {});

      const withTwo = await plans.update(user.id, plan.id, {
        constraints: {
          travelDays: ['2026-09-09', '2026-09-10'],
          fixedEvents: [],
          notes: null,
        },
        domainModes: { FAMILY: 'MAINTAIN' },
      });
      expect(withTwo.constraints.travelDays).toEqual(['2026-09-09', '2026-09-10']);

      // A merge patch could not have removed the Thursday.
      const withOne = await plans.update(user.id, plan.id, {
        constraints: { travelDays: ['2026-09-09'], fixedEvents: [], notes: null },
      });
      expect(withOne.constraints.travelDays).toEqual(['2026-09-09']);
      // …while the mode set two calls ago survived.
      expect(withOne.domainModes).toMatchObject({ FAMILY: 'MAINTAIN', WORK: 'GROW' });
    });

    it('clears a stale proposal', async () => {
      const { user } = await seed();
      const { plan } = await plans.create(user.id, {});

      await plans.propose(user.id, plan.id, {});
      const after = await plans.update(user.id, plan.id, { primaryFocus: 'Ship the draft' });

      // The previous proposal describes a week nobody asked for.
      expect(after.proposal).toBeNull();
    });
  });

  describe('propose', () => {
    it('materialises the epic-script week with its exclusions', async () => {
      const { user } = await seed();
      const { plan } = await plans.create(user.id, {});

      await plans.update(user.id, plan.id, {
        constraints: {
          travelDays: ['2026-09-09'],
          fixedEvents: [
            { date: '2026-09-11', title: 'Dentist', startTime: '10:00', endTime: '11:00' },
          ],
          notes: null,
        },
      });

      const proposed = await plans.propose(user.id, plan.id, {});
      const items = proposed.proposal!.items;

      const included = items.filter((item) => item.include);
      const work = included.filter((item) => item.domain === 'WORK').map((i) => i.date);
      const health = included.filter((item) => item.domain === 'HEALTH').map((i) => i.date);

      // Wednesday is out for both: the travel day. The Friday dentist runs
      // 10:00–11:00 and does not touch the 07:30 block.
      expect(work).toEqual(['2026-09-07', '2026-09-08', '2026-09-10', '2026-09-11']);
      expect(health).toEqual(['2026-09-07', '2026-09-12']);

      expect(
        items.filter((item) => item.date === '2026-09-09').map((item) => item.excludedBy),
      ).toEqual(['travel_day', 'travel_day']);

      expect(proposed.proposal!.summary.recurringCount).toBe(2);
      expect(proposed.proposal!.warnings).toEqual([]);
    });

    it('raises RECURRING_OVER_CAP once past the cap and clears it again', async () => {
      const { user } = await seed();
      const { plan } = await plans.create(user.id, {});

      // Two routines plus seven recurring extras is nine.
      const extras = Array.from({ length: 7 }, (_, index) =>
        extra({ title: `Extra ${index}`, date: '2026-09-08' }),
      );

      const over = await plans.propose(user.id, plan.id, { extras });
      expect(over.proposal!.warnings.map((w) => w.code)).toContain('RECURRING_OVER_CAP');
      expect(over.proposal!.warnings[0].message).toContain('9 recurring commitments');

      const under = await plans.propose(user.id, plan.id, { extras: extras.slice(0, 6) });
      expect(under.proposal!.warnings).toEqual([]);
    });

    it('excludes a paused domain', async () => {
      const { user } = await seed();
      const { plan } = await plans.create(user.id, {});
      await plans.update(user.id, plan.id, { domainModes: { HEALTH: 'PAUSE' } });

      const proposed = await plans.propose(user.id, plan.id, {});

      expect(
        proposed.proposal!.items
          .filter((item) => item.domain === 'HEALTH')
          .every((item) => item.excludedBy === 'paused_domain'),
      ).toBe(true);
    });

    it('ignores routines on a superseded version or a paused outcome', async () => {
      const { user, health } = await seed();
      await prisma.planVersion.update({
        where: { id: health.version.id },
        data: { status: 'SUPERSEDED' },
      });

      const { plan } = await plans.create(user.id, {});
      const proposed = await plans.propose(user.id, plan.id, {});

      // Work the user already decided to stop doing.
      expect(proposed.proposal!.items.some((item) => item.domain === 'HEALTH')).toBe(false);
    });
  });

  describe('approve', () => {
    async function proposedPlan(weekdayMinutes: number | null = 240) {
      const seeded = await seed(weekdayMinutes);
      const { plan } = await plans.create(seeded.user.id, {});
      await plans.propose(seeded.user.id, plan.id, {});

      return { ...seeded, planId: plan.id };
    }

    it('writes one PLANNED commitment per included item, at the local wall clock', async () => {
      const { user, work, planId } = await proposedPlan();

      const result = await plans.approve(user.id, planId, {});

      // Five weekday blocks plus three workouts.
      expect(result.createdCommitmentIds).toHaveLength(8);
      expect(result.plan.status).toBe('APPROVED');

      const rows = await prisma.commitment.findMany({
        where: { userId: user.id },
        orderBy: { scheduledStart: 'asc' },
      });

      expect(rows).toHaveLength(8);
      expect(rows.every((row) => row.status === 'PLANNED')).toBe(true);
      expect(rows.every((row) => row.userConfirmed)).toBe(true);

      const monday = rows.find((row) => row.routineId === work.routine.id);
      expect(monday?.scheduledStart.toISOString()).toBe(
        localTimeToInstant('2026-09-07', '07:30', TZ).toISOString(),
      );
      expect(monday?.planVersionId).toBe(work.version.id);
      expect(monday?.outcomeId).toBe(work.outcome.id);
      expect(monday?.fullMinutes).toBe(50);
      expect(monday?.minimumMinutes).toBe(10);
    });

    it('refuses without a proposal', async () => {
      const { user } = await seed();
      const { plan } = await plans.create(user.id, {});

      await expect(plans.approve(user.id, plan.id, {})).rejects.toThrow(/Propose the week/);
    });

    it('writes NOTHING when warnings are unacknowledged', async () => {
      const seeded = await seed(10); // ten minutes a weekday: everything overruns
      const { plan } = await plans.create(seeded.user.id, {});
      await plans.propose(seeded.user.id, plan.id, {});

      await expect(plans.approve(seeded.user.id, plan.id, {})).rejects.toMatchObject({
        status: 422,
      });

      await expect(
        prisma.commitment.count({ where: { userId: seeded.user.id } }),
      ).resolves.toBe(0);
      await expect(
        prisma.weeklyPlan.findUnique({ where: { id: plan.id } }),
      ).resolves.toMatchObject({ status: 'DRAFT' });
    });

    it('proceeds once the user acknowledges them', async () => {
      const seeded = await seed(10);
      const { plan } = await plans.create(seeded.user.id, {});
      await plans.propose(seeded.user.id, plan.id, {});

      const result = await plans.approve(seeded.user.id, plan.id, {
        acknowledgeWarnings: true,
      });

      expect(result.createdCommitmentIds.length).toBeGreaterThan(0);
      // The warnings stay on the response: the user agreed, the software did not.
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('applies only the domain modes that actually changed', async () => {
      const { user, planId } = await proposedPlan();
      await plans.update(user.id, planId, { domainModes: { FAMILY: 'MAINTAIN' } });
      await plans.propose(user.id, planId, {});

      await plans.approve(user.id, planId, {});

      await expect(
        prisma.domainMode.findMany({ where: { userId: user.id } }),
      ).resolves.toMatchObject([{ domain: 'FAMILY', mode: 'MAINTAIN' }]);

      // Written through DomainModesService, so the audit row exists — and only
      // one, because WORK and HEALTH were already GROW.
      const audits = await prisma.auditEvent.findMany({
        where: { actorUserId: user.id, action: 'domain_mode:set' },
      });
      expect(audits).toHaveLength(1);
      expect(audits[0].meta).toMatchObject({ domain: 'FAMILY', from: 'GROW', to: 'MAINTAIN' });
    });

    it('closes the previous week’s review', async () => {
      const { user, planId } = await proposedPlan();

      await plans.approve(user.id, planId, {});

      expect(reviews.markApproved).toHaveBeenCalledWith(
        user.id,
        THIS_WEEK,
        expect.anything(),
      );
    });

    it('creates no duplicates when the week is already half materialised', async () => {
      const { user, work, planId } = await proposedPlan();

      // Something else — a quick add, a crashed earlier approve — already put
      // Monday's focus block on the calendar.
      await prisma.commitment.create({
        data: {
          userId: user.id,
          domain: 'WORK',
          title: 'Morning focus block',
          routineId: work.routine.id,
          planVersionId: work.version.id,
          scheduledStart: localTimeToInstant('2026-09-07', '07:30', TZ),
          status: 'PLANNED',
        },
      });

      const result = await plans.approve(user.id, planId, {});

      expect(result.skippedExisting).toBe(1);
      expect(result.createdCommitmentIds).toHaveLength(7);
      await expect(prisma.commitment.count({ where: { userId: user.id } })).resolves.toBe(8);
    });

    it('refuses a second approve', async () => {
      const { user, planId } = await proposedPlan();
      await plans.approve(user.id, planId, {});

      await expect(plans.approve(user.id, planId, {})).rejects.toThrow(/cannot be changed/);
      await expect(plans.create(user.id, {})).rejects.toThrow(/already been approved/);
    });

    it('records the approve with its counts', async () => {
      const { user, planId } = await proposedPlan();
      await plans.approve(user.id, planId, {});

      const audit = await prisma.auditEvent.findFirst({
        where: { actorUserId: user.id, action: 'weekly_plan:approve' },
      });

      expect(audit?.meta).toMatchObject({
        weekStart: NEXT_WEEK,
        created: 8,
        skippedExisting: 0,
        acknowledged: false,
      });
    });
  });

  describe('ownership', () => {
    it('answers 404 for another user’s plan, on every route', async () => {
      const { user } = await seed();
      const stranger = await seed();
      const { plan } = await plans.create(user.id, {});

      await expect(plans.get(stranger.user.id, plan.id)).rejects.toThrow(/not found/i);
      await expect(
        plans.update(stranger.user.id, plan.id, { primaryFocus: 'mine now' }),
      ).rejects.toThrow(/not found/i);
      await expect(plans.propose(stranger.user.id, plan.id, {})).rejects.toThrow(/not found/i);
      await expect(plans.approve(stranger.user.id, plan.id, {})).rejects.toThrow(/not found/i);
    });
  });
});
