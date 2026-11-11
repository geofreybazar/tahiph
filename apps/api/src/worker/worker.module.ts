import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module.js';
import { EmailWorkerModule } from '../core/email/email.module.js';
import { QueueModule } from '../core/queue/queue.module.js';
import { RemindersWorkerModule } from '../modules/appointments/reminders.module.js';
import { MaintenanceProcessor } from './maintenance.processor.js';

/** Worker composition root: domain modules without controllers + queue processors. */
@Module({
  imports: [CoreModule, QueueModule, EmailWorkerModule, RemindersWorkerModule],
  providers: [MaintenanceProcessor],
})
export class WorkerModule {}
