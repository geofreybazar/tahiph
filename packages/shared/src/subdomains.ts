export const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set([
  'www',
  'app',
  'api',
  'admin',
  'portal',
  'auth',
  'mail',
  'static',
  'cdn',
  'docs',
  'status',
  'support',
  'help',
  'blog',
]);

/** One DNS label: lower case, digits and inner hyphens, at most 63 characters. */
const TENANT_SLUG = /^(?=.{1,63}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidTenantSlug(slug: string): boolean {
  return TENANT_SLUG.test(slug) && !RESERVED_SUBDOMAINS.has(slug);
}
