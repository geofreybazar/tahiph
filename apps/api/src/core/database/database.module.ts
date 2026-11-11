import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createPrismaClient, type DatabaseClient } from '@tahi/database';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';

/**
 * Base (unscoped) Prisma client. Phase 2 adds the tenant-scoped client and restricts this
 * token to allow-listed modules (docs/MULTI_TENANCY.md §4).
 */
export const UNSCOPED_PRISMA = Symbol('UNSCOPED_PRISMA');

@Global()
@Module({
  providers: [
    {
      provide: UNSCOPED_PRISMA,
      inject: [ENV],
      useFactory: (env: Env): DatabaseClient =>
        createPrismaClient({ connectionString: env.DATABASE_URL, max: env.DATABASE_POOL_MAX }),
    },
  ],
  exports: [UNSCOPED_PRISMA],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(UNSCOPED_PRISMA) private readonly prisma: DatabaseClient) {}

  async onApplicationShutdown(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
