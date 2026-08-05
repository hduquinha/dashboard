import { classifyAdDestination, costPer } from "@/lib/adDestinationGroups";
import type { AdDestinationInfo, DailyAdRow } from "@/types/metaAds";

/**
 * Análise diária: transforma as linhas (dia × anúncio) que vêm do banco em
 * "um bloco por dia", com os anúncios daquele dia agrupados pelo destino
 * (formulário nativo × cada landing page). É a leitura que responde "ontem
 * gastei quanto, entraram quantos leads e a que custo médio" sem precisar
 * abrir campanha por campanha.
 */

interface DailyTotals {
  spend: number;
  impressions: number;
  clicks: number;
  leadsMeta: number;
  cadastrosCrm: number;
  /** Pessoas inéditas do dia — recorte de cadastrosCrm sem os recontatos. */
  novos: number;
  /** Todo preenchimento do dia, inclusive descartado e repetido: a régua
   * comparável com leadsMeta, que também conta envio. */
  envios: number;
  leadsCrm: number;
}

interface DerivedDailyMetrics {
  ctr: number | null;
  /** Investimento ÷ cadastros salvos no dia. */
  custoPorCadastro: number | null;
  /** Investimento ÷ pessoas novas no dia. */
  custoPorContato: number | null;
}

export interface DailyDestinationBucket extends DailyTotals, DerivedDailyMetrics {
  destination: AdDestinationInfo;
  ads: DailyAdRow[];
}

export interface DailyAnalysisDay extends DailyTotals, DerivedDailyMetrics {
  date: string;
  /** Anúncios distintos com entrega ou cadastro no dia. */
  adCount: number;
  buckets: DailyDestinationBucket[];
}

function emptyTotals(): DailyTotals {
  return { spend: 0, impressions: 0, clicks: 0, leadsMeta: 0, cadastrosCrm: 0, novos: 0, envios: 0, leadsCrm: 0 };
}

/** `source` é estruturalmente um DailyTotals — serve tanto para uma linha
 * (dia × anúncio) quanto para um bucket/dia já somado. */
function accumulate(target: DailyTotals, source: DailyTotals): void {
  target.spend += source.spend;
  target.impressions += source.impressions;
  target.clicks += source.clicks;
  target.leadsMeta += source.leadsMeta;
  target.cadastrosCrm += source.cadastrosCrm;
  target.novos += source.novos;
  target.envios += source.envios;
  target.leadsCrm += source.leadsCrm;
}

function derive(totals: DailyTotals): DerivedDailyMetrics {
  return {
    ctr: totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : null,
    custoPorCadastro: costPer(totals.spend, totals.cadastrosCrm),
    custoPorContato: costPer(totals.spend, totals.novos),
  };
}

/** Dias em ordem decrescente (o mais recente primeiro — é o que o gestor abre
 * pra ver "como foi ontem"); dentro do dia, grupos e anúncios por gasto. */
export function buildDailyAnalysis(rows: DailyAdRow[]): DailyAnalysisDay[] {
  const byDate = new Map<string, Map<string, DailyDestinationBucket>>();

  for (const row of rows) {
    const destination = classifyAdDestination(row.landingUrl);
    let buckets = byDate.get(row.date);
    if (!buckets) {
      buckets = new Map<string, DailyDestinationBucket>();
      byDate.set(row.date, buckets);
    }

    let bucket = buckets.get(destination.key);
    if (!bucket) {
      bucket = { destination, ads: [], ...emptyTotals(), ctr: null, custoPorCadastro: null, custoPorContato: null };
      buckets.set(destination.key, bucket);
    }

    bucket.ads.push(row);
    accumulate(bucket, row);
  }

  const days: DailyAnalysisDay[] = [];
  for (const [date, bucketMap] of byDate.entries()) {
    const buckets = Array.from(bucketMap.values()).sort((a, b) => b.spend - a.spend);
    const totals = emptyTotals();
    let adCount = 0;

    for (const bucket of buckets) {
      bucket.ads.sort((a, b) => b.spend - a.spend || b.cadastrosCrm - a.cadastrosCrm);
      Object.assign(bucket, derive(bucket));
      accumulate(totals, bucket);
      adCount += bucket.ads.length;
    }

    days.push({ date, adCount, buckets, ...totals, ...derive(totals) });
  }

  return days.sort((a, b) => b.date.localeCompare(a.date));
}

export interface DailyAnalysisSummary {
  dayCount: number;
  spend: number;
  cadastrosCrm: number;
  novos: number;
  leadsCrm: number;
  /** Investimento ÷ dias com veiculação. */
  spendPerDay: number | null;
  /** Cadastros ÷ dias com veiculação. */
  cadastrosPerDay: number | null;
  /** Custo médio por lead do período inteiro (investimento ÷ cadastros) — não é
   * a média das médias diárias, que daria peso igual a um dia de R$ 10 e a um
   * de R$ 300. */
  custoPorCadastro: number | null;
  custoPorContato: number | null;
  /** Dia mais barato e mais caro por lead, entre os dias que tiveram cadastro. */
  bestDay: DailyAnalysisDay | null;
  worstDay: DailyAnalysisDay | null;
}

export function summarizeDailyAnalysis(days: DailyAnalysisDay[]): DailyAnalysisSummary {
  const totals = emptyTotals();
  for (const day of days) accumulate(totals, day);

  const withCost = days.filter((day) => day.custoPorCadastro !== null);
  const sortedByCost = [...withCost].sort((a, b) => (a.custoPorCadastro ?? 0) - (b.custoPorCadastro ?? 0));

  return {
    dayCount: days.length,
    spend: totals.spend,
    cadastrosCrm: totals.cadastrosCrm,
    novos: totals.novos,
    leadsCrm: totals.leadsCrm,
    spendPerDay: costPer(totals.spend, days.length),
    cadastrosPerDay: days.length > 0 ? totals.cadastrosCrm / days.length : null,
    custoPorCadastro: costPer(totals.spend, totals.cadastrosCrm),
    custoPorContato: costPer(totals.spend, totals.novos),
    bestDay: sortedByCost[0] ?? null,
    worstDay: sortedByCost.length > 1 ? sortedByCost[sortedByCost.length - 1] : null,
  };
}
