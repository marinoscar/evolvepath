import { Module } from '@nestjs/common';

import { AiModule } from '../../ai/ai.module';
import { SafetyPolicyService } from './safety-policy.service';

/**
 * The AI safety layer (issue #82, epic E06).
 *
 * SEPARATE FROM `CoachModule` ON PURPOSE. Onboarding's planner, E09's workout
 * programmer and the media flow all have to run `evaluate` over free text, and
 * none of them should have to import the coach to do it — importing the coach
 * would also make the coach import them the moment it needs anything back.
 */
@Module({
  imports: [AiModule],
  providers: [SafetyPolicyService],
  exports: [SafetyPolicyService],
})
export class SafetyModule {}
