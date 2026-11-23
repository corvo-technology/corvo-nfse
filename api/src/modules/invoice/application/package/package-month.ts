const sp = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
});

/** The calendar month (YYYY-MM) that `now` falls in, in São Paulo time. */
export function monthOf(now: Date): string {
  const parts = Object.fromEntries(
    sp.formatToParts(now).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}`;
}

/** The month before the one `now` falls in, in São Paulo time. */
export function previousMonth(now: Date): string {
  const [year, month] = monthOf(now).split('-').map(Number);
  return month === 1
    ? `${year - 1}-12`
    : `${year}-${String(month - 1).padStart(2, '0')}`;
}

/** "2026-11" as "novembro de 2026". */
export function monthLabel(month: string): string {
  const [year, mm] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, mm - 1, 1)));
}
