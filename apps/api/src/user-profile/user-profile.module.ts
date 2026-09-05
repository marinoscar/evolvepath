import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { UserProfileService } from './user-profile.service';

/**
 * Deliberately imports ONLY `PrismaModule`.
 *
 * `AuthModule` imports this one so `GET /auth/me` can report onboarding state;
 * anything else imported here would become a dependency of the auth graph and
 * risk a cycle.
 */
@Module({
  imports: [PrismaModule],
  providers: [UserProfileService],
  exports: [UserProfileService],
})
export class UserProfileModule {}
