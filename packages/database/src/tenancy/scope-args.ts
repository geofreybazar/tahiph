import { TenantScopeViolationError } from './errors.js';

type Args = Record<string, unknown>;

const WHERE_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
  'aggregate',
  'count',
  'groupBy',
]);
const CREATE_OPERATIONS = new Set(['create', 'createMany', 'createManyAndReturn']);
const UPDATE_DATA_OPERATIONS = new Set(['update', 'updateMany', 'updateManyAndReturn']);

function isRecord(v: unknown): v is Args {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function assertSameTenant(value: unknown, tenantId: string, where: string): void {
  if (value !== undefined && value !== tenantId) {
    throw new TenantScopeViolationError(
      `${where}: tenantId must be omitted or equal the context tenant`,
    );
  }
}

function scopeWhere(where: unknown, tenantId: string): Args {
  const w = isRecord(where) ? { ...where } : {};
  assertSameTenant(w.tenantId, tenantId, 'where');
  // Compound unique selectors such as { tenantId_id: { tenantId, id } }.
  for (const [key, value] of Object.entries(w)) {
    if (key.includes('_') && isRecord(value) && 'tenantId' in value) {
      assertSameTenant(value.tenantId, tenantId, `where.${key}`);
    }
  }
  w.tenantId = tenantId;
  return w;
}

function stampCreate(data: unknown, tenantId: string): Args {
  if (!isRecord(data)) throw new TenantScopeViolationError('create: data must be an object');
  if ('tenant' in data) {
    throw new TenantScopeViolationError(
      'create: use the unchecked input (tenantId scalar), not a tenant relation, on tenant models',
    );
  }
  assertSameTenant(data.tenantId, tenantId, 'data');
  return { ...data, tenantId };
}

function checkUpdate(data: unknown, tenantId: string): unknown {
  if (isRecord(data)) {
    if ('tenant' in data)
      throw new TenantScopeViolationError('update: tenant relation cannot change');
    assertSameTenant(data.tenantId, tenantId, 'data');
  }
  return data;
}

/**
 * Layer 2 of tenant isolation (docs/MULTI_TENANCY.md §4): filters every top-level read and
 * write on a tenant model by the context tenant and stamps tenantId on creates. Nested
 * relation reads and writes are covered by RLS (same transaction) and composite FKs.
 * Unknown operations are rejected so new Prisma operations cannot bypass scoping silently.
 */
export function scopeArgs(operation: string, args: unknown, tenantId: string): Args {
  const a: Args = isRecord(args) ? { ...args } : {};

  if (CREATE_OPERATIONS.has(operation)) {
    a.data = Array.isArray(a.data)
      ? a.data.map((d) => stampCreate(d, tenantId))
      : stampCreate(a.data, tenantId);
    return a;
  }
  if (!WHERE_OPERATIONS.has(operation)) {
    throw new TenantScopeViolationError(`Operation ${operation} is not supported on tenant models`);
  }

  a.where = scopeWhere(a.where, tenantId);
  if (UPDATE_DATA_OPERATIONS.has(operation)) a.data = checkUpdate(a.data, tenantId);
  if (operation === 'upsert') {
    a.create = stampCreate(a.create, tenantId);
    a.update = checkUpdate(a.update, tenantId);
  }
  return a;
}
