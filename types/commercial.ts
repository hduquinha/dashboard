import type { CommercialStage } from "@/types/inscricao";
import type { ProductivityLeadAgent } from "@/types/productivity";

export interface CommercialSeller extends ProductivityLeadAgent {
  isSupervisor: boolean;
}

export interface CommercialWorkspace {
  isSupervisor: boolean;
  sellers: CommercialSeller[];
  stages: Array<{ key: CommercialStage; label: string }>;
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
