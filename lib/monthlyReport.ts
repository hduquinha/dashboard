import { costPer } from "@/lib/adDestinationGroups";
import { readableCampaignName } from "@/lib/metaAdsLabels";
import type { AdRow, CampaignPurpose, DailySeriesPoint, FunnelStagePoint, PeriodReachData } from "@/types/metaAds";

/**
 * Relatório mensal de mídia para apresentar aos sócios: quanto entrou de
 * dinheiro em anúncio no mês e o que voltou.
 *
 * Três regras seguram este arquivo:
 *
 * 1. **Conversão e engajamento nunca se somam numa média.** Campanha de
 *    engajamento não tem formulário; jogá-la no custo por lead da conta faz o
 *    mês parecer pior do que foi. Cada bloco tem investimento, resultado e
 *    custo próprios, e o total só aparece como soma explícita dos dois.
 * 2. **Retorno em reais é declaradamente uma estimativa** enquanto o valor da
 *    venda não estiver no CRM. O relatório usa o valor real quando ele existe
 *    (`AdRow.valorFechado`) e só cai no ticket médio informado quando não
 *    existe — sempre dizendo qual das duas bases usou.
 * 3. **O que o Financeiro registrou é contexto, não atribuição.** Hoje nenhuma
 *    receita tem vínculo com lead (`finance_revenues.lead_inscricao_id`), então
 *    o faturamento do mês entra num bloco à parte, sem afirmar que veio dos
 *    anúncios.
 */

export const REPORT_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isReportMonth(value: string | null | undefined): boolean {
  return typeof value === "string" && REPORT_MONTH_PATTERN.test(value);
}

