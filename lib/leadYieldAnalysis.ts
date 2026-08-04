import type { CommercialStageKind } from "@/types/inscricao";

/**
 * Rendimento do lead: onde cada pessoa PAROU no funil, separada por formulário
 * de origem.
 *
 * Existe porque o Kanban é um quadro só: Meta, landing page e aula exclusiva
 * dividem as mesmas colunas, então "27 em Conexão" não responde quantos desses
 * o anúncio pagou. Aqui o recorte de origem vem primeiro (ver
 * LEAD_ORIGIN_GROUPS em lib/vozupFolders.ts) e a contagem é feita sobre o
 * recorte, nunca sobre o quadro inteiro.
 *
 * Este módulo é puro de propósito (nada de banco): a consulta devolve uma
 * pessoa por linha e TODA a agregação acontece aqui, no navegador. É o que
 * permite trocar funil, vendedor, origem e etapa sem ida ao servidor — o
 * pedido era "totalmente modificável".
 */

/** Sobre qual data o período do topo da tela é aplicado. */
export type LeadYieldBasis = "chegada" | "movimentacao" | "tudo";

export const BASIS_LABEL: Record<LeadYieldBasis, string> = {
  chegada: "Chegada do lead",
  movimentacao: "Movimentação no funil",
  tudo: "Tudo (sem período)",
};

export const BASIS_HINT: Record<LeadYieldBasis, string> = {
  chegada:
    "Coorte: as pessoas que se cadastraram dentro do período, e até onde elas chegaram no funil (mesmo que tenham avançado depois).",
  movimentacao:
    "As pessoas que se MOVERAM no funil dentro do período, tenham chegado quando tiverem. Responde \"de tal dia a tal dia, tantas agendaram\".",
  tudo:
    "O quadro como ele está hoje, sem recorte de data — é este modo que bate card a card com o Kanban, que também não filtra por período.",
};

/** Uma passagem de etapa: quando a pessoa entrou nela pela primeira vez. */
export interface LeadYieldStageStep {
  key: string;
  /** Primeira entrada nesta etapa (ISO). */
  at: string;
  /** Quem moveu — null em etapa de entrada, que nasce com o card. */
  actor: string | null;
  /** Houve entrada nesta etapa DENTRO do período consultado. */
  inWindow: boolean;
}

export interface LeadYieldLead {
  id: number;
  nome: string | null;
  telefone: string | null;
  /** Origem crua do payload, como o formulário gravou. */
  origem: string;
  /** Chave do grupo de origem (ver LEAD_ORIGIN_GROUPS). */
  originGroup: string;
  criadoEm: string;
  /** Funil do card, ou null quando a pessoa nunca entrou em funil nenhum. */
  funnelId: number | null;
  /** Etapa atual; null = sem card no funil (parou na Chegada de Leads). */
  stageKey: string | null;
  stageKind: CommercialStageKind | null;
  /** Quando o card foi criado no funil. */
  cardCreatedAt: string | null;
  sellerName: string | null;
  sellerEmail: string | null;
  assignedAt: string | null;
  contactAttempts: number;
  closedAt: string | null;
  closedReason: string | null;
  /** Campanha/anúncio quando o lead veio de mídia paga (pode faltar). */
  campaignName: string | null;
  adName: string | null;
  /** Trilha completa, em ordem cronológica. */
  trail: LeadYieldStageStep[];
}

export interface LeadYieldStageDef {
  key: string;
  label: string;
  kind: CommercialStageKind;
  position: number;
}

/** Etapa sintética para quem nunca entrou no funil. Não é etapa de funil
 * nenhum: é a ausência de card, e some se a pessoa for distribuída. */
export const NO_CARD_KEY = "__sem_card__";
export const NO_CARD_LABEL = "Sem card no funil";

export interface LeadYieldStageRow extends LeadYieldStageDef {
  /** Pessoas cuja etapa ATUAL é esta — onde elas pararam. */
  pararam: number;
  /** Pessoas que passaram por esta etapa em algum momento. */
  alcancaram: number;
  /** Pessoas que entraram nesta etapa DENTRO do período consultado. */
  noPeriodo: number;
  /** % de `alcancaram` sobre a maior etapa sequencial anterior — ver
   * buildStageRows para por que a base não é simplesmente a etapa de cima. */
  conversao: number | null;
  /** % de `alcancaram` sobre o total de pessoas do recorte. */
  doTotal: number;
  /** Horas medianas entre a chegada da pessoa e a entrada nesta etapa. */
  horasMedianas: number | null;
}

