import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
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
  imports: [PrismaModule],
  controllers: [CommitmentsController, EvidenceController, ReflectionsController],
  providers: [CommitmentsService, EvidenceService, ReflectionsService],
  exports: [CommitmentsService, EvidenceService, ReflectionsService],
})
export class CommitmentsModule {}
