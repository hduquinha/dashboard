export type MetaAdsStatusFilter = "active" | "inactive" | "all";

/**
 * As quatro caixas em que todo envio de formulário atribuído a um anúncio cai,
 * sem sobra e sem sobreposição: `envios = descartados + repetidos + recontatos
 * + novos`. A regra que classifica está em lib/metaAds.ts (leadBucketExpr) e é
 * relativa à janela consultada — o mesmo envio é "repetido" numa janela que
 * contém o cadastro original e "recontato" numa que não contém.
 */
export type LeadBucket = "descartado" | "repetido" | "recontato" | "novo";

export type CampanhasTab =
  | "geral"
  | "inteligencia"
  | "relatorio"
  | "comparativos"
  | "alcance"
  | "grupos"
  | "horarios"
  | "diario"
  | "tabela"
  | "anuncios"
  | "leads"
  | "rendimento"
  | "vendedores";

/** Para que serve a campanha, segundo o objetivo declarado na Meta. Separa o
 * que é para TRAZER LEAD do que é para APARECER — misturar os dois numa média
 * de custo por lead faz a campanha de engajamento parecer um desastre de
 * captação, quando ela nem tem formulário. Ver lib/campaignObjectives.ts. */
export type CampaignPurpose = "captacao" | "engajamento" | "outro";

export interface MetaAdsFilters {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  status: MetaAdsStatusFilter;
  search?: string;
}

/**
 * O mínimo para MOSTRAR um criativo: miniatura, imagem plena e vídeo. Toda tela
 * em que se escolhe ou se lista um anúncio precisa disso — o gestor reconhece o
 * criativo pela imagem, não pelo código no nome (`VOZUP_AD20_IMG_AUTO`). É o
 * contrato do `CreativeThumb` e do `CreativeLightbox`, e o motivo pelo qual as
 * linhas diárias também carregam esses campos.
 */
export interface CreativeVisual {
  adName: string;
  thumbnailUrl: string | null;
  /** Imagem em resolução maior fornecida pelo criativo; thumbnail é fallback. */
  imageUrl: string | null;
  /** ID do vídeo do criativo (quando é anúncio de vídeo). A URL tocável é
   * resolvida sob demanda pela Graph API (ver getCreativeVideoSource), pois o
   * `source` da Meta expira em poucas horas — não dá pra guardar no banco. */
  videoId: string | null;
}

/**
 * O que aconteceu com o anúncio além do clique — tudo já vinha guardado em
 * `meta_ads.ad_insights_daily.actions_raw` desde o primeiro sync, só não era
 * lido. São as linhas que o gerenciador da Meta mostra em "Resultados" para
 * campanha de engajamento e as que faltavam para julgar criativo (um vídeo
 * pode ter poucos leads e muita visualização, e isso muda a decisão).
 */
export interface EngagementMetrics {
  /** Visualizações de vídeo de 3 segundos (`video_view`). */
  videoViews: number;
  /** Cliques no link do anúncio (`link_click`) — subconjunto de `clicks`. */
  linkClicks: number;
  /** Carregou a página de destino (`landing_page_view`); a diferença para
   * linkClicks é gente que desistiu antes da página abrir. */
  landingPageViews: number;
  /** Qualquer interação com a publicação (`post_engagement`). */
  postEngagement: number;
  /** Interações com a página/perfil (`page_engagement`). */
  pageEngagement: number;
  /** Curtidas e outras reações na publicação (`post_reaction`). */
  reactions: number;
  comments: number;
  /** Compartilhamentos (`post`). */
  shares: number;
  /** Salvamentos (`onsite_conversion.post_save`). */
  saves: number;
  /** Conversas iniciadas no direct (`onsite_conversion.total_messaging_connection`). */
  messagingStarted: number;
}

