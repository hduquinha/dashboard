import { matchesPurposeFilter, type CampaignPurposeFilter } from "@/lib/campaignObjectives";
import { getEnrollmentOrigins, summarizeEnrollmentOrigins } from "@/lib/enrollmentOrigin";
import { getMonthlyTotals } from "@/lib/finance";
import {
  getAdLeadDetails,
  getAdsHierarchy,
  getDailySeries,
  getFunnelBreakdown,
  getMetaAdsToday,
  getPeriodReach,
  shiftIsoDate,
} from "@/lib/metaAds";
import {
  buildMonthlyReport,
  monthBounds,
  monthLabel,
  monthOfIsoDate,
  reportPeriodLabel,
  shiftMonth,
  type FinanceContextInput,
  type MonthlyReport,
  type SellerInput,
} from "@/lib/monthlyReport";
import type { AdLeadDetail, AdRow, FunnelStagePoint, MetaAdsFilters } from "@/types/metaAds";

/** Parâmetros que precisam acompanhar o documento exportado. O relatório não
 * pode mais escapar do recorte escolhido na tela, porque isso fazia o PDF
 * contradizer os filtros que a pessoa tinha acabado de aplicar. */
export interface CampaignReportOptions {
  filters: MetaAdsFilters;
  purposeFilter: CampaignPurposeFilter;
  /** Ausente = todas as campanhas que passaram pelos filtros; preenchido = só as marcadas. */
  campaignIds: string[];
  adsetId: string | null;
  ticketMedio: number | null;
  saleStageKey: string | null;
  /** Faturamento só entra para quem tem acesso ao Financeiro. */
  includeFinance: boolean;
}

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

/**
 * Leads de anúncio por vendedor: quantos recebeu, quantos chegaram a agendar e
 * quantos ele deu por perdidos — inclusive quantas dessas perdas estão sem
 * objeção registrada, que é o que impede diagnosticar a diferença entre um
 * vendedor e outro.
 *
 * "Agendou" olha o histórico (`etapasAlcancadas`), não a etapa atual: quem
 * agendou e depois avançou ou caiu continua contando.
 */
function summarizeSellers(leads: AdLeadDetail[], funnel: FunnelStagePoint[]): SellerInput[] {
  if (leads.length === 0) return [];
  const agendadoKey = funnel.find((stage) => stage.key === "agendado")?.key ?? "agendado";
  const bySeller = new Map<string, SellerInput>();

  for (const lead of leads) {
    const key = lead.sellerName?.trim() || "";
    const current = bySeller.get(key) ?? {
      sellerName: key || null,
      leads: 0,
      agendados: 0,
      perdidos: 0,
      perdidosSemMotivo: 0,
    };
    current.leads += 1;
    if (lead.etapasAlcancadas.includes(agendadoKey)) current.agendados += 1;
    if (lead.stageKind === "lost") {
      current.perdidos += 1;
      if (!lead.lastObjection) current.perdidosSemMotivo += 1;
    }
    bySeller.set(key, current);
  }

  return Array.from(bySeller.values());
}

function periodBefore(from: string, to: string): { from: string; to: string } {
  const start = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  const end = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
  const days = Math.max(1, Math.round((end - start) / 86_400_000) + 1);
  const previousTo = shiftIsoDate(from, -1);
  return { from: shiftIsoDate(previousTo, -(days - 1)), to: previousTo };
}

function isMonthPeriod(from: string, to: string, today: string): boolean {
  const month = monthOfIsoDate(from);
  if (month !== monthOfIsoDate(to) || !from.endsWith("-01")) return false;
  return monthBounds(month, today).to === to;
}

function scopeRows(rows: AdRow[], options: CampaignReportOptions): AdRow[] {
  const allowedCampaigns = new Set(options.campaignIds);
  return rows.filter(
    (row) =>
      matchesPurposeFilter(row.campaignPurpose, options.purposeFilter) &&
      (allowedCampaigns.size === 0 || allowedCampaigns.has(row.campaignId)) &&
      (!options.adsetId || row.adsetId === options.adsetId)
  );
}

function hasAccountWideScope(options: CampaignReportOptions): boolean {
  return (
    options.filters.status === "all" &&
    !options.filters.search &&
    options.purposeFilter === "todas" &&
    options.campaignIds.length === 0 &&
    !options.adsetId
  );
}

function scopeLabel(options: CampaignReportOptions, ads: AdRow[], accountWide: boolean): string {
  if (accountWide) return "Conta inteira, incluindo campanhas pausadas";
  const campaigns = new Set(ads.map((row) => row.campaignId)).size;
  const parts = [`${campaigns} ${campaigns === 1 ? "campanha selecionada" : "campanhas selecionadas"}`];
  if (options.purposeFilter !== "todas") parts.push(options.purposeFilter === "captacao" ? "somente captação" : "somente engajamento");
  if (options.filters.status !== "all") parts.push(options.filters.status === "active" ? "somente ativas" : "somente inativas");
  if (options.filters.search) parts.push("busca aplicada");
  return parts.join(" · ");
}

