import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { ProposalsService } from '../../coach/proposals/proposals.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { findOwnedOrThrow } from '../../path/owned-resource';
import { PrismaService } from '../../prisma/prisma.service';
import { PROGRAM_INCLUDE } from '../programs/workout-program.mapper';
import { programSubstitutionsSchema } from '../programs/workout-program.schema';
import {
  detect,
  substitutionCandidate,
  WINDOW_DAYS,
  type AdaptationCandidate,
  type TemplateSignals,
} from './adaptation-rules';

// =============================================================================
// Turning signals into proposals (issue #88, epic E09)
// =============================================================================
//
// THE DETECTOR NEVER CHANGES A PROGRAM. It writes `plan_change_proposals` rows
// and stops; the template changes when — and only when — the user calls
// `POST /proposals/:id/accept` (PRD §15, §43, §106). `WorkoutProposalEffect` is
// the other half, and it runs inside that accept.
//
// AT MOST ONE PROPOSAL PER TEMPLATE PER FORTNIGHT. Not a performance
// consideration: a product that raises a second proposal about the same
// workout while the first is still unread is nagging somebody about a plan
// they already know is not working, and PRD §43's whole tone is the opposite of
// that. The de-dup looks for an existing PROPOSED/EDITED/ACCEPTED proposal on
// the same routine with the same op inside the window.
// =============================================================================

const DEDUPE_STATUSES = ['PROPOSED', 'EDITED', 'ACCEPTED'] as const;

@Injectable()
export class WorkoutAdaptationService {
  private readonly logger = new Logger(WorkoutAdaptationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly proposals: ProposalsService,
    private readonly notifications: NotificationsService,
  ) {}

  /** What `run` would create, without creating it. The explain view. */
  async candidates(userId: string, now = new Date()): Promise<AdaptationCandidate[]> {
    const signals = await this.signalsFor(userId, now);

    return detect(signals);
  }

  async run(
    userId: string,
    now = new Date(),
  ): Promise<{ created: number; proposalIds: string[] }> {
    const program = await this.activeProgram(userId);

    if (!program?.planId) return { created: 0, proposalIds: [] };

    const candidates = await this.candidates(userId, now);
    const proposalIds: string[] = [];

    for (const candidate of candidates) {
      if (await this.alreadyRaised(userId, candidate, now)) {
        this.logger.debug(
          `workout_adaptation skipped template=${candidate.templateId} ` +
            `detector=${candidate.detector} (recent proposal)`,
        );
        continue;
      }

      const proposal = await this.proposals.createFromSource(userId, 'WORKOUT', {
        planId: program.planId,
        summary: candidate.summary,
        changes: candidate.changes,
        invocationId: null,
      });

      proposalIds.push(proposal.id);

      await this.prisma.auditEvent.create({
        data: {
          actorUserId: userId,
          action: 'workout_adaptation:propose',
          targetType: 'plan_change_proposal',
          targetId: proposal.id,
          meta: {
            proposalId: proposal.id,
            detector: candidate.detector,
            templateId: candidate.templateId,
          } as Prisma.InputJsonValue,
        },
      });

      // After the row exists, never before: a notification about a proposal
      // that failed to write is a link to a 404.
      await this.notifications.notify('plan.proposal_created', userId, {
        summary: candidate.summary,
        proposalId: proposal.id,
      });
    }

    if (proposalIds.length > 0) {
      this.logger.log(
        `workout_adaptation.run user=${userId} candidates=${candidates.length} ` +
          `created=${proposalIds.length}`,
      );
    }

    return { created: proposalIds.length, proposalIds };
  }

