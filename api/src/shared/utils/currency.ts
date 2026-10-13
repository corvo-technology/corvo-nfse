const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

/** Formats a number as Brazilian reais, e.g. 1250 -> "R$ 1.250,00". */
export function formatBrl(amount: number): string {
  // Intl separates the symbol with a no-break space (U+00A0); use a regular one.
  return brl.format(amount).replace(/\s/g, ' ');
}
