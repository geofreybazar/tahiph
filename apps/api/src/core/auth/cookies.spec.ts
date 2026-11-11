import { describe, expect, it } from 'vitest';
import { readCookie } from './cookies.js';

describe('readCookie', () => {
  it('finds a cookie among others', () => {
    expect(readCookie('a=1; __Host-tahi_app=tok; b=2', '__Host-tahi_app')).toBe('tok');
  });

  it('uses the first occurrence and ignores prefixes of other names', () => {
    expect(
      readCookie(
        'x__Host-tahi_app=no; __Host-tahi_app=yes; __Host-tahi_app=late',
        '__Host-tahi_app',
      ),
    ).toBe('yes');
  });

  it('returns undefined for missing, empty or malformed cookies', () => {
    expect(readCookie(undefined, 'a')).toBeUndefined();
    expect(readCookie('a=', 'a')).toBeUndefined();
    expect(readCookie('garbage', 'a')).toBeUndefined();
  });
});
