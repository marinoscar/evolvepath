import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { buildDatabaseUrl } from '../../src/common/database-url';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { ContextAssemblerService } from '../../src/coach/context/context-assembler.service';
import { ProposalsService } from '../../src/coach/proposals/proposals.service';
import { OutcomesService } from '../../src/path/outcomes/outcomes.service';
import { PlansService } from '../../src/path/plans/plans.service';
import { PlanVersionsService } from '../../src/path/plans/plan-versions.service';
import { UserProfileService } from '../../src/user-profile/user-profile.service';
import { AggregationService } from '../../src/weekly/aggregation.service';
import { WeeklyReviewService } from '../../src/weekly/weekly-review.service';
import { WeeklySettingsService } from '../../src/weekly/weekly-settings.service';
import { localTimeToInstant } from '../../src/weekly/week-bounds';
import type { WeeklyReviewOutput } from '../../src/weekly/weekly.schema';

// =============================================================================
// Weekly review generation against a real database (issue #73, epic E10)
// =============================================================================
//
// THE CENTRAL ASSERTION IS A COUNT, as it is for E06's proposals: generating a
// review must leave `plan_versions` exactly as it found it, however many plan
// changes the reviewer proposed. The reviewer's output becomes proposal rows
// and stops (PRD §15, §89) — and "we did not write anything" is exactly the
// kind of claim that rots silently in a mocked transaction.
//
// The rest is what a mock cannot prove: that the aggregation reads back the
// week that was actually written, that regenerating replaces the same row
// rather than racing the unique index, and that a provider failure still
// produces a READY review.
// =============================================================================

const hasDatabase = Boolean(process.env.POSTGRES_HOST ?? process.env.DATABASE_URL);
const describeWithDb = hasDatabase ? describe : describe.skip;

const TZ = 'America/Costa_Rica';
const WEEK_START = '2026-08-31';
/** Sunday 20:00 local — every day of the week has happened. */
const NOW = new Date('2026-09-07T02:00:00.000Z');

