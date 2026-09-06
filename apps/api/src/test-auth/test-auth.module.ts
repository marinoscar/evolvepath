import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { TestAuthController } from './test-auth.controller';
import { TestAuthService } from './test-auth.service';
import { AiModule } from '../ai/ai.module';
import { CoachingNotificationsModule } from '../coaching-notifications/coaching-notifications.module';
import { ProgressModule } from '../progress/progress.module';
import { UserProfileModule } from '../user-profile/user-profile.module';

@Module({
  imports: [
    // JWT configuration (reuse from AuthModule)
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret'),
        signOptions: {
          expiresIn: `${config.get<number>('jwt.accessTtlMinutes', 15)}m`,
        },
      }),
    }),
    ConfigModule,
    PrismaModule,

    // `withAiKey` seeds an OpenAI key so an e2e login lands on the app rather
    // than on the setup gate (#25/#29).
    AiModule,

    // `run-job` drives the real coaching engine, not a stand-in for it (#59).
    CoachingNotificationsModule,

    // `run-job comeback` drives the real sweep, not a stand-in for it (#112).
    ProgressModule,

    // `withOnboarding` marks the profile done so an e2e login lands on the app
    // rather than on the wizard (#107, epic E04).
    UserProfileModule,
  ],
  controllers: [TestAuthController],
  providers: [TestAuthService],
  exports: [TestAuthService],
})
export class TestAuthModule {}