/** "2026-07-15" → "2026-07". */
export function monthOfIsoDate(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/** Soma meses trabalhando só com números — sem Date, sem fuso no meio. */
export function shiftMonth(month: string, delta: number): string {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1 + delta;
  const nextYear = year + Math.floor(index / 12);
  const nextMonth = ((index % 12) + 12) % 12;
  return `${nextYear}-${String(nextMonth + 1).padStart(2, "0")}`;
}

function daysInMonth(month: string): number {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  // Dia 0 do mês seguinte = último dia deste mês.
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

/** Primeiro e último dia do mês. O fim é limitado a `today` para o mês
 * corrente não prometer dias que ainda não aconteceram. */
export function monthBounds(month: string, today?: string): { from: string; to: string } {
  const from = `${month}-01`;
  const to = `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
  if (today && today >= from && today < to) return { from, to: today };
  return { from, to };
}

const MONTH_NAMES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

/** "2026-07" → "Julho de 2026". */
export function monthLabel(month: string): string {
  const name = MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month;
  return `${name} de ${month.slice(0, 4)}`;
}

/** Variação percentual entre dois períodos; null quando não há base (mês
 * anterior sem dado ou com zero, onde "+∞%" não informa nada). */
export function deltaPct(current: number, previous: number | null | undefined): number | null {
  if (previous === null || previous === undefined || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export interface ReportDelta {
  current: number;
  previous: number | null;
  deltaPct: number | null;
  /** true quando cair é bom (custo por lead, por exemplo). */
  lowerIsBetter?: boolean;
}

function delta(current: number, previous: number | null, lowerIsBetter = false): ReportDelta {
  return { current, previous, deltaPct: deltaPct(current, previous), lowerIsBetter };
}

export interface ReportCampaignLine {
  campaignId: string;
  label: string;
  rawName: string;
  purpose: CampaignPurpose;
  spend: number;
  /** Fatia do investimento do próprio bloco (conversão ou engajamento), 0–100. */
  sharePct: number;
  impressions: number;
  reach: number;
  clicks: number;
  cadastros: number;
  pessoas: number;
  custoPorCadastro: number | null;
  interacoes: number;
  videoViews: number;
  custoPorInteracao: number | null;
}

export interface InvestmentSection {
  total: number;
  conversao: number;
  engajamento: number;
  /** Campanhas com objetivo que o mapa ainda não conhece; entram em conversão
   * (comportamento seguro) mas ficam visíveis aqui. */
  outrosObjetivos: number;
  shareEngajamentoPct: number | null;
  diasComEntrega: number;
  mediaDiaria: number | null;
  maiorDia: { date: string; spend: number } | null;
  menorDia: { date: string; spend: number } | null;
  /** Dias em que houve gasto e nenhum cadastro entrou. */
  diasSemCadastro: number;
  gastoSemCadastro: number;
}

export interface ConversionSection {
  spend: number;
  cadastros: number;
  pessoas: number;
  leadsMeta: number;
  impressions: number;
  clicks: number;
  ctr: number | null;
  cpm: number | null;
  custoPorCadastro: number | null;
  custoPorPessoa: number | null;
  funnel: FunnelStagePoint[];
  agendados: number;
  agendadoLabel: string | null;
  ganhos: number;
  ganhoLabel: string | null;
  perdidos: number;
  taxaAgendamento: number | null;
  taxaGanho: number | null;
  campanhas: ReportCampaignLine[];
  melhorCampanha: ReportCampaignLine | null;
  piorCampanha: ReportCampaignLine | null;
  /** Pareto: quantas campanhas respondem por 80% dos cadastros. */
  concentracao: { campanhas: number; total: number; sharePct: number } | null;
  semCadastro: { campanhas: number; spend: number };
}

export interface EngagementSection {
  spend: number;
  impressions: number;
  reach: number;
  frequency: number | null;
  videoViews: number;
  interacoes: number;
  reactions: number;
  comments: number;
  shares: number;
  saves: number;
  messagingStarted: number;
  cpm: number | null;
  custoPorInteracao: number | null;
  custoPorVideoView: number | null;
  custoPorMilPessoas: number | null;
  campanhas: ReportCampaignLine[];
}

/** De onde saiu o número de retorno: matrícula de fato registrada e conciliada
 * com um lead de anúncio (`matricula`), valor de fechamento preenchido no CRM
 * (`crm`) ou nada medido (`sem_base`). Estimativa NUNCA é retorno — ela vive no
 * campo `potencial`. */
export type ReturnBasis = "matricula" | "crm" | "sem_base";

/** Oportunidade de anúncio que já avançou no funil mas ainda não virou
 * matrícula registrada. É o "pode virar", nunca o "voltou". */
export interface PipelinePotential {
  oportunidades: number;
  stageKey: string | null;
  stageLabel: string;
  ticketMedio: number | null;
  ticketOrigem: "informado" | "financeiro" | "nenhum";
  valor: number | null;
}

export interface FinancialSection {
  /** Matrículas do mês conciliadas com lead vindo de anúncio. */
  matriculasDeAnuncio: number;
  /** Total de matrículas do mês, de qualquer origem (denominador honesto). */
  matriculasNoMes: number;
  /** Faturamento contratado das matrículas atribuídas a anúncio. */
  retornoMedido: number;
  /** Soma de `closed_value` dos leads de anúncio ganhos — hoje vem zerada. */
  valorFechadoCrm: number;
  basis: ReturnBasis;
  retorno: number | null;
  investimento: number;
  /** Retorno ÷ investimento; só existe quando há retorno medido. */
  roas: number | null;
  roiPct: number | null;
  /** Custo de mídia por matrícula atribuída a anúncio. */
  custoPorMatricula: number | null;
  /** O funil andou, mas ainda não virou matrícula: o "em aberto". */
  potencial: PipelinePotential;
  /** true quando o CRM tem oportunidade ganha de anúncio e o Financeiro não
   * registrou matrícula correspondente — a divergência que faz o relatório
   * parecer otimista demais. */
  divergenciaCrmFinanceiro: boolean;
}

export interface FinanceContextInput {
  month: string;
  /** Dinheiro que entrou no mês (regime de caixa). */
  recebido: number;
  /** Parcelas com competência no mês, canceladas fora. */
  previsto: number;
  matriculas: number;
  valorContratado: number;
}

/** Cada matrícula do mês com a origem que a conciliação conseguiu provar. */
export interface EnrollmentOriginInput {
  total: number;
  totalAmount: number;
  anuncio: { count: number; amount: number };
  crmSemAnuncio: { count: number; amount: number };
  semCadastro: { count: number; amount: number };
  rows: Array<{
    student: string;
    amount: number;
    saleDate: string;
    kind: "anuncio" | "crm_sem_anuncio" | "sem_cadastro";
    leadOrigem: string | null;
    campaignName: string | null;
  }>;
}

export interface FinanceContextSection extends FinanceContextInput {
  ticketMedioMatricula: number | null;
  recebidoAnterior: number | null;
  matriculasAnterior: number | null;
  /** Null quando a conciliação não pôde ser feita (sem acesso ao Financeiro). */
  origens: EnrollmentOriginInput | null;
}

export interface ReportHighlight {
  text: string;
  tone: "neutral" | "good" | "warn";
}

export interface MonthlyReportComparison {
  previousMonth: string;
  investimento: ReportDelta;
  investimentoConversao: ReportDelta;
  investimentoEngajamento: ReportDelta;
  cadastros: ReportDelta;
  custoPorCadastro: ReportDelta;
  pessoas: ReportDelta;
  ganhos: ReportDelta;
  impressoes: ReportDelta;
  interacoes: ReportDelta;
}

export interface MonthlyReport {
  month: string;
  monthLabel: string;
  from: string;
  to: string;
  parcial: boolean;
  investment: InvestmentSection;
  conversion: ConversionSection;
  engagement: EngagementSection;
  financial: FinancialSection;
  financeContext: FinanceContextSection | null;
  comparison: MonthlyReportComparison | null;
  highlights: ReportHighlight[];
}

export interface MonthlyReportInput {
  month: string;
  from: string;
  to: string;
  /** Mês corrente ainda em andamento: o relatório avisa que é parcial. */
  parcial: boolean;
  ads: AdRow[];
  previousAds: AdRow[] | null;
  previousMonth: string | null;
  series: DailySeriesPoint[];
  /** Funil cumulativo dos anúncios de conversão do mês. */
  funnel: FunnelStagePoint[];
  finance: FinanceContextInput | null;
  previousFinance: FinanceContextInput | null;
  /** Ticket médio informado pelo usuário para dimensionar o potencial. */
  ticketMedio: number | null;
  /** Etapa do funil que a operação considera "venda fechada". */
  saleStageKey: string | null;
  /** Conciliação matrícula → lead → anúncio; null sem acesso ao Financeiro. */
  enrollmentOrigins: EnrollmentOriginInput | null;
  /** Alcance deduplicado da Meta no mês, por campanha. Sem ele o relatório cai
   * na soma dos anúncios, que conta a mesma pessoa uma vez por dia e por peça
   * (ver lib/periodReach.ts). */
  periodReach: PeriodReachData | null;
}

/** Engajamento é o bloco de "aparecer"; todo o resto (inclusive objetivo
 * desconhecido) é tratado como conversão, igual ao filtro da tela. */
function isEngagement(row: { campaignPurpose: CampaignPurpose }): boolean {
  return row.campaignPurpose === "engajamento";
}

function sum<T>(rows: T[], pick: (row: T) => number): number {
  return rows.reduce((total, row) => total + pick(row), 0);
}

/** Interações da publicação: o mesmo número que a aba Alcance mostra. */
function interacoes(row: AdRow): number {
  return row.postEngagement;
}

function buildCampaignLines(rows: AdRow[], periodReach: PeriodReachData | null): ReportCampaignLine[] {
  const byCampaign = new Map<string, AdRow[]>();
  for (const row of rows) {
    const list = byCampaign.get(row.campaignId);
    if (list) list.push(row);
    else byCampaign.set(row.campaignId, [row]);
  }

  const totalSpend = sum(rows, (row) => row.spend);
  const lines: ReportCampaignLine[] = [];
  for (const [campaignId, ads] of byCampaign) {
    const spend = sum(ads, (row) => row.spend);
    const cadastros = sum(ads, (row) => row.cadastrosCrm);
    const interacoesTotal = sum(ads, interacoes);
    lines.push({
      campaignId,
      label: readableCampaignName(ads[0].campaignName),
      rawName: ads[0].campaignName,
      purpose: ads[0].campaignPurpose,
      spend,
      sharePct: totalSpend > 0 ? (spend / totalSpend) * 100 : 0,
      impressions: sum(ads, (row) => row.impressions),
      reach: periodReach?.byCampaign[campaignId]?.reach ?? sum(ads, (row) => row.reach),
      clicks: sum(ads, (row) => row.clicks),
      cadastros,
      pessoas: sum(ads, (row) => row.novos),
      custoPorCadastro: costPer(spend, cadastros),
      interacoes: interacoesTotal,
      videoViews: sum(ads, (row) => row.videoViews),
      custoPorInteracao: costPer(spend, interacoesTotal),
    });
  }

  return lines.sort((a, b) => b.spend - a.spend);
}

function stageCount(funnel: FunnelStagePoint[], key: string | null): number {
  if (!key) return 0;
  return funnel.find((stage) => stage.key === key)?.count ?? 0;
}

function findStage(funnel: FunnelStagePoint[], predicate: (stage: FunnelStagePoint) => boolean) {
  return funnel.find(predicate) ?? null;
}

function buildInvestment(ads: AdRow[], series: DailySeriesPoint[]): InvestmentSection {
  const conversionAds = ads.filter((row) => !isEngagement(row));
  const engagementAds = ads.filter(isEngagement);
  const total = sum(ads, (row) => row.spend);
  const engajamento = sum(engagementAds, (row) => row.spend);

  const spendDays = series.filter((point) => point.spend > 0);
  const semCadastro = spendDays.filter((point) => point.cadastrosCrm === 0);
  const sorted = [...spendDays].sort((a, b) => b.spend - a.spend);

  return {
    total,
    conversao: sum(conversionAds, (row) => row.spend),
    engajamento,
    outrosObjetivos: sum(
      ads.filter((row) => row.campaignPurpose === "outro"),
      (row) => row.spend
    ),
    shareEngajamentoPct: total > 0 ? (engajamento / total) * 100 : null,
    diasComEntrega: spendDays.length,
    mediaDiaria: spendDays.length > 0 ? total / spendDays.length : null,
    maiorDia: sorted[0] ? { date: sorted[0].date, spend: sorted[0].spend } : null,
    menorDia: sorted.length > 1 ? { date: sorted[sorted.length - 1].date, spend: sorted[sorted.length - 1].spend } : null,
    diasSemCadastro: semCadastro.length,
    gastoSemCadastro: semCadastro.reduce((totalSpend, point) => totalSpend + point.spend, 0),
  };
}

/** Quantas campanhas respondem por 80% dos cadastros do mês (Pareto). */
function buildConcentration(lines: ReportCampaignLine[]): ConversionSection["concentracao"] {
  const withLeads = lines.filter((line) => line.cadastros > 0).sort((a, b) => b.cadastros - a.cadastros);
  const total = withLeads.reduce((totalLeads, line) => totalLeads + line.cadastros, 0);
  if (total === 0 || withLeads.length < 2) return null;

  let accumulated = 0;
  let count = 0;
  for (const line of withLeads) {
    accumulated += line.cadastros;
    count += 1;
    if ((accumulated / total) * 100 >= 80) break;
  }
  return { campanhas: count, total: withLeads.length, sharePct: (accumulated / total) * 100 };
}

function buildConversion(ads: AdRow[], funnel: FunnelStagePoint[], periodReach: PeriodReachData | null): ConversionSection {
  const rows = ads.filter((row) => !isEngagement(row));
  const spend = sum(rows, (row) => row.spend);
  const cadastros = sum(rows, (row) => row.cadastrosCrm);
  const pessoas = sum(rows, (row) => row.novos);
  const impressions = sum(rows, (row) => row.impressions);
  const clicks = sum(rows, (row) => row.clicks);

  const lines = buildCampaignLines(rows, periodReach);
  const ranked = lines
    .filter((line) => line.custoPorCadastro !== null)
    .sort((a, b) => (a.custoPorCadastro ?? 0) - (b.custoPorCadastro ?? 0));
  const semCadastro = lines.filter((line) => line.cadastros === 0 && line.spend > 0);

  const agendadoStage = findStage(funnel, (stage) => stage.key === "agendado");
  const ganhoStage = findStage(funnel, (stage) => stage.kind === "won");
  const perdidoStage = findStage(funnel, (stage) => stage.kind === "lost");
  const agendados = agendadoStage?.count ?? 0;
  const ganhos = ganhoStage?.count ?? 0;

  return {
    spend,
    cadastros,
    pessoas,
    leadsMeta: sum(rows, (row) => row.leadsMeta),
    impressions,
    clicks,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : null,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : null,
    custoPorCadastro: costPer(spend, cadastros),
    custoPorPessoa: costPer(spend, pessoas),
    funnel,
    agendados,
    agendadoLabel: agendadoStage?.label ?? null,
    ganhos,
    ganhoLabel: ganhoStage?.label ?? null,
    perdidos: perdidoStage?.count ?? 0,
    // A base é "pessoas" (as inéditas), não "cadastros": quem já era da base
    // voltou para um card que já existia, então dividir pelo total de
    // formulários enviados subestimaria a taxa.
    taxaAgendamento: pessoas > 0 ? (agendados / pessoas) * 100 : null,
    taxaGanho: pessoas > 0 ? (ganhos / pessoas) * 100 : null,
    campanhas: lines,
    melhorCampanha: ranked[0] ?? null,
    piorCampanha: ranked.length > 1 ? ranked[ranked.length - 1] : null,
    concentracao: buildConcentration(lines),
    semCadastro: { campanhas: semCadastro.length, spend: semCadastro.reduce((total, line) => total + line.spend, 0) },
  };
}

function buildEngagement(ads: AdRow[], periodReach: PeriodReachData | null): EngagementSection {
  const rows = ads.filter(isEngagement);
  const spend = sum(rows, (row) => row.spend);
  const impressions = sum(rows, (row) => row.impressions);
  const campanhas = buildCampaignLines(rows, periodReach);
  // Alcance por campanha já vem deduplicado da Meta; o total do bloco soma
  // essas campanhas (quem viu duas delas ainda conta duas vezes, mas some a
  // duplicação por dia e por peça, que é a maior parte do erro).
  const reach = sum(campanhas, (line) => line.reach);
  const interacoesTotal = sum(rows, interacoes);
  const videoViews = sum(rows, (row) => row.videoViews);

  return {
    spend,
    impressions,
    reach,
    frequency: reach > 0 ? impressions / reach : null,
    videoViews,
    interacoes: interacoesTotal,
    reactions: sum(rows, (row) => row.reactions),
    comments: sum(rows, (row) => row.comments),
    shares: sum(rows, (row) => row.shares),
    saves: sum(rows, (row) => row.saves),
    messagingStarted: sum(rows, (row) => row.messagingStarted),
    cpm: impressions > 0 ? (spend / impressions) * 1000 : null,
    custoPorInteracao: costPer(spend, interacoesTotal),
    custoPorVideoView: costPer(spend, videoViews),
    custoPorMilPessoas: reach > 0 ? (spend / reach) * 1000 : null,
    campanhas,
  };
}

/**
 * Retorno = matrícula registrada, conciliada com um lead de anúncio. Etapa do
 * funil NÃO é receita: um lead de anúncio marcado como ganho no CRM sem
 * matrícula correspondente no Financeiro é oportunidade em aberto, e entra em
 * `potencial` com o ticket como cenário — não no retorno.
 */
function buildFinancial(
  ads: AdRow[],
  funnel: FunnelStagePoint[],
  conversion: ConversionSection,
  investimento: number,
  ticketMedio: number | null,
  ticketFinanceiro: number | null,
  saleStageKey: string | null,
  origins: EnrollmentOriginInput | null
): FinancialSection {
  const wonStage = findStage(funnel, (stage) => stage.kind === "won");
  const stageKey = saleStageKey ?? wonStage?.key ?? null;
  const stage = funnel.find((item) => item.key === stageKey) ?? wonStage;
  const oportunidades = stageKey ? stageCount(funnel, stageKey) : conversion.ganhos;

  const valorFechadoCrm = sum(
    ads.filter((row) => !isEngagement(row)),
    (row) => row.valorFechado
  );

  const matriculasDeAnuncio = origins?.anuncio.count ?? 0;
  const retornoMedido = origins?.anuncio.amount ?? 0;

  const ticket = ticketMedio && ticketMedio > 0 ? ticketMedio : ticketFinanceiro;
  const ticketOrigem: PipelinePotential["ticketOrigem"] =
    ticketMedio && ticketMedio > 0 ? "informado" : ticketFinanceiro ? "financeiro" : "nenhum";

  let basis: ReturnBasis = "sem_base";
  let retorno: number | null = null;
  if (retornoMedido > 0) {
    basis = "matricula";
    retorno = retornoMedido;
  } else if (valorFechadoCrm > 0) {
    basis = "crm";
    retorno = valorFechadoCrm;
  }

  return {
    matriculasDeAnuncio,
    matriculasNoMes: origins?.total ?? 0,
    retornoMedido,
    valorFechadoCrm,
    basis,
    retorno,
    investimento,
    roas: retorno !== null && investimento > 0 ? retorno / investimento : null,
    roiPct: retorno !== null && investimento > 0 ? ((retorno - investimento) / investimento) * 100 : null,
    custoPorMatricula: costPer(investimento, matriculasDeAnuncio),
    potencial: {
      oportunidades,
      stageKey,
      stageLabel: stage?.label ?? "Ganho",
      ticketMedio: ticket ?? null,
      ticketOrigem,
      valor: ticket && ticket > 0 && oportunidades > 0 ? ticket * oportunidades : null,
    },
    divergenciaCrmFinanceiro: oportunidades > 0 && matriculasDeAnuncio === 0 && origins !== null,
  };
}

function buildComparison(
  previousMonth: string | null,
  previousAds: AdRow[] | null,
  current: { investment: InvestmentSection; conversion: ConversionSection; engagement: EngagementSection }
): MonthlyReportComparison | null {
  if (!previousMonth || !previousAds || previousAds.length === 0) return null;

  const prevConversion = previousAds.filter((row) => !isEngagement(row));
  const prevEngagement = previousAds.filter(isEngagement);
  const prevSpend = sum(previousAds, (row) => row.spend);
  const prevConversionSpend = sum(prevConversion, (row) => row.spend);
  const prevCadastros = sum(prevConversion, (row) => row.cadastrosCrm);

  // O mês anterior à primeira campanha ainda devolve linhas de anúncio (a
  // estrutura existe, os insights é que não), e comparar com ele encheria a
  // tela de "sem base para comparar". Sem entrega nem cadastro, não houve mês
  // anterior — e o relatório fica sem coluna de comparação, como deve.
  if (prevSpend === 0 && prevCadastros === 0) return null;
  const prevCusto = costPer(prevConversionSpend, prevCadastros);
  const prevGanhos = sum(prevConversion, (row) => row.leadsFechados);

  return {
    previousMonth,
    investimento: delta(current.investment.total, prevSpend),
    investimentoConversao: delta(current.conversion.spend, prevConversionSpend),
    investimentoEngajamento: delta(current.engagement.spend, sum(prevEngagement, (row) => row.spend)),
    cadastros: delta(current.conversion.cadastros, prevCadastros),
    custoPorCadastro: delta(current.conversion.custoPorCadastro ?? 0, prevCusto, true),
    pessoas: delta(current.conversion.pessoas, sum(prevConversion, (row) => row.novos)),
    ganhos: delta(current.conversion.ganhos, prevGanhos),
    impressoes: delta(
      current.conversion.impressions + current.engagement.impressions,
      sum(previousAds, (row) => row.impressions)
    ),
    interacoes: delta(current.engagement.interacoes, sum(prevEngagement, interacoes)),
  };
}

function money(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
}

function count(value: number): string {
  return value.toLocaleString("pt-BR");
}

function pct(value: number | null, digits = 1): string {
  return value === null ? "—" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: digits })}%`;
}

function plural(value: number, singular: string, pluralWord: string): string {
  return value === 1 ? singular : pluralWord;
}

/** Os "pontos" do relatório: as frases que a pessoa lê em voz alta na reunião.
 * Cada uma nasce de um número já calculado acima — nenhuma conclusão aqui é
 * inventada, e nada que não pôde ser medido vira frase afirmativa. */
function buildHighlights(report: Omit<MonthlyReport, "highlights">): ReportHighlight[] {
  const { investment, conversion, engagement, financial, financeContext, comparison } = report;
  const points: ReportHighlight[] = [];

  const variacao =
    comparison?.investimento.deltaPct !== null && comparison?.investimento.deltaPct !== undefined
      ? ` (${comparison.investimento.deltaPct >= 0 ? "+" : ""}${pct(comparison.investimento.deltaPct)} vs. ${monthLabel(comparison.previousMonth).toLocaleLowerCase("pt-BR")})`
      : "";
  points.push({
    tone: "neutral",
    text: `Investimos ${money(investment.total)} em anúncios em ${report.monthLabel.toLocaleLowerCase("pt-BR")}${variacao}: ${money(investment.conversao)} em campanhas de conversão e ${money(investment.engajamento)} em engajamento.`,
  });

  if (investment.mediaDiaria !== null) {
    points.push({
      tone: "neutral",
      text: `A verba rodou em ${count(investment.diasComEntrega)} ${plural(investment.diasComEntrega, "dia", "dias")}, média de ${money(investment.mediaDiaria)} por dia.`,
    });
  }

  if (conversion.cadastros > 0) {
    points.push({
      tone: "good",
      text: `As campanhas de conversão trouxeram ${count(conversion.cadastros)} ${plural(conversion.cadastros, "cadastro", "cadastros")} (${count(conversion.pessoas)} ${plural(conversion.pessoas, "pessoa nova", "pessoas novas")} no CRM) a ${conversion.custoPorCadastro === null ? "—" : money(conversion.custoPorCadastro)} por cadastro.`,
    });
  } else if (conversion.spend > 0) {
    points.push({
      tone: "warn",
      text: `As campanhas de conversão gastaram ${money(conversion.spend)} e não trouxeram nenhum cadastro no mês.`,
    });
  }

  if (comparison?.custoPorCadastro.deltaPct !== null && comparison?.custoPorCadastro.deltaPct !== undefined) {
    const caiu = comparison.custoPorCadastro.deltaPct < 0;
    points.push({
      tone: caiu ? "good" : "warn",
      text: `O custo por cadastro ${caiu ? "caiu" : "subiu"} ${pct(Math.abs(comparison.custoPorCadastro.deltaPct))} em relação a ${monthLabel(comparison.previousMonth).toLocaleLowerCase("pt-BR")} (de ${money(comparison.custoPorCadastro.previous ?? 0)} para ${money(comparison.custoPorCadastro.current)}).`,
    });
  }

  if (conversion.agendados > 0 && conversion.taxaAgendamento !== null) {
    points.push({
      tone: "neutral",
      text: `Do que entrou, ${count(conversion.agendados)} ${plural(conversion.agendados, "pessoa chegou", "pessoas chegaram")} a "${conversion.agendadoLabel ?? "Agendado"}" — ${pct(conversion.taxaAgendamento)} das pessoas novas.`,
    });
  }

  if (conversion.melhorCampanha?.custoPorCadastro != null) {
    points.push({
      tone: "good",
      text: `Campanha mais eficiente: ${conversion.melhorCampanha.label}, a ${money(conversion.melhorCampanha.custoPorCadastro)} por cadastro (${count(conversion.melhorCampanha.cadastros)} ${plural(conversion.melhorCampanha.cadastros, "cadastro", "cadastros")} com ${money(conversion.melhorCampanha.spend)}).`,
    });
  }
  if (conversion.piorCampanha?.custoPorCadastro != null) {
    points.push({
      tone: "warn",
      text: `A mais cara foi ${conversion.piorCampanha.label}, a ${money(conversion.piorCampanha.custoPorCadastro)} por cadastro — ${money(conversion.piorCampanha.spend)} para ${count(conversion.piorCampanha.cadastros)} ${plural(conversion.piorCampanha.cadastros, "cadastro", "cadastros")}.`,
    });
  }

  if (conversion.concentracao) {
    points.push({
      tone: "neutral",
      text: `${count(conversion.concentracao.campanhas)} de ${count(conversion.concentracao.total)} campanhas respondem por ${pct(conversion.concentracao.sharePct, 0)} dos cadastros.`,
    });
  }

  if (conversion.semCadastro.campanhas > 0) {
    points.push({
      tone: "warn",
      text: `${count(conversion.semCadastro.campanhas)} ${plural(conversion.semCadastro.campanhas, "campanha gastou", "campanhas gastaram")} ${money(conversion.semCadastro.spend)} sem trazer nenhum cadastro.`,
    });
  }

  if (investment.diasSemCadastro > 0) {
    points.push({
      tone: "warn",
      text: `Houve ${count(investment.diasSemCadastro)} ${plural(investment.diasSemCadastro, "dia", "dias")} com gasto e nenhum cadastro, somando ${money(investment.gastoSemCadastro)}.`,
    });
  }

  if (engagement.spend > 0) {
    points.push({
      tone: "neutral",
      text: `O engajamento consumiu ${money(engagement.spend)} (${pct(investment.shareEngajamentoPct, 0)} da verba) e entregou ${count(engagement.impressions)} ${plural(engagement.impressions, "impressão", "impressões")} para ${count(engagement.reach)} ${plural(engagement.reach, "pessoa", "pessoas")}, com ${count(engagement.interacoes)} ${plural(engagement.interacoes, "interação", "interações")} a ${engagement.custoPorInteracao === null ? "—" : money(engagement.custoPorInteracao)} cada.`,
    });
    points.push({
      tone: "neutral",
      text: `Engajamento não tem formulário: ele não entra em nenhuma conta de custo por lead deste relatório.`,
    });
  }

  if (financial.basis === "matricula" && financial.retorno !== null) {
    points.push({
      tone: "good",
      text: `Retorno medido: ${count(financial.matriculasDeAnuncio)} de ${count(financial.matriculasNoMes)} ${plural(financial.matriculasNoMes, "matrícula do mês veio", "matrículas do mês vieram")} de anúncio, somando ${money(financial.retorno)} contratados — ${financial.roas === null ? "—" : `${financial.roas.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}× o investido em captação`}.`,
    });
  } else if (financial.basis === "crm" && financial.retorno !== null) {
    points.push({
      tone: "good",
      text: `Retorno registrado no CRM: ${money(financial.retorno)} em valores de fechamento de leads de anúncio. Nenhuma matrícula do mês pôde ser conciliada com esses leads no Financeiro.`,
    });
  } else if (financial.matriculasNoMes > 0) {
    points.push({
      tone: "warn",
      text: `Nenhuma das ${count(financial.matriculasNoMes)} ${plural(financial.matriculasNoMes, "matrícula do mês veio", "matrículas do mês veio")} de anúncio: o retorno de mídia medido em reais no mês é ${money(0)}.`,
    });
  } else {
    points.push({
      tone: "warn",
      text: `Nenhuma matrícula foi registrada no mês, então não há retorno de mídia em reais para apurar.`,
    });
  }

  if (financial.divergenciaCrmFinanceiro && financial.potencial.oportunidades > 0) {
    points.push({
      tone: "warn",
      text: `Atenção à divergência: ${count(financial.potencial.oportunidades)} ${plural(financial.potencial.oportunidades, "lead de anúncio chegou", "leads de anúncio chegaram")} à etapa "${financial.potencial.stageLabel}" no CRM, mas nenhuma matrícula correspondente foi registrada no Financeiro. Ou a venda não fechou de fato, ou não foi lançada.`,
    });
  }

  if (financial.potencial.valor !== null) {
    points.push({
      tone: "neutral",
      text: `Potencial em aberto: ${count(financial.potencial.oportunidades)} ${plural(financial.potencial.oportunidades, "oportunidade de anúncio", "oportunidades de anúncio")} na etapa "${financial.potencial.stageLabel}" × ticket de ${money(financial.potencial.ticketMedio ?? 0)} = ${money(financial.potencial.valor)} se todas fecharem. É cenário, não receita.`,
    });
  }

  if (financeContext?.origens) {
    const { origens } = financeContext;
    const partes: string[] = [];
    if (origens.anuncio.count > 0) partes.push(`${count(origens.anuncio.count)} de anúncio`);
    if (origens.crmSemAnuncio.count > 0) partes.push(`${count(origens.crmSemAnuncio.count)} de lead do CRM sem anúncio`);
    if (origens.semCadastro.count > 0)
      partes.push(`${count(origens.semCadastro.count)} sem cadastro no CRM (venda fora do funil digital: indicação, boca a boca, presencial)`);
    points.push({
      tone: "neutral",
      text: `As ${count(financeContext.matriculas)} ${plural(financeContext.matriculas, "matrícula do mês", "matrículas do mês")} (${money(financeContext.valorContratado)} contratados) se dividem em: ${partes.join("; ")}. A conciliação é por nome — o Financeiro ainda não guarda o lead de origem.`,
    });
  } else if (financeContext) {
    points.push({
      tone: "neutral",
      text: `No Financeiro, o mês registrou ${count(financeContext.matriculas)} ${plural(financeContext.matriculas, "matrícula", "matrículas")} (${money(financeContext.valorContratado)} contratados) e ${money(financeContext.recebido)} efetivamente recebidos, de todas as origens.`,
    });
  }

  return points;
}

export function buildMonthlyReport(input: MonthlyReportInput): MonthlyReport {
  const investment = buildInvestment(input.ads, input.series);
  const conversion = buildConversion(input.ads, input.funnel, input.periodReach);
  const engagement = buildEngagement(input.ads, input.periodReach);

  const ticketFinanceiro =
    input.finance && input.finance.matriculas > 0 ? input.finance.valorContratado / input.finance.matriculas : null;

  const financial = buildFinancial(
    input.ads,
    input.funnel,
    conversion,
    // O retorno é comparado com a mídia que existe para vender: o engajamento
    // tem outro objetivo e é cobrado por outros números.
    conversion.spend,
    input.ticketMedio,
    ticketFinanceiro,
    input.saleStageKey,
    input.enrollmentOrigins
  );

  const financeContext: FinanceContextSection | null = input.finance
    ? {
        ...input.finance,
        ticketMedioMatricula: ticketFinanceiro,
        recebidoAnterior: input.previousFinance?.recebido ?? null,
        matriculasAnterior: input.previousFinance?.matriculas ?? null,
        origens: input.enrollmentOrigins,
      }
    : null;

  const comparison = buildComparison(input.previousMonth, input.previousAds, { investment, conversion, engagement });

  const base: Omit<MonthlyReport, "highlights"> = {
    month: input.month,
    monthLabel: monthLabel(input.month),
    from: input.from,
    to: input.to,
    parcial: input.parcial,
    investment,
    conversion,
    engagement,
    financial,
    financeContext,
    comparison,
  };

  return { ...base, highlights: buildHighlights(base) };
}

/** Versão em texto para colar em e-mail, WhatsApp ou ata da reunião — os
 * mesmos números da tela, sem depender de imprimir. */
export function buildReportText(report: MonthlyReport): string {
  const lines: string[] = [];
  lines.push(`RELATÓRIO DE MÍDIA — ${report.monthLabel.toLocaleUpperCase("pt-BR")}`);
  lines.push(
    `Período: ${report.from.split("-").reverse().join("/")} a ${report.to.split("-").reverse().join("/")}${report.parcial ? " (mês em andamento)" : ""}`
  );
  lines.push("");

  lines.push("RESUMO");
  for (const point of report.highlights) lines.push(`• ${point.text}`);
  lines.push("");

  lines.push("INVESTIMENTO");
  lines.push(`• Total: ${money(report.investment.total)}`);
  lines.push(`• Conversão: ${money(report.investment.conversao)}`);
  lines.push(`• Engajamento: ${money(report.investment.engajamento)}`);
  lines.push("");

  lines.push("CONVERSÃO (campanhas com formulário)");
  lines.push(`• Cadastros: ${count(report.conversion.cadastros)}`);
  lines.push(`• Pessoas novas no CRM: ${count(report.conversion.pessoas)}`);
  lines.push(
    `• Custo por cadastro: ${report.conversion.custoPorCadastro === null ? "—" : money(report.conversion.custoPorCadastro)}`
  );
  for (const stage of report.conversion.funnel) {
    lines.push(`• ${stage.label}: ${count(stage.count)}`);
  }
  for (const line of report.conversion.campanhas) {
    lines.push(
      `   - ${line.label}: ${money(line.spend)} · ${count(line.cadastros)} ${plural(line.cadastros, "cadastro", "cadastros")} · ${line.custoPorCadastro === null ? "—" : money(line.custoPorCadastro)} por cadastro`
    );
  }
  lines.push("");

  if (report.engagement.spend > 0) {
    lines.push("ENGAJAMENTO (campanhas de aparecer — não geram lead)");
    lines.push(`• Investimento: ${money(report.engagement.spend)}`);
    lines.push(`• Impressões: ${count(report.engagement.impressions)}`);
    lines.push(`• Pessoas alcançadas: ${count(report.engagement.reach)}`);
    lines.push(`• Interações: ${count(report.engagement.interacoes)}`);
    lines.push(
      `• Custo por interação: ${report.engagement.custoPorInteracao === null ? "—" : money(report.engagement.custoPorInteracao)}`
    );
    lines.push("");
  }

  lines.push("RETORNO MEDIDO (matrícula registrada e conciliada com lead de anúncio)");
  lines.push(
    `• Matrículas de anúncio: ${count(report.financial.matriculasDeAnuncio)} de ${count(report.financial.matriculasNoMes)} no mês`
  );
  if (report.financial.retorno !== null) {
    lines.push(`• Retorno: ${money(report.financial.retorno)}`);
    lines.push(`• ROAS: ${report.financial.roas === null ? "—" : `${report.financial.roas.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×`}`);
    lines.push(`• ROI: ${pct(report.financial.roiPct)}`);
    lines.push(
      `• Custo de mídia por matrícula: ${report.financial.custoPorMatricula === null ? "—" : money(report.financial.custoPorMatricula)}`
    );
  } else {
    lines.push(`• Retorno: ${money(0)} — nenhuma matrícula do mês foi atribuída a anúncio`);
  }
  if (report.financial.potencial.valor !== null) {
    lines.push(
      `• Potencial em aberto (cenário, não receita): ${count(report.financial.potencial.oportunidades)} na etapa "${report.financial.potencial.stageLabel}" × ${money(report.financial.potencial.ticketMedio ?? 0)} = ${money(report.financial.potencial.valor)}`
    );
  }

  if (report.financeContext) {
    lines.push("");
    lines.push("FINANCEIRO DO MÊS (todas as origens)");
    lines.push(`• Matrículas: ${count(report.financeContext.matriculas)}`);
    lines.push(`• Valor contratado: ${money(report.financeContext.valorContratado)}`);
    lines.push(`• Recebido no mês: ${money(report.financeContext.recebido)}`);
    if (report.financeContext.origens) {
      const { origens } = report.financeContext;
      lines.push(`   - De anúncio: ${count(origens.anuncio.count)} (${money(origens.anuncio.amount)})`);
      lines.push(
        `   - De lead do CRM sem anúncio: ${count(origens.crmSemAnuncio.count)} (${money(origens.crmSemAnuncio.amount)})`
      );
      lines.push(
        `   - Sem cadastro no CRM — indicação/boca a boca/presencial: ${count(origens.semCadastro.count)} (${money(origens.semCadastro.amount)})`
      );
    }
  }

  return lines.join("\n");
}
