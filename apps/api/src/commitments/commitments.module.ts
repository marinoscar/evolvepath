import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';
import { PrismaModule } from '../prisma/prisma.module';
import { UserProfileModule } from '../user-profile/user-profile.module';
import { CommitmentActionsController } from './actions/commitment-actions.controller';
import { CommitmentActionsService } from './actions/commitment-actions.service';
import { DecompositionService } from './decomposition/decomposition.service';
import { CommitmentsController } from './commitments.controller';
import { CommitmentsService } from './commitments.service';
import { EvidenceController } from './evidence/evidence.controller';
import { EvidenceService } from './evidence/evidence.service';
import { ReflectionsController } from './reflections/reflections.controller';
import { ReflectionsService } from './reflections/reflections.service';

/**
 * The deterministic state machine every later epic mutates: what the user
 * intends to do, what actually happened, and what they made of it.
 *
 * Separate from `PathModule` because the boundary is real rather than
 * alphabetical. Path is the SHAPE of a life — slow-moving, edited
 * deliberately. Commitments are the RECORD of days — high-volume, written by
 * the Start flow (E05), focus sessions (E07) and the workout runner (E09),
 * none of which have any business reaching a plan version's editor.
 *
 * `EvidenceService` is exported for exactly those flows: they call
 * `createFromFlow` to write TIMER / WORKOUT_LOG / APP_FLOW rows, which no
 * route can produce.
 */
@Module({
  // `AiModule` is here for one method: "break this down" (#40). It is imported
  // rather than injected globally so that the coupling is visible — this module
  // does exactly one thing that can fail because a provider is down, and PRD
  // §120 requires every other route in it to keep working when that happens.
  imports: [PrismaModule, AiModule, UserProfileModule],
  controllers: [
    CommitmentsController,
    CommitmentActionsController,
    EvidenceController,
    ReflectionsController,
  ],
  providers: [
    CommitmentsService,
    CommitmentActionsService,
    DecompositionService,
    EvidenceService,
    ReflectionsService,
  ],
  exports: [CommitmentsService, CommitmentActionsService, EvidenceService, ReflectionsService],
})
export class CommitmentsModule {}
