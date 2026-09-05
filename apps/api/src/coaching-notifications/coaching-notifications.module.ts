import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { UserProfileModule } from '../user-profile/user-profile.module';
import { NotificationInteractionsService } from './interactions/notification-interactions.service';
import { NotificationPolicyController } from './policy/notification-policy.controller';
import { NotificationPolicyService } from './policy/notification-policy.service';

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
  imports: [PrismaModule, UserProfileModule],
  controllers: [NotificationPolicyController],
  providers: [NotificationPolicyService, NotificationInteractionsService],
  exports: [NotificationPolicyService, NotificationInteractionsService],
})
export class CoachingNotificationsModule {}
