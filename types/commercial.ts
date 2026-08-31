import type { CommercialStage } from "@/types/inscricao";
import type { Funnel } from "@/types/funnel";
import type { ProductivityLeadAgent } from "@/types/productivity";

export interface CommercialSeller extends ProductivityLeadAgent {
  isSupervisor: boolean;
}

export interface CommercialWorkspace {
  isSupervisor: boolean;
  sellers: CommercialSeller[];
  /** Etapas do Funil Padrão — mantido por compat; para telas funil-aware, use `funnels`. */
  stages: Array<{ key: CommercialStage; label: string }>;
  funnels: Funnel[];
}

export interface CommercialActionResult {
  ok: true;
  inscricaoId: number;
  stage?: CommercialStage;
  seller?: {
    id: number;
    email: string;
    name: string;
  } | null;
}

/**
 * Quantos leads estao parados na Chegada de Leads, por fila. Fica em `types/`
 * porque o menu lateral (componente client) consome o numero vindo do feed de
 * notificacoes, e nao pode importar `lib/manualDistribution` — que arrasta o
 * driver do Postgres para o bundle.
 */
export interface ArrivalQueueCounts {
  /** Fila "Chegada geral": captacao Meta e Google. */
  general: number;
  /** Fila dedicada da Aula Exclusiva / Experimental. */
  exclusiveClass: number;
  /** Soma das duas — e o numero que acende o aviso no menu. */
  total: number;
}
