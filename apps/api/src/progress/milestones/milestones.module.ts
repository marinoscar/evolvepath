import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { MilestonesService } from './milestones.service';

/**
 * Milestones, in their own module (issue #115, epic E11).
 *
 * DELIBERATELY NOT PART OF `ProgressModule`, for the same reason
 * `ActivityModule` is not: `ProgressModule` imports `CommitmentsModule` (the
 * comeback completes a restart through it), and `CommitmentsModule` needs to
 * award a milestone the instant somebody starts something they had moved
 * twice. A module with one import and one provider breaks the cycle, and Nest
 * circular imports fail at BOOT rather than at compile time — which is a
 * production incident, not a red build.
 */
@Module({
  imports: [PrismaModule],
  providers: [MilestonesService],
  exports: [MilestonesService],
})
export class MilestonesModule {}
