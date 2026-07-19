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
