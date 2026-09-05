import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { NotificationsService } from '../../notifications/notifications.service';
import { PlanVersionsService } from '../../path/plans/plan-versions.service';
import { findOwnedOrThrow } from '../../path/owned-resource';
import { PrismaService } from '../../prisma/prisma.service';
import { UserProfileService } from '../../user-profile/user-profile.service';
import { localDate, safeTimeZone } from '../../today/local-date';
import { addDays, localTimeToInstant, weekdayOf } from '../../weekly/week-bounds';
import type { ApproveProgramDto, ProgramQueryDto } from '../dto/workout-program.dtos';
import {
  PROGRAM_INCLUDE,
  toProgramDto,
  toProgramSummary,
  type ProgramRow,
} from './workout-program.mapper';
import { weeklyStructureSchema } from './workout-program.schema';
import { estimateMinutes } from './workout-program-rules';
import type { GenerationResult } from './workout-program-generator.service';

// =============================================================================
// A program's life after it is drafted (issue #77, epic E09)
// =============================================================================
//
// APPROVE IS THE ONLY PLACE A PROGRAM BECOMES A PLAN. Everything before it —
// generation, regeneration, the starter fallback — writes `workout_programs`
// rows and nothing else. PRD §15 is the reason, and it is enforced here by
// shape: `WorkoutProgramGeneratorService` has no `PlanVersionsService` and this
// one does.
//
// The approve transaction does five things that must all happen or none:
//   1. the Health outcome and its plan exist
//   2. a new user-approved `PlanVersion` carries the program's rationale
//   3. one `Routine` per FULL template, linked back by `workout_templates
//      .routine_id` — the join E09-05's adaptation proposals travel over
//   4. the previous ACTIVE program is archived and its future days cancelled
//   5. fourteen days of commitments exist, carrying all three sizes
//
// A half-applied approval is a user looking at a program that is live in one
// screen and absent from another, which is why it is one `$transaction` and not
// five awaits.
//
// THE NOTIFICATION IS SENT AFTER THE COMMIT, never inside it. `notify` is
// detached and would otherwise announce a program a rollback removed.
// =============================================================================

/** How far ahead approve schedules. Two weeks: long enough to feel real, short
 * enough that an abandoned program stops littering Today. */
export const SCHEDULE_DAYS = 14;

const DEFAULT_PREFERRED_TIME = '07:00';

