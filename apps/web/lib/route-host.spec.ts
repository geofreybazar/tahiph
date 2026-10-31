import { describe, expect, it } from 'vitest';
import { routeHost } from './route-host';

describe('routeHost', () => {
  it('routes a tenant host in development', () => {
    expect(routeHost('demo.localhost:3000', '/', 'localhost:3000')).toEqual({
      kind: 'tenant',
      site: 'demo',
      rewriteTo: '/demo',
    });
  });

  it('routes a tenant host in production and keeps the path', () => {
    expect(routeHost('Designer.tahi.ph', '/about', 'tahi.ph')).toEqual({
      kind: 'tenant',
      site: 'designer',
      rewriteTo: '/designer/about',
    });
  });

  it('takes the tenant from the host, never the path', () => {
    expect(routeHost('demo.tahi.ph', '/other/secret', 'tahi.ph')).toMatchObject({
      site: 'demo',
      rewriteTo: '/demo/other/secret',
    });
  });

  it('serves only the landing page on the root host', () => {
    expect(routeHost('tahi.ph', '/', 'tahi.ph')).toEqual({ kind: 'root' });
    expect(routeHost('www.tahi.ph', '/', 'tahi.ph')).toEqual({ kind: 'root' });
    expect(routeHost('localhost:3000', '/demo', 'localhost:3000')).toEqual({ kind: 'not-found' });
  });

  it.each([
    'api.tahi.ph',
    'app.tahi.ph',
    'a.b.tahi.ph',
    'evil-tahi.ph',
    'tahi.ph.evil.com',
    'demo.vercel.app',
    '-bad.tahi.ph',
    '',
  ])('rejects %j', (host) => {
    expect(routeHost(host, '/', 'tahi.ph')).toEqual({ kind: 'not-found' });
  });

  it('rejects a missing host or unset root domain', () => {
    expect(routeHost(null, '/', 'tahi.ph')).toEqual({ kind: 'not-found' });
    expect(routeHost('demo.tahi.ph', '/', '')).toEqual({ kind: 'not-found' });
  });
});
