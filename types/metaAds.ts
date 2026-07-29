export type MetaAdsStatusFilter = "active" | "inactive" | "all";

export type CampanhasTab = "geral" | "tabela" | "anuncios" | "leads" | "vendedores";

export interface MetaAdsFilters {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  status: MetaAdsStatusFilter;
  search?: string;
}

export interface AdRow {
  adId: string;
  adName: string;
  status: string;
  effectiveStatus: string | null;
  thumbnailUrl: string | null;
  /** Imagem em resolução maior fornecida pelo criativo; thumbnail é fallback. */
  imageUrl: string | null;
  /** ID do vídeo do criativo (quando é anúncio de vídeo). A URL tocável é
   * resolvida sob demanda pela Graph API (ver getCreativeVideoSource), pois o
   * `source` da Meta expira em poucas horas — não dá pra guardar no banco. */
  videoId: string | null;
  /** URL de destino informada pelo criativo; nula em anúncios sem landing page identificável. */
  landingUrl: string | null;
  adsetId: string;
  adsetName: string;
  adsetStatus: string;
  campaignId: string;
  campaignName: string;
  campaignStatus: string;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  frequency: number | null;
  leadsMeta: number;
  /** Cadastros que o endpoint da landing page salvou, incluindo retornos de
   * uma pessoa que já existia e foi mesclada ao contato anterior. */
  cadastrosCrm: number;
  /** Contatos novos/primários atribuídos ao anúncio (não inclui retornos
   * mesclados). Mantido separado de cadastrosCrm para não esconder o fato de
   * que o formulário funcionou quando a pessoa já estava no CRM. */
  leadsCrm: number;
  leadsQualificados: number;
  leadsFechados: number;
  valorFechado: number;
  cplReal: number | null;
  cacReal: number | null;
  /** Distribuição atual dos leads desse anúncio por etapa do funil (chave = funnel_stages.key). */
  stageCounts: Record<string, number>;
}

export interface AggregatedMetrics {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  leadsMeta: number;
  cadastrosCrm: number;
  leadsCrm: number;
  leadsQualificados: number;
  leadsFechados: number;
  valorFechado: number;
  stageCounts: Record<string, number>;
}

export type FunnelStageKind = "entry" | "normal" | "won" | "lost";

export interface FunnelStageDef {
  position: number;
  key: string;
  label: string;
  kind: FunnelStageKind;
}

export interface FunnelStagePoint extends FunnelStageDef {
  /** Leads que chegaram a esta etapa (ou etapa posterior) em algum momento —
   * calculado a partir do histórico de commercial_events, não da etapa atual. */
  count: number;
}

export interface FunnelScopeOption {
  key: string; // "all" ou campaignId
  label: string;
}

export interface AdsetGroup {
  adsetId: string;
  adsetName: string;
  status: string;
  ads: AdRow[];
  totals: AggregatedMetrics;
}

export interface CampaignGroup {
  campaignId: string;
  campaignName: string;
  status: string;
  adsets: AdsetGroup[];
  totals: AggregatedMetrics;
}

export interface KpiTotals extends AggregatedMetrics {
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  cplReal: number | null;
  cacReal: number | null;
}

export interface DailySeriesPoint {
  date: string;
  spend: number;
  leadsMeta: number;
  cadastrosCrm: number;
  leadsCrm: number;
}

export interface SyncRunSummary {
  syncType: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  rowsUpserted: number | null;
}

export interface AdLeadSummary {
  id: number;
  nome: string | null;
  telefone: string | null;
  email: string | null;
  criadoEm: string;
  stageLabel: string | null;
  stageKind: FunnelStageKind | null;
  /** true quando este cadastro reencontrou uma pessoa que já existia no CRM. */
  isReturning: boolean;
}

/** Lead recente atribuído a um anúncio — usado na aba "Últimos Leads", onde o
 * gestor quer ver de relance quem chegou, de qual anúncio e em que etapa. */
export interface RecentAdLead extends AdLeadSummary {
  campaignName: string;
  adsetName: string;
  adName: string;
  /** Nome do vendedor responsável no CRM, ou null se ainda não distribuído. */
  sellerName: string | null;
}

/** Desempenho por vendedor considerando SÓ os leads vindos de anúncios (Meta)
 * no período — base da aba "Vendedores". A linha sem vendedor (não distribuído)
 * vem com sellerName null. */
export interface SellerAdPerformance {
  sellerName: string | null;
  sellerEmail: string | null;
  totalLeads: number;
  qualificados: number;
  ganhos: number;
  perdidos: number;
  valorFechado: number;
}

/** URL tocável de um vídeo de criativo, resolvida sob demanda pela Graph API. */
export interface CreativeVideoSource {
  source: string | null;
  permalinkUrl: string | null;
}
