import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma, type UserProfile } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { safeTimeZone, isValidTimeZone } from '../today/local-date';
import { UserProfileService } from '../user-profile/user-profile.service';
import {
  domainReflectionsSchema,
  healthBaselineSchema,
  type DomainReflections,
  type HealthBaseline,
  type ObstacleOption,
} from '../user-profile/user-profile.schema';
import {
  onboardingProposalSchema,
  type OnboardingProposal,
  type ProposalDomain,
} from './onboarding-proposal.schema';
import { OnboardingProposalService } from './onboarding-proposal.service';
import { buildTemplateProposal, reduceTemplate } from './onboarding-templates';
import { validateOnboardingProposal, type GuardrailContext } from './onboarding.guardrails';
import type {
  ApprovedPath,
  ConfidenceResponse,
  OnboardingAnswers,
  OnboardingState,
  ProposalResponse,
} from './onboarding.types';
import type { PatchAnswersDto } from './dto/patch-answers.dto';
import type { StartOnboardingDto } from './dto/start-onboarding.dto';

// =============================================================================
// Onboarding (issue #101, epic E04)
// =============================================================================
//
// ANSWERS ARE SAVED PER STEP AND THE PLAN IS NOT SAVED AT ALL until the user
// approves it. Those two sentences are the whole design:
//
//   • Per step, because PRD §19 gives this five to eight minutes on a phone and
//     a phone locks. A wizard holding its answers in React state loses them to
//     a notification, and the user starts again — once.
//   • Not at all, because PRD §15 says AI output becomes a plan only through a
//     human approval. `pendingProposal` is a JSON column on the profile; it is
//     not a set of `outcomes` rows with a `draft` flag, which would make every
//     list query in the product responsible for remembering to filter.
//
// THE SECOND APPROVE IS A 409, NOT A NO-OP. A client that raced two submits
// needs to be able to tell which one built the Path; a silent success would
// return a second set of ids for rows that were never created.
// =============================================================================

