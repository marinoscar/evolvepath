import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';
import { CommitmentsModule } from '../commitments/commitments.module';
import { PrismaModule } from '../prisma/prisma.module';
import { UserProfileModule } from '../user-profile/user-profile.module';
import { WorkSessionPlanningController } from './planning/work-session-planning.controller';
import { WorkSessionPlanningService } from './planning/work-session-planning.service';
import { FocusSessionController } from './focus/focus-session.controller';
import { FocusSessionService } from './focus/focus-session.service';

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
  imports: [PrismaModule, AiModule, UserProfileModule, CommitmentsModule],
  controllers: [WorkSessionPlanningController, FocusSessionController],
  providers: [WorkSessionPlanningService, FocusSessionService],
  exports: [WorkSessionPlanningService, FocusSessionService],
})
export class WorkModule {}
