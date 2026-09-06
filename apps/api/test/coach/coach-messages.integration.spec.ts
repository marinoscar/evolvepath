import { randomBytes, randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { buildDatabaseUrl } from '../../src/common/database-url';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { AiGatewayService } from '../../src/ai/gateway/ai-gateway.service';
import type { SafetyPolicyService } from '../../src/coach/safety/safety-policy.service';
import type { SafetyDecision } from '../../src/coach/safety/safety.types';
import { OutcomesService } from '../../src/path/outcomes/outcomes.service';
import { PlansService } from '../../src/path/plans/plans.service';
import { PlanVersionsService } from '../../src/path/plans/plan-versions.service';
import { UserProfileService } from '../../src/user-profile/user-profile.service';
import { ContextAssemblerService } from '../../src/coach/context/context-assembler.service';
import { CoachConversationsService } from '../../src/coach/coach-conversations.service';
import { CoachService } from '../../src/coach/coach.service';
import { ProposalsService } from '../../src/coach/proposals/proposals.service';
import { COACH_PROMPT_VERSION } from '../../src/coach/prompts/coach.prompt';
import { SAFETY_REDIRECT_COPY } from '../../src/coach/safety/safety-copy';
import type { CoachReply } from '../../src/coach/contracts/coach-reply.contract';
import { ActivityTrackerService } from '../../src/progress/comeback/activity-tracker.service';

// =============================================================================
// One coaching turn, end to end (issue #70, epic E06)
// =============================================================================
//
// The gateway is a stub because the point is not what a model says — it is
// what this service does with what a model says. Four of those behaviours only
// exist across the whole turn and cannot be unit-tested:
//
//   - A provider failure is a 201 with readable copy, not an exception.
//   - A reply naming things the user does not have never reaches the client,
//     and the invocation row is updated to `invalid_output`.
//   - A reply carrying a proposal creates exactly one proposal row and ZERO
//     plan versions.
//   - A safety redirect never calls the gateway at all.
// =============================================================================

const hasDatabase = Boolean(process.env.POSTGRES_HOST ?? process.env.DATABASE_URL);
const describeWithDb = hasDatabase ? describe : describe.skip;

const ALLOW: SafetyDecision = {
  decision: 'allow',
  category: 'none',
  source: 'precheck',
};

describeWithDb('Coach messages (integration, real DB)', () => {
  let prisma: PrismaClient;
  let coach: CoachService;
  let conversations: CoachConversationsService;

  const invoke = jest.fn();
  const evaluate = jest.fn();
  const seededUserIds: string[] = [];

  const reply = (over: Partial<CoachReply> = {}): CoachReply =>
    ({
      intervention_type: 'ACTIVATION_REDUCTION',
      reasoning_summary: 'Wednesday evenings have been missed three weeks running.',
      user_message: 'Want to try ten minutes on Saturday morning instead?',
      recommended_action: null,
      fallback_action: null,
      proposal: null,
      friction_question: null,
      ...over,
    }) as CoachReply;

  const ok = (output: CoachReply, invocationId = randomUUID()) => ({
    ok: true as const,
    invocationId,
    output,
    usage: { inputTokens: 1, outputTokens: 1 },
    model: 'gpt-5.4',
    latencyMs: 5,
  });

  async function seed() {
    const user = await prisma.user.create({
      data: { email: `coach-${randomBytes(6).toString('hex')}@example.test` },
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
        userApproved: true,
      },
    });
    const routine = await prisma.routine.create({
      data: {
        userId: user.id,
        planVersionId: version.id,
        title: 'Strength workout',
        domain: 'HEALTH',
        preferredTime: '18:30',
        estimatedDurationMin: 40,
        minimumDurationMin: 10,
      },
    });

    return { user, plan, version, routine };
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg(buildDatabaseUrl()) });
    await prisma.$connect();

    const service = prisma as unknown as PrismaService;
    const outcomes = new OutcomesService(service);
    const plans = new PlansService(service, outcomes);
    const versions = new PlanVersionsService(service, plans);
    const proposals = new ProposalsService(service, versions);
    const assembler = new ContextAssemblerService(service);
    const profiles = new UserProfileService(service);
    conversations = new CoachConversationsService(service);

    coach = new CoachService(
      service,
      { invoke } as unknown as AiGatewayService,
      { evaluate } as unknown as SafetyPolicyService,
      assembler,
      conversations,
      proposals,
      profiles,
      new ActivityTrackerService(service, profiles),
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
    invoke.mockReset();
    evaluate.mockReset().mockResolvedValue(ALLOW);
  });

  // ---------------------------------------------------------------------------
  // Happy path
  // ---------------------------------------------------------------------------

  it('stores the user turn and the coach turn, and returns the contract', async () => {
    const { user } = await seed();
    invoke.mockResolvedValue(ok(reply()));

    const result = await coach.sendMessage(user.id, { text: "I'm procrastinating" });

    expect(result.degraded).toBe(false);
    expect(result.userMessage.role).toBe('USER');
    expect(result.coachMessage.role).toBe('COACH');
    expect(result.coachMessage.structured).toMatchObject({
      intervention_type: 'ACTIVATION_REDUCTION',
    });

    const rows = await prisma.coachMessage.findMany({
      where: { conversationId: result.conversationId },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows.map((r) => r.role)).toEqual(['USER', 'COACH']);
    expect(rows[1].invocationId).not.toBeNull();
  });

  it('calls the coach persona with its versioned prompt and schema name', async () => {
    const { user } = await seed();
    invoke.mockResolvedValue(ok(reply()));

    await coach.sendMessage(user.id, { text: 'Help me plan my week' });

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][0]).toMatchObject({
      persona: 'coach',
      userId: user.id,
      promptVersion: COACH_PROMPT_VERSION,
      schemaName: 'coach_reply',
      safetyDecision: ALLOW,
    });
  });

  it('never puts the invocation id on the wire', async () => {
    const { user } = await seed();
    invoke.mockResolvedValue(ok(reply()));

    const result = await coach.sendMessage(user.id, { text: 'hello' });

    // It is a support handle. A client that had it would turn it into an API.
    expect(JSON.stringify(result)).not.toContain('invocationId');
  });

  it('titles a new conversation from the first thing the user said', async () => {
    const { user } = await seed();
    invoke.mockResolvedValue(ok(reply()));

    const result = await coach.sendMessage(user.id, {
      text: 'My schedule changed and Wednesday no longer works for me at all',
    });

    const row = await prisma.coachConversation.findUnique({
      where: { id: result.conversationId },
    });
    // The first 60 characters, trimmed. Asking a model to name the thread
    // would put a second AI call on the critical path of a screen whose whole
    // promise is that it works when the model does not.
    expect(row?.title).toBe('My schedule changed and Wednesday no longer works for me at');
  });

  // ---------------------------------------------------------------------------
  // Degradation (PRD §120)
  // ---------------------------------------------------------------------------

  describe('when the coach is unavailable', () => {
    it.each(['timeout', 'rate_limit', 'no_user_key', 'ai_disabled'])(
      'answers with readable copy for %s rather than throwing',
      async (code) => {
        const { user } = await seed();
        invoke.mockResolvedValue({
          ok: false,
          invocationId: randomUUID(),
          error: { code, message: 'nope' },
          model: null,
          latencyMs: 1,
        });

        const result = await coach.sendMessage(user.id, { text: 'hello' });

        expect(result.degraded).toBe(true);
        expect(result.coachMessage.content.length).toBeGreaterThan(0);
        // A fallback must be indistinguishable from "no model output", or a
        // client would start rendering a fake intervention type.
        expect(result.coachMessage.structured).toBeNull();
      },
    );

    it('still records the turn in the thread', async () => {
      const { user } = await seed();
      invoke.mockResolvedValue({
        ok: false,
        invocationId: randomUUID(),
        error: { code: 'timeout', message: 'slow' },
        model: null,
        latencyMs: 1,
      });

      const result = await coach.sendMessage(user.id, { text: 'hello' });

      const rows = await prisma.coachMessage.findMany({
        where: { conversationId: result.conversationId },
      });
      expect(rows).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // The guard (PRD §90)
  // ---------------------------------------------------------------------------

  it('discards a reply naming a commitment the user does not have', async () => {
    const { user } = await seed();
    const invocationId = randomUUID();

    // The invocation row the gateway would have written.
    await prisma.aiInvocation.create({
      data: {
        id: invocationId,
        operation: 'invoke',
        keyScope: 'user',
        userId: user.id,
        persona: 'coach',
        provider: 'openai',
        status: 'succeeded',
        latencyMs: 5,
      },
    });

    invoke.mockResolvedValue(
      ok(
        reply({
          recommended_action: {
            title: 'Finish the thing you already did',
            duration_minutes: 10,
            commitmentId: randomUUID(),
          },
        }),
        invocationId,
      ),
    );

    const result = await coach.sendMessage(user.id, { text: 'what now?' });

    // The fabricated sentence never reaches the client.
    expect(result.degraded).toBe(true);
    expect(result.coachMessage.structured).toBeNull();
    expect(result.coachMessage.content).not.toContain('already did');

    const row = await prisma.aiInvocation.findUnique({ where: { id: invocationId } });
    expect(row?.status).toBe('invalid_output');
    expect(row?.outputValid).toBe(false);
    expect(row?.errorCode).toBe('hallucination_guard');
  });

  it('accepts a reply naming a real commitment', async () => {
    const { user, version, routine } = await seed();
    const commitment = await prisma.commitment.create({
      data: {
        userId: user.id,
        domain: 'HEALTH',
        title: 'Strength workout',
        planVersionId: version.id,
        routineId: routine.id,
        scheduledStart: new Date(),
        status: 'PLANNED',
      },
    });

    invoke.mockResolvedValue(
      ok(
        reply({
          recommended_action: {
            title: 'Ten minutes',
            duration_minutes: 10,
            commitmentId: commitment.id,
          },
        }),
      ),
    );

    const result = await coach.sendMessage(user.id, { text: 'what now?' });

    expect(result.degraded).toBe(false);
    expect(result.coachMessage.structured).toMatchObject({
      recommended_action: { commitmentId: commitment.id },
    });
  });

  // ---------------------------------------------------------------------------
  // Proposals (PRD §15)
  // ---------------------------------------------------------------------------

  it('turns a proposal into a row and no plan version at all', async () => {
    const { user, plan, routine } = await seed();

    invoke.mockResolvedValue(
      ok(
        reply({
          intervention_type: 'PLAN_CHALLENGE',
          proposal: {
            kind: 'plan_change',
            planId: plan.id,
            summary: 'Move the Wednesday workout to Saturday morning.',
            changes: [
              {
                op: 'move',
                target: { type: 'routine', id: routine.id },
                before: null,
                after: { preferredTime: '09:00', triggerValue: 'SAT' },
                reason: 'Wednesday evenings stopped working',
              },
            ],
          },
        }),
      ),
    );

    const result = await coach.sendMessage(user.id, {
      text: "I can't work out Wednesday anymore",
    });

    expect(result.proposal?.status).toBe('PROPOSED');
    expect(result.coachMessage.structured).toMatchObject({
      proposal: { proposalId: result.proposal!.id },
    });

    expect(await prisma.planChangeProposal.count({ where: { planId: plan.id } })).toBe(1);
    // VISION §19: the coach proposed; nothing changed.
    expect(await prisma.planVersion.count({ where: { planId: plan.id } })).toBe(1);

    const stored = await prisma.planChangeProposal.findFirst({
      where: { planId: plan.id },
    });
    // The proposal points back at the message that produced it, so accepting
    // it can drop a SYSTEM notice into this thread.
    expect(stored?.sourceMessageId).toBe(result.coachMessage.id);
  });

  // ---------------------------------------------------------------------------
  // Safety (PRD §14.8)
  // ---------------------------------------------------------------------------

  it('answers a redirect without calling the model', async () => {
    const { user } = await seed();
    evaluate.mockResolvedValue({
      decision: 'redirect',
      category: 'injury',
      userFacingNote: SAFETY_REDIRECT_COPY.injury,
      source: 'precheck',
      matchedRule: 'injury.chest_pain',
    } satisfies SafetyDecision);

    const result = await coach.sendMessage(user.id, {
      text: 'I have sharp chest pain when I run',
    });

    // Zero. The copy is a constant, so this branch is the one that answers
    // when everything else is down.
    expect(invoke).not.toHaveBeenCalled();
    expect(result.degraded).toBe(false);
    expect(result.coachMessage.content).toBe(SAFETY_REDIRECT_COPY.injury);
    expect(result.coachMessage.structured).toBeNull();
    expect(result.coachMessage.safety).toEqual({
      decision: 'redirect',
      category: 'injury',
      userFacingNote: SAFETY_REDIRECT_COPY.injury,
    });
  });

  it('does not expose the matched rule id or prompt version', async () => {
    const { user } = await seed();
    evaluate.mockResolvedValue({
      decision: 'conservative',
      category: 'injury',
      userFacingNote: 'careful',
      source: 'model',
      matchedRule: 'injury.hurts',
      promptVersion: 'safety.v1',
    } satisfies SafetyDecision);
    invoke.mockResolvedValue(ok(reply()));

    const result = await coach.sendMessage(user.id, { text: 'my knee hurts' });

    // Audit fields. A UI rendering them would be showing the user our regex
    // names.
    expect(JSON.stringify(result.coachMessage.safety)).not.toContain('injury.hurts');
    expect(JSON.stringify(result.coachMessage.safety)).not.toContain('safety.v1');
  });

  // ---------------------------------------------------------------------------
  // Ownership and attachments
  // ---------------------------------------------------------------------------

  it("answers 404 for someone else's conversation, never 403", async () => {
    const mine = await seed();
    const theirs = await seed();
    invoke.mockResolvedValue(ok(reply()));

    const result = await coach.sendMessage(mine.user.id, { text: 'hello' });

    await expect(
      coach.sendMessage(theirs.user.id, {
        conversationId: result.conversationId,
        text: 'let me in',
      }),
    ).rejects.toThrow(NotFoundException);

    await expect(
      coach.listMessages(theirs.user.id, result.conversationId),
    ).rejects.toThrow(NotFoundException);
  });

  it('refuses an attachment that is not the caller’s', async () => {
    const { user } = await seed();

    await expect(
      coach.sendMessage(user.id, { text: 'look at this', attachmentIds: [randomUUID()] }),
    ).rejects.toMatchObject({
      response: { code: 'attachment_not_found' },
    });

    // Refused before the user turn is even written, so a rejected attachment
    // does not leave half a conversation behind.
    expect(invoke).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Thread reading
  // ---------------------------------------------------------------------------

  it('reads a thread oldest-first and shows the coach only the last turns', async () => {
    const { user } = await seed();
    invoke.mockResolvedValue(ok(reply()));

    const first = await coach.sendMessage(user.id, { text: 'one' });
    await coach.sendMessage(user.id, {
      conversationId: first.conversationId,
      text: 'two',
    });

    const thread = await coach.listMessages(user.id, first.conversationId);
    expect(thread.items.map((m) => m.content)).toEqual([
      'one',
      thread.items[1].content,
      'two',
      thread.items[3].content,
    ]);

    // Tier 4: the coach sees recent turns as text, never `structured`.
    const input = JSON.parse(invoke.mock.calls[1][0].input);
    expect(input.recentTurns).toEqual([
      { role: 'USER', content: 'one' },
      { role: 'COACH', content: reply().user_message },
    ]);
  });

  it('deletes a conversation and its messages, keeping the proposal', async () => {
    const { user, plan, routine } = await seed();

    invoke.mockResolvedValue(
      ok(
        reply({
          proposal: {
            kind: 'plan_change',
            planId: plan.id,
            summary: 'Move it.',
            changes: [
              {
                op: 'move',
                target: { type: 'routine', id: routine.id },
                before: null,
                after: { preferredTime: '09:00' },
                reason: 'x',
              },
            ],
          },
        }),
      ),
    );

    const result = await coach.sendMessage(user.id, { text: 'change my plan' });
    await conversations.remove(user.id, result.conversationId);

    expect(
      await prisma.coachMessage.count({
        where: { conversationId: result.conversationId },
      }),
    ).toBe(0);

    // PRD §84 lets the user delete the conversation; the record of a plan
    // change they were offered is not part of that.
    const proposal = await prisma.planChangeProposal.findFirst({
      where: { planId: plan.id },
    });
    expect(proposal).not.toBeNull();
    expect(proposal?.sourceMessageId).toBeNull();

    const audit = await prisma.auditEvent.findFirst({
      where: { actorUserId: user.id, action: 'coach:conversation_deleted' },
    });
    expect(audit?.targetId).toBe(result.conversationId);
  });
});