export interface LeadYieldSummary {
  total: number;
  comCard: number;
  semCard: number;
  avancaram: number;
  agendaram: number;
  /** Agendaram DENTRO do período consultado — é a resposta de "de tal dia a
   * tal dia, quantas pessoas agendaram". */
  agendaramNoPeriodo: number;
  ganharam: number;
  perderam: number;
  semDono: number;
  /** Horas medianas da chegada até a primeira entrada na etapa de agendamento. */
  horasAteAgendar: number | null;
}

/** Etapa que a operação trata como agendamento. Mesma chave usada na aba
 * Horários (lib/leadArrivalAnalysis) — as duas telas precisam concordar. */
export const SCHEDULED_STAGE_KEY = "agendado";

/**
 * A pessoa esteve nesta etapa?
 *
 * Quando existe histórico de movimentação, ele é a única resposta: quem foi de
 * Conexão direto para "Compra futura" NÃO agendou, por mais que "compra futura"
 * fique depois de "agendado" na ordem do quadro. Deduzir passagem pela posição
 * enchia a lista de "quem agendou" de gente que nunca agendou — e essa lista é
 * justamente o que a operação usa para conferir agendamento por agendamento.
 *
 * A posição só decide quando não há histórico nenhum (card criado antes de os
 * eventos de etapa existirem, ou distribuído direto para o meio do funil): aí a
 * etapa atual é a única prova que sobrou, e ela implica as anteriores.
 */