/** The answer at or below which PRD §72 requires a smaller plan. */
export const LOW_CONFIDENCE_THRESHOLD = 2;

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: UserProfileService,
    private readonly proposals: OnboardingProposalService,
  ) {}

  // ---------------------------------------------------------------------------
  // Reading and answering
  // ---------------------------------------------------------------------------

  /** The state the wizard reopens on. Creates the row if it is missing. */
  async getState(userId: string): Promise<OnboardingState> {
    return this.toState(await this.profiles.getOrCreate(userId));
  }

  /**
   * Step 1. Records where the user is in the world and moves off `PROMISE`.
   *
   * The timezone is the single most load-bearing answer in this flow — every
   * commitment it schedules is an instant derived from it — so an unusable one
   * is a 400 here rather than a silent fall back to UTC at read time.
   */
  async start(userId: string, dto: StartOnboardingDto): Promise<OnboardingState> {
    const profile = await this.profiles.getOrCreate(userId);

    this.assertNotCompleted(profile);

    if (!isValidTimeZone(dto.timezone)) {
      throw new BadRequestException({
        message: `"${dto.timezone}" is not a timezone this server recognises.`,
        details: { reason: 'INVALID_TIMEZONE' },
      });
    }

    const updated = await this.profiles.update(userId, {
      timezone: dto.timezone,
      ...(dto.locale ? { locale: dto.locale } : {}),
      // Only forwards, and only from the very beginning: a user who walked back
      // to step 1 to fix their timezone must not be sent to step 2 again.
      ...(profile.onboardingStep === 'PROMISE' ? { onboardingStep: 'VISION' as const } : {}),
    });

    return this.toState(updated);
  }

  /**
   * Steps 2–7. A merge patch: an absent key means "leave it alone".
   *
   * `step` records where the CLIENT now is, which is why `DONE` is rejected —
   * completion is `approve`'s to declare, and a client that could patch its way
   * to `DONE` would have a completed account with no Path in it.
   */
  async patchAnswers(userId: string, dto: PatchAnswersDto): Promise<OnboardingState> {
    const profile = await this.profiles.getOrCreate(userId);

    this.assertNotCompleted(profile);

    const patch: Prisma.UserProfileUncheckedUpdateInput = {};

    if (dto.step !== undefined) patch.onboardingStep = dto.step;
    if (dto.sixMonthVision !== undefined) patch.sixMonthVision = dto.sixMonthVision;
    if (dto.domains !== undefined) patch.selectedDomains = dto.domains;
    if (dto.domainReflections !== undefined) {
      patch.domainReflections = dto.domainReflections as Prisma.InputJsonValue;
    }
    if (dto.obstacles !== undefined) patch.obstacles = dto.obstacles;
    if (dto.weekdayMinutes !== undefined) patch.weekdayMinutes = dto.weekdayMinutes;
    if (dto.healthBaseline !== undefined) {
      patch.healthBaseline = dto.healthBaseline as Prisma.InputJsonValue;
    }
    if (dto.coachingStyle !== undefined) patch.coachingStyle = dto.coachingStyle;

    return this.toState(await this.profiles.update(userId, patch));
  }

  // ---------------------------------------------------------------------------
  // Proposing
  // ---------------------------------------------------------------------------

  /** Ask the planner, then store the result on the profile and nowhere else. */
  async propose(
    userId: string,
    now: Date = new Date(),
    requestId?: string,
  ): Promise<ProposalResponse> {
    const profile = await this.profiles.getOrCreate(userId);

    this.assertNotCompleted(profile);

    const answers = this.answersOf(profile);

    this.assertAnswered(answers);

    const { proposal } = await this.proposals.propose({
      userId,
      answers,
      guardrails: this.guardrailsFor(profile, answers, now),
      requestId,
    });

    return this.storeProposal(userId, proposal, 'ai');
  }

  /** The deterministic Path. Never reaches the gateway (PRD §120). */
  async skipAi(userId: string, now: Date = new Date()): Promise<ProposalResponse> {
    const profile = await this.profiles.getOrCreate(userId);

    this.assertNotCompleted(profile);

    const answers = this.answersOf(profile);

    this.assertAnswered(answers);

    const guardrails = this.guardrailsFor(profile, answers, now);

    const proposal = buildTemplateProposal(
      {
        sixMonthVision: answers.sixMonthVision,
        domains: answers.domains,
        weekdayMinutes: answers.weekdayMinutes,
        healthBaseline: answers.healthBaseline,
      },
      now,
      guardrails.timezone,
    );

    // The template is held to the rules the model is held to. A fallback that
    // cannot be approved is not a fallback.
    const rules = validateOnboardingProposal(proposal, guardrails);

    if (rules.length > 0) {
      throw new BadRequestException({
        message: 'A starting plan does not fit inside the minutes you have.',
        details: { reason: 'PROPOSAL_INVALID', rules },
      });
    }

    return this.storeProposal(userId, proposal, 'template');
  }

  /**
   * PRD §72's confidence check, asked before the plan is activated.
   *
   * 1 or 2 replaces the plan with a smaller one, by the route it came from: an
   * AI proposal is re-proposed with the reduce instruction, a template is
   * reduced arithmetically. 3 and above stores the score and changes nothing.
   */
  async confidence(
    userId: string,
    score: number,
    now: Date = new Date(),
    requestId?: string,
  ): Promise<ConfidenceResponse> {
    const profile = await this.profiles.getOrCreate(userId);

    this.assertNotCompleted(profile);

    const pending = this.pendingOf(profile);

    if (!pending) {
      throw new BadRequestException({
        message: 'There is no plan to be confident about yet.',
        details: { reason: 'NO_PENDING_PROPOSAL' },
      });
    }

    const source = (profile.pendingProposal as { source?: string } | null)?.source;
    const from: 'ai' | 'template' = source === 'template' ? 'template' : 'ai';

    if (score > LOW_CONFIDENCE_THRESHOLD) {
      await this.profiles.update(userId, { confidenceScore: score });

      return { proposal: pending, source: from, reproposed: false };
    }

    const answers = this.answersOf(profile);
    const guardrails = this.guardrailsFor(profile, answers, now);

    let smaller: OnboardingProposal;

    if (from === 'ai') {
      const result = await this.proposals.propose({
        userId,
        answers,
        guardrails,
        previousProposal: pending,
        requestId,
      });

      smaller = result.proposal;
    } else {
      smaller = reduceTemplate(pending);
    }

    const stored = await this.storeProposal(userId, smaller, from, score);

    return { ...stored, reproposed: true };
  }

  // ---------------------------------------------------------------------------
  // Approving
  // ---------------------------------------------------------------------------

  /**
   * The PRD §15 approval step, and the only path that turns a proposal into a
   * Path.
   *
   * ONE TRANSACTION. A half-built Path — outcomes with no plan, a plan with no
   * commitments — is worse than a failed approve, because the user would see it
   * on Today and believe it.
   */
  async approve(
    userId: string,
    edited: OnboardingProposal,
    now: Date = new Date(),
  ): Promise<ApprovedPath> {
    const profile = await this.profiles.getOrCreate(userId);

    this.assertNotCompleted(profile);

    const pending = this.pendingOf(profile);
    const storedSource = (profile.pendingProposal as { source?: string } | null)?.source;

    // SOURCE COMES OFF THE ROW, never the body. `createdBy` on the plan version
    // is an attribution — a client claiming `'ai'` would put the coach's name on
    // a plan it never saw.
    const source: 'ai' | 'template' = storedSource === 'template' ? 'template' : 'ai';

    const proposal = onboardingProposalSchema.parse(edited);
    const answers = this.answersOf(profile);
    const guardrails = this.guardrailsFor(profile, answers, now);

    const rules = validateOnboardingProposal(proposal, guardrails);

    if (rules.length > 0) {
      throw new BadRequestException({
        message: 'This plan does not fit the rules a first Path is held to.',
        details: { reason: 'PROPOSAL_INVALID', rules },
      });
    }

    const edits = pending != null && JSON.stringify(pending) !== JSON.stringify(proposal);

    const created = await this.prisma.$transaction(async (tx) =>
      this.persist(tx, userId, proposal, source, now),
    );

    // AFTER the transaction: an audit row inside it would be rolled back with
    // the thing it is evidence of, and one written before it would describe a
    // Path that does not exist.
    await this.prisma.auditEvent.create({
      data: {
        userId,
        action: 'onboarding:approved',
        targetType: 'user_profile',
        targetId: profile.id,
        meta: {
          source,
          outcomes: created.outcomeIds.length,
          routines: created.routineIds.length,
          commitments: created.commitmentIds.length,
          edited: edits,
          confidenceScore: profile.confidenceScore,
        },
      },
    });

    this.logger.log(
      `Onboarding approve user=${userId} source=${source} routines=${created.routineIds.length} ` +
        `commitments=${created.commitmentIds.length} edited=${edits}`,
    );

    return created;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** Everything the approve transaction writes, in dependency order. */
  private async persist(
    tx: Prisma.TransactionClient,
    userId: string,
    proposal: OnboardingProposal,
    source: 'ai' | 'template',
    now: Date,
  ): Promise<ApprovedPath> {
    const createdBy = source === 'ai' ? 'AI' : 'USER';

    // ---- Best Self -----------------------------------------------------------

    const bestSelf = await tx.bestSelfProfile.upsert({
      where: { userId },
      create: {
        userId,
        identityStatement: proposal.bestSelf.identityStatement,
        workIdentity: proposal.bestSelf.workIdentity,
        familyIdentity: proposal.bestSelf.familyIdentity,
        healthIdentity: proposal.bestSelf.healthIdentity,
        sixMonthVision: proposal.bestSelf.sixMonthVision,
        lastReviewedAt: now,
      },
      update: {
        identityStatement: proposal.bestSelf.identityStatement,
        workIdentity: proposal.bestSelf.workIdentity,
        familyIdentity: proposal.bestSelf.familyIdentity,
        healthIdentity: proposal.bestSelf.healthIdentity,
        sixMonthVision: proposal.bestSelf.sixMonthVision,
        lastReviewedAt: now,
      },
    });

    // ---- one outcome, plan and ACTIVE v1 per domain --------------------------

    const outcomeIds: string[] = [];
    const planVersionIds: string[] = [];
    const routineIds: string[] = [];
    const commitmentIds: string[] = [];

    /** domain → the version its routines and commitments hang off. */
    const versionByDomain = new Map<ProposalDomain, string>();

    for (const outcome of proposal.outcomes) {
      const domainRoutines = proposal.routines.filter((r) => r.domain === outcome.domain);

      const outcomeRow = await tx.outcome.create({
        data: {
          userId,
          domain: outcome.domain,
          title: outcome.title,
          motivation: outcome.whyItMatters,
          successDefinition: outcome.successDefinition,
          state: 'ACTIVE',
        },
      });

      outcomeIds.push(outcomeRow.id);

      const plan = await tx.plan.create({ data: { userId, outcomeId: outcomeRow.id } });

      const version = await tx.planVersion.create({
        data: {
          userId,
          planId: plan.id,
          version: 1,
          status: 'ACTIVE',
          createdBy,
          userApproved: true,
          rationale: proposal.rationale,
          // Minutes a week, counted from the commitments actually scheduled for
          // this domain — the number the load check in E10 will compare against.
          expectedWeeklyLoad: proposal.firstWeekCommitments
            .filter((c) => c.domain === outcome.domain)
            .reduce((sum, c) => sum + c.durationMinutes, 0),
          fallbackStrategy:
            domainRoutines.map((r) => r.fallbackBehavior).join(' · ') || null,
          activeFrom: now,
        },
      });

      planVersionIds.push(version.id);
      versionByDomain.set(outcome.domain, version.id);
    }

    // ---- routines ------------------------------------------------------------

    /** routine title → its row id, so a commitment can point at its routine. */
    const routineByTitle = new Map<string, string>();

    for (const [index, routine] of proposal.routines.entries()) {
      const planVersionId = versionByDomain.get(routine.domain);

      // A routine in a domain with no outcome has nothing to hang off. The
      // guardrails do not forbid it, so it is dropped rather than 500ing on a
      // null foreign key.
      if (!planVersionId) continue;

      const row = await tx.routine.create({
        data: {
          userId,
          planVersionId,
          domain: routine.domain,
          title: routine.title,
          triggerType: routine.triggerType === 'AFTER' ? 'EVENT' : 'TIME',
          triggerValue: routine.triggerValue,
          frequency: 'CUSTOM',
          daysOfWeek: [],
          estimatedDurationMin: routine.idealMinutes,
          minimumDurationMin: routine.minimumMinutes,
          fallbackBehavior: routine.fallbackBehavior,
          active: true,
          sortOrder: index,
        },
      });

      routineIds.push(row.id);
      routineByTitle.set(routine.title, row.id);
    }

    // ---- the first week ------------------------------------------------------

    for (const commitment of proposal.firstWeekCommitments) {
      const start = new Date(commitment.scheduledStart);
      const planVersionId = versionByDomain.get(commitment.domain) ?? null;

      const row = await tx.commitment.create({
        data: {
          userId,
          domain: commitment.domain,
          title: commitment.title,
          planVersionId,
          // Matched BY TITLE, which is how the proposal expresses the link: the
          // contract has no ids in it, because a model inventing one would point
          // a commitment at another user's routine.
          routineId: routineByTitle.get(commitment.title) ?? null,
          scheduledStart: start,
          scheduledEnd: new Date(start.getTime() + commitment.durationMinutes * 60_000),
          status: 'PLANNED',
          fullVersion: commitment.fullVersion,
          shortVersion: commitment.shortVersion,
          minimumVersion: commitment.minimumVersion,
          fullMinutes: commitment.durationMinutes,
          shortMinutes: Math.max(5, Math.round(commitment.durationMinutes / 2)),
          minimumMinutes: Math.max(2, Math.round(commitment.durationMinutes / 4)),
        },
      });

      commitmentIds.push(row.id);
    }

    // ---- domain modes --------------------------------------------------------
    //
    // GROW for every selected domain: a person who has just written down who
    // they want to become is not in maintenance.

    for (const domain of new Set(proposal.outcomes.map((o) => o.domain))) {
      await tx.domainMode.upsert({
        where: { userId_domain: { userId, domain } },
        create: { userId, domain, mode: 'GROW', effectiveFrom: now },
        update: { mode: 'GROW', effectiveFrom: now },
      });
    }

    // ---- and the profile itself ---------------------------------------------

    await tx.userProfile.update({
      where: { userId },
      data: {
        onboardingStep: 'DONE',
        onboardingCompletedAt: now,
        // Cleared: the proposal has become a Path, and a copy left behind would
        // be a second, stale answer to "what is this user's plan?".
        pendingProposal: Prisma.DbNull,
        lastActiveAt: now,
      },
    });

    return { bestSelfId: bestSelf.id, outcomeIds, planVersionIds, routineIds, commitmentIds };
  }

  /** Store a proposal and its provenance side by side; return the client view. */
  private async storeProposal(
    userId: string,
    proposal: OnboardingProposal,
    source: 'ai' | 'template',
    confidenceScore?: number,
  ): Promise<ProposalResponse> {
    await this.profiles.update(userId, {
      pendingProposal: { source, proposal } as unknown as Prisma.InputJsonValue,
      onboardingStep: 'PROPOSAL',
      ...(confidenceScore !== undefined ? { confidenceScore } : {}),
    });

    this.logger.log(
      `Onboarding propose user=${userId} source=${source} routines=${proposal.routines.length} ` +
        `commitments=${proposal.firstWeekCommitments.length} reduced=${proposal.reducedFromRequest}`,
    );

    return { proposal, source };
  }

  private toState(profile: UserProfile): OnboardingState {
    const stored = profile.pendingProposal as { source?: string; proposal?: unknown } | null;

    return {
      step: profile.onboardingStep,
      completed: profile.onboardingCompletedAt != null,
      answers: this.answersOf(profile),
      pendingProposal: this.pendingOf(profile),
      proposalSource:
        stored?.proposal == null ? null : stored.source === 'template' ? 'template' : 'ai',
      confidenceScore: profile.confidenceScore,
    };
  }

  /**
   * The stored proposal, or null.
   *
   * Re-parsed rather than cast: the column is JSON written by an earlier
   * deployment's schema, and a shape that no longer validates must read as
   * "no proposal" rather than crash the wizard on load.
   */
  private pendingOf(profile: UserProfile): OnboardingProposal | null {
    const stored = profile.pendingProposal as { proposal?: unknown } | null;

    if (!stored || stored.proposal == null) return null;

    const parsed = onboardingProposalSchema.safeParse(stored.proposal);

    return parsed.success ? parsed.data : null;
  }

  private answersOf(profile: UserProfile): OnboardingAnswers {
    const reflections = domainReflectionsSchema.safeParse(profile.domainReflections ?? {});
    const baseline = healthBaselineSchema.safeParse(profile.healthBaseline ?? null);

    return {
      sixMonthVision: profile.sixMonthVision,
      domains: profile.selectedDomains as ProposalDomain[],
      domainReflections: reflections.success ? (reflections.data as DomainReflections) : null,
      obstacles: profile.obstacles as ObstacleOption[],
      weekdayMinutes: profile.weekdayMinutes,
      healthBaseline: baseline.success ? (baseline.data as HealthBaseline) : null,
      coachingStyle: profile.coachingStyle,
    };
  }

  private guardrailsFor(
    profile: UserProfile,
    answers: OnboardingAnswers,
    now: Date,
  ): GuardrailContext {
    return {
      now,
      timezone: safeTimeZone(profile.timezone),
      domains: answers.domains,
      weekdayMinutes: answers.weekdayMinutes,
    };
  }

  /** A plan needs a person and at least one area. Everything else is optional. */
  private assertAnswered(answers: OnboardingAnswers): void {
    if (!answers.sixMonthVision || answers.domains.length === 0) {
      throw new BadRequestException({
        message: 'Tell me what you are working towards and which areas matter first.',
        details: { reason: 'ONBOARDING_INCOMPLETE' },
      });
    }
  }

  private assertNotCompleted(profile: UserProfile): void {
    if (profile.onboardingCompletedAt != null) {
      throw new ConflictException({
        message: 'You have already built your first Path.',
        details: { reason: 'ONBOARDING_ALREADY_COMPLETED' },
      });
    }
  }
}
