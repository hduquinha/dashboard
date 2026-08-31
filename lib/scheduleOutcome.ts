/**
 * Registro do resultado de um compromisso agendado.
 *
 * Fecha o ciclo aberto quando o lead entra em "Agendado": a tarefa com data
 * vence, o vendedor diz o que aconteceu, e o lead se move sozinho para onde
 * aquele resultado manda (ver `SCHEDULE_OUTCOME_DEFS`).
 *
 * Fica separado de `commercial.ts` porque precisa costurar três coisas que
 * moram em módulos diferentes — tarefa, etapa comercial e histórico do lead —
 * e `commercial.ts` não conhece o módulo de tarefas.
 */
import type { DashboardUser } from "@/lib/auth";
import { getLeadFunnel, logLeadTimelineEvent, setCommercialStage } from "@/lib/commercial";
import { listLeadTasks } from "@/lib/leadTasks";
import {
  RESCHEDULE_REASON_DEFS,
  SCHEDULE_OUTCOME_DEFS,
  type RescheduleReason,
  type ScheduleOutcome,
} from "@/lib/scheduleStage";
import { syncTaskCompletionColumn, updateTask } from "@/lib/tasks";

export interface ScheduleOutcomeResult {
  /** Etapa em que o lead ficou depois do registro. */
  stageKey: string | null;
  /** True quando o resultado foi "fechou": o client abre o modal de venda. */
  opensSale: boolean;
  movedStage: boolean;
}

/**
 * Conclui a tarefa do compromisso, registra o que aconteceu e move o lead.
 *
 * Ordem importa: a tarefa é concluída **antes** de mexer na etapa. Se o
 * movimento falhar (por exemplo, vendedor sem permissão sobre lead de outro),
 * a tarefa já foi baixada e o erro sobe para o usuário — melhor do que mover o
 * lead e deixar a tarefa vencida cobrando para sempre.
 */
export async function registerScheduleOutcome(
  user: DashboardUser | null | undefined,
  inscricaoId: number,
  taskId: number,
  outcome: ScheduleOutcome
): Promise<ScheduleOutcomeResult> {
  const definition = SCHEDULE_OUTCOME_DEFS[outcome];

  // A tarefa tem que ser deste lead: sem esta checagem, um id qualquer no corpo
  // da requisição concluiria tarefa de outra pessoa.
  const tasks = await listLeadTasks(inscricaoId);
  const task = tasks.find((item) => item.id === taskId);
  if (!task) {
    throw new Error("Tarefa não encontrada para este lead.");
  }

  await updateTask(taskId, { completed: true });
  // O card também sai da coluna de trabalho e cai na de conclusão do quadro.
  await syncTaskCompletionColumn(taskId);

  let movedStage = false;
  let stageKey: string | null = null;

  if (definition.targetStageKey) {
    // Funil que não tenha a etapa alvo não quebra o registro: o resultado fica
    // no histórico e o lead só não se move.
    const funnel = await getLeadFunnel(inscricaoId);
    const target = funnel.stages.find((stage) => stage.key === definition.targetStageKey);
    if (target) {
      await setCommercialStage(user, inscricaoId, target.key);
      movedStage = true;
      stageKey = target.key;
    }
  }

  await logLeadTimelineEvent(user, inscricaoId, "schedule_outcome", {
    outcome,
    outcomeLabel: definition.label,
    taskId,
    taskTitle: task.title,
    dueDate: task.dueDate,
    movedToStage: stageKey,
  });

  return {
    stageKey,
    // "Compareceu" indo para Fechado também precisa abrir o registro da venda:
    // o que dispara o modal é a etapa de destino, não o rótulo do resultado.
    opensSale: movedStage && stageKey === "fechamento",
    movedStage,
  };
}

export interface RescheduleTaskResult {
  dueDate: string;
  dueTime: string | null;
}

/**
 * Muda a data/hora de um compromisso já marcado, com o motivo obrigatório.
 *
 * Não usa a rota genérica de tarefa de propósito: mexer no prazo de um
 * compromisso é ato comercial (o cliente empurrou a conversa) ou conserto de
 * digitação, e só o vendedor sabe qual dos dois — sem isso, a linha do tempo
 * mostrava a data nova sem explicar por que ela mudou.
 *
 * O lead NÃO se move: continua em Agendado, agora com a data certa. A tarefa
 * também continua aberta — quem conclui é o registro do resultado.
 */
export async function rescheduleLeadTask(
  user: DashboardUser | null | undefined,
  inscricaoId: number,
  taskId: number,
  input: { dueDate: string; dueTime: string | null; reason: RescheduleReason; note?: string | null }
): Promise<RescheduleTaskResult> {
  const tasks = await listLeadTasks(inscricaoId);
  const task = tasks.find((item) => item.id === taskId);
  if (!task) {
    throw new Error("Tarefa não encontrada para este lead.");
  }
  if (task.completedAt) {
    throw new Error("Compromisso já concluído — registre o resultado em vez de remarcar.");
  }

  const definition = RESCHEDULE_REASON_DEFS[input.reason];
  const dueTime = input.dueTime || null;

  // `updateTask` já zera `reminder_sent_at` quando prazo ou hora mudam, então o
  // lembrete rearma sozinho para o novo horário.
  await updateTask(taskId, { dueDate: input.dueDate, dueTime });

  await logLeadTimelineEvent(user, inscricaoId, "task_rescheduled", {
    taskId,
    taskTitle: task.title,
    reason: input.reason,
    reasonLabel: definition.label,
    countsAsReschedule: definition.countsAsReschedule,
    fromDate: task.dueDate,
    fromTime: task.dueTime,
    toDate: input.dueDate,
    toTime: dueTime,
    note: input.note?.trim() || null,
  });

  return { dueDate: input.dueDate, dueTime };
}
