import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { trace } from '@opentelemetry/api';

import { PrismaService } from '../../prisma/prisma.service';
import { WorkoutAdaptationService } from './workout-adaptation.service';

const tracer = trace.getTracer('evolvepath-api');

/**
 * The daily sweep (issue #88, epic E09).
 *
 * ONE USER'S FAILURE DOES NOT STOP THE LOOP. A malformed program or a deleted
 * routine belongs to one person; letting it end the run would silently stop
 * adaptation for everybody else, and nothing would say so until somebody
 * noticed their plan had not adapted in a month.
 *
 * Users with an ACTIVE program only. Everyone else has nothing to adapt, and
 * scanning them would be a full-table walk for a guaranteed empty answer.
 */
@Injectable()
export class WorkoutAdaptationTask {
  private readonly logger = new Logger(WorkoutAdaptationTask.name);
  private readonly disabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly adaptation: WorkoutAdaptationService,
    config: ConfigService,
  ) {
    this.disabled = config.get<boolean>('workouts.adaptationCronDisabled') ?? false;
  }

  @Cron('0 4 * * *')
  async handleDailySweep(): Promise<void> {
    if (this.disabled) return;

    await this.run();
  }

  /** Exposed for tests and for the non-production job runner. */
  async run(now = new Date()): Promise<{ users: number; proposals: number }> {
    return tracer.startActiveSpan('workouts.adaptation.cron', async (span) => {
      try {
        const users = await this.prisma.workoutProgram.findMany({
          where: { status: 'ACTIVE' },
          select: { userId: true },
          distinct: ['userId'],
        });

        let proposals = 0;

        for (const { userId } of users) {
          try {
            const result = await this.adaptation.run(userId, now);
            proposals += result.created;
          } catch (error) {
            this.logger.error(`workout adaptation failed for user=${userId}: ${error}`);
          }
        }

        span.setAttribute('workout.users', users.length);
        span.setAttribute('workout.proposals', proposals);

        if (proposals > 0) {
          this.logger.log(
            `workout_adaptation.sweep users=${users.length} proposals=${proposals}`,
          );
        }

        return { users: users.length, proposals };
      } finally {
        span.end();
      }
    });
  }
}
