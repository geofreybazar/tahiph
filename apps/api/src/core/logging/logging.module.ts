import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule, ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { ensureRequestId } from '../context/request-id.js';

/** Structured JSON logging with secret/PII redaction (docs/API_STANDARDS.md §9). */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.token',
  '*.secret',
];

@Module({
  imports: [
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ENV],
      useFactory: (env: Env) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          genReqId: (req, res) => ensureRequestId(req, res),
          redact: { paths: REDACT_PATHS, censor: '[redacted]' },
          autoLogging: { ignore: (req) => req.url?.startsWith('/api/health') ?? false },
          customProps: () => ({ service: 'api' }),
          serializers: {
            // Log the route only — query strings may contain PII.
            req: (req: { id: string; method: string; url: string }) => ({
              id: req.id,
              method: req.method,
              url: req.url.split('?')[0],
            }),
          },
          ...(env.NODE_ENV === 'development'
            ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
            : {}),
        },
      }),
    }),
  ],
})
export class LoggingModule {}
