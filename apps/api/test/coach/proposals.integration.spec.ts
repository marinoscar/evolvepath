import { randomBytes, randomUUID } from 'node:crypto';
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { buildDatabaseUrl } from '../../src/common/database-url';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { OutcomesService } from '../../src/path/outcomes/outcomes.service';
import { PlansService } from '../../src/path/plans/plans.service';
import { PlanVersionsService } from '../../src/path/plans/plan-versions.service';
import { ProposalsService } from '../../src/coach/proposals/proposals.service';
import type { PlanChange } from '../../src/coach/proposals/plan-change.schema';

// =============================================================================
// The mutation protocol against a real database (issue #76, epic E06)
// =============================================================================
//
// THE CENTRAL ASSERTION IS A COUNT. PRD §89/§107 say the AI never changes a
// plan without approval, and the way this suite states that is by counting
// `plan_versions` after creating a proposal, after reading it, and after
// editing it — one, every time — and only then after accepting it. "We did not
// write anything" is exactly the kind of claim that rots silently, and a
// mocked transaction cannot see it rot.
//
// Everything else here is about what accept does to rows OTHER than the
// version: future commitments move or cancel, past ones and evidence do not,
// and `rescheduleCount` stays where it was because a change the user chose is
// not the friction signal E07 reads that column for.
// =============================================================================

const hasDatabase = Boolean(process.env.POSTGRES_HOST ?? process.env.DATABASE_URL);
const describeWithDb = hasDatabase ? describe : describe.skip;

