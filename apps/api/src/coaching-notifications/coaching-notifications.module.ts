import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';
import { EmailModule } from '../email/email.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { UserProfileModule } from '../user-profile/user-profile.module';
import { CandidateScannerService } from './candidates/candidate-scanner.service';
import { CoachingNotificationsService } from './coaching-notifications.service';
import { NotificationCopywriterService } from './copy/notification-copywriter.service';
import { NotificationInteractionsController } from './interactions/notification-interactions.controller';
import { NotificationInteractionsService } from './interactions/notification-interactions.service';
import { NotificationPolicyController } from './policy/notification-policy.controller';
import { NotificationPolicyService } from './policy/notification-policy.service';
import { CoachingNotificationTask } from './tasks/coaching-notification.task';

/**
 * The coaching side of notifications (epic E12).
 *
 * Deliberately NOT folded into `NotificationsModule`. That module is the
 * transport — "given a decision to tell someone something, carry it" — and epic
 * #109 built it with no product knowledge at all. This module is the decision:
 * it reads commitments, domain modes and history to answer "is now a useful
 * moment to interrupt". Merging them would put product reasoning inside the
 * dispatcher, which is the thing that has to keep working when the product
 * changes.
 */
@Module({
  imports: [
    PrismaModule,
    UserProfileModule,
    // The transport, so the engine can hand a decision to it (#59). The
    // dependency points this way and only this way: the dispatcher knows
    // nothing about coaching.
    NotificationsModule,
    AiModule,
    EmailModule,
  ],
  controllers: [NotificationPolicyController, NotificationInteractionsController],
  providers: [
    NotificationPolicyService,
    NotificationInteractionsService,
    CandidateScannerService,
    NotificationCopywriterService,
    CoachingNotificationsService,
    CoachingNotificationTask,
  ],
  exports: [
    NotificationPolicyService,
    NotificationInteractionsService,
    CoachingNotificationsService,
  ],
})
export class CoachingNotificationsModule {}
