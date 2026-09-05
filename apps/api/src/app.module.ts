import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';

import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { SettingsModule } from './settings/settings.module';
import { HealthModule } from './health/health.module';
import { AllowlistModule } from './allowlist/allowlist.module';
import { DeviceAuthModule } from './device-auth/device-auth.module';
import { StorageModule } from './storage/storage.module';
import { PatModule } from './pat/pat.module';
import { CredentialsModule } from './credentials/credentials.module';
import { EmailModule } from './email/email.module';
import { CoachingNotificationsModule } from './coaching-notifications/coaching-notifications.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AiModule } from './ai/ai.module';
import { PathModule } from './path/path.module';
import { CommitmentsModule } from './commitments/commitments.module';
import { TodayModule } from './today/today.module';
import { WorkoutsModule } from './workouts/workouts.module';
import { CoachModule } from './coach/coach.module';
import { SafetyModule } from './coach/safety/safety.module';
import { FamilyModule } from './family/family.module';
import { WeeklyModule } from './weekly/weekly.module';
import { LoggerModule } from './common/logger/logger.module';
import { TestAuthModule } from './test-auth/test-auth.module';

import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';

import configuration from './config/configuration';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),

    // Scheduling (must be at root level for NestJS 11)
    ScheduleModule.forRoot(),

    // Event emitter for async events
    EventEmitterModule.forRoot(),

    // Database
    PrismaModule,

    // Logger
    LoggerModule,

    // Feature modules
    CommonModule,
    AuthModule,
    UsersModule,
    SettingsModule,
    HealthModule,
    AllowlistModule,
    DeviceAuthModule,
    StorageModule,
    PatModule,
    // Encrypted credential store (#115). Registered here so it is part of the
    // module graph; consumers still import CredentialsModule explicitly (it is
    // not @Global) so every user of a plaintext-returning service is visible.
    CredentialsModule,
    // Email transports (#122, epic #109) and, since #124, the admin email
    // settings endpoints. Registered here even though nothing sends mail
    // automatically yet: it makes a broken provider graph fail at boot rather
    // than surfacing as a DI error in #125. It costs nothing at runtime --
    // neither transport touches the network or reads a credential until its
    // first send.
    EmailModule,
    // Notifications (#121/#124/#125, epic #109): the event registry endpoint,
    // and since #125 the dispatcher, preference resolution and delivery
    // records. Registered here even though no real event is wired yet (#128)
    // so a broken channel graph — a duplicate channel registration, a missing
    // transport — fails at boot rather than at the first notification.
    NotificationsModule,
    CoachingNotificationsModule,
    // AI provider configuration and the gateway (epic #20). Registered here
    // from #22 onward, while it still provides nothing, so that each later
    // child of the epic is an addition to a graph that already boots rather
    // than a new module and a feature in one review.
    AiModule,
    // The EvolvePath product domain (epic #33). #39 registers the top of the
    // PRD §9 hierarchy — Best Self, Outcomes, Domain Modes — and #42/#47 add
    // plans, routines and commitments to the same module rather than new ones,
    // so the hierarchy stays one graph rather than three that must agree.
    PathModule,
    // The commitment lifecycle, evidence and reflections (#47, epic #33).
    // Separate from PathModule because the boundary is real: Path is the shape
    // of a life, edited deliberately; commitments are the record of days,
    // written at volume by the flows E05/E07/E09 add.
    CommitmentsModule,
    TodayModule,
    WorkoutsModule,

    // The Family domain (epic E08): members, rituals and their materialized
    // occurrences. Separate from PathModule because a ritual is a rule the
    // materializer reads, not a layer of the outcome hierarchy.
    FamilyModule,

    // The weekly loop (epic E10): planned-versus-actual aggregation, the
    // reviewer persona, the hourly sweep and next week's plan. Registered here
    // rather than under PathModule because a review is a ritual over the
    // domain, not another layer of it — and because the module deliberately
    // cannot reach `PlanVersionsService`.
    WeeklyModule,

    // The AI coach (epic E06). Registered here from its first child so a
    // broken provider graph fails at boot rather than at the first chat turn;
    // the context assembler it currently holds calls no model and costs
    // nothing until something asks it for a context.
    CoachModule,
    // The AI safety layer (E06-06, #82). Registered separately from
    // CoachModule because onboarding's planner, the workout programmer and the
    // media flow all evaluate free text and none of them should have to import
    // the coach to do it.
    SafetyModule,

    // Test modules (non-production only)
    ...(process.env.NODE_ENV !== 'production' ? [TestAuthModule] : []),
  ],
  providers: [
    // Global validation pipe (Zod)
    {
      provide: APP_PIPE,
      useClass: ZodValidationPipe,
    },
    // Global exception filter
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    // Global logging interceptor
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    // Global response transform interceptor
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(RequestIdMiddleware)
      .forRoutes('*');
  }
}
