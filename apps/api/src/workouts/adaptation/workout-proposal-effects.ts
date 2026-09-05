import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, ProposalSourceKind } from '@prisma/client';

import type {
  ProposalEffect,
  ProposalEffectContext,
} from '../../coach/proposals/proposal-effects';

// =============================================================================
// What accepting a workout proposal does to the workout (issue #88, epic E09)
// =============================================================================
//
// E06's `applyChanges` writes the routine — the plan now says 25 minutes. This
// writes the workout: the template's own `targetMinutes`, the future
// commitments that already carry the old number, and the swapped exercise.
// Without it, accepting would leave a user with a plan that says 25 and a
// workout that is still 40, which is worse than not offering the change.
//
// AND IT RE-POINTS `workout_templates.routine_id`. This is the subtle one.
// Accepting creates a NEW plan version with NEW routine rows, so every
// template's 1:1 link now points at a routine on a superseded version — and the
// next adaptation run would target a routine nothing schedules. The link is
// re-established by TITLE, which is unique within one version because one FULL
// template produced it.
//
// It runs inside the accept transaction, so a failure here takes the plan
// version with it rather than leaving the two halves disagreeing.
// =============================================================================

@Injectable()
export class WorkoutProposalEffect implements ProposalEffect {
  readonly sourceKind: ProposalSourceKind = 'WORKOUT';

  private readonly logger = new Logger(WorkoutProposalEffect.name);

  async apply(tx: Prisma.TransactionClient, context: ProposalEffectContext): Promise<void> {
    const now = new Date();

    for (const change of context.changes) {
      const templateId = change.workout?.templateId;

      if (!templateId) continue;

      const template = await tx.workoutTemplate.findFirst({
        where: { id: templateId, program: { userId: context.userId } },
        select: { id: true, name: true, programId: true },
      });

      if (!template) continue;

      if (change.op === 'reduce' && change.after?.estimatedDurationMin) {
        const minutes = change.after.estimatedDurationMin;

        await tx.workoutTemplate.update({
          where: { id: template.id },
          data: { targetMinutes: minutes },
        });

        // The days already on the user's calendar. Leaving them at the old
        // length would show "40 min" on a workout the plan now says is 25.
        await tx.commitment.updateMany({
          where: {
            userId: context.userId,
            workoutTemplateId: template.id,
            status: { in: ['PLANNED', 'READY'] },
            scheduledStart: { gte: now },
          },
          data: { fullMinutes: minutes },
        });
      }

      const swap = change.workout?.replaceExercise;

      if (swap) {
        const prescription = await tx.workoutTemplateExercise.findFirst({
          where: { id: swap.templateExerciseId, templateId: template.id },
          select: { id: true, exerciseId: true },
        });

        if (prescription) {
          await tx.workoutTemplateExercise.update({
            where: { id: prescription.id },
            data: { exerciseId: swap.alternativeExerciseId, dislikedAt: null },
          });

          // The same movement in the short and minimum versions of this
          // workout. A swap the user agreed to that only applies on good days
          // is not a swap.
          await tx.workoutTemplateExercise.updateMany({
            where: {
              exerciseId: prescription.exerciseId,
              template: { fallbackOfTemplateId: template.id },
            },
            data: { exerciseId: swap.alternativeExerciseId, dislikedAt: null },
          });
        }
      }
    }

    await this.relinkRoutines(tx, context);

    await tx.auditEvent.create({
      data: {
        actorUserId: context.userId,
        action: 'workout_adaptation:applied',
        targetType: 'plan_version',
        targetId: context.planVersionId,
        meta: {
          planId: context.planId,
          ops: context.changes.map((change) => change.op),
        } as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Re-attach every template of the user's active program to the routine of the
   * version that was just activated.
   *
   * By title, because `createMany` gives the new routines new ids and nothing
   * carries the old ones forward. The titles came from the template names at
   * approve time and are unique within a version.
   */
  private async relinkRoutines(
    tx: Prisma.TransactionClient,
    context: ProposalEffectContext,
  ): Promise<void> {
    const program = await tx.workoutProgram.findFirst({
      where: { userId: context.userId, planId: context.planId, status: 'ACTIVE' },
      select: { id: true, templates: { select: { id: true, name: true, variant: true } } },
    });

    if (!program) return;

    const routines = await tx.routine.findMany({
      where: { planVersionId: context.planVersionId, userId: context.userId },
      select: { id: true, title: true },
    });

    for (const template of program.templates.filter((row) => row.variant === 'FULL')) {
      const routine = routines.find((row) => row.title === template.name);

      if (!routine) continue;

      // The unique index on `routine_id` means the old link has to go first
      // when two templates ever share a title; clearing then setting is the
      // simplest form that cannot collide.
      await tx.workoutTemplate.updateMany({
        where: { routineId: routine.id, id: { not: template.id } },
        data: { routineId: null },
      });

      await tx.workoutTemplate.update({
        where: { id: template.id },
        data: { routineId: routine.id },
      });
    }
  }
}