  /**
   * The equipment-driven swap E09-06's equipment check raises.
   *
   * Same protocol, different trigger: a photograph rather than a fortnight of
   * behaviour. It goes through `createFromSource` like everything else, so an
   * equipment swap is as reviewable and as refusable as a skipped-twice one.
   */
  async proposeSubstitution(
    userId: string,
    templateId: string,
    substitutions: Array<{ templateExerciseId: string; alternativeExerciseId: string }>,
    missingEquipment: string,
  ): Promise<{ created: number; proposalIds: string[] }> {
    const program = await this.activeProgram(userId);

    if (!program?.planId) return { created: 0, proposalIds: [] };

    const signals = (await this.signalsFor(userId, new Date())).find(
      (row) => row.templateId === templateId,
    );

    if (!signals) return { created: 0, proposalIds: [] };

    const candidate = substitutionCandidate(signals, substitutions, missingEquipment);

    if (!candidate) return { created: 0, proposalIds: [] };

    const proposal = await this.proposals.createFromSource(userId, 'WORKOUT', {
      planId: program.planId,
      summary: candidate.summary,
      changes: candidate.changes,
      invocationId: null,
    });

    await this.notifications.notify('plan.proposal_created', userId, {
      summary: candidate.summary,
      proposalId: proposal.id,
    });

    return { created: 1, proposalIds: [proposal.id] };
  }

  /** "Not this one." A timestamp, so the detector can ask when. */
  async setDisliked(
    userId: string,
    templateId: string,
    templateExerciseId: string,
    disliked: boolean,
  ): Promise<{ dislikedAt: string | null }> {
    const row = await findOwnedOrThrow(
      () =>
        this.prisma.workoutTemplateExercise.findFirst({
          where: {
            id: templateExerciseId,
            templateId,
            template: { program: { userId } },
          },
          select: { id: true },
        }),
      'Exercise',
    );

    const updated = await this.prisma.workoutTemplateExercise.update({
      where: { id: row.id },
      data: { dislikedAt: disliked ? new Date() : null },
      select: { dislikedAt: true },
    });

    return { dislikedAt: updated.dislikedAt?.toISOString() ?? null };
  }

  // ---------------------------------------------------------------------------

  private async activeProgram(userId: string) {
    return this.prisma.workoutProgram.findFirst({
      where: { userId, status: 'ACTIVE' },
      include: PROGRAM_INCLUDE,
    });
  }

  /**
   * Everything the pure rules need, for one user, in a handful of queries.
   *
   * FULL templates only: a short version is a fallback, not a plan, and
   * proposing to shorten the short version would be nonsense.
   */
  private async signalsFor(userId: string, now: Date): Promise<TemplateSignals[]> {
    const program = await this.activeProgram(userId);

    if (!program) return [];

    const since = new Date(now.getTime() - WINDOW_DAYS * 24 * 3600_000);
    const templateIds = program.templates.map((row) => row.id);

    const [skips, sessions] = await Promise.all([
      this.prisma.commitment.groupBy({
        by: ['workoutTemplateId'],
        where: {
          userId,
          workoutTemplateId: { in: templateIds },
          status: { in: ['SKIPPED', 'MISSED'] },
          scheduledStart: { gte: since, lte: now },
        },
        _count: { _all: true },
      }),
      this.prisma.workoutSession.findMany({
        where: {
          userId,
          templateId: { in: templateIds },
          status: 'COMPLETED',
          startedAt: { gte: since, lte: now },
        },
        orderBy: { startedAt: 'desc' },
        select: {
          templateId: true,
          startedAt: true,
          finishedAt: true,
          template: { select: { fallbackOfTemplateId: true, variant: true } },
          setLogs: { select: { exerciseId: true } },
        },
      }),
    ]);

    const substitutions = programSubstitutionsSchema.safeParse(program.substitutions);
    const alternativesById = new Map(
      (substitutions.success ? substitutions.data : []).map((entry) => [
        entry.exerciseId,
        entry.alternativeExerciseIds,
      ]),
    );

    const catalogAlternatives = await this.catalogAlternatives(program.id, userId);

    return program.templates
      .filter((template) => template.variant === 'FULL')
      .map((template) => {
        // A session on the short version is still a session on this workout.
        const own = sessions.filter(
          (session) =>
            session.templateId === template.id ||
            session.template.fallbackOfTemplateId === template.id,
        );

        return {
          templateId: template.id,
          templateName: template.name,
          routineId: template.routineId,
          targetMinutes: template.targetMinutes,
          exercises: template.exercises.map((row) => ({
            templateExerciseId: row.id,
            exerciseId: row.exerciseId,
            name: row.exercise.name,
            dislikedAt: row.dislikedAt,
            alternativeExerciseIds:
              alternativesById.get(row.exerciseId) ??
              catalogAlternatives.get(row.exerciseId) ??
              [],
          })),
          skippedCount:
            skips.find((row) => row.workoutTemplateId === template.id)?._count._all ?? 0,
          sessionMinutes: own
            .filter((session) => session.finishedAt !== null)
            .map((session) =>
              Math.round(
                (session.finishedAt!.getTime() - session.startedAt.getTime()) / 60_000,
              ),
            ),
          recentSessionExerciseIds: own.map((session) =>
            session.setLogs.map((log) => log.exerciseId),
          ),
        } satisfies TemplateSignals;
      });
  }