export interface AdRow extends CreativeVisual, EngagementMetrics {
  adId: string;
  /** Objetivo declarado da campanha (ex.: OUTCOME_LEADS, OUTCOME_ENGAGEMENT). */
  campaignObjective: string | null;
  campaignPurpose: CampaignPurpose;
  status: string;
  effectiveStatus: string | null;
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
  /** PESSOAS atribuídas ao anúncio: `novos + recontatos`. É quem a equipe
   * encontra no CRM para atender e o denominador do custo por cadastro. */
  cadastrosCrm: number;
  /** Todo preenchimento de formulário atribuído ao anúncio, sem tirar nada.
   * É o campo que fala a MESMA língua da Meta (ela conta envio, não pessoa),
   * então é por ele que se compara com o gerenciador.
   * Sempre `descartados + repetidos + recontatos + novos`. */
  envios: number;
  /** Envios marcados como lixo/teste à mão no CRM. */
  descartados: number;
  /** A mesma pessoa preencheu de novo DENTRO da janela consultada — contato
   * repetido, não contato a mais. */
  repetidos: number;
  /** Pessoa que já era da base (primário anterior à janela) e voltou pelo
   * anúncio. Conta como cadastro, não como contato novo. */
  recontatos: number;
  /** Pessoa inédita no CRM — o crescimento real que o anúncio gerou. */
  novos: number;
  /** Recorte de cadastrosCrm que já está no funil comercial padrão. Fica menor
   * quando a pessoa foi cadastrada mas ainda não entrou na pipeline. */
  leadsCrm: number;
  leadsQualificados: number;
  leadsFechados: number;
  valorFechado: number;
  cplReal: number | null;
  cacReal: number | null;
  /** Distribuição atual dos leads desse anúncio por etapa do funil (chave = funnel_stages.key). */
  stageCounts: Record<string, number>;
}

export interface AggregatedMetrics extends EngagementMetrics {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  leadsMeta: number;
  cadastrosCrm: number;
  envios: number;
  descartados: number;
  repetidos: number;
  recontatos: number;
  novos: number;
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
  objective: string | null;
  purpose: CampaignPurpose;
  adsets: AdsetGroup[];
  totals: AggregatedMetrics;
}

export interface KpiTotals extends AggregatedMetrics {
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  /** Investimento ÷ cadastros salvos — o "custo médio por lead" que o gestor
   * cobra da mídia (ex.: R$ 400 e 50 cadastros = R$ 8,00 por lead). */
  custoPorCadastro: number | null;
  cplReal: number | null;
  cacReal: number | null;
}

/**
 * Números que a Meta calcula para a JANELA inteira, não por dia. Alcance e
 * frequência são assim: a mesma pessoa alcançada em três dias por dois
 * anúncios é UMA pessoa no período, e nenhuma soma de linhas diárias recupera
 * isso. Por isso a Meta é a fonte deste bloco (ver getPeriodReach).
 */
export interface PeriodReachRow {
  reach: number;
  impressions: number;
  spend: number;
  clicks: number;
  /** Leads que a Meta contou na janela (evento de envio, não pessoa única). */
  leads: number;
  frequency: number | null;
}

export interface PeriodReachData {
  from: string;
  to: string;
  /** Conta inteira no período — o "Alcance" do rodapé do gerenciador. */
  account: PeriodReachRow | null;
  byCampaign: Record<string, PeriodReachRow>;
  byAdset: Record<string, PeriodReachRow>;
  syncedAt: string | null;
}

/** Uma métrica conferida: o que a Meta diz, o que a tela mostra e a diferença. */
export interface ReconciliationLine {
  meta: number;
  dash: number;
  diff: number;
  ok: boolean;
}

/**
 * Conferência da tela contra o gerenciador. Mídia (gasto, impressões, cliques,
 * leads marcados) TEM que bater — se não bater, a janela é ressincronizada
 * sozinha. Já o bloco `crm` não é uma divergência a corrigir: a Meta conta
 * ENVIO de formulário e o CRM conta PESSOA, então ele existe para mostrar por
 * onde a diferença passa.
 */
export interface MetaReconciliation {
  from: string;
  to: string;
  status: "ok" | "ajustado" | "divergente" | "indisponivel";
  /** A janela precisou ser ressincronizada nesta conferência. */
  healed: boolean;
  /** A janela inclui o dia de hoje, que ainda está sendo contabilizado — os
   * números mexem até o fim do dia e a comparação usa margem proporcional. */
  parcial: boolean;
  spend: ReconciliationLine;
  impressions: ReconciliationLine;
  clicks: ReconciliationLine;
  leads: ReconciliationLine;
  crm: {
    /** Envios de formulário que a atribuição ligou a um anúncio — a régua
     * comparável com o número de leads da Meta. Sempre igual a
     * `excluidos + duplicados + recontatos + novos`. */
    envios: number;
    /** Marcados como lixo/teste à mão. */
    excluidos: number;
    /** A mesma pessoa preencheu de novo dentro da janela. */
    duplicados: number;
    /** Já era da base e voltou pelo anúncio. */
    recontatos: number;
    /** Pessoa inédita no CRM. */
    novos: number;
    /** Pessoas reais no CRM (`novos + recontatos`) — é este o número que a tela
     * mostra em "Cadastros". */
    pessoas: number;
    /** Chegaram com sinal de anúncio que não resolve (ex.: link da bio). */
    semAnuncio: number;
  };
  checkedAt: string;
}

