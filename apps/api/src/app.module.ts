import { Module } from '@nestjs/common';
import { CoreModule } from './core/core.module.js';
import { HttpModule } from './core/http/http.module.js';
import { QueueModule } from './core/queue/queue.module.js';
import { HealthModule } from './modules/health/health.module.js';

/** HTTP API composition root. Domain modules are added here from Phase 2. */
@Module({
  imports: [CoreModule, HttpModule, QueueModule, HealthModule],
})
export class AppModule {}
