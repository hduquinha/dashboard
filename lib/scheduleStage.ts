/**
 * Etapa de agendamento e o que fazer com o resultado do compromisso.
 *
 * Fica num módulo sem dependência de banco porque o Kanban (client), a ficha do
 * lead (client) e as rotas de API precisam exatamente das mesmas definições —
 * mesmo motivo de `saleStage.ts`.
 *
 * Regra de negócio (definida pela operação em 2026-08-13): lead que entra em
 * "Agendado" **tem** que ter uma tarefa com data. Quando essa data vence, o
 * vendedor é cobrado a dizer o que aconteceu, e a resposta move o lead sozinha.
 */

/** "Agendado" — existe com esta chave no Funil VozUP e no Funil Aula Exclusiva. */
export const SCHEDULED_STAGE_KEY = "agendado";

export function isScheduledStage(stageKey: string | null | undefined): boolean {
  return stageKey === SCHEDULED_STAGE_KEY;
}

/** O que aconteceu no compromisso marcado. */
export type ScheduleOutcome = "fechamento" | "acompanhamento" | "remarcado" | "bolo";

export const SCHEDULE_OUTCOMES: ScheduleOutcome[] = [
  "fechamento",
  "acompanhamento",
  "remarcado",
  "bolo",
];

export function isScheduleOutcome(value: unknown): value is ScheduleOutcome {
  return typeof value === "string" && (SCHEDULE_OUTCOMES as string[]).includes(value);
}

interface OutcomeDefinition {
  label: string;
  /** Frase curta no botão, para o vendedor não precisar adivinhar o efeito. */
  description: string;
  /**
   * Etapa para onde o lead vai. `null` = fica onde está (só "remarcado", que
   * continua em Agendado com uma data nova).
   *
   * As chaves são as mesmas nos dois funis comerciais, mas se um funil não
   * tiver a etapa o lead simplesmente não se move — o resultado ainda fica
   * registrado no histórico.
   */
  targetStageKey: string | null;
  /** Pede data nova e cria a próxima tarefa. */
  requiresNewDate: boolean;
}

export const SCHEDULE_OUTCOME_DEFS: Record<ScheduleOutcome, OutcomeDefinition> = {
  fechamento: {
    label: "Fechou",
    // Cair em "Fechado" é o que dispara o modal de registrar venda que já existe.
    description: "Vai para Fechado e abre o registro da venda",
    targetStageKey: "fechamento",
    requiresNewDate: false,
  },
  acompanhamento: {
    // "Compareceu" existiu como saída separada por um dia e foi removida: quem
    // veio e não fechou é exatamente este caso, e as duas opções lado a lado só
    // faziam o vendedor escolher no par ou ímpar.
    label: "Compareceu, mas não fechou agora",
    // "Follow-Up" no Funil VozUP. Apesar do nome, NÃO é venda: é nutrição de
    // quem não fechou agora.
    description: "Vai para Follow-Up",
    targetStageKey: "ganho",
    requiresNewDate: false,
  },
  remarcado: {
    label: "Remarcou",
    description: "Continua em Agendado com a nova data",
    targetStageKey: null,
    requiresNewDate: true,
  },
  bolo: {
    label: "Deu bolo (não apareceu)",
    // Quem some precisa ser reconquistado desde o contato ativo.
    description: "Volta para Tentativas",
    targetStageKey: "primeiro_contato",
    requiresNewDate: false,
  },
};

/**
 * Por que a data de um compromisso já marcado mudou.
 *
 * Trocar o horário sem dizer o motivo apagava a diferença entre um cliente que
 * remarca toda semana (sinal comercial) e um vendedor que digitou a data
 * errada (só conserto de cadastro) — os dois viravam a mesma linha muda no
 * histórico.
 */
export type RescheduleReason = "cliente" | "correcao";

export const RESCHEDULE_REASONS: RescheduleReason[] = ["cliente", "correcao"];

export function isRescheduleReason(value: unknown): value is RescheduleReason {
  return typeof value === "string" && (RESCHEDULE_REASONS as string[]).includes(value);
}

export const RESCHEDULE_REASON_DEFS: Record<
  RescheduleReason,
  {
    label: string;
    description: string;
    /** Conta como remarcação de verdade do compromisso (não é conserto de digitação). */
    countsAsReschedule: boolean;
  }
> = {
  cliente: {
    label: "O cliente reagendou",
    description: "Conta como remarcação na linha do tempo do lead",
    countsAsReschedule: true,
  },
  correcao: {
    label: "Eu marquei errado",
    description: "Só corrige a data — não conta como remarcação",
    countsAsReschedule: false,
  },
};

/**
 * Coluna do quadro onde um compromisso de lead deve nascer.
 *
 * O vendedor não escolhe fase de quadro ao agendar — ele marca um horário. Sem
 * esta regra o compromisso caía na primeira coluna do quadro Comercial, que é o
 * backlog de ideias do time, e virava ruído para os dois lados. Preferimos uma
 * coluna dedicada a lead; sem ela, a primeira que não conclui a tarefa.
 */
export function pickAppointmentColumn<T extends { id: number; name: string; completes: boolean }>(
  columns: T[]
): T | undefined {
  const abertas = columns.filter((column) => !column.completes);
  const dedicada = abertas.find((column) => /lead|compromisso|agend/i.test(column.name));
  return dedicada ?? abertas[0] ?? columns[0];
}
