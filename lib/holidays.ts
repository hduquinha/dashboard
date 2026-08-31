/**
 * Feriados brasileiros calculados no próprio sistema.
 *
 * Sem serviço externo de propósito: o calendário letivo é gerado quando a
 * secretaria cria uma turma, e depender de uma API de terceiro para isso
 * significaria "não consigo criar a turma porque um site caiu". Os feriados
 * nacionais são lei — mudam de raro em raro, e os móveis derivam todos da
 * Páscoa, que tem fórmula fechada.
 *
 * Módulo puro: nada de banco aqui, para poder ser testado direto.
 */

export interface Holiday {
  /** "AAAA-MM-DD". */
  day: string;
  label: string;
  /** Nacional, municipal (São Paulo) ou ponto facultativo tratado como feriado. */
  scope: "nacional" | "municipal";
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Domingo de Páscoa pelo algoritmo de Gauss/Meeus (calendário gregoriano).
 * É a âncora de Carnaval, Sexta-feira Santa e Corpus Christi.
 */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  // UTC para a aritmética de dias não escorregar com fuso/horário de verão.
  return new Date(Date.UTC(year, month - 1, day));
}

function shift(base: Date, days: number): string {
  const moved = new Date(base.getTime() + days * 86_400_000);
  return moved.toISOString().slice(0, 10);
}

const FIXED_NATIONAL: Array<[number, number, string]> = [
  [1, 1, "Confraternização Universal"],
  [4, 21, "Tiradentes"],
  [5, 1, "Dia do Trabalho"],
  [9, 7, "Independência do Brasil"],
  [10, 12, "Nossa Senhora Aparecida"],
  [11, 2, "Finados"],
  [11, 15, "Proclamação da República"],
  [11, 20, "Consciência Negra"],
  [12, 25, "Natal"],
];

/** Feriados municipais de São Paulo, onde fica a escola. */
const FIXED_SAO_PAULO: Array<[number, number, string]> = [
  [1, 25, "Aniversário de São Paulo"],
];

/**
 * Todos os feriados de um ano, em ordem de data.
 *
 * Carnaval entra como os **dois dias** (segunda e terça) porque é assim que a
 * escola para; quarta-feira de cinzas é meio período e fica de fora — se a
 * escola quiser, cadastra como recesso.
 */
export function holidaysForYear(year: number): Holiday[] {
  const easter = easterSunday(year);

  const movable: Holiday[] = [
    { day: shift(easter, -48), label: "Carnaval (segunda)", scope: "nacional" },
    { day: shift(easter, -47), label: "Carnaval (terça)", scope: "nacional" },
    { day: shift(easter, -2), label: "Sexta-feira Santa", scope: "nacional" },
    { day: shift(easter, 60), label: "Corpus Christi", scope: "nacional" },
  ];

  const fixed: Holiday[] = [
    ...FIXED_NATIONAL.map(([month, day, label]) => ({
      day: iso(year, month, day),
      label,
      scope: "nacional" as const,
    })),
    ...FIXED_SAO_PAULO.map(([month, day, label]) => ({
      day: iso(year, month, day),
      label,
      scope: "municipal" as const,
    })),
  ];

  return [...fixed, ...movable].sort((a, b) => a.day.localeCompare(b.day));
}

/** Conjunto de datas bloqueadas de vários anos — o formato que a geração de aulas usa. */
export function holidayDaysForYears(years: number[]): Set<string> {
  const days = new Set<string>();
  for (const year of years) {
    for (const holiday of holidaysForYear(year)) days.add(holiday.day);
  }
  return days;
}
