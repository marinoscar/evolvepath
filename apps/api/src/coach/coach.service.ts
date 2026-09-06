import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { trace } from '@opentelemetry/api';

import { AiGatewayService } from '../ai/gateway/ai-gateway.service';
import { PrismaService } from '../prisma/prisma.service';
import { UserProfileService } from '../user-profile/user-profile.service';
import { ContextAssemblerService } from './context/context-assembler.service';
import {
  COACH_SCHEMA_NAME,
  coachReplySchema,
  type CoachReply,
} from './contracts/coach-reply.contract';
import { fallbackReply, type CoachFallbackCode } from './coach-fallbacks';
import { CoachConversationsService } from './coach-conversations.service';
import { guardCoachOutput, type CoachOutputFacts } from './coach-output-guard';
import {
  COACH_PROMPT_VERSION,
  buildCoachInstructions,
} from './prompts/coach.prompt';
import { ProposalsService } from './proposals/proposals.service';
import { ActivityTrackerService } from '../progress/comeback/activity-tracker.service';
import { SafetyPolicyService } from './safety/safety-policy.service';
import type { SafetyDecision } from './safety/safety.types';
import type { SendCoachMessageDto } from './dto/send-coach-message.dto';
import type {
  CoachMessageDto,
  SendCoachMessageResponseDto,
} from './dto/coach-response.dto';

// =============================================================================
// One coaching turn (issue #70, epic E06)
// =============================================================================
//
// THE ORDER OF THE STEPS IS THE CONTRACT (PRD §115), and three of them are
// there specifically to be hard to remove:
//
//   1. SAFETY BEFORE THE MODEL. A `redirect` never reaches the coach persona
//      at all — the professional-care copy is a constant, and it therefore
//      works when the provider is down, which is exactly when it matters most.
//   2. THE GUARD BEFORE THE USER. A model reply naming a commitment or a plan
//      the user does not have is discarded and recorded as `invalid_output`.
//      PRD §90 names this failure; it is the most damaging one this product
//      has, because a fabricated sentence is indistinguishable from a true one
//      to the person reading it.
//   3. A PROPOSAL IS A ROW, NOT A CHANGE. `reply.proposal` becomes a
//      `PlanChangeProposal` and waits (PRD §15). Nothing here writes a plan.
//
// AND THE WHOLE THING IS A 201, ALWAYS. A provider timeout, a rate limit, a
// missing key, a schema violation, a hallucinated id — every one of them is a
// coach message the user can read plus `degraded: true`. PRD §120's promise is
// not "the API returns an error quickly"; it is "the screen still works".
// =============================================================================

const tracer = trace.getTracer('evolvepath-api');

/** How much of the thread the coach is shown (PRD §17 Tier 4). */
const RECENT_TURNS = 10;

@Injectable()
export class CoachService {
  private readonly logger = new Logger(CoachService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiGatewayService,
    private readonly safety: SafetyPolicyService,
    private readonly context: ContextAssemblerService,
    private readonly conversations: CoachConversationsService,
    private readonly proposals: ProposalsService,
    private readonly profiles: UserProfileService,
    private readonly activity: ActivityTrackerService,
  ) {}

  async listMessages(
    userId: string,
    conversationId: string,
    { limit = 50, before }: { limit?: number; before?: string } = {},
  ): Promise<{ items: CoachMessageDto[] }> {
    await this.conversations.findOwned(userId, conversationId);

    const take = Math.min(Math.max(limit, 1), 200);

    const anchor = before
      ? await this.prisma.coachMessage.findFirst({
          where: { id: before, conversationId },
          select: { createdAt: true },
        })
      : null;

    const rows = await this.prisma.coachMessage.findMany({
      where: {
        conversationId,
        ...(anchor ? { createdAt: { lt: anchor.createdAt } } : {}),
      },
      // Newest first to take the last page, then reversed: a thread reads
      // downward and paginates upward.
      orderBy: { createdAt: 'desc' },
      take,
    });

    return { items: rows.reverse().map(toMessageDto) };
  }

  async sendMessage(
    userId: string,
    dto: SendCoachMessageDto,
  ): Promise<SendCoachMessageResponseDto> {
    return tracer.startActiveSpan('coach.send_message', async (span) => {
      try {
        const reply = await this.runTurn(userId, dto);

        // Talking to the coach is behaviour (PRD §57, #112) — a comeback offer
        // must not greet somebody who has been working through it in here.
        this.activity.record(userId);

        return reply;
      } finally {
        span.end();
      }
    });
  }

