import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AiGatewayService } from '../../ai/gateway/ai-gateway.service';
import { ObjectsService } from '../../storage/objects/objects.service';
import { PrismaService } from '../../prisma/prisma.service';
import { findOwnedOrThrow } from '../../path/owned-resource';
import { Trace } from '../../common/decorators/trace.decorator';
import { PAIN_SAFETY_COPY } from '../safety/workout-safety-copy';
import { WorkoutAdaptationService } from '../adaptation/workout-adaptation.service';
import { PROGRAM_INCLUDE } from '../programs/workout-program.mapper';
import {
  EQUIPMENT_CHECK_INSTRUCTIONS,
  FORM_CHECK_INSTRUCTIONS,
  MEAL_CHECK_INSTRUCTIONS,
} from './prompts/media-check.prompts';
import {
  EQUIPMENT_CHECK_PROMPT_VERSION,
  FORM_CHECK_PROMPT_VERSION,
  MEAL_CHECK_PROMPT_VERSION,
  equipmentCheckSchema,
  formCheckSchema,
  mealCheckSchema,
  mentionsAccounting,
  REDIRECTING_FLAGS,
  type EquipmentCheckOutput,
  type FormCheckOutput,
  type MealCheckOutput,
} from './schemas/media-check.schemas';
import { MediaSummaryService } from './media-summary.service';
import { NUTRITION_BEHAVIORS } from '../../health-domain/nutrition/nutrition-behaviors';

// =============================================================================
// Looking at what the user filmed or photographed (issue #92, epic E09)
// =============================================================================
//
// Three typed calls rather than one "ask about this image" (E03's `/ask`
// remains for free text). The difference is that these carry CONTEXT the user
// should not have to type — which exercise, which set, what weight, which
// program — and that they have POST-PROCESSING a free-text answer could not
// have.
//
// TWO PIECES OF POST-PROCESSING ARE THE PRODUCT:
//
//   1. THE SAFETY REDIRECT. A form check that flags pain or instability, or a
//      session already carrying `discomfortFlag`, comes back with NO CUES and
//      the professional-care copy. PRD §45/§81: the moment a body is the
//      question, coaching is the wrong answer — and cues alongside a "get this
//      looked at" would be read as permission to keep going.
//   2. THE NO-ACCOUNTING GUARD. A meal check whose text mentions calories,
//      macros or grams is REJECTED WHOLE rather than edited. A stripped
//      sentence reads as an omission, and we would be publishing the rest of a
//      reply that had already ignored its instructions.
//
// EVERY CALL RETURNS 200. A provider failure is `{ ok: false, error }` (PRD
// §120): the runner is a screen somebody is standing in front of, and an
// exception there ends the workout.
//
// Attachments are STORAGE OBJECT IDS. E03's `media_attachments` table — with
// `purpose`, a polymorphic target and `ai_summary` — is where these belong and
// has not landed; `MediaSummaryService` is the one-method seam that moves when
// it does. Ownership is `ObjectsService.getById(id, userId)` either way, which
// is the check that matters.
// =============================================================================

export type MediaCheckResult<T> =
  | { ok: true; result: T; storageObjectId: string; invocationId: string }
  | { ok: false; error: { code: string; message: string } };

export interface FormCheckResult extends FormCheckOutput {
  /** True when the safety redirect fired and the cues were withheld. */
  redirected: boolean;
}

export interface EquipmentSubstitution {
  exerciseId: string;
  exerciseName: string;
  alternativeExerciseId: string;
  alternativeName: string;
  reason: string;
}

export interface EquipmentCheckResult extends EquipmentCheckOutput {
  substitutions: EquipmentSubstitution[];
  /** The proposal raised from those substitutions, when one was. */
  proposalId: string | null;
}

@Injectable()
export class MediaCheckService {
  private readonly logger = new Logger(MediaCheckService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiGatewayService,
    private readonly objects: ObjectsService,
    private readonly summaries: MediaSummaryService,
    private readonly adaptation: WorkoutAdaptationService,
  ) {}

