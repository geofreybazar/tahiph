import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export interface CreatePrismaClientOptions {
  connectionString: string;
  /** Max pool size for this process (api and worker are sized separately). */
  max?: number;
}

/**
 * Creates the base (unscoped) Prisma client using the node-postgres driver adapter.
 * Tenant-scoped access is layered on top of this client in Phase 2 (docs/MULTI_TENANCY.md §4).
 */
export function createPrismaClient({ connectionString, max = 10 }: CreatePrismaClientOptions) {
  const adapter = new PrismaPg({ connectionString, max });
  return new PrismaClient({ adapter });
}

export type DatabaseClient = ReturnType<typeof createPrismaClient>;