describeWithDb('Weekly review (integration, real DB)', () => {
  let prisma: PrismaClient;
  let reviews: WeeklyReviewService;
  let settings: WeeklySettingsService;
  let gateway: { invoke: jest.Mock };
  const seededUserIds: string[] = [];

  /**
   * The epic-script week: a WORK plan with five morning blocks (four done, one
   * skipped) and a HEALTH plan with three workouts (one full, one minimum, one
   * moved twice).
   */
  async function seed() {
    const user = await prisma.user.create({
      data: { email: `weekly-${randomBytes(6).toString('hex')}@example.test` },
    });
    seededUserIds.push(user.id);

    await prisma.userProfile.create({
      data: {
        userId: user.id,
        timezone: TZ,
        coachingStyle: 'BALANCED',
        weekdayMinutes: 90,
        onboardingCompletedAt: new Date(),
      },
    });

    const health = await buildPlan(user.id, 'HEALTH', 'Get strong again', {
      title: 'Strength workout',
      preferredTime: '18:30',
      daysOfWeek: [1, 3, 6],
      estimatedDurationMin: 40,
      minimumDurationMin: 15,
    });
    const work = await buildPlan(user.id, 'WORK', 'Ship the proposal', {
      title: 'Morning focus block',
      preferredTime: '07:30',
      daysOfWeek: [1, 2, 3, 4, 5],
      estimatedDurationMin: 50,
      minimumDurationMin: 10,
    });

    const at = (date: string, time: string) => localTimeToInstant(date, time, TZ);

    // WORK: four completed, one skipped.
    const workDates = ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'];
    for (const [index, date] of workDates.entries()) {
      await prisma.commitment.create({
        data: {
          userId: user.id,
          domain: 'WORK',
          title: 'Morning focus block',
          planVersionId: work.version.id,
          routineId: work.routine.id,
          outcomeId: work.outcome.id,
          scheduledStart: at(date, '07:30'),
          scheduledEnd: at(date, '08:20'),
          status: index === 4 ? 'SKIPPED' : 'COMPLETED',
          versionUsed: index === 4 ? null : 'FULL',
          minutesSpent: index === 4 ? null : 50,
          startedAt: index === 4 ? null : at(date, '07:30'),
        },
      });
    }

    // HEALTH: one full, one minimum, one moved twice and still open.
    await prisma.commitment.create({
      data: {
        userId: user.id,
        domain: 'HEALTH',
        title: 'Strength workout',
        planVersionId: health.version.id,
        routineId: health.routine.id,
        outcomeId: health.outcome.id,
        scheduledStart: at('2026-08-31', '18:30'),
        status: 'COMPLETED',
        versionUsed: 'FULL',
        minutesSpent: 40,
      },
    });
    await prisma.commitment.create({
      data: {
        userId: user.id,
        domain: 'HEALTH',
        title: 'Strength workout',
        planVersionId: health.version.id,
        routineId: health.routine.id,
        outcomeId: health.outcome.id,
        scheduledStart: at('2026-09-02', '18:30'),
        status: 'COMPLETED',
        versionUsed: 'MINIMUM',
        minutesSpent: 15,
      },
    });
    const original = await prisma.commitment.create({
      data: {
        userId: user.id,
        domain: 'HEALTH',
        title: 'Strength workout',
        planVersionId: health.version.id,
        routineId: health.routine.id,
        scheduledStart: at('2026-09-04', '18:30'),
        status: 'RESCHEDULED',
      },
    });
    await prisma.commitment.create({
      data: {
        userId: user.id,
        domain: 'HEALTH',
        title: 'Strength workout',
        planVersionId: health.version.id,
        routineId: health.routine.id,
        scheduledStart: at('2026-09-05', '18:30'),
        status: 'PLANNED',
        rescheduleCount: 2,
        rescheduledFromId: original.id,
      },
    });

    await prisma.reflection.create({
      data: {
        userId: user.id,
        relatedType: 'day',
        frictionTags: ['BAD_TIMING'],
        createdAt: at('2026-09-03', '21:00'),
      },
    });

    return { user, health, work };
  }

  async function buildPlan(
    userId: string,
    domain: 'WORK' | 'FAMILY' | 'HEALTH',
    title: string,
    routine: {
      title: string;
      preferredTime: string;
      daysOfWeek: number[];
      estimatedDurationMin: number;
      minimumDurationMin: number;
    },
  ) {
    const outcome = await prisma.outcome.create({ data: { userId, domain, title } });
    const plan = await prisma.plan.create({ data: { userId, outcomeId: outcome.id } });
    const version = await prisma.planVersion.create({
      data: {
        userId,
        planId: plan.id,
        version: 1,
        status: 'ACTIVE',
        rationale: 'The first plan',
        userApproved: true,
      },
    });
    const row = await prisma.routine.create({
      data: {
        userId,
        planVersionId: version.id,
        domain,
        triggerType: 'TIME',
        frequency: 'CUSTOM',
        ...routine,
      },
    });

    return { outcome, plan, version, routine: row };
  }

  function reviewerOutput(
    proposedChanges: WeeklyReviewOutput['proposedChanges'] = [],
  ): WeeklyReviewOutput {
    return {
      whatWorked: ['Morning focus blocks: 4 of 5 done'],
      whatDidNot: ['Evening workouts were moved twice'],
      patterns: [
        {
          observation: '4 of 5 morning commitments were done; 2 of 3 in the evening',
          inference: 'Plans after 18:00 are less reliable than mornings',
          recommendation: 'Move the Wednesday workout to Saturday morning',
          confidence: 0.8,
          domain: 'HEALTH',
        },
      ],
      proposedChanges,
      keepUnchanged: ['Morning focus block routine'],
      doNotAddYet: [],
    };
  }

  const ok = (output: WeeklyReviewOutput) => ({
    ok: true as const,
    invocationId: '11111111-1111-4111-8111-111111111111',
    output,
    usage: {},
    model: 'gpt-test',
    latencyMs: 12,
  });

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg(buildDatabaseUrl()) });
    await prisma.$connect();

    const service = prisma as unknown as PrismaService;
    const outcomes = new OutcomesService(service);
    const plans = new PlansService(service, outcomes);
    const versions = new PlanVersionsService(service, plans);
    const proposals = new ProposalsService(service, versions);
    const context = new ContextAssemblerService(service);
    const profiles = new UserProfileService(service);
    const aggregation = new AggregationService(service);

    gateway = { invoke: jest.fn() };
    settings = new WeeklySettingsService(service, profiles);
    reviews = new WeeklyReviewService(
      service,
      aggregation,
      context,
      gateway as never,
      proposals,
      { proposeInsights: jest.fn(async () => ({})) } as never,
      profiles,
      { get: () => 8 } as never,
    );
  });

  afterAll(async () => {
    if (seededUserIds.length > 0) {
      await prisma.auditEvent.deleteMany({
        where: { actorUserId: { in: seededUserIds } },
      });
      await prisma.user.deleteMany({ where: { id: { in: seededUserIds } } });
    }
    await prisma.$disconnect();
  });

  beforeEach(() => {
    // ONLY `Date` is faked. Faking `setTimeout` too would freeze the pg driver's
    // own timers and every query in this suite would hang rather than fail.
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
    gateway.invoke.mockReset();
    gateway.invoke.mockResolvedValue(ok(reviewerOutput()));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('aggregates the week that was actually written', async () => {
    const { user } = await seed();

    const detail = await reviews.generate(user.id, {
      weekStart: WEEK_START,
      trigger: 'manual',
    });

    expect(detail.status).toBe('READY');

    const aggregates = detail.aggregates as {
      domains: Record<string, Record<string, number>>;
      rescheduleLeaders: Array<{ rescheduleCount: number }>;
    };

    expect(aggregates.domains.WORK).toMatchObject({ planned: 5, completed: 4, skipped: 1 });
    // Three intentions, not four: the RESCHEDULED original is not planned.
    expect(aggregates.domains.HEALTH).toMatchObject({
      planned: 3,
      completed: 2,
      fallbackUsed: 1,
      rescheduled: 1,
    });
    expect(aggregates.rescheduleLeaders[0].rescheduleCount).toBe(2);
  });

  it('turns a proposed change into a proposal row and writes NO plan version', async () => {
    const { user, health } = await seed();

    const before = await prisma.planVersion.count({ where: { planId: health.plan.id } });
    expect(before).toBe(1);

    gateway.invoke.mockResolvedValue(
      ok(
        reviewerOutput([
          {
            planId: health.plan.id,
            summary: 'Move Wednesday workout to Saturday morning',
            changes: [
              {
                op: 'move',
                target: { type: 'routine', id: health.routine.id },
                before: { preferredTime: '18:30', triggerValue: 'WED' },
                after: { preferredTime: '09:00', triggerValue: 'SAT' },
                reason: 'Evening sessions were moved twice; mornings held.',
              },
            ],
          },
        ]),
      ),
    );

    const detail = await reviews.generate(user.id, {
      weekStart: WEEK_START,
      trigger: 'manual',
    });

    expect(detail.proposals).toHaveLength(1);

    const proposals = await prisma.planChangeProposal.findMany({
      where: { userId: user.id },
    });
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ sourceKind: 'WEEKLY_REVIEW', status: 'PROPOSED' });

    // The whole point. A review reads the week and proposes; it does not act.
    await expect(
      prisma.planVersion.count({ where: { planId: health.plan.id } }),
    ).resolves.toBe(1);
  });

  it('drops a proposal naming a plan the user does not have', async () => {
    const { user } = await seed();
    const stranger = await seed();

    gateway.invoke.mockResolvedValue(
      ok(
        reviewerOutput([
          {
            planId: stranger.health.plan.id,
            summary: 'Move somebody else’s workout',
            changes: [
              {
                op: 'move',
                target: { type: 'routine', id: stranger.health.routine.id },
                before: { preferredTime: '18:30' },
                after: { preferredTime: '09:00' },
                reason: 'Not this user’s plan at all.',
              },
            ],
          },
        ]),
      ),
    );

    const detail = await reviews.generate(user.id, {
      weekStart: WEEK_START,
      trigger: 'manual',
    });

    expect(detail.proposals).toEqual([]);
    await expect(
      prisma.planChangeProposal.count({ where: { userId: user.id } }),
    ).resolves.toBe(0);

    const audit = await prisma.auditEvent.findFirst({
      where: { actorUserId: user.id, action: 'weekly_review:generate' },
    });
    expect(audit?.meta).toMatchObject({ droppedProposals: 1, proposalCount: 0 });
  });

  it('still produces a READY review when the provider is unreachable', async () => {
    const { user } = await seed();
    gateway.invoke.mockResolvedValue({
      ok: false,
      invocationId: '22222222-2222-4222-8222-222222222222',
      error: { code: 'timeout', message: 'timed out' },
      model: null,
      latencyMs: 60_000,
    });

    const detail = await reviews.generate(user.id, {
      weekStart: WEEK_START,
      trigger: 'manual',
    });

    expect(detail.status).toBe('READY');
    expect(detail.aiSummary).toMatchObject({ source: 'template', promptVersion: null });
    // Numeric sentences only, and never a plan change.
    expect((detail.aiSummary as { whatWorked: string[] }).whatWorked).toContain(
      'Work: 4 of 5 done.',
    );
    expect((detail.aiSummary as { proposedChanges: unknown[] }).proposedChanges).toEqual([]);
  });

  it('replaces the same row when the same week is generated twice', async () => {
    const { user } = await seed();

    const first = await reviews.generate(user.id, {
      weekStart: WEEK_START,
      trigger: 'manual',
    });
    const second = await reviews.generate(user.id, {
      weekStart: WEEK_START,
      trigger: 'manual',
    });

    expect(second.id).toBe(first.id);
    await expect(prisma.weeklyReview.count({ where: { userId: user.id } })).resolves.toBe(1);
  });

  it('reads back through current, and answers 404 for another user’s review', async () => {
    const { user } = await seed();
    const stranger = await seed();

    const mine = await reviews.generate(user.id, {
      weekStart: WEEK_START,
      trigger: 'manual',
    });

    await expect(reviews.current(user.id)).resolves.toMatchObject({ id: mine.id });
    await expect(reviews.current(stranger.user.id)).resolves.toBeNull();
    await expect(reviews.get(stranger.user.id, mine.id)).rejects.toThrow(/not found/i);
  });

  it('records exactly one audit row per generation', async () => {
    const { user } = await seed();

    await reviews.generate(user.id, { weekStart: WEEK_START, trigger: 'manual' });

    const rows = await prisma.auditEvent.findMany({
      where: { actorUserId: user.id, action: 'weekly_review:generate' },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].meta).toMatchObject({
      weekStart: WEEK_START,
      trigger: 'manual',
      source: 'ai',
    });
  });

  it('refuses to regenerate a week that has been approved', async () => {
    const { user } = await seed();
    const detail = await reviews.generate(user.id, {
      weekStart: WEEK_START,
      trigger: 'manual',
    });

    await prisma.weeklyReview.update({
      where: { id: detail.id },
      data: { status: 'APPROVED', approvedAt: new Date() },
    });

    await expect(
      reviews.generate(user.id, { weekStart: WEEK_START, trigger: 'manual' }),
    ).rejects.toThrow(/approved/i);
  });

  it('rejects a weekStart that is not a Monday', async () => {
    const { user } = await seed();

    await expect(
      reviews.generate(user.id, { weekStart: '2026-09-01', trigger: 'manual' }),
    ).rejects.toThrow(/Monday/);
  });

  it('round-trips the weekly rhythm settings', async () => {
    const { user } = await seed();

    const updated = await settings.update(user.id, {
      weeklyReviewWeekday: 5,
      weeklyReviewTime: '16:00',
    });

    expect(updated).toMatchObject({
      weeklyReviewWeekday: 5,
      weeklyReviewTime: '16:00',
      timezone: TZ,
    });
    // Friday 16:00 local, from Sunday evening: 2026-09-11T22:00Z.
    expect(updated.nextReviewAt).toBe('2026-09-11T22:00:00.000Z');

    const profile = await prisma.userProfile.findUnique({ where: { userId: user.id } });
    expect(profile).toMatchObject({ weeklyReviewWeekday: 5, weeklyReviewTime: '16:00' });
  });
});
