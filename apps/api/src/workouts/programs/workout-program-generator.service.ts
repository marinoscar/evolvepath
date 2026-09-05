import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type Equipment } from '@prisma/client';

import { AiGatewayService } from '../../ai/gateway/ai-gateway.service';
import { AiKeyRequiredException } from '../../ai/gateway/ai-errors';
import { SafetyPolicyService } from '../../coach/safety/safety-policy.service';
import type { SafetyDecision } from '../../coach/safety/safety.types';
import { SAFETY_CONSERVATIVE_INSTRUCTIONS } from '../../coach/safety/safety-copy';
import { PrismaService } from '../../prisma/prisma.service';
import { Trace } from '../../common/decorators/trace.decorator';
import { ExerciseResolverService } from '../exercises/exercise-resolver.service';
import type { GenerateProgramRequest } from '../dto/workout-program.dtos';
import { buildStarterProgram, effectiveDaysPerWeek } from './starter-program';
import { buildProgramInstructions } from './workout-programmer.prompt';
import {
  checkProgram,
  normalizeExerciseName,
  violationMessage,
  type RuleViolation,
} from './workout-program-rules';
import {
  PROGRAM_PROMPT_VERSION,
  PROGRAM_SCHEMA_NAME,
  workoutProgramProposalSchema,
  type WorkoutProgramProposal,
} from './workout-program.schema';
import { PROGRAM_INCLUDE, type ProgramRow } from './workout-program.mapper';

// =============================================================================
// Generating a program (issue #77, epic E09)
// =============================================================================
//
// safety pre-check → gateway → deterministic rules → DRAFT rows.
//
// THE ORDER IS THE POINT. The safety evaluation happens BEFORE the model, so a
// user describing a crisis gets professional-care copy even when the provider is
// down — the one situation a model-written response would not arrive at all
// (E06-06). And the rules run AFTER, so the output the user sees has been
// checked rather than merely requested.
//
// EVERY FAILURE IS A PROGRAM, not an error. A rejected proposal, an unreachable
// provider and a safety redirect all return the deterministic starter with a
// `reason` the UI can explain (PRD §120). The single exception is "you have no
// key", which is 412 because it is a thing the user can go and fix, and quietly
// handing them a starter program would hide that.
//
// NOTHING HERE WRITES A PLAN. A generated program is DRAFT rows in
// `workout_programs`; `plans`, `plan_versions`, `routines` and `commitments`
// are untouched until `WorkoutProgramsService.approve` (PRD §15).
// =============================================================================

export type GenerationReason =
  | 'invalid_output'
  | 'ai_unavailable'
  | 'safety_redirect'
  | 'requested';

export interface GenerationResult {
  program: ProgramRow;
  source: 'ai' | 'starter';
  reason: GenerationReason | null;
  message: string | null;
}

@Injectable()
export class WorkoutProgramGeneratorService {
  private readonly logger = new Logger(WorkoutProgramGeneratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiGatewayService,
    private readonly safety: SafetyPolicyService,
    private readonly exercises: ExerciseResolverService,
  ) {}

