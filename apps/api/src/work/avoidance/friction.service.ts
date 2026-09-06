import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma, type Commitment, type Outcome } from '@prisma/client';

import { AiGatewayService } from '../../ai/gateway/ai-gateway.service';
import {
  coachReplySchema,
  COACH_SCHEMA_NAME,
  type InterventionType,
} from '../../coach/contracts/coach-reply.contract';
import { SafetyPolicyService } from '../../coach/safety/safety-policy.service';
import { findOwnedOrThrow } from '../../path/owned-resource';
import { PrismaService } from '../../prisma/prisma.service';
import { safeTimeZone } from '../../today/local-date';
import { addDays, localTimeToInstant } from '../../weekly/week-bounds';
import { localDate } from '../../today/local-date';
import { UserProfileService } from '../../user-profile/user-profile.service';
import { AvoidanceService } from './avoidance.service';
import { FRICTION_INSTRUCTIONS, FRICTION_PROMPT_VERSION } from './friction.instructions';
import { frictionRuleFor } from './friction-answers';
import { templateInterventionFor, type FrictionIntervention } from './friction-templates';
import { timeWindowOf, type TimeWindow } from './time-window';
import type { AnswerFrictionDto } from './dto/answer-friction.dto';
import type { AvoidanceLevel } from './avoidance-detector';

// =============================================================================
// Answering "what's making it hard to start?" (issue #116, epic E07)
// =============================================================================
//
// VISION §9. The question is only worth asking because the eight answers go
// somewhere different, and `friction-answers.ts` is that routing. THE
// INTERVENTION TYPE IS DECIDED HERE, from the answer, before the model is
// called — it is never read off the request body and never read off the reply.
//
// -----------------------------------------------------------------------------
// THE COACH WRITES THE SENTENCE; IT DOES NOT MAKE THE DECISION
// -----------------------------------------------------------------------------
//
// The gateway is asked for wording in the user's coaching style, and the reply
// is DISCARDED — silently, in favour of the template — when it does any of four
// things:
//
//   * claims an intervention type other than the one the answer routes to
//   * recommends more than fifteen minutes (VISION §10: the point is a first
//     move somebody avoiding this can actually make)
//   * names another commitment's id
//   * returns a plan proposal or a friction question of its own
//
// Each of those would be the model quietly overruling a deterministic decision,
// and the user cannot tell a confident wrong sentence from a right one.
//
// -----------------------------------------------------------------------------
// SAFETY RUNS BEFORE THE MODEL
// -----------------------------------------------------------------------------
//
// Free text goes through `SafetyPolicyService` first. A `redirect` returns the
// professional-care copy and writes NOTHING — no reflection, no obstacle, no
// gateway call — because at that moment the product has one job and it is not
// coaching somebody through a deadline.
// =============================================================================

/** The longest first move an intervention may recommend. */
export const MAX_RECOMMENDED_MINUTES = 15;

/** `interventionHistory` is a record, not a log; 50 entries is plenty. */
export const MAX_INTERVENTION_HISTORY = 50;

/** Three sightings is as confident as a counted obstacle gets. */
export const CONFIDENCE_PER_SIGHTING = 1 / 3;

export interface FrictionAnswerResult {
  level: AvoidanceLevel;
  obstacleId: string | null;
  reflectionId: string | null;
  intervention: FrictionIntervention;
}

@Injectable()
export class FrictionService {
  private readonly logger = new Logger(FrictionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiGatewayService,
    private readonly safety: SafetyPolicyService,
    private readonly avoidance: AvoidanceService,
    private readonly profiles: UserProfileService,
  ) {}

