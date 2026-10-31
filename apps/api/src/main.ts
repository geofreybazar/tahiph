import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { Env } from './common/config/env';
import { ENV } from './common/config/env.token';

async function bootstrap() {
  const envFile = resolve(__dirname, '../../../.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const env = app.get<Env>(ENV);
  configureApp(app, env);
  app.enableShutdownHooks();
  await app.listen(env.PORT);
}

void bootstrap();
