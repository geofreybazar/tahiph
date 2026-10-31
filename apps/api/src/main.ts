import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { parseEnv } from './common/config/env';

async function bootstrap() {
  const envFile = resolve(__dirname, '../../../.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const env = parseEnv(process.env);
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app, env);
  await app.listen(env.PORT);
}

void bootstrap();
