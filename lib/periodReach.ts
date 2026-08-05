import type { PeriodReachData, PeriodReachRow } from "@/types/metaAds";

/**
 * Alcance é a única métrica da tela que NÃO pode ser somada.
 *
 * `meta_ads.ad_insights_daily` guarda quantas pessoas cada anúncio alcançou em
 * cada dia. Somar essas linhas conta a mesma pessoa de novo a cada dia e a cada
 * anúncio em que ela apareceu — em 03/08/2026 isso dava 40.039 pessoas para uma
 * semana em que a Meta reportava 29.899. Só a Meta consegue deduplicar, e só
 * para um objeto inteiro (conta, campanha ou conjunto) numa janela: é o que
 * getPeriodReach() busca e guarda.
 *
 * Quando o recorte da tela não corresponde a um desses objetos (filtro de
 * status, busca por texto, captação × engajamento), não existe alcance
 * deduplicado publicado — aí a tela mostra a soma e diz que é soma, em vez de
 * apresentar um número inflado como se fosse o da Meta.
 */
export interface ResolvedReach {
  reach: number;
  /** Impressões ÷ pessoas: quantas vezes a mesma pessoa viu o anúncio. */
  frequency: number | null;
  /** true = número deduplicado da Meta; false = soma dos anúncios (infla). */
  exact: boolean;
}

function fromRow(row: PeriodReachRow, impressions: number): ResolvedReach {
  return {
    reach: row.reach,
    frequency: row.frequency ?? (row.reach > 0 ? impressions / row.reach : null),
    exact: true,
  };
}

function fromSum(summedReach: number, impressions: number): ResolvedReach {
  return {
    reach: summedReach,
    frequency: summedReach > 0 ? impressions / summedReach : null,
    exact: false,
  };
}

/** Alcance do recorte atual da tela (conta, campanha ou conjunto selecionado). */
export function resolveScopeReach(options: {
  periodReach: PeriodReachData;
  /** O recorte não tem filtro que corte anúncios por dentro. */
  exactScope: boolean;
  selectedCampaignId: string | null;
  selectedAdsetId: string | null;
  summedReach: number;
  impressions: number;
}): ResolvedReach {
  const { periodReach, exactScope, selectedCampaignId, selectedAdsetId, summedReach, impressions } = options;
  if (!exactScope) return fromSum(summedReach, impressions);

  const row = selectedAdsetId
    ? periodReach.byAdset[selectedAdsetId]
    : selectedCampaignId
      ? periodReach.byCampaign[selectedCampaignId]
      : periodReach.account;

  return row && row.reach > 0 ? fromRow(row, impressions) : fromSum(summedReach, impressions);
}

/** Alcance de UMA campanha (cards da aba Alcance). */
export function resolveCampaignReach(options: {
  periodReach: PeriodReachData;
  exactScope: boolean;
  campaignId: string;
  summedReach: number;
  impressions: number;
}): ResolvedReach {
  const { periodReach, exactScope, campaignId, summedReach, impressions } = options;
  if (!exactScope) return fromSum(summedReach, impressions);
  const row = periodReach.byCampaign[campaignId];
  return row && row.reach > 0 ? fromRow(row, impressions) : fromSum(summedReach, impressions);
}

/** Texto curto que explica de onde veio o número, para não confundir quem
 * compara com o gerenciador. */
export function reachHint(resolved: ResolvedReach): string {
  return resolved.exact
    ? "Pessoas únicas, como a Meta conta."
    : "Soma dos anúncios: a mesma pessoa pode estar contada mais de uma vez. Tire os filtros para ver o número da Meta.";
}
