import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';
import { PrismaModule } from '../prisma/prisma.module';
import { UserProfileModule } from '../user-profile/user-profile.module';
import { OnboardingController } from './onboarding.controller';
import { OnboardingProposalService } from './onboarding-proposal.service';
import { OnboardingService } from './onboarding.service';

/**
 * The first gate a signed-in user passes after the BYOK key setup (epic E04).
 *
 * It imports `AiModule` for the planner and writes into E02's tables directly
 * through Prisma rather than importing `PathModule`: the whole Path is built in
 * ONE transaction, and a service that opens its own `$transaction` cannot be
 * nested inside it.
 */
@Module({
  imports: [PrismaModule, UserProfileModule, AiModule],
  controllers: [OnboardingController],
  providers: [OnboardingService, OnboardingProposalService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
