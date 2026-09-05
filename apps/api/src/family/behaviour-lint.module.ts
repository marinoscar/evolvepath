import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';
import { BehaviourLintService } from './behaviour-lint.service';

/**
 * One provider, in its own module, to break a cycle rather than to organise
 * anything.
 *
 * `FamilyModule` imports `CommitmentsModule` (it cancels occurrences through
 * the transition matrix, never with a raw `updateMany`). `CommitmentsService`
 * needs the behaviour lint, because `POST /commitments` with `domain: 'FAMILY'`
 * — quick add — must be held to the same PRD §32 rule as a ritual. Exporting
 * the lint from `FamilyModule` would make those two modules import each other.
 *
 * This module imports only `AiModule`, which imports neither of them.
 */
@Module({
  imports: [AiModule],
  providers: [BehaviourLintService],
  exports: [BehaviourLintService],
})
export class BehaviourLintModule {}