export function leadReachedStage(lead: LeadYieldLead, stage: LeadYieldStageDef, stages: LeadYieldStageDef[]): boolean {
  if (lead.trail.some((step) => step.key === stage.key)) return true;

  const hasHistory = lead.trail.length > 1;
  if (hasHistory) return false;

  const current = stages.find((item) => item.key === lead.stageKey);
  if (!current) return false;
  if (stage.kind !== "entry" && stage.kind !== "normal") return lead.stageKind === stage.kind;
  if (current.kind !== "entry" && current.kind !== "normal") {
    // Ganho/perdido não têm lugar na sequência: quem está lá passou pelo menos
    // pela entrada, e o resto do caminho quem conta é a trilha.
    return stage.kind === "entry";
  }
  return current.position >= stage.position;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function hoursBetween(fromIso: string, toIso: string): number {
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 3_600_000;
}

/**
 * A conta principal: para cada etapa, quantos pararam ali, quantos passaram por
 * ela e quantos entraram nela dentro do período.
 *
 * "Pararam" e "alcançaram" respondem perguntas diferentes e as duas importam:
 * 5 parados em Conexão com 40 que passaram por lá é um funil que anda; 5 de 6 é
 * um funil entupido. A tela mostra as duas colunas lado a lado por isso.
 *
 * `alcancaram` conta quem ESTEVE na etapa, não quem "chegou àquela altura" —
 * este funil tem etapas opcionais no meio (no-show, compra futura) pelas quais
 * a maioria passa direto, e contá-las como degrau obrigatório inventaria
 * passagem que não houve.
 *
 * O preço disso é que a contagem não cai de forma monótona: dividir pela etapa
 * imediatamente acima dava conversão de 160% (16 agendados sobre 10 que
 * passaram pelo no-show). A base da conversão é, então, a etapa sequencial
 * anterior MAIS PRÓXIMA que ainda seja maior ou igual a esta — o degrau real
 * de onde essas pessoas vieram, pulando as etapas opcionais.
 */
export function buildStageRows(leads: LeadYieldLead[], stages: LeadYieldStageDef[]): LeadYieldStageRow[] {
  const rows: LeadYieldStageRow[] = [];
  const previousSequential: number[] = [];

  for (const stage of stages) {
    const pararam = leads.filter((lead) => lead.stageKey === stage.key).length;
    const alcancaram = leads.filter((lead) => leadReachedStage(lead, stage, stages)).length;
    const noPeriodo = leads.filter((lead) =>
      lead.trail.some((step) => step.key === stage.key && step.inWindow)
    ).length;

    const horas: number[] = [];
    for (const lead of leads) {
      const step = lead.trail.find((item) => item.key === stage.key);
      if (step) horas.push(hoursBetween(lead.criadoEm, step.at));
    }

    const isSequential = stage.kind === "entry" || stage.kind === "normal";
    const baseline = isSequential
      ? (previousSequential.findLast((count) => count >= alcancaram) ??
        (previousSequential.length > 0 ? Math.max(...previousSequential) : null))
      : null;
    const conversao = baseline !== null && baseline > 0 ? (alcancaram / baseline) * 100 : null;
    if (isSequential) previousSequential.push(alcancaram);

    rows.push({
      ...stage,
      pararam,
      alcancaram,
      noPeriodo,
      conversao,
      doTotal: leads.length > 0 ? (alcancaram / leads.length) * 100 : 0,
      horasMedianas: median(horas),
    });
  }

  return rows;
}

export function summarize(leads: LeadYieldLead[], stages: LeadYieldStageDef[]): LeadYieldSummary {
  const entryKeys = new Set(stages.filter((stage) => stage.kind === "entry").map((stage) => stage.key));
  const horasAgendar: number[] = [];
  for (const lead of leads) {
    const step = lead.trail.find((item) => item.key === SCHEDULED_STAGE_KEY);
    if (step) horasAgendar.push(hoursBetween(lead.criadoEm, step.at));
  }

  return {
    total: leads.length,
    comCard: leads.filter((lead) => lead.stageKey !== null).length,
    semCard: leads.filter((lead) => lead.stageKey === null).length,
    // Avançar = sair da etapa de entrada. Card parado em "Novo" não é
    // atendimento nenhum, por mais que apareça no quadro.
    avancaram: leads.filter((lead) => lead.stageKey !== null && !entryKeys.has(lead.stageKey)).length,
    agendaram: leads.filter((lead) => lead.trail.some((step) => step.key === SCHEDULED_STAGE_KEY)).length,
    agendaramNoPeriodo: leads.filter((lead) =>
      lead.trail.some((step) => step.key === SCHEDULED_STAGE_KEY && step.inWindow)
    ).length,
    ganharam: leads.filter((lead) => lead.stageKind === "won").length,
    perderam: leads.filter((lead) => lead.stageKind === "lost").length,
    semDono: leads.filter((lead) => !lead.sellerEmail && !lead.sellerName).length,
    horasAteAgendar: median(horasAgendar),
  };
}

/** Matriz origem × etapa de parada — é o retrato do Kanban misturado: uma
 * linha por formulário, uma coluna por etapa. */
export interface OriginBreakdownRow {
  originGroup: string;
  total: number;
  porEtapa: Record<string, number>;
  agendaram: number;
  ganharam: number;
}

export function buildOriginBreakdown(leads: LeadYieldLead[], stages: LeadYieldStageDef[]): OriginBreakdownRow[] {
  const byOrigin = new Map<string, LeadYieldLead[]>();
  for (const lead of leads) {
    const list = byOrigin.get(lead.originGroup) ?? [];
    list.push(lead);
    byOrigin.set(lead.originGroup, list);
  }

  return Array.from(byOrigin.entries())
    .map(([originGroup, group]) => {
      const porEtapa: Record<string, number> = {};
      for (const stage of stages) {
        porEtapa[stage.key] = group.filter((lead) => lead.stageKey === stage.key).length;
      }
      porEtapa[NO_CARD_KEY] = group.filter((lead) => lead.stageKey === null).length;
      return {
        originGroup,
        total: group.length,
        porEtapa,
        agendaram: group.filter((lead) => lead.trail.some((step) => step.key === SCHEDULED_STAGE_KEY)).length,
        ganharam: group.filter((lead) => lead.stageKind === "won").length,
      };
    })
    .sort((a, b) => b.total - a.total);
}

export interface SellerBreakdownRow {
  seller: string;
  total: number;
  avancaram: number;
  agendaram: number;
  ganharam: number;
  perderam: number;
  parados: Record<string, number>;
}

export function buildSellerBreakdown(leads: LeadYieldLead[], stages: LeadYieldStageDef[]): SellerBreakdownRow[] {
  const entryKeys = new Set(stages.filter((stage) => stage.kind === "entry").map((stage) => stage.key));
  const bySeller = new Map<string, LeadYieldLead[]>();
  for (const lead of leads) {
    const name = lead.sellerName ?? "Sem dono";
    const list = bySeller.get(name) ?? [];
    list.push(lead);
    bySeller.set(name, list);
  }

  return Array.from(bySeller.entries())
    .map(([seller, group]) => {
      const parados: Record<string, number> = {};
      for (const stage of stages) {
        parados[stage.key] = group.filter((lead) => lead.stageKey === stage.key).length;
      }
      return {
        seller,
        total: group.length,
        avancaram: group.filter((lead) => lead.stageKey !== null && !entryKeys.has(lead.stageKey)).length,
        agendaram: group.filter((lead) => lead.trail.some((step) => step.key === SCHEDULED_STAGE_KEY)).length,
        ganharam: group.filter((lead) => lead.stageKind === "won").length,
        perderam: group.filter((lead) => lead.stageKind === "lost").length,
        parados,
      };
    })
    .sort((a, b) => b.total - a.total);
}

/** "3d 4h", "5h", "12min" — intervalo em linguagem de operação, não em horas
 * decimais (ninguém lê "76.4h"). */
export function formatDuration(hours: number | null): string {
  if (hours === null || !Number.isFinite(hours)) return "—";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}min`;
  if (hours < 48) return `${Math.round(hours)}h`;
  const days = Math.floor(hours / 24);
  const rest = Math.round(hours % 24);
  return rest > 0 ? `${days}d ${rest}h` : `${days}d`;
}