  private async runTurn(
    userId: string,
    dto: SendCoachMessageDto,
  ): Promise<SendCoachMessageResponseDto> {
    const conversationId = await this.resolveConversation(userId, dto);
    const attachmentIds = await this.resolveAttachments(userId, dto.attachmentIds);

    const userMessage = await this.prisma.coachMessage.create({
      data: {
        conversationId,
        role: 'USER',
        content: dto.text,
        attachmentIds,
      },
    });
    await this.touch(conversationId);

    const safety = await this.safety.evaluate({
      userId,
      text: dto.text,
      surface: 'coach',
    });

    if (safety.decision === 'redirect') {
      // No gateway call at all. The copy is a constant, so this branch is the
      // one that still answers when everything else is down.
      const coachMessage = await this.persistCoachMessage({
        conversationId,
        content: safety.userFacingNote ?? '',
        structured: null,
        invocationId: null,
        safety,
      });

      this.log(conversationId, null, null, false, safety, false);

      return {
        conversationId,
        userMessage: toMessageDto(userMessage),
        coachMessage,
        degraded: false,
      };
    }

    const context = await this.context.assemble(userId, 'coach');
    const profile = await this.profiles.find(userId);
    const recentTurns = await this.recentTurns(conversationId, userMessage.id);

    const result = await this.ai.invoke<CoachReply>({
      persona: 'coach',
      userId,
      promptVersion: COACH_PROMPT_VERSION,
      instructions: buildCoachInstructions({
        style: profile?.coachingStyle ?? context.coachingStyle,
        safety,
      }),
      input: JSON.stringify({
        context: this.context.renderForPrompt(context),
        recentTurns,
        attachments: attachmentIds,
        userText: dto.text,
      }),
      schema: coachReplySchema,
      schemaName: COACH_SCHEMA_NAME,
      safetyDecision: safety,
    });

    if (!result.ok) {
      return this.degrade(
        userId,
        conversationId,
        userMessage,
        result.error.code,
        result.invocationId,
        safety,
      );
    }

    const facts = await this.facts(userId, context);
    const verdict = guardCoachOutput(result.output, facts);

    if (!verdict.ok) {
      // Recorded on the telemetry row rather than only in a log line: "how
      // often does the coach invent things?" is a question about the model,
      // and `ai_invocations` is where questions about the model are answered.
      await this.markInvalid(result.invocationId, verdict.reason);

      this.logger.warn(
        `coach guard rejected reply conversation=${conversationId} ` +
          `invocation=${result.invocationId} reason=${verdict.reason}`,
      );

      return this.degrade(
        userId,
        conversationId,
        userMessage,
        'hallucination_guard',
        result.invocationId,
        safety,
      );
    }

    const reply = result.output;
    let proposalSummary: SendCoachMessageResponseDto['proposal'];
    let structured: Record<string, unknown> = reply as unknown as Record<string, unknown>;

    const coachMessage = await this.persistCoachMessage({
      conversationId,
      content: reply.user_message,
      structured,
      invocationId: result.invocationId,
      safety,
    });

    if (reply.proposal) {
      // Created AFTER the message exists, so `sourceMessageId` points at a real
      // row and the accepted-proposal SYSTEM notice lands in this thread.
      const created = await this.proposals.createFromCoach(userId, {
        planId: reply.proposal.planId,
        summary: reply.proposal.summary,
        changes: reply.proposal.changes,
        sourceMessageId: coachMessage.id,
        invocationId: result.invocationId,
      });

      proposalSummary = created;
      structured = {
        ...structured,
        proposal: { ...reply.proposal, proposalId: created.id },
      };

      await this.prisma.coachMessage.update({
        where: { id: coachMessage.id },
        data: { structured: structured as Prisma.InputJsonValue },
      });
      coachMessage.structured = structured;
    }

    await this.touch(conversationId);

    this.log(
      conversationId,
      result.invocationId,
      reply.intervention_type,
      Boolean(reply.proposal),
      safety,
      false,
    );

    return {
      conversationId,
      userMessage: toMessageDto(userMessage),
      coachMessage,
      ...(proposalSummary ? { proposal: proposalSummary } : {}),
      degraded: false,
    };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async resolveConversation(
    userId: string,
    dto: SendCoachMessageDto,
  ): Promise<string> {
    if (dto.conversationId) {
      const owned = await this.conversations.findOwned(userId, dto.conversationId);
      return owned.id;
    }

    // The title is the first thing the user said, trimmed. Asking a model to
    // name the thread would be a second AI call on the critical path of a
    // screen whose whole promise is that it works when the model does not.
    const created = await this.conversations.create(userId, dto.text.slice(0, 60));

    return created.id;
  }

  private async resolveAttachments(
    userId: string,
    ids: string[] | undefined,
  ): Promise<string[]> {
    if (!ids || ids.length === 0) return [];

    const owned = await this.prisma.storageObject.findMany({
      where: { id: { in: ids }, uploadedById: userId, status: 'ready' },
      select: { id: true },
    });

    if (owned.length !== ids.length) {
      throw new BadRequestException({
        code: 'attachment_not_found',
        message: 'One or more attachments are not yours, or are not ready',
      });
    }

    return ids;
  }

  /** The last few turns, as text. Never `structured`, never the whole thread. */
  private async recentTurns(conversationId: string, excludeId: string) {
    const rows = await this.prisma.coachMessage.findMany({
      where: { conversationId, id: { not: excludeId } },
      orderBy: { createdAt: 'desc' },
      take: RECENT_TURNS,
      select: { role: true, content: true },
    });

    return rows.reverse().map((row) => ({ role: row.role, content: row.content }));
  }

  /** Every id the coach is allowed to name. See `coach-output-guard.ts`. */
  private async facts(
    userId: string,
    context: Awaited<ReturnType<ContextAssemblerService['assemble']>>,
  ): Promise<CoachOutputFacts> {
    const planned = await this.prisma.commitment.findMany({
      where: { userId, status: { in: ['PLANNED', 'READY', 'STARTED'] } },
      select: { id: true },
    });

    const commitmentIds = new Set<string>([
      ...context.todayCommitments.map((c) => c.commitmentId),
      ...planned.map((c) => c.id),
    ]);

    const routineIdsByPlan = new Map<string, Set<string>>();
    for (const plan of context.activePlans) {
      routineIdsByPlan.set(
        plan.planId,
        new Set(plan.routines.map((routine) => routine.routineId)),
      );
    }

    return { commitmentIds, routineIdsByPlan };
  }

  private async degrade(
    userId: string,
    conversationId: string,
    userMessage: { id: string; role: string; content: string; attachmentIds: string[]; createdAt: Date; structured: unknown; safetyDecision: unknown },
    code: CoachFallbackCode,
    invocationId: string | null,
    safety: SafetyDecision,
  ): Promise<SendCoachMessageResponseDto> {
    const coachMessage = await this.persistCoachMessage({
      conversationId,
      content: fallbackReply(code).content,
      // Null, not a synthesised contract. A fallback must be indistinguishable
      // from "no model output", because that is what it is — a client that
      // could tell them apart would start rendering a fake intervention type.
      structured: null,
      invocationId,
      safety,
    });

    await this.touch(conversationId);
    this.log(conversationId, invocationId, null, false, safety, true, code);

    return {
      conversationId,
      userMessage: toMessageDto(userMessage as never),
      coachMessage,
      degraded: true,
    };
  }

  private async persistCoachMessage(input: {
    conversationId: string;
    content: string;
    structured: Record<string, unknown> | null;
    invocationId: string | null;
    safety: SafetyDecision;
  }): Promise<CoachMessageDto> {
    const row = await this.prisma.coachMessage.create({
      data: {
        conversationId: input.conversationId,
        role: 'COACH',
        content: input.content,
        structured: (input.structured ?? undefined) as Prisma.InputJsonValue,
        invocationId: input.invocationId,
        safetyDecision: input.safety as unknown as Prisma.InputJsonValue,
      },
    });

    return toMessageDto(row);
  }

  private async markInvalid(invocationId: string, reason: string): Promise<void> {
    try {
      await this.prisma.aiInvocation.update({
        where: { id: invocationId },
        data: {
          status: 'invalid_output',
          outputValid: false,
          errorCode: 'hallucination_guard',
          errorMessage: reason,
        },
      });
    } catch {
      // Telemetry must never fail the turn. The user still gets their reply.
    }
  }

  private async touch(conversationId: string): Promise<void> {
    await this.prisma.coachConversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    });
  }

  private log(
    conversationId: string,
    invocationId: string | null,
    intervention: string | null,
    proposal: boolean,
    safety: SafetyDecision,
    degraded: boolean,
    code?: string,
  ): void {
    // Ids and classifications. Never the user's text, and never the reply's.
    this.logger.log(
      `coach message conversation=${conversationId} invocation=${invocationId ?? 'none'} ` +
        `intervention=${intervention ?? 'none'} proposal=${proposal} ` +
        `safety=${safety.decision} degraded=${degraded}${code ? ` code=${code}` : ''}`,
    );
  }
}

/**
 * The wire shape of one message.
 *
 * `invocationId` IS DELIBERATELY ABSENT. It is a telemetry handle for support
 * and for the admin surfaces; a client that had it would start correlating
 * replies to internal rows, and the id would become an API.
 */
function toMessageDto(row: {
  id: string;
  role: string;
  content: string;
  structured: unknown;
  attachmentIds: string[];
  safetyDecision: unknown;
  createdAt: Date;
}): CoachMessageDto {
  const safety = row.safetyDecision as SafetyDecision | null;

  return {
    id: row.id,
    role: row.role,
    content: row.content,
    structured: (row.structured as Record<string, unknown> | null) ?? null,
    attachmentIds: row.attachmentIds,
    // The rule id and prompt version stay server-side: they are audit fields,
    // and a UI that rendered them would be showing the user our regex names.
    safety: safety
      ? {
          decision: safety.decision,
          category: safety.category,
          ...(safety.userFacingNote ? { userFacingNote: safety.userFacingNote } : {}),
        }
      : null,
    createdAt: row.createdAt.toISOString(),
  };
}
