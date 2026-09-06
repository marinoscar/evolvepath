import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../../prisma/prisma.service';
import { ComebackService, type SweepResult } from './comeback.service';

// =============================================================================
// The daily sweep (issue #112, epic E11)
// =============================================================================
//
// 04:00, after the token cleanup at 03:00 — a returning user's first request of
// the day should find their list already tidy rather than tidy it in front of
// them.
//
// PER-USER TRY/CATCH IS THE WHOLE DESIGN OF THIS CLASS. One user with a broken
// plan must not stop the sweep for everybody else, because the failure mode of
// stopping is the thing this epic exists to prevent: somebody opens the app
// after four days and sees a red list.
// =============================================================================

const PAGE_SIZE = 200;

@Injectable()
export class ComebackSweepTask {
  private readonly logger = new Logger(ComebackSweepTask.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly comeback: ComebackService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async handleCron(): Promise<void> {
    await this.runAll();
  }

  /** Exposed for ops and for the non-production job route. */
  async runForUser(userId: string, now: Date = new Date()): Promise<SweepResult> {
    return this.comeback.sweepUser(userId, now);
  }

  async runAll(now: Date = new Date()): Promise<{
    users: number;
    closed: number;
    offered: number;
    failed: number;
  }> {
    const started = Date.now();
    let cursor: string | undefined;
    const summary = { users: 0, closed: 0, offered: 0, failed: 0 };

    for (;;) {
      const page = await this.prisma.user.findMany({
        where: { isActive: true, commitments: { some: {} } },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      if (page.length === 0) break;

      for (const user of page) {
        summary.users += 1;
        try {
          const result = await this.comeback.sweepUser(user.id, now);
          summary.closed += result.closedCount;
          if (result.trigger) summary.offered += 1;
        } catch (error) {
          summary.failed += 1;
          this.logger.warn(
            `comeback sweep failed for ${user.id}: ${
              error instanceof Error ? error.message : 'unknown'
            }`,
          );
        }
      }

      cursor = page[page.length - 1].id;
      if (page.length < PAGE_SIZE) break;
    }

    this.logger.log(
      `comeback.sweep users=${summary.users} closed=${summary.closed} ` +
        `offered=${summary.offered} failed=${summary.failed} ms=${Date.now() - started}`,
    );

    return summary;
  }
}
