import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { UserProfileModule } from '../../user-profile/user-profile.module';
import { ActivityTrackerService } from './activity-tracker.service';

/**
 * "When did this user last do something?" — and nothing else (issue #112).
 *
 * DELIBERATELY NOT PART OF `ProgressModule`. Commitments, Today and the coach
 * all report activity, and `ProgressModule` imports `CommitmentsModule` to
 * complete a restart — so putting the tracker in `ProgressModule` would close a
 * cycle and Nest would refuse to boot. A module with two imports and one
 * provider is the cheapest possible way to break it, and the seam is honest:
 * recording activity is not a Progress concern, it is a fact every domain
 * produces.
 */
@Module({
  imports: [PrismaModule, UserProfileModule],
  providers: [ActivityTrackerService],
  exports: [ActivityTrackerService],
})
export class ActivityModule {}
