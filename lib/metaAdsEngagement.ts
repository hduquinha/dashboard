import type { EngagementMetrics } from "@/types/metaAds";

/**
 * Leitura das `actions` da Meta (guardadas em `ad_insights_daily.actions_raw`)
 * para os números de entrega e interação que o gerenciador mostra.
 *
 * A Meta devolve uma lista de pares `action_type`/`value` que muda conforme o
 * objetivo do anúncio, e vários tipos contam a MESMA coisa por caminhos
 * diferentes (`post_interaction_gross` × `post_engagement`, `like` ×
 * `onsite_conversion.post_net_like`). Este mapa fixa qual tipo é a fonte de
 * cada métrica da tela, para o número não oscilar conforme o tipo que aparecer
 * primeiro na lista.
 */
const ACTION_SOURCES: Record<keyof EngagementMetrics, string> = {
  videoViews: "video_view",
  linkClicks: "link_click",
  landingPageViews: "landing_page_view",
  postEngagement: "post_engagement",
  pageEngagement: "page_engagement",
  reactions: "post_reaction",
  comments: "comment",
  shares: "post",
  saves: "onsite_conversion.post_save",
  messagingStarted: "onsite_conversion.total_messaging_connection",
};

export const ENGAGEMENT_KEYS = Object.keys(ACTION_SOURCES) as Array<keyof EngagementMetrics>;

/** Os `action_type` que o SQL precisa somar — evita trazer do banco as ~30
 * variações que a tela não usa. */
export const TRACKED_ACTION_TYPES = Object.values(ACTION_SOURCES);

export function emptyEngagement(): EngagementMetrics {
  return {
    videoViews: 0,
    linkClicks: 0,
    landingPageViews: 0,
    postEngagement: 0,
    pageEngagement: 0,
    reactions: 0,
    comments: 0,
    shares: 0,
    saves: 0,
    messagingStarted: 0,
  };
}

function toCount(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === "string" ? Number.parseFloat(value) : Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

/** Converte `{ "video_view": "1234", ... }` (já somado por anúncio no SQL) nas
 * métricas nomeadas da tela. */
export function engagementFromActionTotals(totals: Record<string, unknown> | null | undefined): EngagementMetrics {
  const result = emptyEngagement();
  if (!totals) return result;
  for (const key of ENGAGEMENT_KEYS) {
    result[key] = toCount(totals[ACTION_SOURCES[key]]);
  }
  return result;
}

export function addEngagement(target: EngagementMetrics, source: EngagementMetrics): void {
  for (const key of ENGAGEMENT_KEYS) {
    target[key] += source[key];
  }
}

export interface EngagementMetricDef {
  key: keyof EngagementMetrics;
  label: string;
  hint: string;
}

/** Ordem e texto de cada métrica na tela — de "quantas pessoas viram" até
 * "quantas fizeram alguma coisa". */
export const ENGAGEMENT_METRIC_DEFS: EngagementMetricDef[] = [
  { key: "videoViews", label: "Visualizações de vídeo", hint: "Quem assistiu pelo menos 3 segundos." },
  { key: "postEngagement", label: "Interações com a publicação", hint: "Qualquer ação: reação, comentário, clique, compartilhamento." },
  { key: "pageEngagement", label: "Interações com o perfil", hint: "Interações contabilizadas para a página/perfil." },
  { key: "reactions", label: "Reações", hint: "Curtidas e demais reações na publicação." },
  { key: "comments", label: "Comentários", hint: "Comentários na publicação do anúncio." },
  { key: "shares", label: "Compartilhamentos", hint: "Quantas vezes a publicação foi compartilhada." },
  { key: "saves", label: "Salvamentos", hint: "Quem salvou a publicação para ver depois." },
  { key: "linkClicks", label: "Cliques no link", hint: "Cliques que abriram o destino do anúncio." },
  { key: "landingPageViews", label: "Página carregada", hint: "Cliques que realmente abriram a página — a diferença para os cliques é quem desistiu no caminho." },
  { key: "messagingStarted", label: "Conversas iniciadas", hint: "Conversas abertas no direct a partir do anúncio." },
];

/** Taxa de conclusão do clique: quantos cliques no link viraram página aberta.
 * Null quando não houve clique (a UI mostra "—", nunca 0%). */
export function landingPageCompletion(metrics: EngagementMetrics): number | null {
  return metrics.linkClicks > 0 ? (metrics.landingPageViews / metrics.linkClicks) * 100 : null;
}

/** Custo por resultado de engajamento: gasto ÷ interações com a publicação. */
export function costPerEngagement(spend: number, metrics: EngagementMetrics): number | null {
  return metrics.postEngagement > 0 ? spend / metrics.postEngagement : null;
}
