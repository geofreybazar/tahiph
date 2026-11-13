import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module.js';
import { EmailWorkerModule } from '../core/email/email.module.js';
import { QueueModule } from '../core/queue/queue.module.js';
import { RemindersWorkerModule } from '../modules/appointments/reminders.module.js';
import { QuotationsWorkerModule } from '../modules/quotations/quotations.module.js';
import { UploadsWorkerModule } from '../modules/uploads/uploads.module.js';
import { MaintenanceProcessor } from './maintenance.processor.js';

/** Worker composition root: domain modules without controllers + queue processors. */
@Module({
  imports: [
    CoreModule,
    QueueModule,
    EmailWorkerModule,
    RemindersWorkerModule,
    UploadsWorkerModule,
    QuotationsWorkerModule,
  ],
  providers: [MaintenanceProcessor],
})
export class WorkerModule {}