export interface DailySeriesPoint {
  date: string;
  spend: number;
  leadsMeta: number;
  cadastrosCrm: number;
  /** Recorte de cadastrosCrm sem os recontatos — pessoas inéditas no dia. */
  novos: number;
  leadsCrm: number;
  impressions: number;
  reach: number;
  videoViews: number;
}

/** Onde o anúncio entrega o clique: formulário instantâneo dentro da Meta ou
 * uma landing page do site. Ver lib/adDestinationGroups.ts. */
export type AdDestinationKind = "native_form" | "landing_page" | "unknown";

export interface AdDestinationInfo {
  kind: AdDestinationKind;
  /** Chave estável de agrupamento (ex.: "native_form", "lp:vendas/6-perguntas"). */
  key: string;
  label: string;
  /** Complemento do rótulo (variante do formulário, explicação do nativo). */
  detail: string | null;
  /** Página real, sem query string — null quando o formulário vive dentro da Meta. */
  url: string | null;
}

/** Grupo de anúncios que compartilham o mesmo destino, com métricas somadas e
 * os custos médios já derivados. */
export interface AdDestinationGroup extends AdDestinationInfo, AggregatedMetrics {
  ads: AdRow[];
  /** Criativos distintos (nome do anúncio) dentro do grupo. */
  creativeCount: number;
  campaignCount: number;
  adsetCount: number;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  /** Investimento ÷ cadastros salvos. */
  custoPorCadastro: number | null;
  /** Investimento ÷ contatos novos no CRM. */
  custoPorContato: number | null;
  /** Investimento ÷ vendas fechadas. */
  custoPorVenda: number | null;
}

/** Uma linha por (dia × anúncio) — base da análise diária. O cliente agrupa por
 * dia e por destino a partir daqui, sem consulta extra. Traz os campos visuais
 * (CreativeVisual) para a lista e o seletor de anúncio mostrarem o criativo. */
export interface DailyAdRow extends CreativeVisual {
  date: string;
  adId: string;
  adsetName: string;
  campaignName: string;
  landingUrl: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  leadsMeta: number;
  cadastrosCrm: number;
  /** Recorte de cadastrosCrm sem os recontatos. */
  novos: number;
  /** Todo preenchimento do dia atribuído ao anúncio, inclusive descartado e
   * repetido — a régua comparável com o número da Meta. */
  envios: number;
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
  /** Em qual das quatro caixas este envio caiu (ver LeadBucket em lib/metaAds).
   * Aqui só aparecem "novo", "recontato" e "repetido" — descartado fica fora
   * da listagem. */
  bucket: LeadBucket;
  /** true quando este cadastro reencontrou uma pessoa que já existia no CRM —
   * atalho para `bucket !== "novo"`. */
  isReturning: boolean;
}

/** Lead recente atribuído a um anúncio — usado na aba "Últimos Leads", onde o
 * gestor quer ver de relance quem chegou, de qual anúncio (com a peça à vista)
 * e em que etapa. */
export interface RecentAdLead extends AdLeadSummary, CreativeVisual {
  campaignName: string;
  adsetName: string;
  /** Nome do vendedor responsável no CRM, ou null se ainda não distribuído. */
  sellerName: string | null;
}

/**
 * Um lead de anúncio com tudo que a análise por horário e por grupo de destino
 * precisa: quando ele chegou (já no fuso da conta de anúncios), de qual peça
 * veio, onde ele parou no funil e por quais etapas passou. É a granularidade de
 * PESSOA — as outras estruturas da tela são somas por anúncio ou por dia, e
 * nenhuma delas responde "quem chegou às 21h e quantos desses agendaram".
 */
export interface AdLeadDetail extends AdLeadSummary, CreativeVisual {
  /** Hora local da chegada (0–23) no fuso da conta Meta (America/Sao_Paulo). */
  hora: number;
  /** Dia da semana da chegada: 0 = domingo … 6 = sábado, mesmo fuso. */
  diaSemana: number;
  /** Data local da chegada (YYYY-MM-DD), mesmo fuso. */
  dia: string;
  adId: string;
  campaignName: string;
  adsetName: string;
  /** URL de destino do anúncio — classifica o lead no grupo (nativo × LP). */
  landingUrl: string | null;
  stageKey: string | null;
  sellerName: string | null;
  /** Etapas pelas quais o lead passou em algum momento (histórico de
   * commercial_events + etapa atual), não só onde ele está agora. */
  etapasAlcancadas: string[];
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
