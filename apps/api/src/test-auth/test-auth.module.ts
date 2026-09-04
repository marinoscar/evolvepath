import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { TestAuthController } from './test-auth.controller';
import { TestAuthService } from './test-auth.service';
import { AiModule } from '../ai/ai.module';

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
  ],
  controllers: [TestAuthController],
  providers: [TestAuthService],
  exports: [TestAuthService],
})
export class TestAuthModule {}
