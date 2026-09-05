import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';
import { CommitmentsModule } from '../commitments/commitments.module';
import { PrismaModule } from '../prisma/prisma.module';
import { UserProfileModule } from '../user-profile/user-profile.module';
import { CHECK_IN_READER, NullCheckInReader } from './check-in-reader';
import { TodayInsightService } from './insight/today-insight.service';
import { CandidateLoaderService } from './nba/candidate-loader.service';
import { TodayController } from './today.controller';
import { TodayService } from './today.service';

/**
 * The Today screen's API (issue #38, epic E05).
 *
 * `CHECK_IN_READER` is bound to the null implementation here. E05-03 (#43)
 * rebinds it to the service that reads `daily_check_ins`; until then "the user
 * has not said how today feels" is the correct answer for everybody, and every
 * consumer already handles it.
 */
@Module({
  imports: [PrismaModule, AiModule, CommitmentsModule, UserProfileModule],
  controllers: [TodayController],
  providers: [
    TodayService,
    CandidateLoaderService,
    TodayInsightService,
    { provide: CHECK_IN_READER, useClass: NullCheckInReader },
  ],
  exports: [TodayService, TodayInsightService],
})
export class TodayModule {}
