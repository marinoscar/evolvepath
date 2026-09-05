import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { CommonModule } from '../common/common.module';
import { AllowlistModule } from '../allowlist/allowlist.module';
import { PatModule } from '../pat/pat.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AiModule } from '../ai/ai.module';
import { UserProfileModule } from '../user-profile/user-profile.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GoogleStrategy } from './strategies/google.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { TokenCleanupTask } from './tasks/token-cleanup.task';

@Module({
  imports: [
    // Passport configuration
    PassportModule.register({ defaultStrategy: 'jwt' }),

    // JWT configuration
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret'),
        signOptions: {
          expiresIn: `${config.get<number>('jwt.accessTtlMinutes', 15)}m`,
        },
      }),
    }),

    // Common module for AdminBootstrapService
    CommonModule,

    // Allowlist module for email allowlist checks
    AllowlistModule,

    // PAT module for Personal Access Token validation in JwtAuthGuard
    PatModule,

    // Notifications: `handleGoogleLogin` raises `user.welcome` the first time
    // a user record is created through OAuth (#128).
    NotificationsModule,

    // `getCurrentUser` reports whether the caller has an OpenAI key (#25), so
    // the web app can gate its shell without a second request on boot.
    //
    // NO CYCLE: `AiModule` imports only Prisma, Credentials, Storage and
    // Config — never `AuthModule`. Its controllers use the `@Auth()` decorator,
    // which is metadata, and the guards it resolves are registered globally.
    AiModule,

    // Same shape as `AiModule` above and for the same reason: `/auth/me`
    // reports onboarding state, and `UserProfileModule` imports only Prisma, so
    // there is no path back into `AuthModule`.
    UserProfileModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, GoogleStrategy, JwtStrategy, TokenCleanupTask],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
