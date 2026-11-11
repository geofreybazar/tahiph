import { describe, expect, it } from 'vitest';
import { classifyHost, normalizeHost, realmServedOn } from './host.js';

const env = { APP_HOST: 'app.tahi.ph', ADMIN_HOST: 'admin.tahi.ph', API_HOST: 'api.tahi.ph' };

describe('normalizeHost', () => {
  it('lower-cases and strips port and trailing dot', () => {
    expect(normalizeHost('Maria.Tahi.PH:443')).toBe('maria.tahi.ph');
    expect(normalizeHost('app.tahi.ph.')).toBe('app.tahi.ph');
  });

  it.each([undefined, '', '[::1]:3000', 'a b.ph', 'evil.ph/x', 'x'.repeat(300)])(
    'rejects %s',
    (h) => {
      expect(normalizeHost(h)).toBeUndefined();
    },
  );
});

describe('classifyHost / realmServedOn', () => {
  it('maps configured hosts and treats everything else as a storefront', () => {
    expect(classifyHost('app.tahi.ph', env)).toBe('app');
    expect(classifyHost('admin.tahi.ph', env)).toBe('admin');
    expect(classifyHost('api.tahi.ph', env)).toBe('api');
    expect(classifyHost('maria.tahi.ph', env)).toBe('storefront');
    expect(classifyHost('www.maria-couture.com', env)).toBe('storefront');
  });

  it('serves each realm only on its host', () => {
    expect(realmServedOn('tenant', 'app')).toBe(true);
    expect(realmServedOn('tenant', 'storefront')).toBe(false);
    expect(realmServedOn('platform', 'app')).toBe(false);
    expect(realmServedOn('customer', 'storefront')).toBe(true);
    expect(realmServedOn('public', 'admin')).toBe(false);
  });
});
