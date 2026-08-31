import { buildAdDestinationGroups, costPer } from "@/lib/adDestinationGroups";
import { normalizeFunnelBoard } from "@/lib/funnelBoards";
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

/** Rótulo legível para relatórios que não fecham exatamente em um mês. */
export function reportPeriodLabel(from: string, to: string): string {
  if (from.slice(0, 7) === to.slice(0, 7)) {
    const month = MONTH_NAMES[Number(from.slice(5, 7)) - 1]?.toLocaleLowerCase("pt-BR") ?? from.slice(5, 7);
    return `${Number(from.slice(8, 10))} a ${Number(to.slice(8, 10))} de ${month} de ${from.slice(0, 4)}`;
  }
  return `${from.split("-").reverse().join("/")} a ${to.split("-").reverse().join("/")}`;
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

/** Um degrau de "onde cada real parou": da impressão à matrícula. */
export interface LadderStep {
  label: string;
  value: number;
  /** Custo unitário do degrau, já formatado com a unidade certa. */
  costLabel: string | null;
  /** Comparação com o degrau de cadastros, quando faz sentido. */
  hint: string | null;
}

/** Destino do anúncio: formulário nativo × cada landing page de tema. */
export interface DestinationLine {
  key: string;
  label: string;
  kind: "native_form" | "landing_page" | "unknown";
  spend: number;
  cpm: number | null;
  ctr: number | null;
  cadastros: number;
  custoPorCadastro: number | null;
  agendados: number;
  custoPorAgendamento: number | null;
}

/** Conjunto de anúncio = público. */
export interface AudienceLine {
  adsetId: string;
  label: string;
  spend: number;
  cpm: number | null;
  ctr: number | null;
  cadastros: number;
  custoPorCadastro: number | null;
}

export interface FormatLine {
  label: string;
  pecas: number;
  spend: number;
  sharePct: number;
  cadastros: number;
  cadastrosSharePct: number;
  cpm: number | null;
  ctr: number | null;
  custoPorCadastro: number | null;
}

export interface CreativeLine {
  label: string;
  formato: "Vídeo" | "Imagem";
  spend: number;
  cadastros: number;
  custoPorCadastro: number | null;
  agendados: number;
  custoPorAgendamento: number | null;
  thumbnailUrl: string | null;
}

/** As peças que se pagaram e as que queimaram dinheiro. */
export interface CreativeSection {
  melhores: CreativeLine[];
  desperdicio: {
    pecas: number;
    spend: number;
    sharePct: number;
    cadastros: number;
    custoPorCadastro: number | null;
    labels: string[];
  } | null;
  formatos: FormatLine[];
}

/** Quando o lead chega — o horário nobre é o que a operação não cobre. */
export interface ArrivalSection {
  total: number;
  blocos: Array<{ label: string; leads: number; sharePct: number }>;
  dias: Array<{ label: string; leads: number; sharePct: number }>;
  picoBloco: { label: string; leads: number; sharePct: number } | null;
  picoDia: { label: string; leads: number; sharePct: number } | null;
  /** Chegadas fora do horário comercial (antes das 9h, depois das 18h, fim de semana). */
  foraDoComercialPct: number | null;
}

export interface SellerLine {
  sellerName: string;
  leads: number;
  agendados: number;
  taxa: number | null;
  perdidos: number;
  semMotivo: number;
}

export interface SellersSection {
  linhas: SellerLine[];
  /** Diferença entre a melhor e a pior taxa, quando há amostra dos dois lados. */
  amplitude: { melhor: SellerLine; pior: SellerLine } | null;
  /** Leads perdidos sem objeção registrada — o buraco que impede diagnosticar. */
  perdidosSemMotivo: number;
}

/** O que o relatório NÃO consegue responder, dito na cara. */
export interface BlindSpot {
  label: string;
  text: string;
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
  rows: EnrollmentOriginInputRow[];
}

export interface EnrollmentOriginInputRow {
  student: string;
  amount: number;
  saleDate: string;
  kind: "anuncio" | "crm_sem_anuncio" | "sem_cadastro";
  leadOrigem: string | null;
  campaignName: string | null;
  /** Resolvido a partir do anúncio de origem — é o que liga a venda ao gasto. */
  campaignId?: string | null;
  adName?: string | null;
  course?: string | null;
  seller?: string | null;
  linkKind?: "direto" | "nome" | null;
}

/** Uma linha da tabela "quais campanhas fecharam venda". */
export interface SalesByCampaignLine {
  /** Null na linha das vendas que não vieram de mídia. */
  campaignId: string | null;
  label: string;
  spend: number;
  cadastros: number;
  vendas: number;
  receita: number;
  /** Investimento ÷ vendas: quanto a mídia custou por matrícula desta campanha. */
  custoPorVenda: number | null;
  /** Receita ÷ investimento. */
  retornoPorReal: number | null;
  /** Cadastros que viraram matrícula, 0–100. */
  taxaVenda: number | null;
}

export interface SalesRowSummary {
  student: string;
  saleDate: string;
  amount: number;
  course: string | null;
  seller: string | null;
  campaignName: string | null;
  adName: string | null;
  kind: "anuncio" | "crm_sem_anuncio" | "sem_cadastro";
  origemLabel: string;
  linkKind: "direto" | "nome" | null;
}

/**
 * Vendas fechadas no período e de qual campanha vieram.
 *
 * Vale a mesma regra do bloco de retorno: venda é matrícula registrada no
 * Financeiro, nunca etapa do CRM. A diferença é que aqui o corte é por
 * campanha, para responder "qual anúncio virou dinheiro" em vez de só "quanto
 * a mídia rendeu no total".
 */
export interface SalesSection {
  vendas: number;
  vendasDeAnuncio: number;
  receita: number;
  receitaDeAnuncio: number;
  investimento: number;
  ticketMedio: number | null;
  custoPorVenda: number | null;
  retornoPorReal: number | null;
  porCampanha: SalesByCampaignLine[];
  linhas: SalesRowSummary[];
  /** Vendas de anúncio registradas a partir do lead (vínculo declarado). */
  vinculoDireto: number;
  /** Vendas de anúncio atribuídas por conciliação de nome — palpite. */
  vinculoPorNome: number;
  /** Campanhas que gastaram no período e não fecharam nenhuma venda. */
  campanhasSemVenda: number;
}

/** Um lead de anúncio com o horário em que chegou. */
export interface ArrivalInput {
  hora: number;
  diaSemana: number;
}

/** Vendedor com os leads de anúncio que recebeu no período. */
export interface SellerInput {
  sellerName: string | null;
  leads: number;
  agendados: number;
  perdidos: number;
  /** Perdidos sem objeção registrada (ver o repique no Kanban). */
  perdidosSemMotivo: number;
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
  /** Em relatórios personalizados, a base é uma faixa de datas e não um mês. */
  previousLabel: string;
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
  /** Gasto e cadastros por dia. Já entrava no builder para calcular médias e
   * pico; passou a sair no relatório para o documento desenhar a evolução. */
  series: DailySeriesPoint[];
  monthLabel: string;
  from: string;
  to: string;
  parcial: boolean;
  /** Recorte aplicado antes de gerar o documento. */
  scopeLabel: string;
  /** Alcance da Meta só é deduplicado para o recorte da conta inteira. */
  reachIsDeduplicated: boolean;
  investment: InvestmentSection;
  /** Da impressão à matrícula, com o custo de cada degrau. */
  ladder: LadderStep[];
  conversion: ConversionSection;
  destinations: DestinationLine[];
  audiences: AudienceLine[];
  creatives: CreativeSection;
  engagement: EngagementSection;
  financial: FinancialSection;
  /** Null quando quem abriu não tem acesso ao Financeiro. */
  sales: SalesSection | null;
  /** Null quando não há leads de anúncio com horário no período. */
  arrival: ArrivalSection | null;
  sellers: SellersSection | null;
  blindSpots: BlindSpot[];
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
  /** Usa uma faixa de datas no título quando o período não for um mês inteiro. */
  periodLabel?: string;
  /** Rótulo do período-base de comparação. */
  previousPeriodLabel?: string | null;
  scopeLabel?: string;
  reachIsDeduplicated?: boolean;
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
  /** Horários de chegada dos leads de anúncio (hora local e dia da semana). */
  arrival: ArrivalInput[] | null;
  /** Desempenho por vendedor nos leads de anúncio do período. */
  sellers: SellerInput[] | null;
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

/** Total de um tipo de etapa somando TODAS as colunas daquele tipo. */
function sumStagesOfKind(funnel: FunnelStagePoint[], kind: FunnelStagePoint["kind"]): number {
  return funnel.reduce((total, stage) => (stage.kind === kind ? total + stage.count : total), 0);
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
  const agendados = agendadoStage?.count ?? 0;
  // Soma todas as etapas do tipo: o funil pode ter mais de uma coluna de ganho
  // (Fechado + o quadro de Clientes) e mais de uma de perda (Desinteresse + Em
  // espera). Ler só a primeira esconderia quem já avançou para o pós-venda.
  const ganhos = sumStagesOfKind(funnel, "won");

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
    perdidos: sumStagesOfKind(funnel, "lost"),
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
/**
 * "Onde cada real parou": a escada de impressão até matrícula, cada degrau com
 * o próprio custo. É a leitura que mostra em qual etapa o dinheiro trava — o
 * total de investimento sozinho não diz isso.
 */
function buildLadder(conversion: ConversionSection, sales: SalesSection | null): LadderStep[] {
  const spend = conversion.spend;
  const steps: LadderStep[] = [];
  const share = (value: number) =>
    conversion.cadastros > 0 ? `${pct((value / conversion.cadastros) * 100, 0)} dos cadastros` : null;

  if (conversion.impressions > 0) {
    steps.push({
      label: "Impressões",
      value: conversion.impressions,
      costLabel: conversion.cpm === null ? null : `${money(conversion.cpm)} por mil`,
      hint: null,
    });
  }
  if (conversion.clicks > 0) {
    steps.push({
      label: "Cliques",
      value: conversion.clicks,
      costLabel: costPer(spend, conversion.clicks) === null ? null : `${money(costPer(spend, conversion.clicks)!)} por clique`,
      hint: conversion.ctr === null ? null : `CTR de ${pct(conversion.ctr)}`,
    });
  }
  steps.push({
    label: "Cadastros",
    value: conversion.cadastros,
    costLabel: conversion.custoPorCadastro === null ? null : money(conversion.custoPorCadastro),
    hint: `${count(conversion.pessoas)} ${plural(conversion.pessoas, "pessoa nova", "pessoas novas")}`,
  });

  // Degraus do funil comercial, na ordem em que a equipe trabalha. Só entram os
  // que existem no funil configurado — nome de etapa é livre.
  for (const stage of conversion.funnel) {
    // A escada é o caminho até a venda: a etapa de perda tem bloco próprio (a
    // equipe, o repique) e no meio da escada só faria o funil parecer subir.
    // Fora do quadro principal (pós-venda, espera) não é degrau da aquisição:
    // a escada termina na venda, e o que vem depois é acompanhamento.
    if (normalizeFunnelBoard(stage.board) !== "principal") continue;
    if (stage.kind === "entry" || stage.kind === "lost" || stage.count === 0) continue;
    steps.push({
      label: stage.label,
      value: stage.count,
      costLabel: costPer(spend, stage.count) === null ? null : money(costPer(spend, stage.count)!),
      hint: share(stage.count),
    });
  }

  steps.push({
    label: "Matrícula rastreável",
    value: sales?.vendasDeAnuncio ?? 0,
    costLabel:
      sales && sales.vendasDeAnuncio > 0 && sales.custoPorVenda !== null ? money(sales.custoPorVenda) : null,
    hint:
      sales === null
        ? "Sem acesso ao Financeiro nesta sessão"
        : sales.vendasDeAnuncio === 0
          ? "nenhuma no período"
          : money(sales.receitaDeAnuncio),
  });

  return steps;
}

/** Qual etapa conta como "agendou" nas tabelas por destino e por criativo. */
function schedulingStageKey(funnel: FunnelStagePoint[]): string | null {
  return findStage(funnel, (stage) => stage.key === "agendado")?.key ?? null;
}

/** Quantos leads daquele anúncio/grupo passaram pela etapa — `stageCounts` do AdRow. */
function stageCountOf(stageCounts: Record<string, number>, key: string | null): number {
  return key ? stageCounts[key] ?? 0 : 0;
}

function buildDestinations(ads: AdRow[], funnel: FunnelStagePoint[]): DestinationLine[] {
  const stageKey = schedulingStageKey(funnel);
  return buildAdDestinationGroups(ads.filter((row) => !isEngagement(row)))
    .map((group) => {
      const agendados = stageCountOf(group.stageCounts, stageKey);
      return {
        key: group.key,
        label: group.label,
        kind: group.kind,
        spend: group.spend,
        cpm: group.cpm,
        ctr: group.ctr,
        cadastros: group.cadastrosCrm,
        custoPorCadastro: group.custoPorCadastro,
        agendados,
        custoPorAgendamento: costPer(group.spend, agendados),
      };
    })
    .filter((line) => line.spend > 0 || line.cadastros > 0);
}

function buildAudiences(ads: AdRow[]): AudienceLine[] {
  const byAdset = new Map<string, { label: string; spend: number; impressions: number; clicks: number; cadastros: number }>();
  for (const row of ads) {
    if (isEngagement(row)) continue;
    const current = byAdset.get(row.adsetId) ?? {
      label: row.adsetName || "Conjunto sem nome",
      spend: 0,
      impressions: 0,
      clicks: 0,
      cadastros: 0,
    };
    current.spend += row.spend;
    current.impressions += row.impressions;
    current.clicks += row.clicks;
    current.cadastros += row.cadastrosCrm;
    byAdset.set(row.adsetId, current);
  }

  return Array.from(byAdset.entries())
    .map(([adsetId, data]) => ({
      adsetId,
      label: data.label,
      spend: data.spend,
      cpm: data.impressions > 0 ? (data.spend / data.impressions) * 1000 : null,
      ctr: data.impressions > 0 ? (data.clicks / data.impressions) * 100 : null,
      cadastros: data.cadastros,
      custoPorCadastro: costPer(data.spend, data.cadastros),
    }))
    .filter((line) => line.spend > 0)
    .sort((left, right) => {
      // Mais barato primeiro; quem não trouxe lead vai para o fim.
      if (left.custoPorCadastro === null && right.custoPorCadastro === null) return right.spend - left.spend;
      if (left.custoPorCadastro === null) return 1;
      if (right.custoPorCadastro === null) return -1;
      return left.custoPorCadastro - right.custoPorCadastro;
    });
}

/** Peça anunciada: o mesmo criativo aparece em vários conjuntos, então soma por nome. */
interface CreativeAggregate {
  label: string;
  formato: "Vídeo" | "Imagem";
  spend: number;
  cadastros: number;
  agendados: number;
  thumbnailUrl: string | null;
}

function aggregateCreatives(ads: AdRow[], funnel: FunnelStagePoint[]): CreativeAggregate[] {
  const stageKey = schedulingStageKey(funnel);
  const byName = new Map<string, CreativeAggregate>();
  for (const row of ads) {
    if (isEngagement(row)) continue;
    const label = row.adName || row.adId;
    const current = byName.get(label) ?? {
      label,
      formato: row.videoId ? ("Vídeo" as const) : ("Imagem" as const),
      spend: 0,
      cadastros: 0,
      agendados: 0,
      thumbnailUrl: row.thumbnailUrl ?? row.imageUrl ?? null,
    };
    // Uma peça com vídeo em qualquer variação é vídeo.
    if (row.videoId) current.formato = "Vídeo";
    current.spend += row.spend;
    current.cadastros += row.cadastrosCrm;
    current.agendados += stageCountOf(row.stageCounts, stageKey);
    current.thumbnailUrl = current.thumbnailUrl ?? row.thumbnailUrl ?? row.imageUrl ?? null;
    byName.set(label, current);
  }
  return Array.from(byName.values());
}

/** Gasto mínimo para uma peça ser cobrada por resultado — abaixo disso o número é ruído. */
const CREATIVE_MIN_SPEND = 100;

function buildCreatives(ads: AdRow[], funnel: FunnelStagePoint[], totalSpend: number): CreativeSection {
  const pecas = aggregateCreatives(ads, funnel);

  const melhores = pecas
    .filter((peca) => peca.spend >= CREATIVE_MIN_SPEND && peca.cadastros > 0)
    .sort((left, right) => left.spend / left.cadastros - right.spend / right.cadastros)
    .slice(0, 6)
    .map((peca) => ({
      label: peca.label,
      formato: peca.formato,
      spend: peca.spend,
      cadastros: peca.cadastros,
      custoPorCadastro: costPer(peca.spend, peca.cadastros),
      agendados: peca.agendados,
      custoPorAgendamento: costPer(peca.spend, peca.agendados),
      thumbnailUrl: peca.thumbnailUrl,
    }));

  // O outro lado: peças que gastaram de verdade e não entregaram agendamento.
  const queimaram = pecas.filter(
    (peca) => peca.spend >= CREATIVE_MIN_SPEND && peca.agendados === 0 && (peca.cadastros === 0 || peca.spend / peca.cadastros > (totalSpend > 0 ? totalSpend / Math.max(1, sum(pecas, (p) => p.cadastros)) : 0) * 2)
  );
  const spendQueimado = sum(queimaram, (peca) => peca.spend);
  const cadastrosQueimados = sum(queimaram, (peca) => peca.cadastros);

  const formatos = (["Vídeo", "Imagem"] as const).map((formato) => {
    const grupo = pecas.filter((peca) => peca.formato === formato);
    const spend = sum(grupo, (peca) => peca.spend);
    const cadastros = sum(grupo, (peca) => peca.cadastros);
    const adsDoFormato = ads.filter(
      (row) => !isEngagement(row) && (row.videoId ? "Vídeo" : "Imagem") === formato
    );
    const impressions = sum(adsDoFormato, (row) => row.impressions);
    const clicks = sum(adsDoFormato, (row) => row.clicks);
    const totalCadastros = sum(pecas, (peca) => peca.cadastros);
    return {
      label: formato,
      pecas: grupo.length,
      spend,
      sharePct: totalSpend > 0 ? (spend / totalSpend) * 100 : 0,
      cadastros,
      cadastrosSharePct: totalCadastros > 0 ? (cadastros / totalCadastros) * 100 : 0,
      cpm: impressions > 0 ? (spend / impressions) * 1000 : null,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : null,
      custoPorCadastro: costPer(spend, cadastros),
    };
  }).filter((line) => line.pecas > 0);

  return {
    melhores,
    desperdicio:
      queimaram.length > 0
        ? {
            pecas: queimaram.length,
            spend: spendQueimado,
            sharePct: totalSpend > 0 ? (spendQueimado / totalSpend) * 100 : 0,
            cadastros: cadastrosQueimados,
            custoPorCadastro: costPer(spendQueimado, cadastrosQueimados),
            labels: queimaram
              .sort((left, right) => right.spend - left.spend)
              .slice(0, 12)
              .map((peca) => peca.label),
          }
        : null,
    formatos,
  };
}

const WEEKDAY_LABELS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const HOUR_BLOCKS: Array<{ label: string; from: number; to: number }> = [
  { label: "Madrugada (1h–6h)", from: 1, to: 6 },
  { label: "Manhã (6h–12h)", from: 6, to: 12 },
  { label: "Tarde (12h–18h)", from: 12, to: 18 },
  { label: "Noite (18h–1h)", from: 18, to: 25 },
];

function blockLabelFor(hora: number): string {
  const normalized = hora === 0 ? 24 : hora;
  return HOUR_BLOCKS.find((block) => normalized >= block.from && normalized < block.to)?.label ?? "Noite (18h–1h)";
}

/**
 * A que horas e em que dia o lead chega. O valor da seção é o descompasso: o
 * anúncio roda 24h e o atendimento não, então o pico costuma cair fora do
 * horário comercial.
 */
function buildArrival(leads: ArrivalInput[] | null): ArrivalSection | null {
  if (!leads || leads.length === 0) return null;
  const total = leads.length;

  const porBloco = new Map<string, number>();
  for (const block of HOUR_BLOCKS) porBloco.set(block.label, 0);
  const porDia = new Map<string, number>();
  for (const label of WEEKDAY_LABELS) porDia.set(label, 0);

  let foraDoComercial = 0;
  for (const lead of leads) {
    const blockLabel = blockLabelFor(lead.hora);
    porBloco.set(blockLabel, (porBloco.get(blockLabel) ?? 0) + 1);
    const diaLabel = WEEKDAY_LABELS[lead.diaSemana] ?? "Domingo";
    porDia.set(diaLabel, (porDia.get(diaLabel) ?? 0) + 1);
    const fimDeSemana = lead.diaSemana === 0 || lead.diaSemana === 6;
    if (fimDeSemana || lead.hora < 9 || lead.hora >= 18) foraDoComercial += 1;
  }

  const toLine = ([label, leadsCount]: [string, number]) => ({
    label,
    leads: leadsCount,
    sharePct: (leadsCount / total) * 100,
  });
  const blocos = Array.from(porBloco.entries()).map(toLine);
  const dias = Array.from(porDia.entries()).map(toLine);
  const maiorBloco = [...blocos].sort((left, right) => right.leads - left.leads)[0] ?? null;
  const maiorDia = [...dias].sort((left, right) => right.leads - left.leads)[0] ?? null;

  return {
    total,
    blocos,
    dias,
    picoBloco: maiorBloco && maiorBloco.leads > 0 ? maiorBloco : null,
    picoDia: maiorDia && maiorDia.leads > 0 ? maiorDia : null,
    foraDoComercialPct: (foraDoComercial / total) * 100,
  };
}

function buildSellers(input: SellerInput[] | null): SellersSection | null {
  if (!input || input.length === 0) return null;
  const linhas: SellerLine[] = input
    .filter((row) => row.leads > 0)
    .map((row) => ({
      sellerName: row.sellerName?.trim() || "Sem responsável",
      leads: row.leads,
      agendados: row.agendados,
      taxa: row.leads > 0 ? (row.agendados / row.leads) * 100 : null,
      perdidos: row.perdidos,
      semMotivo: row.perdidosSemMotivo,
    }))
    .sort((left, right) => (right.taxa ?? -1) - (left.taxa ?? -1) || right.leads - left.leads);

  if (linhas.length === 0) return null;

  // Amplitude só faz sentido com amostra dos dois lados; menos de 5 leads é ruído.
  const comAmostra = linhas.filter((line) => line.leads >= 5 && line.sellerName !== "Sem responsável");
  const amplitude =
    comAmostra.length >= 2
      ? { melhor: comAmostra[0], pior: comAmostra[comAmostra.length - 1] }
      : null;

  return {
    linhas,
    amplitude,
    perdidosSemMotivo: linhas.reduce((total, line) => total + line.semMotivo, 0),
  };
}

/**
 * O que o relatório não consegue responder. Sai da própria apuração, não de
 * uma lista fixa: cada item só aparece quando o dado realmente falta neste
 * período.
 */
function buildBlindSpots(report: Omit<MonthlyReport, "highlights" | "blindSpots">): BlindSpot[] {
  const spots: BlindSpot[] = [];
  const { sales, sellers, conversion, parcial } = report;

  if (sales && sales.vinculoPorNome > 0) {
    spots.push({
      label: "Receita",
      text: `${count(sales.vinculoPorNome)} ${plural(sales.vinculoPorNome, "matrícula foi atribuída", "matrículas foram atribuídas")} a anúncio por conciliação de nome, não pelo vínculo com o lead. Registrar a venda pelo card do CRM elimina o palpite.`,
    });
  }
  if (sales && sales.vendas === 0) {
    spots.push({
      label: "Receita",
      text: "Nenhuma matrícula foi registrada no Financeiro neste período, então não há retorno em reais para apurar — nem a favor nem contra a mídia.",
    });
  }
  if (sellers && sellers.perdidosSemMotivo > 0) {
    spots.push({
      label: "Perdas",
      text: `${count(sellers.perdidosSemMotivo)} ${plural(sellers.perdidosSemMotivo, "lead perdido está", "leads perdidos estão")} sem objeção registrada. Sem o motivo não dá para separar "preço" de "não atendeu o telefone", que são problemas com soluções opostas.`,
    });
  }
  if (conversion.cadastros > 0 && conversion.agendados === 0) {
    spots.push({
      label: "Funil",
      text: "Nenhum cadastro do período chegou à etapa de agendamento — ou o atendimento não andou, ou o funil não está sendo movido no CRM.",
    });
  }
  if (parcial) {
    spots.push({
      label: "Janela",
      text: "O período ainda está em andamento: os números de hoje ainda vão mudar, e venda costuma demorar mais que a janela do relatório.",
    });
  }
  spots.push({
    label: "Demografia",
    text: "Idade, gênero e região não são sincronizados da Meta. A conta responde qual conjunto rende mais, não qual pessoa responde melhor.",
  });

  return spots;
}

function originLabel(row: EnrollmentOriginInputRow): string {
  if (row.kind === "anuncio") return row.campaignName ?? "Anúncio";
  if (row.kind === "crm_sem_anuncio") return row.leadOrigem?.trim() || "Lead do CRM sem anúncio";
  return "Fora do funil digital";
}

/**
 * Cruza as matrículas do período com o investimento de cada campanha.
 *
 * Toda campanha de conversão que gastou entra na tabela, inclusive as que não
 * fecharam nada — é justamente a linha com venda zero que mostra onde o
 * dinheiro parou. As vendas sem anúncio ficam numa linha própria, sem
 * investimento, para o total de receita continuar fechando com o Financeiro.
 */
function buildSales(
  conversion: ConversionSection,
  origins: EnrollmentOriginInput | null
): SalesSection | null {
  if (!origins) return null;

  const rows = origins.rows;
  const receita = rows.reduce((total, row) => total + row.amount, 0);
  const adRows = rows.filter((row) => row.kind === "anuncio");
  const receitaDeAnuncio = adRows.reduce((total, row) => total + row.amount, 0);

  const byCampaign = new Map<string, { vendas: number; receita: number; label: string }>();
  for (const row of adRows) {
    // Sem campanha resolvida a venda ainda é de anúncio; agrupa pelo nome que
    // veio, e só cai em "Anúncio sem campanha" quando nem isso existe.
    const key = row.campaignId ?? row.campaignName ?? "sem-campanha";
    const current = byCampaign.get(key) ?? {
      vendas: 0,
      receita: 0,
      label: row.campaignName ?? "Anúncio sem campanha identificada",
    };
    current.vendas += 1;
    current.receita += row.amount;
    byCampaign.set(key, current);
  }

  const porCampanha: SalesByCampaignLine[] = conversion.campanhas.map((campanha) => {
    const sales = byCampaign.get(campanha.campaignId) ?? byCampaign.get(campanha.rawName) ?? null;
    byCampaign.delete(campanha.campaignId);
    byCampaign.delete(campanha.rawName);
    const vendas = sales?.vendas ?? 0;
    const receitaCampanha = sales?.receita ?? 0;
    return {
      campaignId: campanha.campaignId,
      label: campanha.label,
      spend: campanha.spend,
      cadastros: campanha.cadastros,
      vendas,
      receita: receitaCampanha,
      custoPorVenda: vendas > 0 ? campanha.spend / vendas : null,
      retornoPorReal: campanha.spend > 0 && receitaCampanha > 0 ? receitaCampanha / campanha.spend : null,
      taxaVenda: campanha.cadastros > 0 ? (vendas / campanha.cadastros) * 100 : null,
    };
  });

  // Venda atribuída a uma campanha que não aparece no recorte de gasto (ex.:
  // campanha antiga que trouxe o lead antes do período) não pode sumir.
  for (const [key, sales] of byCampaign) {
    porCampanha.push({
      campaignId: key,
      label: sales.label,
      spend: 0,
      cadastros: 0,
      vendas: sales.vendas,
      receita: sales.receita,
      custoPorVenda: null,
      retornoPorReal: null,
      taxaVenda: null,
    });
  }

  porCampanha.sort((left, right) => right.receita - left.receita || right.spend - left.spend);

  const foraDeMidia = rows.filter((row) => row.kind !== "anuncio");
  if (foraDeMidia.length > 0) {
    porCampanha.push({
      campaignId: null,
      label: "Fora de mídia (CRM sem anúncio, indicação, boca a boca)",
      spend: 0,
      cadastros: 0,
      vendas: foraDeMidia.length,
      receita: foraDeMidia.reduce((total, row) => total + row.amount, 0),
      custoPorVenda: null,
      retornoPorReal: null,
      taxaVenda: null,
    });
  }

  return {
    vendas: rows.length,
    vendasDeAnuncio: adRows.length,
    receita,
    receitaDeAnuncio,
    investimento: conversion.spend,
    ticketMedio: rows.length > 0 ? receita / rows.length : null,
    custoPorVenda: adRows.length > 0 ? conversion.spend / adRows.length : null,
    retornoPorReal: conversion.spend > 0 && receitaDeAnuncio > 0 ? receitaDeAnuncio / conversion.spend : null,
    porCampanha,
    linhas: [...rows]
      .sort((left, right) => right.amount - left.amount)
      .map((row) => ({
        student: row.student,
        saleDate: row.saleDate,
        amount: row.amount,
        course: row.course ?? null,
        seller: row.seller ?? null,
        campaignName: row.campaignName ?? null,
        adName: row.adName ?? null,
        kind: row.kind,
        origemLabel: originLabel(row),
        linkKind: row.linkKind ?? null,
      })),
    vinculoDireto: adRows.filter((row) => row.linkKind === "direto").length,
    vinculoPorNome: adRows.filter((row) => row.linkKind !== "direto").length,
    campanhasSemVenda: porCampanha.filter((line) => line.spend > 0 && line.vendas === 0).length,
  };
}

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
  previousLabel: string | null | undefined,
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
    previousLabel: previousLabel ?? monthLabel(previousMonth),
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
      ? ` (${comparison.investimento.deltaPct >= 0 ? "+" : ""}${pct(comparison.investimento.deltaPct)} vs. ${comparison.previousLabel.toLocaleLowerCase("pt-BR")})`
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
      text: `As campanhas de conversão gastaram ${money(conversion.spend)} e não trouxeram nenhum cadastro no período.`,
    });
  }

  if (comparison?.custoPorCadastro.deltaPct !== null && comparison?.custoPorCadastro.deltaPct !== undefined) {
    const caiu = comparison.custoPorCadastro.deltaPct < 0;
    points.push({
      tone: caiu ? "good" : "warn",
      text: `O custo por cadastro ${caiu ? "caiu" : "subiu"} ${pct(Math.abs(comparison.custoPorCadastro.deltaPct))} em relação a ${comparison.previousLabel.toLocaleLowerCase("pt-BR")} (de ${money(comparison.custoPorCadastro.previous ?? 0)} para ${money(comparison.custoPorCadastro.current)}).`,
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
      text: `Retorno medido: ${count(financial.matriculasDeAnuncio)} de ${count(financial.matriculasNoMes)} ${plural(financial.matriculasNoMes, "matrícula do período veio", "matrículas do período vieram")} de anúncio, somando ${money(financial.retorno)} contratados — ${financial.roas === null ? "—" : `${financial.roas.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}× o investido em captação`}.`,
    });
  } else if (financial.basis === "crm" && financial.retorno !== null) {
    points.push({
      tone: "good",
      text: `Retorno registrado no CRM: ${money(financial.retorno)} em valores de fechamento de leads de anúncio. Nenhuma matrícula do período pôde ser conciliada com esses leads no Financeiro.`,
    });
  } else if (financial.matriculasNoMes > 0) {
    points.push({
      tone: "warn",
      text: `Nenhuma das ${count(financial.matriculasNoMes)} ${plural(financial.matriculasNoMes, "matrícula do período veio", "matrículas do período vieram")} de anúncio: o retorno de mídia medido em reais no período é ${money(0)}.`,
    });
  } else {
    points.push({
      tone: "warn",
      text: `Nenhuma matrícula foi registrada no período, então não há retorno de mídia em reais para apurar.`,
    });
  }

  // Qual campanha virou dinheiro é a pergunta que o retorno total não responde.
  if (report.sales && report.sales.vendasDeAnuncio > 0) {
    const vencedoras = report.sales.porCampanha
      .filter((line) => line.campaignId !== null && line.vendas > 0)
      .slice(0, 3)
      .map(
        (line) =>
          `${line.label} (${count(line.vendas)} ${plural(line.vendas, "venda", "vendas")}, ${money(line.receita)}${
            line.custoPorVenda !== null ? `, ${money(line.custoPorVenda)} de mídia por venda` : ""
          })`
      );
    if (vencedoras.length > 0) {
      points.push({
        tone: "good",
        text: `As vendas de anúncio vieram de: ${vencedoras.join("; ")}.`,
      });
    }
    if (report.sales.vinculoPorNome > 0) {
      points.push({
        tone: "warn",
        text: `${count(report.sales.vinculoPorNome)} ${plural(report.sales.vinculoPorNome, "dessas vendas foi atribuída", "dessas vendas foram atribuídas")} por conciliação de nome, não pelo vínculo com o lead — registrar a venda pelo card do CRM elimina esse palpite.`,
      });
    }
  }

  if (report.sales && report.sales.campanhasSemVenda > 0) {
    points.push({
      tone: "warn",
      text: `${count(report.sales.campanhasSemVenda)} ${plural(report.sales.campanhasSemVenda, "campanha gastou", "campanhas gastaram")} no período sem fechar nenhuma venda.`,
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
      text: `As ${count(financeContext.matriculas)} ${plural(financeContext.matriculas, "matrícula do mês", "matrículas do mês")} (${money(financeContext.valorContratado)} contratados) se dividem em: ${partes.join("; ")}. Venda registrada pelo card do CRM já carrega o lead de origem; a lançada direto no Financeiro é conciliada pelo nome do aluno.`,
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

  const sales = buildSales(conversion, input.enrollmentOrigins);
  const ladder = buildLadder(conversion, sales);
  const destinations = buildDestinations(input.ads, input.funnel);
  const audiences = buildAudiences(input.ads);
  const creatives = buildCreatives(input.ads, input.funnel, conversion.spend);
  const arrival = buildArrival(input.arrival);
  const sellers = buildSellers(input.sellers);

  const financeContext: FinanceContextSection | null = input.finance
    ? {
        ...input.finance,
        ticketMedioMatricula: ticketFinanceiro,
        recebidoAnterior: input.previousFinance?.recebido ?? null,
        matriculasAnterior: input.previousFinance?.matriculas ?? null,
        origens: input.enrollmentOrigins,
      }
    : null;

  const comparison = buildComparison(input.previousMonth, input.previousPeriodLabel, input.previousAds, {
    investment,
    conversion,
    engagement,
  });

  const base: Omit<MonthlyReport, "highlights" | "blindSpots"> = {
    month: input.month,
    monthLabel: input.periodLabel ?? monthLabel(input.month),
    from: input.from,
    to: input.to,
    parcial: input.parcial,
    scopeLabel: input.scopeLabel ?? "Conta inteira, incluindo campanhas pausadas",
    reachIsDeduplicated: input.reachIsDeduplicated ?? true,
    series: input.series,
    investment,
    ladder,
    conversion,
    destinations,
    audiences,
    creatives,
    engagement,
    financial,
    sales,
    arrival,
    sellers,
    financeContext,
    comparison,
  };

  const withSpots = { ...base, blindSpots: buildBlindSpots(base) };
  return { ...withSpots, highlights: buildHighlights(withSpots) };
}

/** Versão em texto para colar em e-mail, WhatsApp ou ata da reunião — os
 * mesmos números da tela, sem depender de imprimir. */
export function buildReportText(report: MonthlyReport): string {
  const lines: string[] = [];
  lines.push(`RELATÓRIO DE MÍDIA — ${report.monthLabel.toLocaleUpperCase("pt-BR")}`);
  lines.push(
    `Período: ${report.from.split("-").reverse().join("/")} a ${report.to.split("-").reverse().join("/")}${report.parcial ? " (período em andamento)" : ""}`
  );
  lines.push(`Recorte: ${report.scopeLabel}.`);
  lines.push("");

  lines.push("RESUMO");
  for (const point of report.highlights) lines.push(`• ${point.text}`);
  lines.push("");

  lines.push("ONDE CADA REAL PAROU");
  for (const step of report.ladder) {
    lines.push(
      `• ${step.label}: ${count(step.value)}${step.costLabel ? ` — ${step.costLabel}` : ""}${step.hint ? ` (${step.hint})` : ""}`
    );
  }
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
    `• Matrículas de anúncio: ${count(report.financial.matriculasDeAnuncio)} de ${count(report.financial.matriculasNoMes)} no período`
  );
  if (report.financial.retorno !== null) {
    lines.push(`• Retorno: ${money(report.financial.retorno)}`);
    lines.push(`• ROAS: ${report.financial.roas === null ? "—" : `${report.financial.roas.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×`}`);
    lines.push(`• ROI: ${pct(report.financial.roiPct)}`);
    lines.push(
      `• Custo de mídia por matrícula: ${report.financial.custoPorMatricula === null ? "—" : money(report.financial.custoPorMatricula)}`
    );
  } else {
    lines.push(`• Retorno: ${money(0)} — nenhuma matrícula do período foi atribuída a anúncio`);
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

  if (report.sales && report.sales.porCampanha.length > 0) {
    lines.push("");
    lines.push("VENDAS POR CAMPANHA");
    for (const line of report.sales.porCampanha) {
      lines.push(
        `• ${line.label}: ${count(line.vendas)} ${plural(line.vendas, "venda", "vendas")}${line.receita > 0 ? ` · ${money(line.receita)}` : ""}${line.spend > 0 ? ` · ${money(line.spend)} investidos` : ""}${line.custoPorVenda !== null ? ` · ${money(line.custoPorVenda)} de mídia por venda` : ""}`
      );
    }
  }

  if (report.destinations.length > 0) {
    lines.push("");
    lines.push("DESTINO DO CLIQUE");
    for (const line of report.destinations) {
      lines.push(
        `• ${line.label}: ${money(line.spend)} · ${count(line.cadastros)} ${plural(line.cadastros, "cadastro", "cadastros")} a ${line.custoPorCadastro === null ? "—" : money(line.custoPorCadastro)} · ${count(line.agendados)} ${plural(line.agendados, "agendou", "agendaram")}${line.custoPorAgendamento !== null ? ` a ${money(line.custoPorAgendamento)}` : ""}`
      );
    }
  }

  if (report.audiences.length > 0) {
    lines.push("");
    lines.push("PÚBLICOS (conjuntos)");
    for (const line of report.audiences) {
      lines.push(
        `• ${line.label}: ${money(line.spend)} · CPM ${line.cpm === null ? "—" : money(line.cpm)} · ${count(line.cadastros)} ${plural(line.cadastros, "lead", "leads")} a ${line.custoPorCadastro === null ? "—" : money(line.custoPorCadastro)}`
      );
    }
  }

  if (report.creatives.formatos.length > 0 || report.creatives.melhores.length > 0) {
    lines.push("");
    lines.push("FORMATO E PEÇAS");
    for (const formato of report.creatives.formatos) {
      lines.push(
        `• ${formato.label}: ${count(formato.pecas)} ${plural(formato.pecas, "peça", "peças")} · ${money(formato.spend)} (${pct(formato.sharePct, 0)} da verba) · ${count(formato.cadastros)} ${plural(formato.cadastros, "lead", "leads")} a ${formato.custoPorCadastro === null ? "—" : money(formato.custoPorCadastro)}`
      );
    }
    for (const peca of report.creatives.melhores) {
      lines.push(
        `   - ${peca.label} (${peca.formato}): ${money(peca.spend)} · ${count(peca.cadastros)} ${plural(peca.cadastros, "lead", "leads")} a ${peca.custoPorCadastro === null ? "—" : money(peca.custoPorCadastro)} · ${count(peca.agendados)} ${plural(peca.agendados, "agendamento", "agendamentos")}`
      );
    }
    if (report.creatives.desperdicio) {
      lines.push(
        `   ! ${count(report.creatives.desperdicio.pecas)} ${plural(report.creatives.desperdicio.pecas, "peça consumiu", "peças consumiram")} ${money(report.creatives.desperdicio.spend)} (${pct(report.creatives.desperdicio.sharePct, 0)} da verba) sem nenhum agendamento: ${report.creatives.desperdicio.labels.join(", ")}`
      );
    }
  }

  if (report.arrival) {
    lines.push("");
    lines.push("QUANDO O LEAD CHEGA");
    for (const bloco of report.arrival.blocos) {
      lines.push(`• ${bloco.label}: ${count(bloco.leads)} (${pct(bloco.sharePct, 0)})`);
    }
    if (report.arrival.picoDia) {
      lines.push(`• Dia mais forte: ${report.arrival.picoDia.label} (${pct(report.arrival.picoDia.sharePct, 0)})`);
    }
    if (report.arrival.foraDoComercialPct !== null) {
      lines.push(`• Fora do horário comercial: ${pct(report.arrival.foraDoComercialPct, 0)} das chegadas`);
    }
  }

  if (report.sellers) {
    lines.push("");
    lines.push("EQUIPE (leads de anúncio)");
    for (const line of report.sellers.linhas) {
      lines.push(
        `• ${line.sellerName}: ${count(line.leads)} ${plural(line.leads, "lead", "leads")} · ${count(line.agendados)} ${plural(line.agendados, "agendou", "agendaram")} (${pct(line.taxa)})${line.perdidos > 0 ? ` · ${count(line.perdidos)} ${plural(line.perdidos, "perdido", "perdidos")}${line.semMotivo > 0 ? `, ${count(line.semMotivo)} sem motivo` : ""}` : ""}`
      );
    }
  }

  if (report.blindSpots.length > 0) {
    lines.push("");
    lines.push("PONTOS CEGOS");
    for (const spot of report.blindSpots) lines.push(`• ${spot.label}: ${spot.text}`);
  }

  return lines.join("\n");
}
