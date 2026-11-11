import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createPrismaClient, type DatabaseClient } from '@tahi/database';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { TENANT_DB, tenantDatabaseProvider } from './tenant-database.provider.js';
import { UNSCOPED_PRISMA } from './tokens.js';

export { TENANT_DB } from './tenant-database.provider.js';
export { UNSCOPED_PRISMA } from './tokens.js';

@Global()
@Module({
  providers: [
    {
      provide: UNSCOPED_PRISMA,
      inject: [ENV],
      useFactory: (env: Env): DatabaseClient =>
        createPrismaClient({ connectionString: env.DATABASE_URL, max: env.DATABASE_POOL_MAX }),
    },
    tenantDatabaseProvider,
  ],
  exports: [UNSCOPED_PRISMA, TENANT_DB],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(UNSCOPED_PRISMA) private readonly prisma: DatabaseClient) {}

  async onApplicationShutdown(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
