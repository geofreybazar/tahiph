import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ClsModule } from 'nestjs-cls';
import { ZodValidationPipe } from 'nestjs-zod';
import { AuthModule } from './common/auth/auth.module';
import { ConfigModule } from './common/config/config.module';
import { ApiExceptionFilter } from './common/http/api-exception.filter';
import { ResponseEnvelopeInterceptor } from './common/http/response-envelope.interceptor';
import { PrismaModule } from './common/prisma/prisma.module';
import { ClientsModule } from './modules/clients/clients.module';
import { GarmentsModule } from './modules/garments/garments.module';
import { HealthModule } from './modules/health/health.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { MediaModule } from './modules/media/media.module';
import { MeasurementsModule } from './modules/measurements/measurements.module';
import { MeModule } from './modules/me/me.module';
import { MembersModule } from './modules/members/members.module';
import { PlatformModule } from './modules/platform/platform.module';
import { PublicSitesModule } from './modules/public-sites/public-sites.module';

@Module({
  imports: [
    ClsModule.forRoot({ global: true, middleware: { mount: true } }),
    ScheduleModule.forRoot(),
    ConfigModule,
    PrismaModule,
    AuthModule,
    HealthModule,
    MeModule,
    MediaModule,
    MembersModule,
    ClientsModule,
    ProjectsModule,
    MeasurementsModule,
    GarmentsModule,
    PaymentsModule,
    PlatformModule,
    PublicSitesModule,
  ],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
