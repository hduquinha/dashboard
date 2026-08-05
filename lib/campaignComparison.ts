import { costPer } from "@/lib/adDestinationGroups";
import type { AdRow, CampaignGroup, CampaignPurpose } from "@/types/metaAds";
import { classifyAdDestination } from "@/lib/adDestinationGroups";
import { groupAdsByCreative } from "@/lib/creativeGroups";
import { readableCampaignName } from "@/lib/metaAdsLabels";

/**
 * Comparação entre coisas do mesmo tipo (campanha × campanha, criativo ×
 * criativo, página × página): quem traz lead mais barato, quem come o
 * orçamento, onde está concentrado o resultado.
 *
 * A regra que segura tudo isso: **só entra na comparação de custo por lead
 * quem tem a captação como objetivo**. Campanha de engajamento não tem
 * formulário — colocá-la no mesmo ranking a mostraria eternamente como "a
 * pior", e ela nem está tentando. Ela é comparada em outra tela, pelas
 * métricas dela (alcance, visualização, interação).
 */

export interface ComparisonInput {
  key: string;
  label: string;
  sublabel: string | null;
  purpose: CampaignPurpose;
  spend: number;
  cadastros: number;
  leadsCrm: number;
  leadsQualificados: number;
  leadsFechados: number;
  impressions: number;
  clicks: number;
  videoViews: number;
  postEngagement: number;
}

export interface ComparisonEntity extends ComparisonInput {
  custoPorLead: number | null;
  ctr: number | null;
  cpm: number | null;
  /** Fatia do investimento do recorte (0–100). */
  shareSpend: number;
  /** Fatia dos cadastros do recorte (0–100). */
  shareLeads: number;
  /**
   * shareLeads ÷ shareSpend. Acima de 1 = entrega mais lead do que consome
   * orçamento; abaixo de 1 = consome mais do que entrega. É o número que
   * responde "para onde eu movo verba" sem precisar comparar reais com reais
   * entre campanhas de tamanhos diferentes.
   */
  eficiencia: number | null;
  /** Posição no ranking de custo por lead (1 = mais barato); null sem cadastro. */
  rankCusto: number | null;
}

export interface ParetoPoint {
  key: string;
  label: string;
  shareLeads: number;
  /** Soma acumulada das fatias, do maior para o menor (0–100). */
  acumulado: number;
}

export interface ComparisonResult {
  entities: ComparisonEntity[];
  totalSpend: number;
  totalCadastros: number;
  custoMedio: number | null;
  /** Menor custo por lead entre quem teve cadastro. */
  melhorCusto: ComparisonEntity | null;
  piorCusto: ComparisonEntity | null;
  /** Quem trouxe mais cadastros em número absoluto. */
  maiorVolume: ComparisonEntity | null;
  /** Gastou no período e não trouxe nenhum cadastro. */
  semResultado: ComparisonEntity[];
  pareto: ParetoPoint[];
  /**
   * Quantas entidades somam 80% dos cadastros — a frase "X de Y campanhas
   * trazem 80% dos leads". Null quando não houve cadastro.
   */
  concentracao: { quantidade: number; total: number; share: number } | null;
}

function derive(input: ComparisonInput, totalSpend: number, totalCadastros: number): ComparisonEntity {
  const shareSpend = totalSpend > 0 ? (input.spend / totalSpend) * 100 : 0;
  const shareLeads = totalCadastros > 0 ? (input.cadastros / totalCadastros) * 100 : 0;
  return {
    ...input,
    custoPorLead: costPer(input.spend, input.cadastros),
    ctr: input.impressions > 0 ? (input.clicks / input.impressions) * 100 : null,
    cpm: input.impressions > 0 ? (input.spend / input.impressions) * 1000 : null,
    shareSpend,
    shareLeads,
    eficiencia: shareSpend > 0 ? shareLeads / shareSpend : null,
    rankCusto: null,
  };
}

