import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';
import { CommitmentsModule } from '../commitments/commitments.module';
import { SafetyModule } from '../coach/safety/safety.module';
import { PrismaModule } from '../prisma/prisma.module';
import { UserProfileModule } from '../user-profile/user-profile.module';
import { WorkSessionPlanningController } from './planning/work-session-planning.controller';
import { WorkSessionPlanningService } from './planning/work-session-planning.service';
import { FocusSessionController } from './focus/focus-session.controller';
import { FocusSessionService } from './focus/focus-session.service';
import { AvoidanceService } from './avoidance/avoidance.service';
import { AvoidanceSignalsService } from './avoidance/avoidance-signals.service';
import { FrictionController } from './avoidance/friction.controller';
import { FrictionService } from './avoidance/friction.service';
import { WorkSummaryController } from './summary/work-summary.controller';
import { WorkSummaryService } from './summary/work-summary.service';

/**
 * The Work domain: turning an outcome into sessions somebody actually starts
 * (epic E07).
 *
 * Its own module rather than a folder inside `PathModule` for the reason
 * `CommitmentsModule` is separate from it: Path is the SHAPE of a life, edited
 * deliberately and rarely. Work is the RECORD of trying to execute one — high
 * volume, written by a timer and a friction dialog, and the one part of the
 * product whose failure mode is a person quietly not starting.
 */
@Module({
  // `CommitmentsModule` for one reason: focus sessions call E05-02's action
  // service rather than re-implementing the status machine or the timer. That
  // import is the coupling, and it points one way — nothing in Commitments
  // knows this module exists.
  // `SafetyModule` is here for one call: the user's free text about why
  // something is hard goes through E06-06 BEFORE the coach sees it. PRD §88 —
  // and the redirect path has to work when the provider is down, which is why
  // it is a regex first and a persona second.
  imports: [PrismaModule, AiModule, UserProfileModule, CommitmentsModule, SafetyModule],
  controllers: [
    WorkSessionPlanningController,
    FocusSessionController,
    FrictionController,
    WorkSummaryController,
  ],
  providers: [
    WorkSessionPlanningService,
    FocusSessionService,
    AvoidanceSignalsService,
    AvoidanceService,
    FrictionService,
    WorkSummaryService,
  ],
  // `AvoidanceService` is exported for two readers: E05-01's Today service,
  // which puts the assessment on every WORK card, and E07-05's weekly summary,
  // which reports the ladder level of everything repeatedly postponed.
  // `WorkSummaryService` is exported for E10-02's weekly reviewer, which reads
  // these counts as its deterministic input.
  exports: [
    WorkSessionPlanningService,
    FocusSessionService,
    AvoidanceService,
    WorkSummaryService,
  ],
})
export class WorkModule {}