  /**
   * The catalog's own answer to "what else could I do instead?", used when the
   * program's stored substitutions have nothing for a movement.
   *
   * Same substitution group, equipment the program was built for. This is why
   * `substitutionGroup` exists: it makes the fallback a lookup rather than
   * another model call on a path that has to work with the provider down.
   */
  private async catalogAlternatives(
    programId: string,
    userId: string,
  ): Promise<Map<string, string[]>> {
    const program = await this.prisma.workoutProgram.findUniqueOrThrow({
      where: { id: programId },
      select: { generationInput: true },
    });

    const equipment = new Set<string>([
      ...(((program.generationInput as { equipment?: string[] } | null)?.equipment ?? []) as string[]),
      'BODYWEIGHT',
    ]);

    const prescribed = await this.prisma.workoutTemplateExercise.findMany({
      where: { template: { programId } },
      select: { exerciseId: true, exercise: { select: { substitutionGroup: true } } },
    });

    const groups = [...new Set(prescribed.map((row) => row.exercise.substitutionGroup))];

    const catalog = await this.prisma.exercise.findMany({
      where: {
        substitutionGroup: { in: groups },
        OR: [{ scope: 'catalog' }, { scope: userId }],
      },
      select: { id: true, equipment: true, substitutionGroup: true },
      orderBy: { name: 'asc' },
    });

    const byGroup = new Map<string, string[]>();

    for (const row of catalog) {
      if (!row.equipment.every((item) => equipment.has(item))) continue;

      byGroup.set(row.substitutionGroup, [...(byGroup.get(row.substitutionGroup) ?? []), row.id]);
    }

    return new Map(
      prescribed.map((row) => [
        row.exerciseId,
        (byGroup.get(row.exercise.substitutionGroup) ?? []).filter((id) => id !== row.exerciseId),
      ]),
    );
  }

  private async alreadyRaised(
    userId: string,
    candidate: AdaptationCandidate,
    now: Date,
  ): Promise<boolean> {
    const since = new Date(now.getTime() - WINDOW_DAYS * 24 * 3600_000);

    const recent = await this.prisma.planChangeProposal.findMany({
      where: {
        userId,
        sourceKind: 'WORKOUT',
        status: { in: [...DEDUPE_STATUSES] },
        createdAt: { gte: since },
      },
      select: { changes: true },
    });

    const wanted = candidate.changes.map(
      (change) => `${change.op}:${change.target.id ?? ''}`,
    );

    return recent.some((row) => {
      const changes = (row.changes ?? []) as Array<{ op?: string; target?: { id?: string } }>;

      return changes.some((change) =>
        wanted.includes(`${change.op ?? ''}:${change.target?.id ?? ''}`),
      );
    });
  }
}