  async answer(
    userId: string,
    commitmentId: string,
    dto: AnswerFrictionDto,
    now: Date = new Date(),
  ): Promise<FrictionAnswerResult> {
    const commitment = await this.findWorkCommitment(userId, commitmentId);
    const outcome = commitment.outcomeId
      ? await this.prisma.outcome.findFirst({
          where: { id: commitment.outcomeId, userId },
        })
      : null;

    const assessment = await this.avoidance.assessOne(userId, commitmentId, now);
    const rule = frictionRuleFor(dto.answer);
    const profile = await this.profiles.find(userId);
    const timezone = safeTimeZone(profile?.timezone);

    // ---- safety, before anything is written or asked -------------------------

    if (dto.text) {
      const decision = await this.safety.evaluate({
        userId,
        text: dto.text,
        surface: 'coach',
      });

      if (decision.decision === 'redirect') {
        this.logger.log(
          `Friction user=${userId} commitment=${commitmentId} answer=${dto.answer} level=${assessment.level} source=safety`,
        );

        return {
          level: assessment.level,
          obstacleId: null,
          reflectionId: null,
          intervention: {
            interventionType: 'FRICTION_DIAGNOSIS',
            userMessage: decision.userFacingNote ?? '',
            recommendedAction: null,
            fallbackAction: null,
            suggestedReschedule: null,
            source: 'template',
          },
        };
      }
    }

    // ---- the record ---------------------------------------------------------

    const suggestedReschedule =
      dto.answer === 'SOMETHING_URGENT'
        ? await this.nextFreeSlot(userId, commitment, timezone, now)
        : null;

    const { reflectionId, obstacleId } = await this.prisma.$transaction(async (tx) => {
      const reflection = await tx.reflection.create({
        data: {
          userId,
          relatedType: 'commitment',
          relatedId: commitmentId,
          commitmentId,
          userText: dto.text ?? null,
          // The ANSWER key, not a `SkipReason`. `avoidance-signals.service.ts`
          // tells the two apart by this list, which is how "asked once" works.
          frictionTags: [dto.answer],
        },
      });

      const existing = await tx.obstacle.findFirst({
        where: { userId, domain: 'WORK', type: rule.obstacleType },
      });

      const entry = {
        at: now.toISOString(),
        commitmentId,
        answer: dto.answer,
        level: assessment.level,
        interventionType: rule.interventionType,
      };

      if (existing) {
        const history = Array.isArray(existing.interventionHistory)
          ? existing.interventionHistory
          : [];
        const observedCount = existing.observedCount + 1;

        const updated = await tx.obstacle.update({
          where: { id: existing.id },
          data: {
            observedCount,
            lastObservedAt: now,
            confidence: Math.min(1, observedCount * CONFIDENCE_PER_SIGHTING),
            interventionHistory: [...history, entry].slice(
              -MAX_INTERVENTION_HISTORY,
            ) as unknown as Prisma.InputJsonValue,
          },
        });

        return { reflectionId: reflection.id, obstacleId: updated.id };
      }

      const created = await tx.obstacle.create({
        data: {
          userId,
          domain: 'WORK',
          type: rule.obstacleType,
          description: rule.label,
          observedCount: 1,
          confidence: CONFIDENCE_PER_SIGHTING,
          lastObservedAt: now,
          interventionHistory: [entry] as unknown as Prisma.InputJsonValue,
        },
      });

      return { reflectionId: reflection.id, obstacleId: created.id };
    });

    // ---- the words ----------------------------------------------------------

    const intervention = await this.wordsFor(
      userId,
      commitment,
      outcome,
      dto,
      rule.interventionType,
      assessment.level,
      suggestedReschedule,
      profile?.coachingStyle ?? 'BALANCED',
    );

    await this.prisma.auditEvent.create({
      data: {
        actorUserId: userId,
        action: 'work:friction_answered',
        targetType: 'commitment',
        targetId: commitmentId,
        meta: {
          answer: dto.answer,
          level: assessment.level,
          interventionType: intervention.interventionType,
          source: intervention.source,
        },
      },
    });

    // The answer key and the level. NEVER `text`: it is the user telling their
    // coach why something is hard.
    this.logger.log(
      `Friction user=${userId} commitment=${commitmentId} answer=${dto.answer} level=${assessment.level} source=${intervention.source}`,
    );

    return { level: assessment.level, obstacleId, reflectionId, intervention };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async findWorkCommitment(userId: string, id: string): Promise<Commitment> {
    const commitment = await findOwnedOrThrow(
      () => this.prisma.commitment.findFirst({ where: { id, userId } }),
      'Commitment',
    );

    if (commitment.domain !== 'WORK') {
      throw new BadRequestException({
        message: 'The friction question is asked about Work commitments.',
        details: { reason: 'COMMITMENT_NOT_WORK', domain: commitment.domain },
      });
    }

    return commitment;
  }

  /** The template, or the coach's wording when it passes every guard. */
  private async wordsFor(
    userId: string,
    commitment: Commitment,
    outcome: Outcome | null,
    dto: AnswerFrictionDto,
    requiredInterventionType: InterventionType,
    level: AvoidanceLevel,
    suggestedReschedule: { scheduledStart: string; scheduledEnd: string } | null,
    coachingStyle: string,
  ): Promise<FrictionIntervention> {
    const template = templateInterventionFor(dto.answer, {
      commitmentTitle: commitment.title,
      minimum: commitment.minimumVersion
        ? {
            title: commitment.minimumVersion,
            durationMinutes: commitment.minimumMinutes ?? 5,
          }
        : null,
      motivation: outcome?.motivation ?? null,
      suggestedReschedule,
      text: dto.text ?? null,
    });

    const result = await this.ai.invoke({
      persona: 'coach',
      userId,
      promptVersion: FRICTION_PROMPT_VERSION,
      instructions: FRICTION_INSTRUCTIONS,
      input: JSON.stringify({
        commitment: {
          id: commitment.id,
          title: commitment.title,
          minimumVersion: commitment.minimumVersion,
          scheduledStart: commitment.scheduledStart.toISOString(),
          rescheduleCount: commitment.rescheduleCount,
        },
        outcome: outcome ? { title: outcome.title, motivation: outcome.motivation } : null,
        answer: dto.answer,
        text: dto.text ?? null,
        requiredInterventionType,
        level,
        coachingStyle,
      }),
      schema: coachReplySchema,
      schemaName: COACH_SCHEMA_NAME,
    });

    if (!result.ok) return template;

    const reply = result.output;
    const override = this.overrideReason(reply, requiredInterventionType, commitment.id);

    if (override) {
      this.logger.log(`Friction ai_override reason=${override}`);
      return template;
    }

    return {
      interventionType: requiredInterventionType,
      userMessage: reply.user_message,
      recommendedAction: reply.recommended_action
        ? {
            title: reply.recommended_action.title,
            durationMinutes: reply.recommended_action.duration_minutes,
          }
        : template.recommendedAction,
      fallbackAction: reply.fallback_action
        ? {
            title: reply.fallback_action.title,
            durationMinutes: reply.fallback_action.duration_minutes,
          }
        : template.fallbackAction,
      // Deterministic either way: the slot is arithmetic over the user's own
      // calendar and is not something the model gets to propose.
      suggestedReschedule,
      source: 'ai',
    };
  }

  /** Why this reply is being discarded, or null when it may be used. */
  private overrideReason(
    reply: { [k: string]: unknown },
    required: InterventionType,
    commitmentId: string,
  ): string | null {
    if (reply.intervention_type !== required) return 'intervention_type';

    const action = reply.recommended_action as
      | { duration_minutes: number; commitmentId: string | null }
      | null;

    if (action && action.duration_minutes > MAX_RECOMMENDED_MINUTES) return 'duration';
    if (action && action.commitmentId && action.commitmentId !== commitmentId) {
      return 'commitment_id';
    }
    if (reply.proposal) return 'proposal';
    if (reply.friction_question) return 'friction_question';

    return null;
  }

  /**
   * Tomorrow, in the same part of the day, in the first quarter-hour this user
   * has nothing else scheduled.
   *
   * DETERMINISTIC. "Something more urgent came up" is answered with a slot, and
   * a slot the model invented could collide with the meeting that displaced
   * this in the first place.
   */
  private async nextFreeSlot(
    userId: string,
    commitment: Commitment,
    timezone: string,
    now: Date,
  ): Promise<{ scheduledStart: string; scheduledEnd: string }> {
    const window = timeWindowOf(commitment.scheduledStart, timezone);
    const tomorrow = addDays(localDate(now, timezone), 1);

    const durationMs = commitment.scheduledEnd
      ? commitment.scheduledEnd.getTime() - commitment.scheduledStart.getTime()
      : (commitment.fullMinutes ?? 25) * 60_000;

    const dayStart = localTimeToInstant(tomorrow, WINDOW_START[window], timezone);
    const dayEnd = localTimeToInstant(tomorrow, WINDOW_END[window], timezone);

    const busy = await this.prisma.commitment.findMany({
      where: {
        userId,
        status: { in: ['PLANNED', 'READY', 'STARTED'] },
        scheduledStart: { gte: dayStart, lt: dayEnd },
      },
      select: { scheduledStart: true, scheduledEnd: true },
      orderBy: { scheduledStart: 'asc' },
    });

    for (
      let start = dayStart.getTime();
      start + durationMs <= dayEnd.getTime();
      start += 15 * 60_000
    ) {
      const end = start + durationMs;

      const collides = busy.some((row) => {
        const otherStart = row.scheduledStart.getTime();
        const otherEnd = (row.scheduledEnd ?? row.scheduledStart).getTime();

        return start < Math.max(otherEnd, otherStart + 1) && otherStart < end;
      });

      if (!collides) {
        return {
          scheduledStart: new Date(start).toISOString(),
          scheduledEnd: new Date(end).toISOString(),
        };
      }
    }

    // The window is full. Offer its start anyway — the user asked to move this,
    // and refusing to name a time would leave them with nothing to press.
    return {
      scheduledStart: dayStart.toISOString(),
      scheduledEnd: new Date(dayStart.getTime() + durationMs).toISOString(),
    };
  }
}

/** The wall-clock edges of each window, matching `greetingFor`'s boundaries. */
const WINDOW_START: Record<TimeWindow, string> = {
  morning: '05:00',
  afternoon: '12:00',
  evening: '18:00',
};

const WINDOW_END: Record<TimeWindow, string> = {
  morning: '12:00',
  afternoon: '18:00',
  evening: '23:00',
};