/**
 * Gera o mesmo relatório apresentado no PDF, mas para qualquer faixa de
 * datas e para o recorte de campanhas escolhido na interface.
 *
 * A comparação usa o período imediatamente anterior com a mesma quantidade
 * de dias. Para um mês completo, mantém a comparação mensal tradicional.
 */
export async function loadCampaignReport(options: CampaignReportOptions): Promise<MonthlyReport> {
  const today = getMetaAdsToday();
  const { from, to } = options.filters;
  const currentMonth = monthOfIsoDate(from);
  const monthly = isMonthPeriod(from, to, today);
  const previousMonth = monthly ? shiftMonth(currentMonth, -1) : monthOfIsoDate(from);
  const previousBounds = monthly ? monthBounds(previousMonth, today) : periodBefore(from, to);
  const previousFilters: MetaAdsFilters = { ...options.filters, ...previousBounds };
  const accountWide = hasAccountWideScope(options);

  const [allAds, allPreviousAds, periodReach, financeTotals, rawEnrollmentOrigins] = await Promise.all([
    getAdsHierarchy(options.filters),
    getAdsHierarchy(previousFilters),
    // Só existe alcance deduplicado para a conta inteira. Em qualquer recorte
    // menor, não inventamos uma soma que a Meta não publica como única.
    accountWide ? getPeriodReach(from, to) : Promise.resolve(null),
    options.includeFinance && accountWide && monthly
      ? getMonthlyTotals(previousMonth, currentMonth).catch(() => [])
      : Promise.resolve([]),
    options.includeFinance ? getEnrollmentOrigins(from, to).catch(() => null) : Promise.resolve(null),
  ]);

  const ads = scopeRows(allAds, options);
  const previousAds = scopeRows(allPreviousAds, options);
  const selectedAdIds = new Set(ads.map((row) => row.adId));
  const conversionAdIds = ads.filter((row) => row.campaignPurpose !== "engajamento").map((row) => row.adId);

  const [series, funnel, leadDetails] = await Promise.all([
    getDailySeries(options.filters, ads.map((row) => row.adId)),
    getFunnelBreakdown(conversionAdIds, options.filters),
    // Horário de chegada e vendedor por lead: as duas seções que mostram onde a
    // operação (e não a mídia) está perdendo o lead.
    getAdLeadDetails(options.filters, conversionAdIds).catch(() => [] as AdLeadDetail[]),
  ]);

  const sellers = summarizeSellers(leadDetails, funnel);

  // Quando há filtros de campanha, uma matrícula de indicação ou de outra
  // campanha não pode aparecer como retorno do recorte escolhido.
  const enrollmentOrigins = rawEnrollmentOrigins
    ? summarizeEnrollmentOrigins(
        accountWide ? rawEnrollmentOrigins.rows : rawEnrollmentOrigins.rows.filter((row) => row.adId && selectedAdIds.has(row.adId))
      )
    : null;

  // A matrícula sabe o anúncio de origem; a campanha vem daqui. Usa a lista
  // completa (não a recortada) para uma venda de campanha filtrada fora ainda
  // ser reconhecida como venda de anúncio.
  const campaignByAd = new Map(allAds.map((row) => [row.adId, row.campaignId]));

  const periodLabel = monthly ? monthLabel(currentMonth) : reportPeriodLabel(from, to);
  const previousLabel = monthly ? monthLabel(previousMonth) : reportPeriodLabel(previousBounds.from, previousBounds.to);

  return buildMonthlyReport({
    // O campo continua sendo usado no nome do CSV; em um intervalo ele vira
    // uma chave estável, sem fingir que a faixa pertence a um único mês.
    month: monthly ? currentMonth : `${from}_a_${to}`,
    periodLabel,
    from,
    to,
    parcial: to >= today,
    scopeLabel: scopeLabel(options, ads, accountWide),
    reachIsDeduplicated: accountWide,
    ads,
    previousAds,
    previousMonth,
    previousPeriodLabel: previousLabel,
    series,
    funnel,
    finance: financeFrom(currentMonth, financeTotals),
    previousFinance: financeFrom(previousMonth, financeTotals),
    arrival: leadDetails.map((lead) => ({ hora: lead.hora, diaSemana: lead.diaSemana })),
    sellers,
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
            // A venda guarda o anúncio; a campanha sai daqui, que é a mesma
            // hierarquia usada no gasto — assim receita e investimento caem na
            // mesma linha da tabela.
            campaignId: row.adId ? campaignByAd.get(row.adId) ?? null : null,
            adName: row.adName,
            course: row.course,
            seller: row.seller,
            linkKind: row.linkKind,
          })),
        }
      : null,
  });
}
