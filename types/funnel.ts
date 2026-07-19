import type { CommercialStageKind } from "@/types/inscricao";
import type { StageColorToken } from "@/lib/stageColors";

export interface FunnelStage {
  id: number;
  key: string;
  label: string;
  kind: CommercialStageKind;
  color: StageColorToken;
  position: number;
}

export interface Funnel {
  id: number;
  name: string;
  isDefault: boolean;
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
}

export interface FunnelInput {
  name: string;
  stages: FunnelStageInput[];
  sellerIds?: number[];
}
