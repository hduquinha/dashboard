import { getEnrollmentOrigins } from "@/lib/enrollmentOrigin";
import { getMonthlyTotals } from "@/lib/finance";
import { getAdsHierarchy, getDailySeries, getFunnelBreakdown, getMetaAdsToday, getPeriodReach } from "@/lib/metaAds";
import {
  buildMonthlyReport,
  monthBounds,
  monthOfIsoDate,
  shiftMonth,
  type FinanceContextInput,
  type MonthlyReport,
} from "@/lib/monthlyReport";
import type { AdRow, MetaAdsFilters } from "@/types/metaAds";

/**
 * Monta o relatório mensal a partir das consultas que já existem, com uma
 * diferença deliberada: **o relatório ignora os filtros da tela**.
 *
 * O padrão de /campanhas é "Ativas", e no fim do mês metade da verba costuma
 * estar em campanha pausada — um relatório para os sócios que herdasse esse
 * filtro mostraria um investimento menor do que o extrato da Meta. Aqui o
 * status é sempre `all` e não há busca: o mês inteiro, a conta inteira.
 */

function financeFrom(
  month: string,
  totals: Array<{ month: string; revenue: number; revenueForecast: number; enrollmentsCount: number; enrollmentsAmount: number }>
): FinanceContextInput | null {
  const row = totals.find((item) => item.month === month);
  if (!row) return null;
  return {
    month,
    recebido: row.revenue,
    previsto: row.revenueForecast,
    matriculas: row.enrollmentsCount,
    valorContratado: row.enrollmentsAmount,
  };
}

export async function loadMonthlyReport(options: {
  month: string;
  ticketMedio: number | null;
  saleStageKey: string | null;
  /** Faturamento só entra para quem tem acesso ao Financeiro. */
  includeFinance: boolean;
}): Promise<MonthlyReport> {
  const today = getMetaAdsToday();
  const { from, to } = monthBounds(options.month, today);
  const previousMonth = shiftMonth(options.month, -1);
  const previousBounds = monthBounds(previousMonth, today);

  const filters: MetaAdsFilters = { from, to, status: "all" };
  const previousFilters: MetaAdsFilters = { ...previousBounds, status: "all" };

  const [ads, previousAds, periodReach, financeTotals, enrollmentOrigins] = await Promise.all([
    getAdsHierarchy(filters),
    getAdsHierarchy(previousFilters),
    // Alcance do mês vem da Meta já deduplicado; somar linha diária inflaria.
    getPeriodReach(from, to),
    options.includeFinance ? getMonthlyTotals(previousMonth, options.month).catch(() => []) : Promise.resolve([]),
    // A conciliação matrícula → lead → anúncio é o que separa "retorno" de
    // "etapa do CRM"; sem acesso ao Financeiro ela simplesmente não existe e o
    // bloco financeiro do relatório se declara não medido.
    options.includeFinance
      ? getEnrollmentOrigins(from, to).catch(() => null)
      : Promise.resolve(null),
  ]);

  const conversionAdIds = ads.filter((row: AdRow) => row.campaignPurpose !== "engajamento").map((row) => row.adId);
  const [series, funnel] = await Promise.all([
    getDailySeries(filters, ads.map((row) => row.adId)),
    getFunnelBreakdown(conversionAdIds, filters),
  ]);

  return buildMonthlyReport({
    month: options.month,
    from,
    to,
    parcial: monthOfIsoDate(today) === options.month,
    ads,
    previousAds,
    previousMonth,
    series,
    funnel,
    finance: financeFrom(options.month, financeTotals),
    previousFinance: financeFrom(previousMonth, financeTotals),
    ticketMedio: options.ticketMedio,
    saleStageKey: options.saleStageKey,
    periodReach,
    enrollmentOrigins: enrollmentOrigins
      ? {
          total: enrollmentOrigins.total,
          totalAmount: enrollmentOrigins.totalAmount,
          anuncio: enrollmentOrigins.anuncio,
          crmSemAnuncio: enrollmentOrigins.crmSemAnuncio,
          semCadastro: enrollmentOrigins.semCadastro,
          rows: enrollmentOrigins.rows.map((row) => ({
            student: row.student,
            amount: row.amount,
            saleDate: row.saleDate,
            kind: row.kind,
            leadOrigem: row.leadOrigem,
            campaignName: row.campaignName,
          })),
        }
      : null,
  });
}
