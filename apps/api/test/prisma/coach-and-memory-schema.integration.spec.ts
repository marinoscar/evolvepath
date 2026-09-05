import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { buildDatabaseUrl } from '../../src/common/database-url';

// =============================================================================
// The E06 coach and memory tables — schema guarantees against a real database
// (issue #61)
// =============================================================================
//
// Requires a live Postgres reachable via the individual POSTGRES_* env vars
// (loaded from apps/api/.env.test by test/setup.ts) with the schema migrated,
// exactly like test/prisma/ai-invocations.integration.spec.ts.
//
// WHAT ONLY THE DATABASE CAN PROVE, and therefore what is asserted here:
//
//   1. The defaults. A proposal is PROPOSED, an insight is neither confirmed
//      nor forbidden, an obstacle has been seen once. Every writer in E06
//      relies on not having to say so.
//   2. Account deletion is whole. One DELETE on `users` removes conversations,
//      messages, proposals, insights and obstacles — the security promise in
//      the child's Definition of Done, and a relation added later without
//      Cascade would silently break it.
//   3. The two SET NULL relations really are SET NULL. Deleting the coach
//      message that produced a proposal, or the plan version an acceptance
//      produced, must leave the proposal standing with a null reference — not
//      delete it, and not fail the delete.
// =============================================================================