  // ---------------------------------------------------------------------------
  // Form check
  // ---------------------------------------------------------------------------

  @Trace('workouts.media.form_check')
  async formCheck(
    userId: string,
    sessionId: string,
    input: { storageObjectId: string; exerciseId: string; setNumber?: number },
  ): Promise<MediaCheckResult<FormCheckResult>> {
    const session = await findOwnedOrThrow(
      () =>
        this.prisma.workoutSession.findFirst({
          where: { id: sessionId, userId },
          select: { id: true, discomfortFlag: true, templateId: true },
        }),
      'Workout session',
    );

    await this.assertReady(userId, input.storageObjectId);

    const exercise = await this.prisma.exercise.findFirst({
      where: { id: input.exerciseId, OR: [{ scope: 'catalog' }, { scope: userId }] },
      select: { id: true, name: true, instructions: true, movementPattern: true },
    });

    if (!exercise) {
      throw new BadRequestException({
        code: 'EXERCISE_NOT_FOUND',
        message: 'That movement is not one we know about.',
      });
    }

    const set = await this.prisma.setLog.findFirst({
      where: {
        sessionId,
        exerciseId: input.exerciseId,
        ...(input.setNumber ? { setNumber: input.setNumber } : {}),
      },
      orderBy: { setNumber: 'desc' },
    });

    const result = await this.ai.invoke<FormCheckOutput>({
      persona: 'media_analyst',
      userId,
      promptVersion: FORM_CHECK_PROMPT_VERSION,
      instructions: FORM_CHECK_INSTRUCTIONS,
      input: JSON.stringify({
        exercise: {
          name: exercise.name,
          instructions: exercise.instructions,
          pattern: exercise.movementPattern,
        },
        set: set
          ? {
              weightKg: set.weightKg === null ? null : Number(set.weightKg),
              reps: set.reps,
              rpe: set.rpe,
              // The user's own report, handed over so the model does not have
              // to infer pain from a video it cannot feel.
              discomfort: set.discomfort,
            }
          : null,
      }),
      attachments: [{ storageObjectId: input.storageObjectId, detail: 'low' }],
      schema: formCheckSchema,
      schemaName: 'form_check',
      maxOutputTokens: 600,
    });

    if (!result.ok) return this.failure(result.error);

    // The redirect. Either the model saw something, or the user already told us.
    const flagged =
      result.output.riskFlags.some((flag) => REDIRECTING_FLAGS.includes(flag)) ||
      session.discomfortFlag ||
      (set !== null && set.discomfort !== 'NONE');

    const shaped: FormCheckResult = flagged
      ? {
          ...result.output,
          cues: [],
          safetyNote: PAIN_SAFETY_COPY,
          redirected: true,
        }
      : { ...result.output, redirected: false };

    await this.summaries.store(input.storageObjectId, userId, {
      kind: 'form_check',
      askedAt: new Date().toISOString(),
      invocationId: result.invocationId,
      promptVersion: FORM_CHECK_PROMPT_VERSION,
      result: shaped,
      context: { sessionId, exerciseId: input.exerciseId, setNumber: set?.setNumber ?? null },
    });

    await this.audit(userId, 'workout_media:form_check', input.storageObjectId, {
      sessionId,
      exerciseId: input.exerciseId,
      invocationId: result.invocationId,
      riskFlags: shaped.riskFlags,
      redirected: shaped.redirected,
    });

    return {
      ok: true,
      result: shaped,
      storageObjectId: input.storageObjectId,
      invocationId: result.invocationId,
    };
  }

  // ---------------------------------------------------------------------------
  // Equipment check
  // ---------------------------------------------------------------------------

