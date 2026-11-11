import { Module } from '@nestjs/common';
import { AuditModule } from './core/audit/audit.module.js';
import { AuthCoreModule } from './core/auth/auth-core.module.js';
import { CoreModule } from './core/core.module.js';
import { HttpModule } from './core/http/http.module.js';
import { QueueModule } from './core/queue/queue.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { TenantsModule } from './modules/tenants/tenants.module.js';

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
  ],
})
export class AppModule {}
