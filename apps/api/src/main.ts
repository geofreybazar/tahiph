import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { ENV } from './core/config/config.module.js';
import type { Env } from './core/config/env.js';
import { configureApp } from './core/http/configure-app.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  const env = app.get<Env>(ENV);
  configureApp(app, env);
  await app.listen(env.API_PORT, '0.0.0.0');
}

bootstrap().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
