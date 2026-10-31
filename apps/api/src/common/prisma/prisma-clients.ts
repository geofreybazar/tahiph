import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { RelationMap, scopeOperation } from './tenant-scope';

export function createBasePrisma(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

interface RuntimeDataModel {
  models: Record<string, { fields: { name: string; kind: string; type: string }[] }>;
}

export function readRelations(client: PrismaClient): RelationMap {
  // shortcut: private Prisma field, because the prisma-client generator has no Prisma.dmmf.
  // Safe while Prisma is pinned exactly; this throws at startup if an upgrade removes it.
  const model = (client as unknown as { _runtimeDataModel?: RuntimeDataModel })._runtimeDataModel;
  if (!model) throw new Error('Prisma runtime data model is unavailable');

  return new Map(
    Object.entries(model.models).map(([name, { fields }]) => [
      name,
      new Map(fields.filter((f) => f.kind === 'object').map((f) => [f.name, f.type])),
    ]),
  );
}

export function createScopedPrisma(base: PrismaClient, getTenantId: () => string | undefined) {
  const relations = readRelations(base);
  return base.$extends({
    query: {
      $allOperations({ model, operation, args, query }) {
        return query(scopeOperation(model, operation, args, getTenantId(), relations) as never);
      },
    },
  });
}

export type ScopedPrisma = ReturnType<typeof createScopedPrisma>;
