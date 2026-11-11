import { Global, Module } from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ensureRequestId } from './request-id.js';

/**
 * Request-scoped context via AsyncLocalStorage (docs/MULTI_TENANCY.md §3).
 * Phase 1 stores the request id; Phase 2 adds realm, tenantId, userId and permissions.
 */
@Global()
@Module({
  imports: [
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        generateId: true,
        idGenerator: (req: IncomingMessage) => ensureRequestId(req),
        setup: (_cls, req: IncomingMessage, res: ServerResponse) => {
          ensureRequestId(req, res);
        },
      },
    }),
  ],
})
export class ContextModule {}
