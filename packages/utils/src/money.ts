export const DEFAULT_CURRENCY = 'PHP';
export const DEFAULT_LOCALE = 'en-PH';

const DECIMAL_STRING = /^-?\d+(\.\d+)?$/;

/**
 * Formats a decimal-string amount for display without converting it to a JS float.
 * Intl.NumberFormat accepts decimal strings exactly (ECMA-402 NumberFormat v3).
 */
export function formatMoney(
  amount: string,
  currency: string = DEFAULT_CURRENCY,
  locale: string = DEFAULT_LOCALE,
): string {
  if (!DECIMAL_STRING.test(amount)) {
    throw new TypeError(`formatMoney expects a decimal string, received "${amount}"`);
  }
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(
    amount as unknown as number, // decimal strings are valid input per ECMA-402; typed as number in lib.d.ts
  );
}
