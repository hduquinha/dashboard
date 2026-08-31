/**
 * Geração do quadro de aulas de uma turma.
 *
 * A regra da VozUP é uma aula por semana, sempre no mesmo dia e horário. O que
 * o sistema precisa fazer é transformar "curso de 24 aulas, terça às 19h,
 * começando em 03/03" numa lista de 24 datas — **pulando feriado e recesso**,
 * que é justamente o que ninguém acerta na mão e o que fazia a turma terminar
 * numa data diferente da combinada com o aluno.
 *
 * Puro de propósito: nada de banco. Quem sabe quais dias estão bloqueados é
 * quem chama (`academic_calendar_days` + `lib/holidays.ts`).
 */

export interface LessonSlot {
  /** 1 = primeira aula do curso. */
  sequence: number;
  /** "AAAA-MM-DD". */
  date: string;
  /** 0 = domingo … 6 = sábado, como no `academic_class_schedule`. */
  weekday: number;
  /** Feriado que empurrou esta aula, quando houve — vira aviso na tela. */
  skipped?: string[];
}

export interface LessonPlanInput {
  /** Primeira data possível ("AAAA-MM-DD"); se não cair num dia de aula, o plano começa no próximo. */
  startDate: string;
  /** Dias da semana em que a turma tem aula (0–6). */
  weekdays: number[];
  lessonsCount: number;
  /** Datas bloqueadas ("AAAA-MM-DD"): feriado, recesso, o que a escola marcar. */
  blocked?: Set<string>;
}

/** Teto de segurança: 3 anos de tentativas cobre qualquer curso real e evita laço infinito. */
const MAX_DAYS_SCANNED = 1100;

function parseIsoDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  // UTC: somar dias em horário local escorrega no início/fim do horário de verão.
  return new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1));
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Datas das aulas, na ordem.
 *
 * Feriado **não vira aula em outro dia da semana**: a aula pula para a próxima
 * ocorrência do mesmo dia (a turma de terça continua sendo de terça), e o curso
 * termina uma semana depois. Trocar o dia da semana por causa de um feriado é
 * decisão de reposição, que a secretaria faz aula a aula.
 */
export function generateLessonDates(input: LessonPlanInput): LessonSlot[] {
  const weekdays = [...new Set(input.weekdays)].filter((day) => day >= 0 && day <= 6).sort();
  const total = Math.trunc(input.lessonsCount);
  if (weekdays.length === 0 || !Number.isFinite(total) || total <= 0) return [];

  const blocked = input.blocked ?? new Set<string>();
  const slots: LessonSlot[] = [];
  const cursor = parseIsoDate(input.startDate);
  let pendingSkips: string[] = [];

  for (let scanned = 0; scanned < MAX_DAYS_SCANNED && slots.length < total; scanned += 1) {
    const iso = toIso(cursor);
    const weekday = cursor.getUTCDay();

    if (weekdays.includes(weekday)) {
      if (blocked.has(iso)) {
        // Guarda o feriado para explicar, na aula que de fato acontecer, por que
        // ela caiu uma semana depois.
        pendingSkips.push(iso);
      } else {
        slots.push({
          sequence: slots.length + 1,
          date: iso,
          weekday,
          ...(pendingSkips.length > 0 ? { skipped: pendingSkips } : {}),
        });
        pendingSkips = [];
      }
    }

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return slots;
}

/** Última aula do plano — é a data de término da turma. */
export function lessonPlanEndDate(slots: LessonSlot[]): string | null {
  return slots.length > 0 ? slots[slots.length - 1].date : null;
}

/** Anos que o plano atravessa; usado para carregar os feriados certos. */
export function yearsSpanned(startDate: string, lessonsCount: number, perWeek = 1): number[] {
  const start = parseIsoDate(startDate);
  const semanas = Math.ceil(Math.max(1, lessonsCount) / Math.max(1, perWeek));
  // Uma folga de 12 semanas cobre os feriados que empurram o fim do curso.
  const end = new Date(start.getTime() + (semanas + 12) * 7 * 86_400_000);
  const years: number[] = [];
  for (let year = start.getUTCFullYear(); year <= end.getUTCFullYear(); year += 1) {
    years.push(year);
  }
  return years;
}
