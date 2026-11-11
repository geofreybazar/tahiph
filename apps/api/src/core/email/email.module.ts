import { Module } from '@nestjs/common';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { EmailProcessor } from './email.processor.js';
import { EMAIL_TRANSPORT, MAILER } from './email.types.js';
import { QueueMailer } from './queue-mailer.js';
import { createTransport } from './transports.js';

/** API side: MAILER enqueues. Requires QueueModule. */
@Module({
  providers: [{ provide: MAILER, useClass: QueueMailer }],
  exports: [MAILER],
})
export class MailerModule {}

/** Worker side: processes the email queue. */
@Module({
  providers: [
    { provide: EMAIL_TRANSPORT, inject: [ENV], useFactory: (env: Env) => createTransport(env) },
    EmailProcessor,
  ],
})
export class EmailWorkerModule {}
