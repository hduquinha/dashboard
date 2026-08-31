import { getPool } from "@/lib/db";

/**
 * Leitura das métricas do Google Ads para a aba "Google Ads" de /campanhas.
 *
 * Por que este arquivo existe separado de `lib/metaAds.ts`: o que o Google
 * entrega é um subconjunto do que a Meta entrega. Não há criativo, miniatura
 * nem alcance — logo, nada de galeria de peças nem de alcance deduplicado. A
 * unidade de análise aqui é campanha → grupo de anúncios → anúncio, e a métrica
 * que interessa é custo por lead REAL (o do CRM), não a conversão que o Google
 * declara.
 *
 * Sobre `conversions`: vem de `metrics.conversions` da API (ver
 * `lib/googleAds.ts`), que é a coluna oficial do Google — só as ações marcadas
 * como principais. NÃO é `all_conversions`. Em 2026-08-13 a diferença entre as
 * duas na conta VozUp era de 1 contra 53, porque existe uma ação importada do
 * GA4 ("Enviar formulário de lead", MANY_PER_CLICK) que conta clique em botão
 * como envio de formulário. Ver `docs/google-ads-integracao.md`.
 */

const TZ = "America/Sao_Paulo";

/** Mesma normalização de origem usada em lib/vozupFolders.ts. */
const ORIGEM_NORM = `LOWER(TRIM(COALESCE(i.payload->>'origem', '')))`;
/** Mesma exclusão de lixo usada em lib/metaAds.ts. */
const LEAD_NOT_EXCLUDED = `COALESCE(i.payload->>'dashboard_excluido', '') != 'true'`;

/**
 * Um lead conta como "do Google" quando o formulário diz que é — a origem é
 * gravada pelo próprio formulário. O `gclid` entra como reforço para o caso de
 * a origem ter vindo vazia, mas nunca como fonte primária: UTM e clique pago
 * não mudam o produto nem o formulário de entrada (ver a cartilha).
 */
const LEAD_IS_GOOGLE = `(${ORIGEM_NORM} LIKE '%google ads%'
  OR (COALESCE(${ORIGEM_NORM}, '') = '' AND COALESCE(i.payload->>'gclid', '') <> ''))`;

export interface GoogleAdsTotals {
  costBrl: number;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number | null;
  cpcBrl: number | null;
  crmLeads: number;
  costPerCrmLeadBrl: number | null;
  costPerGoogleConversionBrl: number | null;
}

export interface GoogleAdsCampaignRow {
  campaignId: string;
  campaignName: string;
  status: string | null;
  channelType: string | null;
  costBrl: number;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number | null;
  cpcBrl: number | null;
}

export interface GoogleAdsAdRow {
  adId: string;
  adName: string | null;
  adStatus: string | null;
  adGroupId: string;
  adGroupName: string;
  campaignId: string;
  campaignName: string;
  finalUrl: string | null;
  costBrl: number;
  impressions: number;
  clicks: number;
  conversions: number;
}

export interface GoogleAdsDailyPoint {
  date: string;
  costBrl: number;
  clicks: number;
  impressions: number;
  conversions: number;
  crmLeads: number;
}

export interface GoogleAdsLeadRow {
  id: number;
  nome: string | null;
  telefone: string | null;
  origem: string | null;
  criadoEm: string;
  hasGclid: boolean;
  utmCampaign: string | null;
}

export interface GoogleAdsReport {
  hasData: boolean;
  totals: GoogleAdsTotals;
  campaigns: GoogleAdsCampaignRow[];
  ads: GoogleAdsAdRow[];
  daily: GoogleAdsDailyPoint[];
  leads: GoogleAdsLeadRow[];
  lastSyncedAt: string | null;
}

const num = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** micros → reais. A API devolve custo multiplicado por 1.000.000. */
const microsToBrl = (value: unknown): number => num(value) / 1_000_000;

const ratio = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? numerator / denominator : null;

/**
 * CTR já sai daqui em pontos percentuais (4.33 = 4,33%), não em fração.
 * `formatPercent` só carimba o "%" no número que recebe, e é assim que a Meta
 * também guarda o campo (ver `ctr` em lib/metaAds.ts) — devolver 0.0433 daria
 * "0,04%" na tela, cem vezes menor que o real.
 */
