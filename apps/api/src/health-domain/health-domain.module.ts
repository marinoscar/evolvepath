import { Module } from '@nestjs/common';

import { CommitmentsModule } from '../commitments/commitments.module';
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
  imports: [PrismaModule, CommitmentsModule, UserProfileModule],
  controllers: [NutritionController, BodyWeightController],
  providers: [NutritionService, BodyWeightService],
  exports: [BodyWeightService],
})
export class HealthDomainModule {}