export function buildComparison(inputs: ComparisonInput[]): ComparisonResult {
  const totalSpend = inputs.reduce((total, item) => total + item.spend, 0);
  const totalCadastros = inputs.reduce((total, item) => total + item.cadastros, 0);
  const entities = inputs.map((input) => derive(input, totalSpend, totalCadastros));

  // Ranking de custo só entre quem teve cadastro: sem lead o custo é "—", não
  // "infinito", e um zero disfarçado envenenaria a ordenação.
  const ranked = entities
    .filter((entity) => entity.custoPorLead !== null)
    .sort((a, b) => (a.custoPorLead ?? 0) - (b.custoPorLead ?? 0));
  ranked.forEach((entity, index) => {
    entity.rankCusto = index + 1;
  });

  const byLeads = [...entities].sort((a, b) => b.cadastros - a.cadastros);
  const pareto: ParetoPoint[] = [];
  let acumulado = 0;
  for (const entity of byLeads) {
    if (entity.cadastros === 0) continue;
    acumulado += entity.shareLeads;
    pareto.push({
      key: entity.key,
      label: entity.label,
      shareLeads: entity.shareLeads,
      acumulado: Math.min(acumulado, 100),
    });
  }

  let concentracao: ComparisonResult["concentracao"] = null;
  if (pareto.length > 0) {
    const index = pareto.findIndex((point) => point.acumulado >= 80);
    const quantidade = index === -1 ? pareto.length : index + 1;
    concentracao = {
      quantidade,
      total: pareto.length,
      share: pareto[quantidade - 1]?.acumulado ?? 100,
    };
  }

  return {
    entities,
    totalSpend,
    totalCadastros,
    custoMedio: costPer(totalSpend, totalCadastros),
    melhorCusto: ranked[0] ?? null,
    piorCusto: ranked.length > 1 ? ranked[ranked.length - 1] : null,
    maiorVolume: byLeads[0]?.cadastros ? byLeads[0] : null,
    semResultado: entities
      .filter((entity) => entity.cadastros === 0 && entity.spend > 0)
      .sort((a, b) => b.spend - a.spend),
    pareto,
    concentracao,
  };
}

function fromAds(key: string, label: string, sublabel: string | null, purpose: CampaignPurpose, ads: AdRow[]): ComparisonInput {
  return {
    key,
    label,
    sublabel,
    purpose,
    spend: ads.reduce((total, ad) => total + ad.spend, 0),
    cadastros: ads.reduce((total, ad) => total + ad.cadastrosCrm, 0),
    leadsCrm: ads.reduce((total, ad) => total + ad.leadsCrm, 0),
    leadsQualificados: ads.reduce((total, ad) => total + ad.leadsQualificados, 0),
    leadsFechados: ads.reduce((total, ad) => total + ad.leadsFechados, 0),
    impressions: ads.reduce((total, ad) => total + ad.impressions, 0),
    clicks: ads.reduce((total, ad) => total + ad.clicks, 0),
    videoViews: ads.reduce((total, ad) => total + ad.videoViews, 0),
    postEngagement: ads.reduce((total, ad) => total + ad.postEngagement, 0),
  };
}

export function campaignComparisonInputs(hierarchy: CampaignGroup[]): ComparisonInput[] {
  return hierarchy.map((campaign) =>
    fromAds(
      campaign.campaignId,
      readableCampaignName(campaign.campaignName),
      `${campaign.adsets.length} conjunto${campaign.adsets.length === 1 ? "" : "s"}`,
      campaign.purpose,
      campaign.adsets.flatMap((adset) => adset.ads)
    )
  );
}

export function creativeComparisonInputs(ads: AdRow[]): ComparisonInput[] {
  return groupAdsByCreative(ads).map((creative) =>
    fromAds(
      creative.key,
      creative.key,
      `${creative.adsetCount} conjunto${creative.adsetCount === 1 ? "" : "s"}`,
      creative.card.campaignPurpose,
      creative.members
    )
  );
}

export function destinationComparisonInputs(ads: AdRow[]): ComparisonInput[] {
  const byKey = new Map<string, { label: string; detail: string | null; ads: AdRow[] }>();
  for (const ad of ads) {
    const destination = classifyAdDestination(ad.landingUrl);
    const entry = byKey.get(destination.key);
    if (entry) entry.ads.push(ad);
    else byKey.set(destination.key, { label: destination.label, detail: destination.detail, ads: [ad] });
  }
  return Array.from(byKey.entries()).map(([key, entry]) =>
    fromAds(key, entry.label, entry.detail, entry.ads[0]?.campaignPurpose ?? "outro", entry.ads)
  );
}

export function adsetComparisonInputs(hierarchy: CampaignGroup[]): ComparisonInput[] {
  return hierarchy.flatMap((campaign) =>
    campaign.adsets.map((adset) =>
      fromAds(adset.adsetId, adset.adsetName, readableCampaignName(campaign.campaignName), campaign.purpose, adset.ads)
    )
  );
}