  @Trace('workouts.program.generate')
  async generate(userId: string, req: GenerateProgramRequest): Promise<GenerationResult> {
    if (req.useStarter) {
      return this.starter(userId, req, 'requested', null, null);
    }

    // ---- 1. safety, before the model ---------------------------------------

    const text = [req.goal, req.preferences, req.limitations].filter(Boolean).join('\n');
    const decision = await this.safety.evaluate({ userId, text, surface: 'workout' });

    if (decision.decision === 'redirect') {
      return this.starter(
        userId,
        req,
        'safety_redirect',
        decision.userFacingNote ?? null,
        decision,
      );
    }

    // ---- 2. the model ------------------------------------------------------

    const catalog = await this.promptCatalog(userId, req.equipment);

    const result = await this.ai.invoke<WorkoutProgramProposal>({
      persona: 'workout_programmer',
      userId,
      promptVersion: PROGRAM_PROMPT_VERSION,
      instructions: buildProgramInstructions({
        safetyInstructions:
          decision.decision === 'conservative' ? SAFETY_CONSERVATIVE_INSTRUCTIONS : null,
      }),
      input: JSON.stringify({
        request: {
          goal: req.goal,
          experience: req.experience,
          daysPerWeek: req.daysPerWeek,
          minutesPerSession: req.minutesPerSession,
          equipment: req.equipment,
          preferences: req.preferences ?? null,
          limitations: req.limitations ?? null,
        },
        catalog,
        rules: { maxDaysBeginner: 4, minutesTolerancePct: 10 },
      }),
      schema: workoutProgramProposalSchema,
      schemaName: PROGRAM_SCHEMA_NAME,
      maxOutputTokens: 4000,
      safetyDecision: decision,
    });

    if (!result.ok) {
      // The one failure that is the user's to fix, so it must not be hidden
      // behind a working-looking fallback.
      if (result.error.code === 'no_user_key') throw new AiKeyRequiredException();

      this.logger.log(
        `workout program falling back to starter user=${userId} reason=${result.error.code}`,
      );

      return this.starter(userId, req, 'ai_unavailable', null, decision, result.invocationId);
    }

    // ---- 3. the rules ------------------------------------------------------

    const violations = await this.violationsFor(userId, result.output, req);

    if (violations.length > 0) {
      this.logger.warn(
        `workout program rejected user=${userId} invocation=${result.invocationId} ` +
          `codes=${violations.map((v) => v.code).join(',')}`,
      );

      return this.starter(
        userId,
        req,
        'invalid_output',
        violationMessage(violations),
        decision,
        result.invocationId,
        violations,
      );
    }

    // ---- 4. DRAFT rows -----------------------------------------------------

    const program = await this.persist(userId, result.output, req);

    await this.audit(userId, program.id, {
      source: 'ai',
      invocationId: result.invocationId,
      templates: program.templates.length,
    });

    return { program, source: 'ai', reason: null, message: null };
  }

  // ---------------------------------------------------------------------------

  private async starter(
    userId: string,
    req: GenerateProgramRequest,
    reason: GenerationReason,
    message: string | null,
    decision: SafetyDecision | null,
    invocationId?: string,
    violations?: RuleViolation[],
  ): Promise<GenerationResult> {
    const proposal = buildStarterProgram({
      experience: req.experience,
      daysPerWeek: req.daysPerWeek,
      minutesPerSession: req.minutesPerSession,
      equipment: req.equipment as Equipment[],
    });

    const program = await this.persist(userId, proposal, req);

    await this.audit(userId, program.id, {
      source: 'starter',
      reason,
      invocationId: invocationId ?? null,
      safetyDecision: decision?.decision ?? null,
      violations: violations?.map((v) => ({ code: v.code, subject: v.subject ?? null })) ?? null,
      scheduledDays: effectiveDaysPerWeek({
        experience: req.experience,
        daysPerWeek: req.daysPerWeek,
        minutesPerSession: req.minutesPerSession,
        equipment: req.equipment as Equipment[],
      }),
    });

    return { program, source: 'starter', reason, message };
  }

  /**
   * The names and groups the model may choose from, filtered to what the user
   * has plus bodyweight.
   *
   * AND semantics on `equipment`: a movement is offered only when EVERY piece it
   * needs is available. A dumbbell bench press in a room with dumbbells and no
   * bench is a program the user cannot run.
   */
  private async promptCatalog(
    userId: string,
    equipment: string[],
  ): Promise<Array<{ name: string; group: string }>> {
    const available = new Set<string>([...equipment, 'BODYWEIGHT']);

    const rows = await this.prisma.exercise.findMany({
      where: this.exercises.visibleWhere(userId),
      select: { name: true, equipment: true, substitutionGroup: true },
      orderBy: { name: 'asc' },
    });

    return rows
      .filter((row) => row.equipment.every((item) => available.has(item)))
      .map((row) => ({ name: row.name, group: row.substitutionGroup }));
  }

  /**
   * Read-only. The contraindication map comes from rows that already exist, so a
   * proposal we are about to reject never leaves custom exercises behind.
   */
  private async violationsFor(
    userId: string,
    proposal: WorkoutProgramProposal,
    req: GenerateProgramRequest,
  ): Promise<RuleViolation[]> {
    const rows = await this.prisma.exercise.findMany({
      where: this.exercises.visibleWhere(userId),
      select: { nameKey: true, contraindicationTags: true },
    });

    return checkProgram(proposal, {
      experience: req.experience,
      daysPerWeek: req.daysPerWeek,
      minutesPerSession: req.minutesPerSession,
      limitations: req.limitations,
      contraindicationsByName: new Map(rows.map((row) => [row.nameKey, row.contraindicationTags])),
    });
  }

