import { CROSS_TENANT_MODELS, SELF_SCOPED_MODEL, TENANT_MODELS } from './tenant-registry';

type Args = Record<string, unknown>;
/** model name -> relation field name -> related model name */
export type RelationMap = ReadonlyMap<string, ReadonlyMap<string, string>>;

export class TenantScopeViolation extends Error {
  override readonly name = 'TenantScopeViolation';
}

const isObject = (value: unknown): value is Args =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);

const READS_AND_FILTERED_WRITES = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'delete',
  'deleteMany',
]);
const UPDATES = new Set(['update', 'updateMany', 'updateManyAndReturn']);
const SELF_SCOPED_READS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
]);
const SELF_SCOPED_UPDATES = new Set(['update', 'updateMany']);
const RELATION_FILTERS = ['some', 'none', 'every', 'is', 'isNot'];

function withTenantWhere(where: unknown, tenantId: string): Args {
  const existing = isObject(where) ? where : {};
  if ('tenantId' in existing && existing.tenantId !== tenantId) {
    throw new TenantScopeViolation('A query named a different tenant than the current one');
  }
  return { ...existing, tenantId };
}

function stamped(row: unknown, tenantId: string): Args {
  const data = isObject(row) ? row : {};
  if ('tenantId' in data && data.tenantId !== tenantId) {
    throw new TenantScopeViolation('A write named a different tenant than the current one');
  }
  return { ...data, tenantId };
}

function assertNoTenantChange(data: unknown): void {
  if (isObject(data) && 'tenantId' in data) {
    throw new TenantScopeViolation('tenantId cannot be changed by an update');
  }
}

function assertNoRelationWrites(model: string, data: unknown, relations: RelationMap): void {
  const rows = Array.isArray(data) ? data : [data];
  for (const row of rows) {
    if (!isObject(row)) continue;
    for (const field of Object.keys(row)) {
      if (relations.get(model)?.has(field)) {
        throw new TenantScopeViolation(
          `Nested write on ${model}.${field}: write each model in its own call, in a transaction`,
        );
      }
    }
  }
}

function follow(model: string, field: string, relations: RelationMap): string | undefined {
  const target = relations.get(model)?.get(field);
  if (target && CROSS_TENANT_MODELS.has(model) && !CROSS_TENANT_MODELS.has(target)) {
    throw new TenantScopeViolation(`${model}.${field} reaches other tenants' data`);
  }
  return target;
}

function checkWhere(model: string, where: unknown, relations: RelationMap): void {
  if (Array.isArray(where)) return where.forEach((item) => checkWhere(model, item, relations));
  if (!isObject(where)) return;
  for (const [key, value] of Object.entries(where)) {
    if (key === 'AND' || key === 'OR' || key === 'NOT') {
      checkWhere(model, value, relations);
      continue;
    }
    const target = follow(model, key, relations);
    if (!target || !isObject(value)) continue;
    const filters = RELATION_FILTERS.filter((name) => name in value);
    if (filters.length === 0) checkWhere(target, value, relations);
    filters.forEach((name) => checkWhere(target, value[name], relations));
  }
}

function checkOrderBy(model: string, orderBy: unknown, relations: RelationMap): void {
  if (Array.isArray(orderBy))
    return orderBy.forEach((item) => checkOrderBy(model, item, relations));
  if (!isObject(orderBy)) return;
  for (const [key, value] of Object.entries(orderBy)) {
    const target = follow(model, key, relations);
    if (target) checkOrderBy(target, value, relations);
  }
}

function checkSelection(model: string, selection: unknown, relations: RelationMap): void {
  if (!isObject(selection)) return;
  for (const [key, value] of Object.entries(selection)) {
    if (key === '_count') {
      const counted = isObject(value) ? value.select : undefined;
      checkSelection(model, counted, relations);
      continue;
    }
    const target = follow(model, key, relations);
    if (target) checkReads(target, value, relations);
  }
}

function checkReads(model: string, args: unknown, relations: RelationMap): void {
  if (!isObject(args)) return;
  checkSelection(model, args.include, relations);
  checkSelection(model, args.select, relations);
  checkWhere(model, args.where, relations);
  checkOrderBy(model, args.orderBy, relations);
}

function scopeTenantOwned(operation: string, args: Args, tenantId: string, model: string): Args {
  if (READS_AND_FILTERED_WRITES.has(operation)) {
    return { ...args, where: withTenantWhere(args.where, tenantId) };
  }
  if (UPDATES.has(operation)) {
    assertNoTenantChange(args.data);
    return { ...args, where: withTenantWhere(args.where, tenantId) };
  }
  if (operation === 'create') return { ...args, data: stamped(args.data, tenantId) };
  if (operation === 'createMany' || operation === 'createManyAndReturn') {
    const rows = Array.isArray(args.data) ? args.data : [args.data];
    return { ...args, data: rows.map((row) => stamped(row, tenantId)) };
  }
  if (operation === 'upsert') {
    assertNoTenantChange(args.update);
    return {
      ...args,
      where: withTenantWhere(args.where, tenantId),
      create: stamped(args.create, tenantId),
    };
  }
  throw new TenantScopeViolation(`${model}.${operation} isn't allowed on the scoped client`);
}

function scopeSelf(operation: string, args: Args, tenantId: string): Args {
  const where = { ...(isObject(args.where) ? args.where : {}), id: tenantId };
  if (SELF_SCOPED_READS.has(operation)) return { ...args, where };
  if (SELF_SCOPED_UPDATES.has(operation)) {
    if (isObject(args.data) && 'id' in args.data) {
      throw new TenantScopeViolation('A tenant id cannot be changed');
    }
    return { ...args, where };
  }
  throw new TenantScopeViolation(
    `${SELF_SCOPED_MODEL}.${operation} isn't allowed on the scoped client`,
  );
}

/**
 * Returns the args to run, or throws. Everything not explicitly understood is rejected, so a new
 * model or a new Prisma operation fails closed. Relation filters and includes aren't filtered:
 * composite foreign keys keep them inside one tenant, and User-to-tenant traversal is rejected.
 */
export function scopeOperation(
  model: string | undefined,
  operation: string,
  rawArgs: unknown,
  tenantId: string | undefined,
  relations: RelationMap,
): Args {
  if (!model) throw new TenantScopeViolation(`${operation} isn't allowed on the scoped client`);
  if (!tenantId) throw new TenantScopeViolation(`${model}.${operation} ran with no tenant context`);

  const args = isObject(rawArgs) ? rawArgs : {};
  const owned = TENANT_MODELS.has(model);
  if (!owned && model !== SELF_SCOPED_MODEL) {
    throw new TenantScopeViolation(`${model} isn't available on the scoped client`);
  }

  checkReads(model, args, relations);
  assertNoRelationWrites(model, args.data, relations);
  assertNoRelationWrites(model, args.create, relations);
  assertNoRelationWrites(model, args.update, relations);

  return owned
    ? scopeTenantOwned(operation, args, tenantId, model)
    : scopeSelf(operation, args, tenantId);
}
