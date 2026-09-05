import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { BestSelfController } from './best-self/best-self.controller';
import { BestSelfService } from './best-self/best-self.service';
import { OutcomesController } from './outcomes/outcomes.controller';
import { OutcomesService } from './outcomes/outcomes.service';
import { DomainModesController } from './domain-modes/domain-modes.controller';
import { DomainModesService } from './domain-modes/domain-modes.service';
import { OutcomePlansController, PlansController } from './plans/plans.controller';
import { PlansService } from './plans/plans.service';
import { PlanVersionsService } from './plans/plan-versions.service';
import { RoutinesController } from './routines/routines.controller';
import { RoutinesService } from './routines/routines.service';

/**
 * The PRD §9 hierarchy, as one module: who the user is trying to become, what
 * they are trying to achieve, the versioned strategy for achieving it, and the
 * repeatable behaviours that strategy is made of.
 *
 * One module rather than four, on purpose. Each layer resolves ownership
 * through the one below it — a routine is yours because its version is, which
 * is yours because its plan is, which is yours because its outcome is — and
 * splitting that chain across module boundaries would mean either exporting
 * every service anyway or re-implementing the ownership lookup per module.
 *
 * `PlanVersionsService` is exported because E06's mutation protocol creates
 * AI-authored drafts through `createDraft`'s `author` parameter, which no
 * route sets.
 */
@Module({
  imports: [PrismaModule],
  controllers: [
    BestSelfController,
    OutcomesController,
    DomainModesController,
    OutcomePlansController,
    PlansController,
    RoutinesController,
  ],
  providers: [
    BestSelfService,
    OutcomesService,
    DomainModesService,
    PlansService,
    PlanVersionsService,
    RoutinesService,
  ],
  exports: [OutcomesService, PlansService, PlanVersionsService, RoutinesService],
})
export class PathModule {}
