import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module.js';
import { QueueModule } from '../core/queue/queue.module.js';
import { MaintenanceProcessor } from './maintenance.processor.js';

/** Worker composition root: domain modules without controllers + queue processors. */
@Module({
  imports: [CoreModule, QueueModule],
  providers: [MaintenanceProcessor],
})
export class WorkerModule {}