  /**
   * One transaction: the program, its templates, their exercises, and then the
   * program again with the ids the first insert could not know.
   *
   * `weeklyStructure` is written twice because a weekday points at a TEMPLATE
   * ID, and template ids do not exist until the templates do. The alternative —
   * storing template names in the column — would make renaming a workout a
   * silent data corruption.
   */
  private async persist(
    userId: string,
    proposal: WorkoutProgramProposal,
    req: GenerateProgramRequest,
  ): Promise<ProgramRow> {
    const names = [
      ...proposal.templates.flatMap((t) => t.exercises.map((e) => e.exerciseName)),
      ...proposal.substitutions.flatMap((s) => [s.exerciseName, ...s.alternatives]),
    ];

    const resolved = await this.exercises.resolveMany(names, userId, {
      equipment: req.equipment as Equipment[],
    });

    const idFor = (name: string): string | null =>
      resolved.get(normalizeExerciseName(name))?.id ?? null;

    return this.prisma.$transaction(async (tx) => {
      const program = await tx.workoutProgram.create({
        data: {
          userId,
          name: proposal.programName,
          durationWeeks: proposal.durationWeeks,
          weeklyStructure: [],
          rationale: proposal.rationale,
          generationInput: req as unknown as Prisma.InputJsonValue,
          status: 'DRAFT',
        },
      });

      // FULL templates first, so SHORT and MINIMUM have a sibling to point at.
      const ordered = [...proposal.templates].sort((a, b) =>
        a.variant === 'FULL' ? -1 : b.variant === 'FULL' ? 1 : 0,
      );

      const fullIdByName = new Map<string, string>();
      const templateIds: Array<{ name: string; variant: string; id: string }> = [];

      for (const template of ordered) {
        const created = await tx.workoutTemplate.create({
          data: {
            programId: program.id,
            name: template.name,
            variant: template.variant,
            targetMinutes: template.targetMinutes,
            fallbackOfTemplateId:
              template.variant === 'FULL' ? null : (fullIdByName.get(template.name) ?? null),
          },
        });

        if (template.variant === 'FULL') fullIdByName.set(template.name, created.id);
        templateIds.push({ name: template.name, variant: template.variant, id: created.id });

        await tx.workoutTemplateExercise.createMany({
          data: template.exercises
            .map((exercise, index) => {
              const exerciseId = idFor(exercise.exerciseName);

              return exerciseId
                ? {
                    templateId: created.id,
                    exerciseId,
                    order: index + 1,
                    sets: exercise.sets,
                    repMin: exercise.repMin,
                    repMax: exercise.repMax,
                    restSeconds: exercise.restSeconds,
                    notes: exercise.notes,
                  }
                : null;
            })
            .filter((row): row is NonNullable<typeof row> => row !== null),
        });
      }

      const weeklyStructure = proposal.weeklyStructure
        .map((day) => ({ weekday: day.weekday, templateId: fullIdByName.get(day.templateName) }))
        .filter((day): day is { weekday: number; templateId: string } => Boolean(day.templateId));

      const substitutions = proposal.substitutions
        .map((entry) => ({
          exerciseId: idFor(entry.exerciseName),
          alternativeExerciseIds: entry.alternatives
            .map(idFor)
            .filter((id): id is string => id !== null),
        }))
        .filter(
          (entry): entry is { exerciseId: string; alternativeExerciseIds: string[] } =>
            entry.exerciseId !== null && entry.alternativeExerciseIds.length > 0,
        );

      return tx.workoutProgram.update({
        where: { id: program.id },
        data: { weeklyStructure, substitutions },
        include: PROGRAM_INCLUDE,
      });
    });
  }

  private async audit(
    userId: string,
    programId: string,
    meta: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        actorUserId: userId,
        action: 'workout_program:generate',
        targetType: 'workout_program',
        targetId: programId,
        meta: meta as Prisma.InputJsonValue,
      },
    });
  }
}
