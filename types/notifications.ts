/**
 * Tipos do feed de notificacoes do site. Ficam fora de `lib/appNotifications`
 * para que componentes client possam importar sem arrastar o driver do
 * Postgres para o bundle.
 */

import type { ArrivalQueueCounts } from "@/types/commercial";

export type AppNotificationKind =
  | "new_lead"
  | "lead_assigned"
  | "stale_lead"
  | "undistributed_lead"
  // Módulo de Tarefas: atribuição, citação em comentário e prazo do card.
  | "task_assigned"
  | "task_mention"
  | "task_due"
  // Financeiro: parcela de matrícula que venceu e continua em aberto.
  | "finance_overdue";

export interface AppNotification {
  id: number;
  kind: AppNotificationKind;
  title: string;
  body: string;
  url: string | null;
  inscricaoId: number | null;
  createdAt: string;
  readAt: string | null;
}

export interface AppNotificationFeed {
  items: AppNotification[];
  unread: number;
  /**
   * Leads esperando distribuicao na Chegada de Leads. Vem junto do feed em vez
   * de ter rota propria porque o menu ja consulta este endpoint em ciclo — uma
   * segunda busca periodica so para o contador dobraria o trafego. Nulo para
   * quem nao distribui leads (o item do menu nem acende).
   */
  arrivalQueue?: ArrivalQueueCounts | null;
}
