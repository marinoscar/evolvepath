import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { BestSelfController } from './best-self/best-self.controller';
import { BestSelfService } from './best-self/best-self.service';
import { OutcomesController } from './outcomes/outcomes.controller';
import { OutcomesService } from './outcomes/outcomes.service';
import { DomainModesController } from './domain-modes/domain-modes.controller';
import { DomainModesService } from './domain-modes/domain-modes.service';

/**
 * The top of the PRD §9 hierarchy: who the user is trying to become, what they
 * are trying to achieve, and what posture each domain is in.
 *
 * `OutcomesService` is exported because plans (#42) hang off an outcome and
 * must resolve it through the same ownership-scoped lookup rather than
 * re-implementing one.
 */
@Module({
  imports: [PrismaModule],
  controllers: [BestSelfController, OutcomesController, DomainModesController],
  providers: [BestSelfService, OutcomesService, DomainModesService],
  exports: [OutcomesService],
})
export class PathModule {}
