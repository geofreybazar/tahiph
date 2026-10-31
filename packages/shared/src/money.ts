const MAX_CENTAVOS = 2_147_483_647;

/**
 * Parses what a person typed, such as "1,500.50", into integer centavos without floats.
 * Returns null for anything that isn't a valid amount in range.
 */
export function pesosToCentavos(input: string): number | null {
  const cleaned = input.trim().replace(/^₱\s*/, '');
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole = '', fraction = ''] = cleaned.replaceAll(',', '').split('.');
  const centavos = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return centavos <= MAX_CENTAVOS ? centavos : null;
}

export function formatCentavos(centavos: number): string {
  const sign = centavos < 0 ? '-' : '';
  const absolute = Math.abs(centavos);
  const pesos = Math.floor(absolute / 100).toLocaleString('en-PH');
  return `${sign}₱${pesos}.${String(absolute % 100).padStart(2, '0')}`;
}
