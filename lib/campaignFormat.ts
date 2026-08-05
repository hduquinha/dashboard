/** Formatação compartilhada pelas telas de Métricas de Campanha — as abas
 * precisam mostrar o mesmo número exatamente igual (moeda, milhar, "—" quando
 * não dá pra calcular), então a formatação mora num lugar só. */

export function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
}

export function formatNullableCurrency(value: number | null): string {
  return value === null ? "—" : formatCurrency(value);
}

export function formatNumber(value: number): string {
  return value.toLocaleString("pt-BR");
}

export function formatPercent(value: number | null): string {
  return value === null ? "—" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

/** "2026-07-29" → "29/07". Trabalha na string para não passar pelo fuso do
 * runtime — a data já vem no fuso da conta de anúncios. */
export function formatDayShort(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${day}/${month}`;
}

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" });

/** "2026-07-29" → "qua · 29/07". O meio-dia UTC evita que o dia vire o anterior
 * em qualquer fuso do servidor. */
export function formatDayWithWeekday(iso: string): string {
  const weekday = WEEKDAY_FORMATTER.format(new Date(`${iso}T12:00:00Z`)).replace(".", "");
  return `${weekday} · ${formatDayShort(iso)}`;
}
