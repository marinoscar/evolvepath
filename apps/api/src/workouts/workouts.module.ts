import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';
import { CoachModule } from '../coach/coach.module';
import { CommitmentsModule } from '../commitments/commitments.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PathModule } from '../path/path.module';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { SafetyModule } from '../coach/safety/safety.module';
import { UserProfileModule } from '../user-profile/user-profile.module';
import { ExercisesController } from './exercises/exercises.controller';
import { ExerciseResolverService } from './exercises/exercise-resolver.service';
import { WorkoutProgramGeneratorService } from './programs/workout-program-generator.service';
import { WorkoutProgramsController } from './programs/workout-programs.controller';
import { WorkoutProgramsService } from './programs/workout-programs.service';
import { ProgressionExplainerService } from './progression/progression-explainer.service';
import { WorkoutAdaptationController } from './adaptation/workout-adaptation.controller';
import { WorkoutAdaptationService } from './adaptation/workout-adaptation.service';
import { WorkoutAdaptationTask } from './adaptation/workout-adaptation.task';
import { MediaCheckService } from './media/media-check.service';
import { MediaSummaryService } from './media/media-summary.service';
import { WorkoutMediaController } from './media/workout-media.controller';
import { WorkoutSessionsController } from './sessions/workout-sessions.controller';
import { WorkoutSessionsService } from './sessions/workout-sessions.service';

/**
 * The Health domain's product code (epic E09).
 *
 * NOT `apps/api/src/health/` — that module is the liveness and readiness probe
 * and its routes are `@Public()`. Nothing in here may go there.
 *
 * `CommitmentsModule` is imported for `CommitmentActionsService`, and the
 * session runner calls it for EVERY commitment transition. The transition
 * matrix, the timer and the APP_FLOW evidence live there; a second writer here
 * would be a second matrix.
 *
 * `CoachModule` is imported for `ProposalsService`, which is the ONLY writer of
 * plan-change proposals. The adaptation detector produces changes and hands
 * them over; it never writes a plan version, and the effect that changes a
 * template runs inside E06's own accept transaction.
 *
 * `PathModule` is imported for `PlanVersionsService`, and unlike `WeeklyModule`
 * this epic DOES inject it: approving a workout program is the user's own
 * approval of an AI proposal, which is exactly the moment PRD §15 permits a plan
 * version to be written. The generator, which is where the model output lives,
 * does not have it.
 */
@Module({
  imports: [
    PrismaModule,
    AiModule,
    SafetyModule,
    CoachModule,
    CommitmentsModule,
    PathModule,
    UserProfileModule,
    NotificationsModule,
    StorageModule,
  ],
  controllers: [
    WorkoutProgramsController,
    ExercisesController,
    WorkoutSessionsController,
    WorkoutAdaptationController,
    WorkoutMediaController,
  ],
  providers: [
    ExerciseResolverService,
    WorkoutProgramGeneratorService,
    WorkoutProgramsService,
    WorkoutSessionsService,
    ProgressionExplainerService,
    WorkoutAdaptationService,
    WorkoutAdaptationTask,
    MediaCheckService,
    MediaSummaryService,
  ],
  exports: [
    WorkoutProgramsService,
    WorkoutSessionsService,
    ExerciseResolverService,
    WorkoutAdaptationService,
    MediaCheckService,
  ],
})
export class WorkoutsModule {}
