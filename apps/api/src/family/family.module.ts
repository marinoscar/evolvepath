import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';

/**
 * The Family domain (epic E08): members, rituals, and the machinery that turns
 * a ritual into real commitments.
 *
 * Empty of providers at this point on purpose — issue #37 lands the schema, the
 * boundary schemas and the mapper; issue #41 adds the controllers, the
 * recurrence engine and the materializer, and issue #45 the summary. The module
 * is registered in `AppModule` from the start so that a broken relation graph
 * fails at boot in `family-schema.integration.spec.ts` rather than the first
 * time somebody writes a controller.
 */
@Module({
  imports: [PrismaModule],
})
export class FamilyModule {}
