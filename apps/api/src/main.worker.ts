import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './worker/worker.module.js';

/** Background worker entrypoint: no HTTP server; runs BullMQ processors (ADR-009). */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  await app.init();
}

bootstrap().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