@Injectable()
export class WorkoutProgramsService {
  private readonly logger = new Logger(WorkoutProgramsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly planVersions: PlanVersionsService,
    private readonly profiles: UserProfileService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(userId: string, query: ProgramQueryDto) {
    const rows = await this.prisma.workoutProgram.findMany({
      where: { userId, ...(query.status ? { status: query.status } : {}) },
      orderBy: [{ createdAt: 'desc' }],
    });

    return rows.map(toProgramSummary);
  }

  async get(userId: string, id: string) {
    return toProgramDto(await this.findOwned(userId, id));
  }

  async findOwned(userId: string, id: string): Promise<ProgramRow> {
    return findOwnedOrThrow(
      () =>
        this.prisma.workoutProgram.findFirst({
          where: { id, userId },
          include: PROGRAM_INCLUDE,
        }),
      'Workout program',
    );
  }

  toGenerateResponse(result: GenerationResult) {
    return {
      program: toProgramDto(result.program),
      source: result.source,
      reason: result.reason,
      message: result.message,
    };
  }

  // ---------------------------------------------------------------------------

  async approve(userId: string, id: string, dto: ApproveProgramDto) {
    const program = await this.findOwned(userId, id);

    if (program.status !== 'DRAFT') {
      throw new ConflictException({
        code: 'PROGRAM_NOT_DRAFT',
        message: `This program is ${program.status} and has already been decided on.`,
      });
    }

    const profile = await this.profiles.find(userId);
    const timeZone = safeTimeZone(profile?.timezone);
    const preferredTime = dto.preferredTime ?? DEFAULT_PREFERRED_TIME;
    const startDate = dto.startDate ?? addDays(localDate(new Date(), timeZone), 1);

    const structure = weeklyStructureSchema.safeParse(program.weeklyStructure);
    const weekdays = structure.success ? structure.data : [];

    const fullTemplates = program.templates.filter((t) => t.variant === 'FULL');
    const goal =
      (program.generationInput as { goal?: string } | null)?.goal ??
      'Train consistently and feel stronger.';

    const result = await this.prisma.$transaction(async (tx) => {
      // ---- 1. the Health outcome and its plan -----------------------------

      let outcome = await tx.outcome.findFirst({
        where: { userId, domain: 'HEALTH', state: 'ACTIVE' },
        orderBy: { createdAt: 'asc' },
      });

      outcome ??= await tx.outcome.create({
        data: {
          userId,
          domain: 'HEALTH',
          title: 'Train consistently',
          motivation: goal,
          importance: 4,
        },
      });

      let plan = await tx.plan.findFirst({ where: { userId, outcomeId: outcome.id } });

      plan ??= await tx.plan.create({ data: { userId, outcomeId: outcome.id } });

      // ---- 2 & 3. the version and its routines ----------------------------

      const expectedWeeklyLoad = fullTemplates.reduce(
        (total, template) => total + template.targetMinutes,
        0,
      );

      const version = await this.planVersions.createAndActivateInTx(tx, userId, plan.id, {
        rationale: program.rationale ?? `Workout program "${program.name}".`,
        expectedWeeklyLoad,
        fallbackStrategy: 'SHORT/MINIMUM workout variants',
        author: 'AI',
        routines: fullTemplates.map((template, index) => ({
          title: template.name,
          domain: 'HEALTH' as const,
          triggerType: 'TIME' as const,
          triggerValue: preferredTime,
          frequency: 'CUSTOM' as const,
          daysOfWeek: weekdays
            .filter((day) => day.templateId === template.id)
            .map((day) => day.weekday),
          preferredTime,
          estimatedDurationMin: template.targetMinutes,
          minimumDurationMin:
            program.templates.find((t) => t.name === template.name && t.variant === 'MINIMUM')
              ?.targetMinutes ?? template.targetMinutes,
          fallbackBehavior: `Short or minimum version of ${template.name}`,
          sortOrder: index,
        })),
      });

      // `createMany` cannot return ids, so the 1:1 link is stitched afterwards
      // by title — unique within one version because one FULL template made it.
      const routines = await tx.routine.findMany({
        where: { planVersionId: version.id },
        select: { id: true, title: true },
      });

      for (const template of fullTemplates) {
        const routine = routines.find((row) => row.title === template.name);

        if (routine) {
          await tx.workoutTemplate.update({
            where: { id: template.id },
            data: { routineId: routine.id },
          });
        }
      }

      // ---- 4. one active program at a time --------------------------------

      const superseded = await tx.workoutProgram.findMany({
        where: { userId, status: 'ACTIVE', id: { not: program.id } },
        select: { id: true, templates: { select: { id: true } } },
      });

      if (superseded.length > 0) {
        await tx.workoutProgram.updateMany({
          where: { id: { in: superseded.map((row) => row.id) } },
          data: { status: 'ARCHIVED' },
        });

        await tx.commitment.updateMany({
          where: {
            userId,
            workoutTemplateId: { in: superseded.flatMap((row) => row.templates.map((t) => t.id)) },
            status: { in: ['PLANNED', 'READY'] },
            scheduledStart: { gte: new Date() },
          },
          data: { status: 'CANCELLED' },
        });
      }

      const activated = await tx.workoutProgram.update({
        where: { id: program.id },
        data: { status: 'ACTIVE', planId: plan.id },
        include: PROGRAM_INCLUDE,
      });

      // ---- 5. the next fourteen days --------------------------------------

      const commitmentIds: string[] = [];

      for (let offset = 0; offset < SCHEDULE_DAYS; offset += 1) {
        const dateLocal = addDays(startDate, offset);
        const weekday = weekdayOf(dateLocal);

        for (const day of weekdays.filter((entry) => entry.weekday === weekday)) {
          const full = activated.templates.find((t) => t.id === day.templateId);

          if (!full) continue;

          const short = activated.templates.find(
            (t) => t.name === full.name && t.variant === 'SHORT',
          );
          const minimum = activated.templates.find(
            (t) => t.name === full.name && t.variant === 'MINIMUM',
          );

          const created = await tx.commitment.create({
            data: {
              userId,
              domain: 'HEALTH',
              title: full.name,
              outcomeId: outcome.id,
              planVersionId: version.id,
              routineId: full.routineId,
              workoutTemplateId: full.id,
              scheduledStart: localTimeToInstant(dateLocal, preferredTime, timeZone),
              scheduledEnd: new Date(
                localTimeToInstant(dateLocal, preferredTime, timeZone).getTime() +
                  full.targetMinutes * 60_000,
              ),
              fullVersion: full.name,
              fullMinutes: full.targetMinutes,
              shortVersion: short ? `${full.name} (short)` : null,
              shortMinutes: short?.targetMinutes ?? null,
              minimumVersion: minimum ? `${full.name} (minimum)` : null,
              minimumMinutes: minimum?.targetMinutes ?? null,
              importance: 4,
              status: 'PLANNED',
            },
            select: { id: true },
          });

          commitmentIds.push(created.id);
        }
      }

      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          action: 'workout_program:approve',
          targetType: 'workout_program',
          targetId: program.id,
          meta: {
            programId: program.id,
            planVersionId: version.id,
            commitments: commitmentIds.length,
            archivedPrograms: superseded.length,
          } as Prisma.InputJsonValue,
        },
      });

      return { program: activated, planVersionId: version.id, commitmentIds };
    });

    // Detached, and after the commit: a rollback must not leave the user with a
    // notification about a program that does not exist.
    await this.notifications.notify('health.program_activated', userId, {
      programName: result.program.name,
      programId: result.program.id,
    });

    this.logger.log(
      `workout_program.approve program=${program.id} commitments=${result.commitmentIds.length} user=${userId}`,
    );

    return {
      program: toProgramDto(result.program),
      planVersionId: result.planVersionId,
      commitmentIds: result.commitmentIds,
    };
  }

  async archive(userId: string, id: string) {
    const program = await this.findOwned(userId, id);

    if (program.status === 'ARCHIVED') return toProgramDto(program);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.commitment.updateMany({
        where: {
          userId,
          workoutTemplateId: { in: program.templates.map((t) => t.id) },
          status: { in: ['PLANNED', 'READY'] },
          scheduledStart: { gte: new Date() },
        },
        data: { status: 'CANCELLED' },
      });

      return tx.workoutProgram.update({
        where: { id: program.id },
        data: { status: 'ARCHIVED' },
        include: PROGRAM_INCLUDE,
      });
    });

    await this.audit(userId, 'workout_program:archive', program.id, {
      previousStatus: program.status,
    });

    return toProgramDto(updated);
  }

  async remove(userId: string, id: string): Promise<void> {
    const program = await this.findOwned(userId, id);

    // Only a DRAFT. An ACTIVE program has commitments, evidence and sessions
    // hanging off it; "delete" there means archive, and pretending otherwise
    // would destroy the record of workouts the user actually did.
    if (program.status !== 'DRAFT') {
      throw new ConflictException({
        code: 'PROGRAM_NOT_DRAFT',
        message: `A ${program.status} program is archived, not deleted.`,
      });
    }

    await this.prisma.workoutProgram.delete({ where: { id: program.id } });
    await this.audit(userId, 'workout_program:delete', program.id, { name: program.name });
  }

  /**
   * What a FULL template is expected to cost, in minutes.
   *
   * Recomputed from the prescription rather than read from `targetMinutes`,
   * because E09-05 changes the prescription and a stale label is what makes a
   * "25 minute" workout run forty.
   */
  estimateTemplateMinutes(template: {
    exercises: Array<{ sets: number; repMin: number; repMax: number; restSeconds: number }>;
  }): number {
    return estimateMinutes(template);
  }

  private async audit(
    userId: string,
    action: string,
    targetId: string,
    meta: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        actorUserId: userId,
        action,
        targetType: 'workout_program',
        targetId,
        meta: meta as Prisma.InputJsonValue,
      },
    });
  }
}