describe('coach and memory tables (integration, real DB)', () => {
  let prisma: PrismaClient;
  const seededUserIds: string[] = [];

  const uniqueEmail = () =>
    `coach-schema-${randomBytes(6).toString('hex')}@example.test`;

  /** A user with a plan, its v1 and a conversation — the E06 starting point. */
  async function seedUser() {
    const user = await prisma.user.create({ data: { email: uniqueEmail() } });
    seededUserIds.push(user.id);

    const outcome = await prisma.outcome.create({
      data: { userId: user.id, domain: 'HEALTH', title: 'Get strong again' },
    });
    const plan = await prisma.plan.create({
      data: { userId: user.id, outcomeId: outcome.id },
    });
    const version = await prisma.planVersion.create({
      data: { userId: user.id, planId: plan.id, version: 1, status: 'ACTIVE' },
    });
    const conversation = await prisma.coachConversation.create({
      data: { userId: user.id, title: 'Schedule changed' },
    });

    return { user, outcome, plan, version, conversation };
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

  it('applies the defaults every E06 writer relies on', async () => {
    const { user, plan, conversation } = await seedUser();

    const message = await prisma.coachMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'USER',
        content: "I can't work out Wednesday anymore.",
      },
    });

    // A USER row carries no contract, no invocation and no safety decision:
    // nothing was asked of a model yet.
    expect(message.structured).toBeNull();
    expect(message.invocationId).toBeNull();
    expect(message.safetyDecision).toBeNull();
    expect(message.attachmentIds).toEqual([]);

    const proposal = await prisma.planChangeProposal.create({
      data: {
        userId: user.id,
        planId: plan.id,
        sourceKind: 'COACH',
        sourceMessageId: message.id,
        summary: 'Move the Wednesday workout to Saturday morning.',
        changes: [{ kind: 'ROUTINE_RESCHEDULE', to: 'SAT 09:00' }],
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    // Nothing has been decided, so nothing is recorded as decided.
    expect(proposal.status).toBe('PROPOSED');
    expect(proposal.appliedPlanVersionId).toBeNull();
    expect(proposal.originalChanges).toBeNull();
    expect(proposal.editedAt).toBeNull();
    expect(proposal.decidedAt).toBeNull();
    expect(proposal.decisionReason).toBeNull();

    const insight = await prisma.memoryInsight.create({
      data: {
        userId: user.id,
        category: 'PATTERN',
        statement: 'Morning workouts are more reliable than evening ones.',
        confidence: 0.72,
        source: 'AI',
      },
    });

    // A proposed insight is neither confirmed nor forbidden. Those are two
    // different questions, and the default answer to both is "the user has not
    // said" — which is why neither can be the other's negation.
    expect(insight.userConfirmed).toBe(false);
    expect(insight.doNotUse).toBe(false);
    expect(insight.evidenceCount).toBe(0);
    expect(insight.expiresAt).toBeNull();

    const obstacle = await prisma.obstacle.create({
      data: {
        userId: user.id,
        type: 'EVENING_WORKOUT_UNRELIABLE',
        description: 'Evening workouts collide with dinner.',
        domain: 'HEALTH',
        confidence: 0.5,
      },
    });

    expect(obstacle.observedCount).toBe(1);
    expect(obstacle.interventionHistory).toEqual([]);
  });

  it('stores structured JSON as jsonb and round-trips it', async () => {
    const { conversation } = await seedUser();

    const contract = {
      interventionType: 'PLAN_ADJUSTMENT',
      reasoningSummary: 'Wednesday has been missed three weeks running.',
      proposal: { proposalId: null },
    };

    const message = await prisma.coachMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'COACH',
        content: 'Want to move it to Saturday?',
        structured: contract,
        safetyDecision: { decision: 'allow', category: 'none' },
        attachmentIds: ['b0a1f2c3-d4e5-4678-9abc-def012345678'],
      },
    });

    const [{ structured_type, safety_type }] = await prisma.$queryRawUnsafe<
      Array<{ structured_type: string; safety_type: string }>
    >(
      `select pg_typeof(structured)::text as structured_type,
              pg_typeof(safety_decision)::text as safety_type
         from coach_messages where id = $1::uuid`,
      message.id,
    );

    // jsonb, not json and not text: the assembler and the web app both read
    // keys out of these columns.
    expect(structured_type).toBe('jsonb');
    expect(safety_type).toBe('jsonb');
    expect(message.structured).toEqual(contract);
    expect(message.attachmentIds).toHaveLength(1);
  });

  it('stores plan_change_proposals.changes as jsonb', async () => {
    const { user, plan } = await seedUser();

    const proposal = await prisma.planChangeProposal.create({
      data: {
        userId: user.id,
        planId: plan.id,
        sourceKind: 'COACH',
        summary: 'Shorten the session.',
        changes: [{ kind: 'ROUTINE_UPDATE', minutes: 30 }],
        expiresAt: new Date(Date.now() + 1000),
      },
    });

    const [{ changes_type }] = await prisma.$queryRawUnsafe<
      Array<{ changes_type: string }>
    >(
      `select pg_typeof(changes)::text as changes_type
         from plan_change_proposals where id = $1::uuid`,
      proposal.id,
    );

    expect(changes_type).toBe('jsonb');
  });

  it('removes every coaching row when the account is deleted', async () => {
    const { user, plan, conversation } = await seedUser();

    const message = await prisma.coachMessage.create({
      data: { conversationId: conversation.id, role: 'USER', content: 'hi' },
    });
    const proposal = await prisma.planChangeProposal.create({
      data: {
        userId: user.id,
        planId: plan.id,
        sourceKind: 'COACH',
        sourceMessageId: message.id,
        summary: 'Move it.',
        changes: [],
        expiresAt: new Date(Date.now() + 1000),
      },
    });
    const insight = await prisma.memoryInsight.create({
      data: {
        userId: user.id,
        category: 'HEALTH',
        statement: 'Trains best before 9am.',
        confidence: 0.8,
        source: 'USER',
        userConfirmed: true,
      },
    });
    const obstacle = await prisma.obstacle.create({
      data: {
        userId: user.id,
        type: 'OVERCOMMITMENT',
        description: 'Books more than the week holds.',
        domain: 'WORK',
        confidence: 0.6,
      },
    });

    await prisma.user.delete({ where: { id: user.id } });
    seededUserIds.splice(seededUserIds.indexOf(user.id), 1);

    // One DELETE, and nothing about the coaching relationship is left behind.
    expect(
      await prisma.coachConversation.findUnique({
        where: { id: conversation.id },
      }),
    ).toBeNull();
    expect(
      await prisma.coachMessage.findUnique({ where: { id: message.id } }),
    ).toBeNull();
    expect(
      await prisma.planChangeProposal.findUnique({
        where: { id: proposal.id },
      }),
    ).toBeNull();
    expect(
      await prisma.memoryInsight.findUnique({ where: { id: insight.id } }),
    ).toBeNull();
    expect(
      await prisma.obstacle.findUnique({ where: { id: obstacle.id } }),
    ).toBeNull();
  });

  it('keeps a proposal when its source message is deleted', async () => {
    const { user, plan, conversation } = await seedUser();

    const message = await prisma.coachMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'COACH',
        content: 'Move it to Saturday?',
      },
    });
    const proposal = await prisma.planChangeProposal.create({
      data: {
        userId: user.id,
        planId: plan.id,
        sourceKind: 'COACH',
        sourceMessageId: message.id,
        summary: 'Move it to Saturday.',
        changes: [],
        expiresAt: new Date(Date.now() + 1000),
      },
    });

    await prisma.coachMessage.delete({ where: { id: message.id } });

    const after = await prisma.planChangeProposal.findUnique({
      where: { id: proposal.id },
    });

    // The conversation is transient; the record of the plan change is not.
    expect(after).not.toBeNull();
    expect(after?.sourceMessageId).toBeNull();
    expect(after?.summary).toBe('Move it to Saturday.');
  });

  it('keeps an accepted proposal when the version it produced is deleted', async () => {
    const { user, plan, version } = await seedUser();

    // A partial unique index allows one ACTIVE version per plan, so the
    // acceptance path supersedes v1 before activating v2 — mirrored here.
    await prisma.planVersion.update({
      where: { id: version.id },
      data: { status: 'SUPERSEDED' },
    });
    const v2 = await prisma.planVersion.create({
      data: { userId: user.id, planId: plan.id, version: 2, status: 'ACTIVE' },
    });
    const proposal = await prisma.planChangeProposal.create({
      data: {
        userId: user.id,
        planId: plan.id,
        sourceKind: 'COACH',
        summary: 'Move it to Saturday.',
        changes: [],
        status: 'ACCEPTED',
        appliedPlanVersionId: v2.id,
        decidedAt: new Date(),
        expiresAt: new Date(Date.now() + 1000),
      },
    });

    await prisma.planVersion.delete({ where: { id: v2.id } });

    const after = await prisma.planChangeProposal.findUnique({
      where: { id: proposal.id },
    });

    // Still ACCEPTED. A Cascade here would quietly rewrite the audit trail.
    expect(after).not.toBeNull();
    expect(after?.status).toBe('ACCEPTED');
    expect(after?.appliedPlanVersionId).toBeNull();
  });
});
