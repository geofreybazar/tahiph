import { type INestApplication, VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Env } from '../config/env.js';

/**
 * HTTP application settings shared by main.ts and the test harness, so tests exercise the
 * same prefix, versioning, body limits and proxy trust as production.
 */
export function configureApp(app: INestApplication, env: Pick<Env, 'TRUST_PROXY'>): void {
  const express = app as NestExpressApplication;
  express.disable('x-powered-by');
  express.set('trust proxy', parseTrustProxy(env.TRUST_PROXY));
  express.useBodyParser('json', { limit: '1mb' });

  app.setGlobalPrefix('api');
  // Business routes: /api/v1/...  Health: /api/health/... (controllers declare `version: VERSION_NEUTRAL`).
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableShutdownHooks();
}

function parseTrustProxy(value: string): number | string[] {
  const hops = Number(value);
  return Number.isInteger(hops) ? hops : value.split(',').map((v) => v.trim());
}
