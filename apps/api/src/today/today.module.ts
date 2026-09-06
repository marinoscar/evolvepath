import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';
import { CommitmentsModule } from '../commitments/commitments.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ProgressModule } from '../progress/progress.module';
import { UserProfileModule } from '../user-profile/user-profile.module';
import { CHECK_IN_READER } from './check-in-reader';
import { CheckInService } from './check-in/check-in.service';
import { DayReflectionService } from './reflection/day-reflection.service';
import { TodayInsightCache } from './insight/today-insight.cache';
import { TodayInsightService } from './insight/today-insight.service';
import { CandidateLoaderService } from './nba/candidate-loader.service';
import { TodayController } from './today.controller';
import { TodayService } from './today.service';

/**
 * The Today screen's API (issue #38, epic E05).
 *
 * `CHECK_IN_READER` resolves to `CheckInService` (#43). The token stays rather
 * than being inlined: the loader depends on the QUESTION ("has this user said
 * how today feels?"), not on `daily_check_ins`, and that separation is what let
 * #38 land and be tested before the table existed.
 */
@Module({
  imports: [PrismaModule, AiModule, CommitmentsModule, UserProfileModule, ProgressModule],
  controllers: [TodayController],
  providers: [
    TodayService,
    CandidateLoaderService,
    TodayInsightService,
    TodayInsightCache,
    CheckInService,
    DayReflectionService,
    { provide: CHECK_IN_READER, useExisting: CheckInService },
  ],
  exports: [TodayService, TodayInsightService, CheckInService, DayReflectionService],
})
export class TodayModule {}
