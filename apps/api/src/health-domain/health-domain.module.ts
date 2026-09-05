import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';
import { CommitmentsModule } from '../commitments/commitments.module';
import { WorkoutsModule } from '../workouts/workouts.module';
import { PrismaModule } from '../prisma/prisma.module';
import { UserProfileModule } from '../user-profile/user-profile.module';
import { NutritionController } from './nutrition/nutrition.controller';
import { NutritionService } from './nutrition/nutrition.service';
import { BodyWeightController } from './weight/body-weight.controller';
import { BodyWeightService } from './weight/body-weight.service';

/**
 * Nutrition behaviours and body weight (epic E09).
 *
 * NOT `apps/api/src/health/` — that is the liveness and readiness probe, and
 * its routes are `@Public()`. The two coexist under the `/api/health` prefix
 * because NestJS resolves by controller, not by prefix, and nothing in
 * `auth/` exempts a path.
 */
@Module({
  // `WorkoutsModule` for `MediaCheckService`: the meal check is the same
  // `media_analyst` call as the form and equipment checks, and a second copy of
  // the gateway/guard/summary skeleton here would be a second place for the
  // no-accounting guard to be forgotten.
  // `AiModule` for the shared `TestThrottle` — the meal check spends the user's
  // own key on images, and it goes through the same per-user window every other
  // user-triggered AI call does.
  imports: [PrismaModule, CommitmentsModule, UserProfileModule, WorkoutsModule, AiModule],
  controllers: [NutritionController, BodyWeightController],
  providers: [NutritionService, BodyWeightService],
  exports: [BodyWeightService],
})
export class HealthDomainModule {}
