import type { CampaignPurpose } from "@/types/metaAds";

/**
 * Traduz o objetivo declarado da campanha na Meta para o que ele significa na
 * operação: campanha que existe para TRAZER LEAD × campanha que existe para
 * APARECER.
 *
 * Isso não é cosmético: campanha de engajamento não tem formulário, então todo
 * indicador de captação dela é zero. Somada junto com as de captação, ela puxa
 * o custo por lead da conta inteira para cima e some no meio dos rankings —
 * quem olha conclui que "a mídia piorou" quando na verdade comparou coisas
 * diferentes. Os dois blocos convivem na mesma tela, mas nunca na mesma média.
 */

const CAPTURE_OBJECTIVES = new Set([
  "OUTCOME_LEADS",
  "LEAD_GENERATION",
  "OUTCOME_SALES",
  "CONVERSIONS",
  "PRODUCT_CATALOG_SALES",
  "OUTCOME_TRAFFIC",
  "LINK_CLICKS",
  "MESSAGES",
]);

const ENGAGEMENT_OBJECTIVES = new Set([
  "OUTCOME_ENGAGEMENT",
  "POST_ENGAGEMENT",
  "PAGE_LIKES",
  "EVENT_RESPONSES",
  "OUTCOME_AWARENESS",
  "BRAND_AWARENESS",
  "REACH",
  "VIDEO_VIEWS",
  "OUTCOME_APP_PROMOTION",
]);

export function classifyCampaignPurpose(objective: string | null | undefined): CampaignPurpose {
  const key = objective?.trim().toUpperCase();
  if (!key) return "outro";
  if (CAPTURE_OBJECTIVES.has(key)) return "captacao";
  if (ENGAGEMENT_OBJECTIVES.has(key)) return "engajamento";
  return "outro";
}

export const PURPOSE_LABELS: Record<CampaignPurpose, string> = {
  captacao: "Captação",
  engajamento: "Engajamento",
  outro: "Outros objetivos",
};

export const PURPOSE_DESCRIPTIONS: Record<CampaignPurpose, string> = {
  captacao: "Campanhas com formulário: o resultado esperado é lead no CRM.",
  engajamento: "Campanhas para aparecer: o resultado esperado é alcance, visualização e interação — elas não geram lead.",
  outro: "Objetivo que não se encaixa nos dois grupos; confira no gerenciador antes de comparar.",
};

/** Rótulo legível do objetivo cru da Meta, para mostrar junto do nome da campanha. */
const OBJECTIVE_LABELS: Record<string, string> = {
  OUTCOME_LEADS: "Cadastros",
  LEAD_GENERATION: "Cadastros",
  OUTCOME_SALES: "Vendas",
  CONVERSIONS: "Conversões",
  OUTCOME_TRAFFIC: "Tráfego",
  LINK_CLICKS: "Cliques no link",
  MESSAGES: "Mensagens",
  OUTCOME_ENGAGEMENT: "Engajamento",
  POST_ENGAGEMENT: "Engajamento com a publicação",
  PAGE_LIKES: "Curtidas na página",
  OUTCOME_AWARENESS: "Reconhecimento",
  BRAND_AWARENESS: "Reconhecimento de marca",
  REACH: "Alcance",
  VIDEO_VIEWS: "Visualizações de vídeo",
};

export function readableObjective(objective: string | null | undefined): string {
  const key = objective?.trim().toUpperCase();
  if (!key) return "Objetivo não informado";
  return OBJECTIVE_LABELS[key] ?? key.replace(/^OUTCOME_/, "").replace(/_/g, " ").toLocaleLowerCase("pt-BR");
}

export const PURPOSE_FILTER_VALUES = ["todas", "captacao", "engajamento"] as const;
export type CampaignPurposeFilter = (typeof PURPOSE_FILTER_VALUES)[number];

export function parsePurposeFilter(value: string | null | undefined): CampaignPurposeFilter {
  return value === "captacao" || value === "engajamento" ? value : "todas";
}

/** "outro" acompanha captação no filtro: é o comportamento seguro (aparece em
 * vez de sumir) para um objetivo novo que a Meta lance e este mapa ainda não
 * conheça. */
export function matchesPurposeFilter(purpose: CampaignPurpose, filter: CampaignPurposeFilter): boolean {
  if (filter === "todas") return true;
  if (filter === "engajamento") return purpose === "engajamento";
  return purpose !== "engajamento";
}
