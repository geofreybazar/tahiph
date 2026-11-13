import { Module } from '@nestjs/common';
import { AuditModule } from './core/audit/audit.module.js';
import { AuthCoreModule } from './core/auth/auth-core.module.js';
import { CoreModule } from './core/core.module.js';
import { HttpModule } from './core/http/http.module.js';
import { QueueModule } from './core/queue/queue.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { PlatformModule } from './modules/platform/platform.module.js';
import { AppointmentsModule } from './modules/appointments/appointments.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { ClientsModule } from './modules/clients/clients.module.js';
import { MeasurementsModule } from './modules/measurements/measurements.module.js';
import { PrivacyModule } from './modules/privacy/privacy.module.js';
import { QuotationsModule } from './modules/quotations/quotations.module.js';
import { TenantsModule } from './modules/tenants/tenants.module.js';
import { UploadsModule } from './modules/uploads/uploads.module.js';

/** HTTP API composition root. Domain modules are added here from Phase 2. */
@Module({
  imports: [
    CoreModule,
    HttpModule,
    AuthCoreModule,
    AuditModule,
    QueueModule,
    HealthModule,
    AuthModule,
    TenantsModule,
    ClientsModule,
    MeasurementsModule,
    AppointmentsModule,
    CatalogModule,
    UploadsModule,
    QuotationsModule,
    PrivacyModule,
    PlatformModule,
  ],
})
export class AppModule {}