describeWithDb('Plan-change proposals (integration, real DB)', () => {
  let prisma: PrismaClient;
  let proposals: ProposalsService;
  const seededUserIds: string[] = [];

  /** A user with one HEALTH outcome, a plan, v1 ACTIVE and one routine. */
  async function seed() {
    const user = await prisma.user.create({
      data: { email: `proposals-${randomBytes(6).toString('hex')}@example.test` },
    });
    seededUserIds.push(user.id);

    const outcome = await prisma.outcome.create({
      data: { userId: user.id, domain: 'HEALTH', title: 'Get strong again' },
    });
    const plan = await prisma.plan.create({
      data: { userId: user.id, outcomeId: outcome.id },
    });
    const version = await prisma.planVersion.create({
      data: {
        userId: user.id,
        planId: plan.id,
        version: 1,
        status: 'ACTIVE',
        rationale: 'Start with Wednesdays',
        expectedWeeklyLoad: 120,
        userApproved: true,
      },
    });
    const routine = await prisma.routine.create({
      data: {
        userId: user.id,
        planVersionId: version.id,
        title: 'Strength workout',
        domain: 'HEALTH',
        triggerType: 'TIME',
        triggerValue: 'WED',
        frequency: 'WEEKLY',
        daysOfWeek: [3],
        preferredTime: '18:30',
        estimatedDurationMin: 40,
        minimumDurationMin: 10,
      },
    });

    // Three ahead, one behind. The one behind is the control.
    const future = await Promise.all(
      [1, 8, 15].map((offsetDays) =>
        prisma.commitment.create({
          data: {
            userId: user.id,
            domain: 'HEALTH',
            title: 'Strength workout',
            planVersionId: version.id,
            routineId: routine.id,
            scheduledStart: new Date(Date.now() + offsetDays * 86_400_000),
            status: 'PLANNED',
          },
        }),
      ),
    );
    const past = await prisma.commitment.create({
      data: {
        userId: user.id,
        domain: 'HEALTH',
        title: 'Strength workout',
        planVersionId: version.id,
        routineId: routine.id,
        scheduledStart: new Date(Date.now() - 7 * 86_400_000),
        status: 'COMPLETED',
      },
    });

    return { user, outcome, plan, version, routine, future, past };
  }

  const moveToSaturday = (routineId: string): PlanChange[] => [
    {
      op: 'move',
      target: { type: 'routine', id: routineId },
      before: null,
      after: { preferredTime: '09:00', triggerValue: 'SAT', daysOfWeek: [6] },
      reason: 'Wednesday evenings stopped working',
    } as PlanChange,
  ];

  const versionCount = (planId: string) =>
    prisma.planVersion.count({ where: { planId } });

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg(buildDatabaseUrl()) });
    await prisma.$connect();

    const service = prisma as unknown as PrismaService;
    const outcomes = new OutcomesService(service);
    const plans = new PlansService(service, outcomes);
    const versions = new PlanVersionsService(service, plans);
    proposals = new ProposalsService(service, versions);
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

  // ---------------------------------------------------------------------------
  // The invariant
  // ---------------------------------------------------------------------------

  it('writes no plan version when a proposal is created, read or edited', async () => {
    const { user, plan, routine } = await seed();

    const created = await proposals.createFromCoach(user.id, {
      planId: plan.id,
      summary: 'Move the Wednesday workout to Saturday morning.',
      changes: moveToSaturday(routine.id),
    });
    expect(await versionCount(plan.id)).toBe(1);

    const read = await proposals.get(user.id, created.id);
    expect(read.preview.diff).toHaveLength(1);
    expect(await versionCount(plan.id)).toBe(1);

    await proposals.edit(user.id, created.id, [
      { ...moveToSaturday(routine.id)[0], after: { preferredTime: '10:00', triggerValue: 'SAT' } } as PlanChange,
    ]);
    expect(await versionCount(plan.id)).toBe(1);
  });

  it('renders the same diff on read that accept will apply', async () => {
    const { user, plan, routine } = await seed();

    const created = await proposals.createFromCoach(user.id, {
      planId: plan.id,
      summary: 'Move it.',
      changes: moveToSaturday(routine.id),
    });

    const preview = (await proposals.get(user.id, created.id)).preview.diff;
    await proposals.accept(user.id, created.id);

    const next = await prisma.routine.findFirst({
      where: { userId: user.id, planVersion: { status: 'ACTIVE' } },
    });

    // What the user read and what happened, compared directly.
    const timeChange = preview[0].fields.find((f) => f.field === 'preferredTime');
    expect(timeChange?.after).toBe('09:00');
    expect(next?.preferredTime).toBe('09:00');
  });

  // ---------------------------------------------------------------------------
  // Accept
  // ---------------------------------------------------------------------------

  describe('accept', () => {
    it('activates v2, supersedes v1, and leaves v1 readable', async () => {
      const { user, plan, routine, version } = await seed();

      const created = await proposals.createFromCoach(user.id, {
        planId: plan.id,
        summary: 'Move the Wednesday workout to Saturday morning.',
        changes: moveToSaturday(routine.id),
      });

      const result = await proposals.accept(user.id, created.id);

      expect(result.planVersion.version).toBe(2);
      expect(await versionCount(plan.id)).toBe(2);

      const v1 = await prisma.planVersion.findUnique({
        where: { id: version.id },
        include: { routines: true },
      });
      const v2 = await prisma.planVersion.findUnique({
        where: { id: result.planVersion.id },
        include: { routines: true },
      });

      expect(v1?.status).toBe('SUPERSEDED');
      // PRD §103: both sides of the change have to still exist for the history
      // to be readable, so v1 keeps its routines.
      expect(v1?.routines).toHaveLength(1);
      expect(v1?.routines[0].preferredTime).toBe('18:30');

      expect(v2?.status).toBe('ACTIVE');
      expect(v2?.createdBy).toBe('AI');
      expect(v2?.userApproved).toBe(true);
      expect(v2?.previousVersionId).toBe(version.id);
      expect(v2?.rationale).toContain('Move the Wednesday workout');
      expect(v2?.rationale).toContain('Wednesday evenings stopped working');
      expect(v2?.routines[0].preferredTime).toBe('09:00');
    });

    it('marks the proposal ACCEPTED and points it at the version it produced', async () => {
      const { user, plan, routine } = await seed();

      const created = await proposals.createFromCoach(user.id, {
        planId: plan.id,
        summary: 'Move it.',
        changes: moveToSaturday(routine.id),
      });
      const result = await proposals.accept(user.id, created.id);

      const row = await prisma.planChangeProposal.findUnique({
        where: { id: created.id },
      });

      expect(row?.status).toBe('ACCEPTED');
      expect(row?.appliedPlanVersionId).toBe(result.planVersion.id);
      expect(row?.decidedAt).not.toBeNull();
    });

    it('moves future commitments without counting it as a user reschedule', async () => {
      const { user, plan, routine, future, past } = await seed();

      const created = await proposals.createFromCoach(user.id, {
        planId: plan.id,
        summary: 'Move it.',
        changes: moveToSaturday(routine.id),
      });
      await proposals.accept(user.id, created.id);

      const moved = await prisma.commitment.findMany({
        where: { id: { in: future.map((c) => c.id) } },
      });

      for (const commitment of moved) {
        expect(commitment.scheduledStart.getUTCHours()).toBe(9);
        expect(commitment.scheduledStart.getUTCMinutes()).toBe(0);
        // `rescheduleCount` counts how often the USER pushed something; E07
        // reads it as friction. A plan the user changed on purpose is not that.
        expect(commitment.rescheduleCount).toBe(0);
        expect(commitment.status).toBe('PLANNED');
      }

      const untouched = await prisma.commitment.findUnique({
        where: { id: past.id },
      });
      expect(untouched?.status).toBe('COMPLETED');
      expect(untouched?.scheduledStart).toEqual(past.scheduledStart);
    });

    it('cancels future commitments of a removed routine and touches no evidence', async () => {
      const { user, plan, routine, future } = await seed();

      const evidence = await prisma.evidence.create({
        data: {
          userId: user.id,
          commitmentId: future[0].id,
          evidenceType: 'completion',
          source: 'USER_LOG',
        },
      });

      const created = await proposals.createFromCoach(user.id, {
        planId: plan.id,
        summary: 'Drop it for now.',
        changes: [
          {
            op: 'remove',
            target: { type: 'routine', id: routine.id },
            before: null,
            after: null,
            reason: 'Not doing this any more',
          } as PlanChange,
        ],
      });
      await proposals.accept(user.id, created.id);

      const cancelled = await prisma.commitment.findMany({
        where: { id: { in: future.map((c) => c.id) } },
      });
      for (const commitment of cancelled) {
        expect(commitment.status).toBe('CANCELLED');
        expect(commitment.skipReason).toBe('plan_change');
      }

      // Evidence is a fact about what happened; a plan change cannot unhappen it.
      expect(
        await prisma.evidence.findUnique({ where: { id: evidence.id } }),
      ).not.toBeNull();
    });

    it('records plan:change_accepted with both version numbers', async () => {
      const { user, plan, routine } = await seed();

      const created = await proposals.createFromCoach(user.id, {
        planId: plan.id,
        summary: 'Move it.',
        changes: moveToSaturday(routine.id),
      });
      await proposals.accept(user.id, created.id);

      const audit = await prisma.auditEvent.findFirst({
        where: { actorUserId: user.id, action: 'plan:change_accepted' },
      });

      expect(audit?.targetType).toBe('plan');
      expect(audit?.targetId).toBe(plan.id);
      expect(audit?.meta).toMatchObject({
        proposalId: created.id,
        fromVersion: 1,
        toVersion: 2,
        opCount: 1,
        edited: false,
      });
    });

    it('refuses a second accept', async () => {
      const { user, plan, routine } = await seed();

      const created = await proposals.createFromCoach(user.id, {
        planId: plan.id,
        summary: 'Move it.',
        changes: moveToSaturday(routine.id),
      });
      await proposals.accept(user.id, created.id);

      await expect(proposals.accept(user.id, created.id)).rejects.toThrow(
        ConflictException,
      );
      expect(await versionCount(plan.id)).toBe(2);
    });

    it('refuses an expired proposal and reads it as EXPIRED', async () => {
      const { user, plan, routine } = await seed();

      const created = await proposals.createFromCoach(user.id, {
        planId: plan.id,
        summary: 'Move it.',
        changes: moveToSaturday(routine.id),
      });
      await prisma.planChangeProposal.update({
        where: { id: created.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      // Lazy expiry: reading is what marks it, and there is no sweeper.
      const read = await proposals.get(user.id, created.id);
      expect(read.status).toBe('EXPIRED');

      await expect(proposals.accept(user.id, created.id)).rejects.toThrow(
        ConflictException,
      );
      expect(await versionCount(plan.id)).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Edit and reject
  // ---------------------------------------------------------------------------

  it('attributes a version to the USER when they edited the proposal first', async () => {
    const { user, plan, routine } = await seed();

    const created = await proposals.createFromCoach(user.id, {
      planId: plan.id,
      summary: 'Move it.',
      changes: moveToSaturday(routine.id),
    });

    const edited = await proposals.edit(user.id, created.id, [
      {
        op: 'move',
        target: { type: 'routine', id: routine.id },
        before: null,
        after: { preferredTime: '10:00', triggerValue: 'SAT' },
        reason: 'Ten is better than nine',
      } as PlanChange,
    ]);

    expect(edited.status).toBe('EDITED');
    // What the coach actually proposed survives the edit.
    expect(edited.originalChanges?.[0].after?.preferredTime).toBe('09:00');

    const result = await proposals.accept(user.id, created.id);
    const v2 = await prisma.planVersion.findUnique({
      where: { id: result.planVersion.id },
      include: { routines: true },
    });

    // Attribution follows who wrote the CONTENT, not who suggested it first.
    expect(v2?.createdBy).toBe('USER');
    expect(v2?.routines[0].preferredTime).toBe('10:00');
  });

  it('keeps the first originalChanges across a second edit', async () => {
    const { user, plan, routine } = await seed();

    const created = await proposals.createFromCoach(user.id, {
      planId: plan.id,
      summary: 'Move it.',
      changes: moveToSaturday(routine.id),
    });

    await proposals.edit(user.id, created.id, [
      { ...moveToSaturday(routine.id)[0], after: { preferredTime: '10:00', triggerValue: 'SAT' } } as PlanChange,
    ]);
    const twice = await proposals.edit(user.id, created.id, [
      { ...moveToSaturday(routine.id)[0], after: { preferredTime: '11:00', triggerValue: 'SAT' } } as PlanChange,
    ]);

    // Otherwise the record of the AI's suggestion becomes a record of the
    // user's first draft.
    expect(twice.originalChanges?.[0].after?.preferredTime).toBe('09:00');
  });

  it('refuses an edit that cannot apply, before storing it', async () => {
    const { user, plan, routine } = await seed();

    const created = await proposals.createFromCoach(user.id, {
      planId: plan.id,
      summary: 'Move it.',
      changes: moveToSaturday(routine.id),
    });

    await expect(
      proposals.edit(user.id, created.id, [
        {
          op: 'reduce',
          target: { type: 'routine', id: randomUUID() },
          before: { estimatedDurationMin: 40 },
          after: { estimatedDurationMin: 20 },
          reason: 'shorter',
        } as PlanChange,
      ]),
    ).rejects.toThrow(UnprocessableEntityException);

    const row = await prisma.planChangeProposal.findUnique({
      where: { id: created.id },
    });
    expect(row?.status).toBe('PROPOSED');
    expect(row?.originalChanges).toBeNull();
    expect(routine.preferredTime).toBe('18:30');
  });

  it('rejects without touching the plan', async () => {
    const { user, plan, routine } = await seed();

    const created = await proposals.createFromCoach(user.id, {
      planId: plan.id,
      summary: 'Move it.',
      changes: moveToSaturday(routine.id),
    });

    const rejected = await proposals.reject(user.id, created.id, 'Wednesday is fine');

    expect(rejected.status).toBe('REJECTED');
    expect(await versionCount(plan.id)).toBe(1);

    const audit = await prisma.auditEvent.findFirst({
      where: { actorUserId: user.id, action: 'plan:change_rejected' },
    });
    expect(audit?.meta).toMatchObject({ proposalId: created.id, hasReason: true });

    const row = await prisma.planChangeProposal.findUnique({
      where: { id: created.id },
    });
    expect(row?.decisionReason).toBe('Wednesday is fine');
  });

  // ---------------------------------------------------------------------------
  // Ownership
  // ---------------------------------------------------------------------------

  it("answers 404 for someone else's proposal, never 403", async () => {
    const mine = await seed();
    const theirs = await seed();

    const created = await proposals.createFromCoach(mine.user.id, {
      planId: mine.plan.id,
      summary: 'Move it.',
      changes: moveToSaturday(mine.routine.id),
    });

    // A 403 would confirm the id exists. `path/owned-resource.ts` is the rule.
    for (const call of [
      () => proposals.get(theirs.user.id, created.id),
      () => proposals.accept(theirs.user.id, created.id),
      () => proposals.reject(theirs.user.id, created.id),
      () => proposals.edit(theirs.user.id, created.id, moveToSaturday(mine.routine.id)),
    ]) {
      await expect(call()).rejects.toThrow(NotFoundException);
    }

    expect(await versionCount(mine.plan.id)).toBe(1);
  });

  it('will not create a proposal against a plan that is not yours', async () => {
    const mine = await seed();
    const theirs = await seed();

    await expect(
      proposals.createFromCoach(theirs.user.id, {
        planId: mine.plan.id,
        summary: 'Move it.',
        changes: moveToSaturday(mine.routine.id),
      }),
    ).rejects.toThrow(NotFoundException);
  });
});
