import { classifyAdDestination } from "@/lib/adDestinationGroups";
import type { AdDestinationInfo, AdLeadDetail } from "@/types/metaAds";

/**
 * Análise de CHEGADA dos leads de anúncio: a que horas as pessoas se cadastram
 * e o que aconteceu com elas depois. Todas as funções aqui são puras — recebem
 * os leads já resolvidos por `getAdLeadDetails` (com hora/dia da semana no fuso
 * da conta de anúncios) e devolvem agregados prontos para a tela.
 *
 * A pergunta que isso responde é "o horário em que o lead entra muda o
 * resultado dele?" — por isso todo bucket carrega, além da contagem, os leads
 * que o compõem: sem a lista, um pico às 21h não dá para ser conferido.
 */

/** Etapa que representa "conseguiu marcar" no funil. É a chave usada pelos
 * funis criados por `lib/funnels.ts` (rótulo pode ser renomeado pela operação,
 * a chave não). */
export const SCHEDULED_STAGE_KEY = "agendado";

export interface ArrivalOutcomes {
  /** PESSOAS: novas + as que já eram da base e voltaram. Mesma definição de
   * "Cadastros" no resto de /campanhas — quem preencheu duas vezes na janela
   * (bucket "repetido") entra na lista, para o horário de chegada não sumir,
   * mas não é contado de novo aqui. */
  cadastros: number;
  /** Pessoas inéditas no CRM. */
  contatosNovos: number;
  /** Chegaram à etapa "Agendado" EM ALGUM MOMENTO, não só quem está lá agora. */
  agendaram: number;
  ganhos: number;
  perdidos: number;
  semDono: number;
  /** agendaram ÷ cadastros. Null sem cadastro, para a UI mostrar "—". */
  taxaAgendamento: number | null;
}

export function summarizeArrival(leads: AdLeadDetail[]): ArrivalOutcomes {
  let cadastros = 0;
  let contatosNovos = 0;
  let agendaram = 0;
  let ganhos = 0;
  let perdidos = 0;
  let semDono = 0;

  for (const lead of leads) {
    if (lead.bucket !== "repetido") cadastros += 1;
    if (lead.bucket === "novo") contatosNovos += 1;
    if (lead.etapasAlcancadas.includes(SCHEDULED_STAGE_KEY)) agendaram += 1;
    if (lead.stageKind === "won") ganhos += 1;
    if (lead.stageKind === "lost") perdidos += 1;
    if (!lead.sellerName) semDono += 1;
  }

  return {
    cadastros,
    contatosNovos,
    agendaram,
    ganhos,
    perdidos,
    semDono,
    taxaAgendamento: cadastros > 0 ? (agendaram / cadastros) * 100 : null,
  };
}

export interface HourBlock {
  key: string;
  label: string;
  range: string;
  startHour: number;
  /** Inclusivo. */
  endHour: number;
}

/**
 * Faixas do dia. Existem porque a granularidade de hora cheia é ruidosa no
 * volume real desta conta (dezenas de leads por mês, ~2 a 9 por hora): a faixa
 * é onde o número vira decisão ("de noite chega o dobro"), a hora fica para
 * conferência fina.
 */
export const HOUR_BLOCKS: HourBlock[] = [
  { key: "madrugada", label: "Madrugada", range: "00h–05h", startHour: 0, endHour: 5 },
  { key: "manha", label: "Manhã", range: "06h–11h", startHour: 6, endHour: 11 },
  { key: "tarde", label: "Tarde", range: "12h–17h", startHour: 12, endHour: 17 },
  { key: "noite", label: "Noite", range: "18h–23h", startHour: 18, endHour: 23 },
];

export function blockForHour(hour: number): HourBlock {
  return HOUR_BLOCKS.find((block) => hour >= block.startHour && hour <= block.endHour) ?? HOUR_BLOCKS[0];
}

