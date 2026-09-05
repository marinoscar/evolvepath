import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { RitualMaterializerService } from '../ritual-materializer.service';

/**
 * The nightly sweep that keeps every active ritual seven days ahead.
 *
 * 01:00 rather than 03:00 (where token cleanup runs) for one reason: this job
 * writes rows a user might see the same morning, and the server's 01:00 is
 * already late evening in the Americas and mid-morning in Asia. Spreading the
 * two jobs also keeps them from contending for the same connection pool.
 *
 * `ScheduleModule.forRoot()` is registered once in `app.module.ts`; this class
 * is a provider of `FamilyModule` and nothing else.
 */
@Injectable()
export class RitualMaterializeTask {
  private readonly logger = new Logger(RitualMaterializeTask.name);

  constructor(private readonly materializer: RitualMaterializerService) {}

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async handleCron(): Promise<void> {
    const { rituals, created } = await this.materializer.materializeAllDue();

    this.logger.log(`ritual.materialize rituals=${rituals} created=${created}`);
  }
}