const percent = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? (numerator / denominator) * 100 : null;

export async function getGoogleAdsReport(from: string, to: string): Promise<GoogleAdsReport> {
  const pool = getPool();

  const [totalsRes, campaignsRes, adsRes, dailyRes, crmLeadsRes, leadsRes, syncRes] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(ins.cost_micros), 0)  AS cost_micros,
              COALESCE(SUM(ins.impressions), 0)  AS impressions,
              COALESCE(SUM(ins.clicks), 0)       AS clicks,
              COALESCE(SUM(ins.conversions), 0)  AS conversions
         FROM google_ads.ad_insights_daily ins
        WHERE ins.date BETWEEN $1::date AND $2::date`,
      [from, to]
    ),
    pool.query(
      `SELECT c.campaign_id,
              c.name,
              c.status,
              c.advertising_channel_type,
              COALESCE(SUM(ins.cost_micros), 0) AS cost_micros,
              COALESCE(SUM(ins.impressions), 0) AS impressions,
              COALESCE(SUM(ins.clicks), 0)      AS clicks,
              COALESCE(SUM(ins.conversions), 0) AS conversions
         FROM google_ads.campaigns c
         LEFT JOIN google_ads.ads a ON a.campaign_id = c.campaign_id
         LEFT JOIN google_ads.ad_insights_daily ins
                ON ins.ad_id = a.ad_id AND ins.date BETWEEN $1::date AND $2::date
        GROUP BY c.campaign_id, c.name, c.status, c.advertising_channel_type
        ORDER BY COALESCE(SUM(ins.cost_micros), 0) DESC, c.name ASC`,
      [from, to]
    ),
    pool.query(
      `SELECT a.ad_id,
              a.name       AS ad_name,
              a.status     AS ad_status,
              a.final_urls,
              g.ad_group_id,
              g.name       AS ad_group_name,
              c.campaign_id,
              c.name       AS campaign_name,
              COALESCE(SUM(ins.cost_micros), 0) AS cost_micros,
              COALESCE(SUM(ins.impressions), 0) AS impressions,
              COALESCE(SUM(ins.clicks), 0)      AS clicks,
              COALESCE(SUM(ins.conversions), 0) AS conversions
         FROM google_ads.ads a
         JOIN google_ads.ad_groups g ON g.ad_group_id = a.ad_group_id
         JOIN google_ads.campaigns c ON c.campaign_id = a.campaign_id
         LEFT JOIN google_ads.ad_insights_daily ins
                ON ins.ad_id = a.ad_id AND ins.date BETWEEN $1::date AND $2::date
        GROUP BY a.ad_id, a.name, a.status, a.final_urls, g.ad_group_id, g.name, c.campaign_id, c.name
        ORDER BY COALESCE(SUM(ins.cost_micros), 0) DESC, c.name ASC`,
      [from, to]
    ),
    pool.query(
      `SELECT ins.date::text AS date,
              COALESCE(SUM(ins.cost_micros), 0) AS cost_micros,
              COALESCE(SUM(ins.clicks), 0)      AS clicks,
              COALESCE(SUM(ins.impressions), 0) AS impressions,
              COALESCE(SUM(ins.conversions), 0) AS conversions
         FROM google_ads.ad_insights_daily ins
        WHERE ins.date BETWEEN $1::date AND $2::date
        GROUP BY ins.date
        ORDER BY ins.date`,
      [from, to]
    ),
    pool.query(
      `SELECT (i.criado_em AT TIME ZONE '${TZ}')::date::text AS date, COUNT(*)::int AS leads
         FROM inscricoes.inscricoes i
        WHERE ${LEAD_NOT_EXCLUDED}
          AND ${LEAD_IS_GOOGLE}
          AND i.criado_em >= ($1::date::timestamp AT TIME ZONE '${TZ}')
          AND i.criado_em <  (($2::date + 1)::timestamp AT TIME ZONE '${TZ}')
        GROUP BY 1`,
      [from, to]
    ),
    pool.query(
      `SELECT i.id,
              i.payload->>'nome'     AS nome,
              i.payload->>'telefone' AS telefone,
              i.payload->>'origem'   AS origem,
              i.criado_em,
              COALESCE(i.payload->>'gclid', '') <> '' AS has_gclid,
              i.payload->>'utm_campaign' AS utm_campaign
         FROM inscricoes.inscricoes i
        WHERE ${LEAD_NOT_EXCLUDED}
          AND ${LEAD_IS_GOOGLE}
          AND i.criado_em >= ($1::date::timestamp AT TIME ZONE '${TZ}')
          AND i.criado_em <  (($2::date + 1)::timestamp AT TIME ZONE '${TZ}')
        ORDER BY i.criado_em DESC
        LIMIT 100`,
      [from, to]
    ),
    pool.query(
      `SELECT MAX(finished_at) AS last_synced_at
         FROM google_ads.sync_runs
        WHERE status = 'success'`
    ),
  ]);

  const t = totalsRes.rows[0] ?? {};
  const costBrl = microsToBrl(t.cost_micros);
  const impressions = num(t.impressions);
  const clicks = num(t.clicks);
  const conversions = num(t.conversions);

  const crmByDate = new Map<string, number>(
    crmLeadsRes.rows.map((row) => [String(row.date), num(row.leads)])
  );
  const crmLeads = [...crmByDate.values()].reduce((sum, value) => sum + value, 0);

  const daily: GoogleAdsDailyPoint[] = dailyRes.rows.map((row) => ({
    date: String(row.date),
    costBrl: microsToBrl(row.cost_micros),
    clicks: num(row.clicks),
    impressions: num(row.impressions),
    conversions: num(row.conversions),
    crmLeads: crmByDate.get(String(row.date)) ?? 0,
  }));

  const campaigns: GoogleAdsCampaignRow[] = campaignsRes.rows.map((row) => {
    const rowClicks = num(row.clicks);
    const rowImpressions = num(row.impressions);
    const rowCost = microsToBrl(row.cost_micros);
    return {
      campaignId: String(row.campaign_id),
      campaignName: String(row.name),
      status: row.status ?? null,
      channelType: row.advertising_channel_type ?? null,
      costBrl: rowCost,
      impressions: rowImpressions,
      clicks: rowClicks,
      conversions: num(row.conversions),
      ctr: percent(rowClicks, rowImpressions),
      cpcBrl: ratio(rowCost, rowClicks),
    };
  });

  const ads: GoogleAdsAdRow[] = adsRes.rows.map((row) => {
    const urls = Array.isArray(row.final_urls) ? row.final_urls : [];
    return {
      adId: String(row.ad_id),
      adName: row.ad_name ?? null,
      adStatus: row.ad_status ?? null,
      adGroupId: String(row.ad_group_id),
      adGroupName: String(row.ad_group_name),
      campaignId: String(row.campaign_id),
      campaignName: String(row.campaign_name),
      finalUrl: typeof urls[0] === "string" ? urls[0] : null,
      costBrl: microsToBrl(row.cost_micros),
      impressions: num(row.impressions),
      clicks: num(row.clicks),
      conversions: num(row.conversions),
    };
  });

  const leads: GoogleAdsLeadRow[] = leadsRes.rows.map((row) => ({
    id: Number(row.id),
    nome: row.nome ?? null,
    telefone: row.telefone ?? null,
    origem: row.origem ?? null,
    criadoEm: new Date(row.criado_em).toISOString(),
    hasGclid: Boolean(row.has_gclid),
    utmCampaign: row.utm_campaign ?? null,
  }));

  const lastSyncedAt = syncRes.rows[0]?.last_synced_at
    ? new Date(syncRes.rows[0].last_synced_at).toISOString()
    : null;

  return {
    hasData: campaigns.length > 0,
    totals: {
      costBrl,
      impressions,
      clicks,
      conversions,
      ctr: percent(clicks, impressions),
      cpcBrl: ratio(costBrl, clicks),
      crmLeads,
      costPerCrmLeadBrl: ratio(costBrl, crmLeads),
      costPerGoogleConversionBrl: ratio(costBrl, conversions),
    },
    campaigns,
    ads,
    daily,
    leads,
    lastSyncedAt,
  };
}
