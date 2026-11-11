import { Module } from '@nestjs/common';
import { AuditModule } from '../../core/audit/audit.module.js';
import { MailerModule } from '../../core/email/email.module.js';
import { QueueModule } from '../../core/queue/queue.module.js';
import { TenantJobRunner } from '../../core/tenancy/tenant-job-runner.js';
import { TenantSettingsService } from '../tenants/tenant-settings.service.js';
import { RemindersProcessor } from './reminders.processor.js';
import { RemindersService } from './reminders.service.js';

/** Worker side of appointments: reminder sweeps. No controllers (SYSTEM_ARCHITECTURE.md §5). */
@Module({
  imports: [QueueModule, MailerModule, AuditModule],
  providers: [TenantJobRunner, TenantSettingsService, RemindersService, RemindersProcessor],
})
export class RemindersWorkerModule {}