  @Trace('workouts.media.equipment_check')
  async equipmentCheck(
    userId: string,
    input: { storageObjectId: string; programId?: string },
  ): Promise<MediaCheckResult<EquipmentCheckResult>> {
    await this.assertReady(userId, input.storageObjectId);

    const result = await this.ai.invoke<EquipmentCheckOutput>({
      persona: 'media_analyst',
      userId,
      promptVersion: EQUIPMENT_CHECK_PROMPT_VERSION,
      instructions: EQUIPMENT_CHECK_INSTRUCTIONS,
      input: JSON.stringify({ question: 'What can this person train with?' }),
      attachments: [{ storageObjectId: input.storageObjectId, detail: 'auto' }],
      schema: equipmentCheckSchema,
      schemaName: 'equipment_check',
      maxOutputTokens: 600,
    });

    if (!result.ok) return this.failure(result.error);

    // Deterministic from here: which prescribed movements the room cannot do,
    // and what the catalog offers instead. No second model call.
    const { substitutions, templateId } = await this.substitutionsFor(
      userId,
      result.output.equipmentDetected,
      input.programId,
    );

    let proposalId: string | null = null;

    if (substitutions.length > 0 && templateId) {
      // Through E06's protocol, like every other change: the check itself
      // mutates nothing, and the user accepts or refuses a diff they can read.
      const raised = await this.adaptation.proposeSubstitution(
        userId,
        templateId,
        substitutions.map((substitution) => ({
          templateExerciseId: substitution.exerciseId,
          alternativeExerciseId: substitution.alternativeExerciseId,
        })),
        'the equipment in that photo',
      );

      proposalId = raised.proposalIds[0] ?? null;
    }

    const shaped: EquipmentCheckResult = { ...result.output, substitutions, proposalId };

    await this.summaries.store(input.storageObjectId, userId, {
      kind: 'equipment_check',
      askedAt: new Date().toISOString(),
      invocationId: result.invocationId,
      promptVersion: EQUIPMENT_CHECK_PROMPT_VERSION,
      result: shaped,
    });

    await this.audit(userId, 'workout_media:equipment_check', input.storageObjectId, {
      invocationId: result.invocationId,
      equipmentDetected: result.output.equipmentDetected,
      substitutions: substitutions.length,
      proposalId,
    });

    return {
      ok: true,
      result: shaped,
      storageObjectId: input.storageObjectId,
      invocationId: result.invocationId,
    };
  }

  // ---------------------------------------------------------------------------
  // Meal check
  // ---------------------------------------------------------------------------

  @Trace('nutrition.media.meal_check')
  async mealCheck(
    userId: string,
    input: { storageObjectId: string; question?: string },
  ): Promise<MediaCheckResult<MealCheckOutput>> {
    await this.assertReady(userId, input.storageObjectId);

    const result = await this.ai.invoke<MealCheckOutput>({
      persona: 'media_analyst',
      userId,
      promptVersion: MEAL_CHECK_PROMPT_VERSION,
      instructions: MEAL_CHECK_INSTRUCTIONS,
      input: JSON.stringify({
        question: input.question ?? null,
        behaviours: NUTRITION_BEHAVIORS.map((behaviour) => ({
          key: behaviour.key,
          title: behaviour.title,
        })),
      }),
      attachments: [{ storageObjectId: input.storageObjectId, detail: 'auto' }],
      schema: mealCheckSchema,
      schemaName: 'meal_check',
      maxOutputTokens: 600,
    });

    if (!result.ok) return this.failure(result.error);

    if (mentionsAccounting(result.output)) {
      this.logger.warn(
        `meal check rejected for naming numbers we do not use invocation=${result.invocationId}`,
      );

      await this.audit(userId, 'nutrition:meal_check', input.storageObjectId, {
        invocationId: result.invocationId,
        rejected: 'accounting',
      });

      return {
        ok: false,
        error: {
          code: 'schema',
          message: 'The coach returned numbers we do not use. Try that photo again.',
        },
      };
    }

    await this.summaries.store(input.storageObjectId, userId, {
      kind: 'meal_check',
      askedAt: new Date().toISOString(),
      invocationId: result.invocationId,
      promptVersion: MEAL_CHECK_PROMPT_VERSION,
      result: result.output,
    });

    await this.audit(userId, 'nutrition:meal_check', input.storageObjectId, {
      invocationId: result.invocationId,
      suggestions: result.output.behaviorSuggestions.map((suggestion) => suggestion.key),
    });

    return {
      ok: true,
      result: result.output,
      storageObjectId: input.storageObjectId,
      invocationId: result.invocationId,
    };
  }

