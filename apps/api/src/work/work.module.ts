import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';
import { PrismaModule } from '../prisma/prisma.module';
import { UserProfileModule } from '../user-profile/user-profile.module';
import { WorkSessionPlanningController } from './planning/work-session-planning.controller';
import { WorkSessionPlanningService } from './planning/work-session-planning.service';

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
  imports: [PrismaModule, AiModule, UserProfileModule],
  controllers: [WorkSessionPlanningController],
  providers: [WorkSessionPlanningService],
  exports: [WorkSessionPlanningService],
})
export class WorkModule {}
