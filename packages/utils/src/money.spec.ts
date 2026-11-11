import { describe, expect, it } from 'vitest';
import { formatMoney } from './money.js';

describe('formatMoney', () => {
  it('formats PHP by default', () => {
    expect(formatMoney('15000.50')).toBe('₱15,000.50');
  });

  it('keeps precision beyond float range', () => {
    // 9007199254740993 cannot be represented as a JS number.
    expect(formatMoney('9007199254740993.10', 'PHP')).toBe('₱9,007,199,254,740,993.10');
  });

  it('rejects non-decimal input', () => {
    expect(() => formatMoney('1e5')).toThrow(TypeError);
    expect(() => formatMoney('')).toThrow(TypeError);
  });
});