  // ---------------------------------------------------------------------------

  /** Owned, and finished uploading. 404 for a foreign id; 409 while it lands. */
  private async assertReady(userId: string, storageObjectId: string): Promise<void> {
    // Throws 404 for anything that is not this user's.
    const object = await this.objects.getById(storageObjectId, userId);

    if (object.status !== 'ready') {
      throw new ConflictException({
        code: 'MEDIA_NOT_READY',
        message: 'That upload has not finished yet.',
      });
    }
  }

  /**
   * Which prescribed movements the photographed room cannot do, and what it can.
   *
   * The catalog's `substitutionGroup` is the whole mechanism, which is why it
   * exists: swapping a lat pulldown for a band pulldown is a lookup, and a
   * lookup keeps working when the provider does not.
   */
  private async substitutionsFor(
    userId: string,
    detected: string[],
    programId?: string,
  ): Promise<{ substitutions: EquipmentSubstitution[]; templateId: string | null }> {
    const program = await this.prisma.workoutProgram.findFirst({
      where: programId ? { id: programId, userId } : { userId, status: 'ACTIVE' },
      include: PROGRAM_INCLUDE,
    });

    if (!program) return { substitutions: [], templateId: null };

    const available = new Set<string>([...detected, 'BODYWEIGHT']);

    const full = program.templates.filter((template) => template.variant === 'FULL');
    const prescribed = full.flatMap((template) =>
      template.exercises.map((row) => ({ template, row })),
    );

    if (prescribed.length === 0) return { substitutions: [], templateId: null };

    const details = await this.prisma.exercise.findMany({
      where: { id: { in: prescribed.map((entry) => entry.row.exerciseId) } },
      select: { id: true, name: true, equipment: true, substitutionGroup: true },
    });

    const byId = new Map(details.map((row) => [row.id, row]));
    const groups = [...new Set(details.map((row) => row.substitutionGroup))];

    const catalog = await this.prisma.exercise.findMany({
      where: {
        substitutionGroup: { in: groups },
        OR: [{ scope: 'catalog' }, { scope: userId }],
      },
      select: { id: true, name: true, equipment: true, substitutionGroup: true },
      orderBy: { name: 'asc' },
    });

    const substitutions: EquipmentSubstitution[] = [];
    let templateId: string | null = null;

    for (const { template, row } of prescribed) {
      const exercise = byId.get(row.exerciseId);

      if (!exercise) continue;

      const fits = exercise.equipment.every((item) => available.has(item));

      if (fits) continue;

      const alternative = catalog.find(
        (candidate) =>
          candidate.substitutionGroup === exercise.substitutionGroup &&
          candidate.id !== exercise.id &&
          candidate.equipment.every((item) => available.has(item)),
      );

      if (!alternative) continue;

      // One template's worth: a proposal spanning several workouts is a diff
      // nobody can read in one sitting.
      templateId ??= template.id;

      if (template.id !== templateId) continue;

      substitutions.push({
        exerciseId: row.id,
        exerciseName: exercise.name,
        alternativeExerciseId: alternative.id,
        alternativeName: alternative.name,
        reason: `No ${exercise.equipment.join(' or ').toLowerCase()} detected`,
      });
    }

    return { substitutions, templateId };
  }

  private failure(error: { code: string; message: string }): { ok: false; error: { code: string; message: string } } {
    return { ok: false, error: { code: error.code, message: error.message } };
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
        targetType: 'storage_object',
        targetId,
        meta: meta as Prisma.InputJsonValue,
      },
    });
  }
}