/** "21h" — rótulo curto do eixo e das listas. */
export function formatHourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}h`;
}

export interface HourArrival extends ArrivalOutcomes {
  hora: number;
  label: string;
  blockKey: string;
  leads: AdLeadDetail[];
}

/** Sempre 24 posições, inclusive as horas sem nenhum lead — o buraco no gráfico
 * é informação ("ninguém se cadastra às 5h"). */
export function buildHourlyArrival(leads: AdLeadDetail[]): HourArrival[] {
  const byHour = new Map<number, AdLeadDetail[]>();
  for (const lead of leads) {
    const list = byHour.get(lead.hora);
    if (list) list.push(lead);
    else byHour.set(lead.hora, [lead]);
  }

  return Array.from({ length: 24 }, (_, hora) => {
    const hourLeads = byHour.get(hora) ?? [];
    return {
      hora,
      label: formatHourLabel(hora),
      blockKey: blockForHour(hora).key,
      leads: hourLeads,
      ...summarizeArrival(hourLeads),
    };
  });
}

export interface BlockArrival extends HourBlock, ArrivalOutcomes {
  leads: AdLeadDetail[];
  /** Fatia dos cadastros do recorte que caiu nesta faixa (0–100). */
  participacao: number;
}

export function buildBlockArrival(leads: AdLeadDetail[]): BlockArrival[] {
  return HOUR_BLOCKS.map((block) => {
    const blockLeads = leads.filter((lead) => lead.hora >= block.startHour && lead.hora <= block.endHour);
    return {
      ...block,
      leads: blockLeads,
      participacao: leads.length > 0 ? (blockLeads.length / leads.length) * 100 : 0,
      ...summarizeArrival(blockLeads),
    };
  });
}

const WEEKDAY_LABELS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const WEEKDAY_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export interface WeekdayArrival extends ArrivalOutcomes {
  diaSemana: number;
  label: string;
  shortLabel: string;
  leads: AdLeadDetail[];
}

/** Sempre 7 posições, de domingo a sábado. */
export function buildWeekdayArrival(leads: AdLeadDetail[]): WeekdayArrival[] {
  return WEEKDAY_LABELS.map((label, diaSemana) => {
    const dayLeads = leads.filter((lead) => lead.diaSemana === diaSemana);
    return {
      diaSemana,
      label,
      shortLabel: WEEKDAY_SHORT[diaSemana],
      leads: dayLeads,
      ...summarizeArrival(dayLeads),
    };
  });
}

export interface WeekdayBlockCell {
  diaSemana: number;
  blockKey: string;
  cadastros: number;
  agendaram: number;
  leads: AdLeadDetail[];
}

/**
 * Matriz dia da semana × faixa (7 × 4 = 28 células). Com o volume real, uma
 * matriz por hora cheia (7 × 24) teria quase só zeros; por faixa cada célula
 * tem massa suficiente para significar alguma coisa.
 */
export function buildWeekdayBlockMatrix(leads: AdLeadDetail[]): WeekdayBlockCell[] {
  const cells: WeekdayBlockCell[] = [];
  for (let diaSemana = 0; diaSemana < 7; diaSemana += 1) {
    for (const block of HOUR_BLOCKS) {
      const cellLeads = leads.filter(
        (lead) =>
          lead.diaSemana === diaSemana && lead.hora >= block.startHour && lead.hora <= block.endHour
      );
      cells.push({
        diaSemana,
        blockKey: block.key,
        cadastros: cellLeads.length,
        agendaram: cellLeads.filter((lead) => lead.etapasAlcancadas.includes(SCHEDULED_STAGE_KEY)).length,
        leads: cellLeads,
      });
    }
  }
  return cells;
}

/** Hora com mais chegadas; null quando o recorte não tem lead nenhum. */
export function peakHour(hours: HourArrival[]): HourArrival | null {
  let best: HourArrival | null = null;
  for (const hour of hours) {
    if (hour.cadastros > 0 && (!best || hour.cadastros > best.cadastros)) best = hour;
  }
  return best;
}

/**
 * Faixa com a melhor taxa de agendamento. Exige um mínimo de cadastros porque
 * "1 lead, 1 agendamento = 100%" não é uma descoberta — é ruído, e apontá-lo
 * como "melhor horário" faria a operação remanejar time por acaso estatístico.
 */
export function bestSchedulingBlock(blocks: BlockArrival[], minSample = 5): BlockArrival | null {
  let best: BlockArrival | null = null;
  for (const block of blocks) {
    if (block.cadastros < minSample || block.taxaAgendamento === null) continue;
    if (!best || (block.taxaAgendamento ?? 0) > (best.taxaAgendamento ?? 0)) best = block;
  }
  return best;
}

export interface DestinationLeadGroup extends ArrivalOutcomes {
  key: string;
  destination: AdDestinationInfo;
  leads: AdLeadDetail[];
}

/**
 * Agrupa os leads pelo destino do anúncio que os trouxe (formulário nativo ×
 * cada landing page), usando a mesma classificação dos grupos de mídia — assim
 * a aba "Grupos" mostra as PESSOAS de cada grupo com a mesma chave que já usa
 * para somar gasto e custo por lead.
 */
export function groupLeadsByDestination(leads: AdLeadDetail[]): Map<string, DestinationLeadGroup> {
  const byKey = new Map<string, DestinationLeadGroup>();

  for (const lead of leads) {
    const destination = classifyAdDestination(lead.landingUrl);
    const group = byKey.get(destination.key);
    if (group) {
      group.leads.push(lead);
    } else {
      byKey.set(destination.key, {
        key: destination.key,
        destination,
        leads: [lead],
        ...summarizeArrival([]),
      });
    }
  }

  for (const group of byKey.values()) {
    Object.assign(group, summarizeArrival(group.leads));
    group.leads.sort((a, b) => new Date(b.criadoEm).getTime() - new Date(a.criadoEm).getTime());
  }

  return byKey;
}
