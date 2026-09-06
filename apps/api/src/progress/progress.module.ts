import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';
import { CommitmentsModule } from '../commitments/commitments.module';
import { PrismaModule } from '../prisma/prisma.module';
import { UserProfileModule } from '../user-profile/user-profile.module';
import {
  INDEPENDENCE_READER,
  NullIndependenceReader,
} from './independence/independence-reader';
import { ActivityModule } from './comeback/activity.module';
import { ComebackController } from './comeback/comeback.controller';
import { ComebackService } from './comeback/comeback.service';
import { ComebackSweepTask } from './comeback/comeback-sweep.task';
import { RestartWordingService } from './comeback/restart-wording.service';
import { DomainWindowLoader } from './momentum/domain-window.loader';
import { MomentumService } from './momentum/momentum.service';
import { ProgressController } from './progress.controller';
import { ProgressService } from './progress.service';

/**
 * Momentum, the consistency run, recovery and the evidence timeline
 * (issue #98, epic E11).
 *
 * `TodayModule` imports this one, never the reverse. `CommitmentsModule` is
 * imported HERE, which is why `ActivityTrackerService` lives in its own tiny
 * `ActivityModule` instead: commitments, Today and the coach all report
 * activity, and putting the tracker here would close the cycle.
 */
@Module({
  imports: [
    PrismaModule,
    UserProfileModule,
    // The comeback loop completes its restart through the ordinary action
    // service (#112), so a return earns the same evidence any completion does.
    CommitmentsModule,
    // Wording only. The restart itself is chosen by a pure function.
    AiModule,
    ActivityModule,
  ],
  controllers: [ProgressController, ComebackController],
  providers: [
    ProgressService,
    MomentumService,
    DomainWindowLoader,
    ComebackService,
    ComebackSweepTask,
    RestartWordingService,
    { provide: INDEPENDENCE_READER, useClass: NullIndependenceReader },
  ],
  exports: [MomentumService, ProgressService, ComebackService, ComebackSweepTask],
})
export class ProgressModule {}
