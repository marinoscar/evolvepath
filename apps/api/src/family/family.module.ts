import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';
import { CommitmentsModule } from '../commitments/commitments.module';
import { PathModule } from '../path/path.module';
import { PrismaModule } from '../prisma/prisma.module';
import { BehaviourLintModule } from './behaviour-lint.module';
import { FamilyMembersController } from './family-members.controller';
import { FamilyMembersService } from './family-members.service';
import { RitualMaterializerService } from './ritual-materializer.service';
import { RitualsController } from './rituals.controller';
import { RitualsService } from './rituals.service';
import { RitualMaterializeTask } from './tasks/ritual-materialize.task';

/**
 * The Family domain (epic E08): members, rituals, and the machinery that turns
 * a ritual into real commitments.
 *
 * `CommitmentsModule` is imported for ONE thing — cancelling a future
 * occurrence through the transition matrix rather than with a raw `updateMany`
 * to `CANCELLED`. That matters: the matrix is what guarantees a row the user
 * has already started, moved or finished is never rewritten by an edit to the
 * rule that produced it.
 *
 * `PathModule` is imported for `RoutinesService`, which is how a ritual linked
 * to an outcome shows up on the Path.
 *
 * The behaviour lint lives in its own module rather than here, because
 * `CommitmentsService` needs it too (quick-add FAMILY commitments are held to
 * the same PRD §32 rule) and this module already imports that one. See
 * `behaviour-lint.module.ts`.
 */
@Module({
  imports: [PrismaModule, AiModule, BehaviourLintModule, CommitmentsModule, PathModule],
  controllers: [FamilyMembersController, RitualsController],
  providers: [
    FamilyMembersService,
    RitualsService,
    RitualMaterializerService,
    RitualMaterializeTask,
  ],
  exports: [RitualMaterializerService],
})
export class FamilyModule {}
