import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { UserProfileModule } from '../user-profile/user-profile.module';
import {
  INDEPENDENCE_READER,
  NullIndependenceReader,
} from './independence/independence-reader';
import { DomainWindowLoader } from './momentum/domain-window.loader';
import { MomentumService } from './momentum/momentum.service';
import { ProgressController } from './progress.controller';
import { ProgressService } from './progress.service';

/**
 * Momentum, the consistency run, recovery and the evidence timeline
 * (issue #98, epic E11).
 *
 * IMPORTS ONLY PRISMA AND THE PROFILE. `TodayModule` imports this one, never
 * the reverse, and `CommitmentsModule` will import E11-03's milestones — a
 * dependency in the other direction here would close that loop and Nest would
 * refuse to boot.
 */
@Module({
  imports: [PrismaModule, UserProfileModule],
  controllers: [ProgressController],
  providers: [
    ProgressService,
    MomentumService,
    DomainWindowLoader,
    { provide: INDEPENDENCE_READER, useClass: NullIndependenceReader },
  ],
  exports: [MomentumService, ProgressService],
})
export class ProgressModule {}
