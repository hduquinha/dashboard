import type { CommercialStageKind } from "@/types/inscricao";
import type { FunnelBoard } from "@/lib/funnelBoards";
import type { StageColorToken } from "@/lib/stageColors";

export interface FunnelStage {
  id: number;
  key: string;
  label: string;
  kind: CommercialStageKind;
  color: StageColorToken;
  /** Em qual quadro do funil esta coluna aparece (ver lib/funnelBoards.ts). */
  board: FunnelBoard;
  position: number;
}

export interface Funnel {
  id: number;
  name: string;
  isDefault: boolean;
  /**
   * Funil de triagem: lista fria/importada que ainda não faz parte do CRM
   * geral. Lead num funil assim some de /crm, /inscricoes, /vozup e do CSV —
   * só volta a aparecer quando é movido para um funil normal.
   */
  isTriage: boolean;
  sellerIds: number[];
  stages: FunnelStage[];
  createdAt: string;
  updatedAt: string;
}

export interface FunnelStageInput {
  id: number | null;
  label: string;
  kind: CommercialStageKind;
  color?: string;
  board?: string;
}

export interface FunnelInput {
  name: string;
  stages: FunnelStageInput[];
  sellerIds?: number[];
}
