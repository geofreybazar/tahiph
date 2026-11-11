/**
 * Base Prisma client with no tenant scoping. RLS still applies (the app role cannot bypass
 * it), so without a tenant context it sees no tenant rows. Allowed only in core/auth,
 * core/tenancy and the auth, tenants and platform modules; a unit test enforces the list.
 */
export const UNSCOPED_PRISMA = Symbol('UNSCOPED_PRISMA');
