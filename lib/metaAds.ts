import { getPool } from "@/lib/db";
import { getFacebookAccessToken } from "@/lib/facebookLeadAds";
import type {
  AdLeadSummary,
  AdRow,
  AggregatedMetrics,
  CampaignGroup,
  CreativeVideoSource,
  DailySeriesPoint,
  FunnelStageDef,
  FunnelStageKind,
  FunnelStagePoint,
  KpiTotals,
  MetaAdsFilters,
  RecentAdLead,
  SellerAdPerformance,
  SyncRunSummary,
} from "@/types/metaAds";
import { getDefaultFunnel } from "@/lib/funnels";

const GRAPH_API_VERSION = "v21.0";
const SCHEMA = "meta_ads";
const ADVISORY_LOCK_KEY = 872341;
const SCHEMA_ADVISORY_LOCK_KEY = 872342;
// A conta de anúncios opera neste fuso. Insights da Meta são agregados pela
// data local da conta, então leads do CRM precisam usar a mesma fronteira de
// dia (o Postgres e o contêiner Node rodam em UTC).
const META_ADS_TIME_ZONE = "America/Sao_Paulo";

// Códigos de erro da Graph API que indicam rate limit de aplicação/conta
// (ver https://developers.facebook.com/docs/graph-api/guides/error-handling).
const RATE_LIMIT_ERROR_CODES = new Set([4, 17, 32, 613]);
const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireAdAccountId(): string {
  const raw = process.env.META_ADS_AD_ACCOUNT_ID?.trim();
  if (!raw) {
    throw new Error("META_ADS_AD_ACCOUNT_ID não configurado");
  }
  return raw.startsWith("act_") ? raw : `act_${raw}`;
}

function safeParseJson(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Lê o header x-business-use-case-usage (uso corrente da conta na Marketing
 * API) e dá uma pausa proativa quando o uso já está perto do limite, para
 * evitar bater no 429 na próxima chamada da mesma sincronização.
 */
async function throttleFromUsageHeader(raw: string | null): Promise<void> {
  const parsed = safeParseJson(raw);
  if (!parsed) return;

  let maxPct = 0;
  for (const value of Object.values(parsed)) {
    const entries = Array.isArray(value) ? value : [value];
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const usage = entry as Record<string, number>;
      maxPct = Math.max(maxPct, usage.call_count ?? 0, usage.total_cputime ?? 0, usage.total_time ?? 0);
    }
  }

  if (maxPct >= 90) await sleep(5000);
  else if (maxPct >= 75) await sleep(1500);
}

interface GraphErrorBody {
  error?: { message?: string; code?: number; error_subcode?: number };
}

async function fetchGraphWithRetry<T>(path: string, attempt = 0): Promise<T> {
  const accessToken = getFacebookAccessToken();
  const separator = path.includes("?") ? "&" : "?";
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${path}${separator}access_token=${encodeURIComponent(accessToken)}`;

  const res = await fetch(url, { cache: "no-store" });
  await throttleFromUsageHeader(res.headers.get("x-business-use-case-usage"));

  if (res.ok) {
    return res.json() as Promise<T>;
  }

  const body = await res.text().catch(() => "");
  const parsed = safeParseJson(body) as GraphErrorBody | null;
  const isRateLimited = res.status === 429 || RATE_LIMIT_ERROR_CODES.has(parsed?.error?.code ?? -1);

  if (isRateLimited && attempt < MAX_RETRIES) {
    const backoff = BASE_BACKOFF_MS * 2 ** attempt + Math.random() * 500;
    await sleep(backoff);
    return fetchGraphWithRetry<T>(path, attempt + 1);
  }

  throw new Error(`Graph API ${res.status}: ${body.slice(0, 300)}`);
}

interface GraphPaged<T> {
  data?: T[];
  paging?: { cursors?: { after?: string }; next?: string };
}

function appendCursor(path: string, after: string): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}after=${encodeURIComponent(after)}`;
}

async function fetchAllPages<T>(initialPath: string): Promise<T[]> {
  const results: T[] = [];
  let path: string | null = initialPath;

  while (path) {
    const page: GraphPaged<T> = await fetchGraphWithRetry<GraphPaged<T>>(path);
    results.push(...(page.data ?? []));
    const after = page.paging?.cursors?.after;
    path = page.paging?.next && after ? appendCursor(initialPath, after) : null;
  }

  return results;
}

// ─────────────────────────────────────────────────────────────
// Schema (idempotente, mesmo padrão de ensureCommercialSchema())
// ─────────────────────────────────────────────────────────────

let schemaEnsured = false;
let schemaEnsurePromise: Promise<void> | null = null;

async function ensureMetaAdsSchemaOnce(): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    // Três workers podem iniciar ao mesmo tempo depois de um deploy. O lock
    // transacional serializa o DDL entre processos; schemaEnsurePromise faz o
    // mesmo entre chamadas concorrentes dentro de um único worker.
    await client.query("SELECT pg_advisory_xact_lock($1)", [SCHEMA_ADVISORY_LOCK_KEY]);
    await client.query(`
    CREATE SCHEMA IF NOT EXISTS ${SCHEMA};

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.campaigns (
      campaign_id       TEXT PRIMARY KEY,
      ad_account_id     TEXT NOT NULL,
      name              TEXT NOT NULL,
      status            TEXT NOT NULL,
      effective_status  TEXT,
      objective         TEXT,
      buying_type       TEXT,
      daily_budget      NUMERIC,
      lifetime_budget   NUMERIC,
      start_time        TIMESTAMPTZ,
      stop_time         TIMESTAMPTZ,
      created_time_meta TIMESTAMPTZ,
      updated_time_meta TIMESTAMPTZ,
      first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_synced_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.adsets (
      adset_id          TEXT PRIMARY KEY,
      campaign_id       TEXT NOT NULL REFERENCES ${SCHEMA}.campaigns(campaign_id) ON DELETE CASCADE,
      ad_account_id     TEXT NOT NULL,
      name              TEXT NOT NULL,
      status            TEXT NOT NULL,
      effective_status  TEXT,
      optimization_goal TEXT,
      billing_event     TEXT,
      daily_budget      NUMERIC,
      lifetime_budget   NUMERIC,
      start_time        TIMESTAMPTZ,
      stop_time         TIMESTAMPTZ,
      first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_synced_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_meta_adsets_campaign ON ${SCHEMA}.adsets(campaign_id);

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.ads (
      ad_id             TEXT PRIMARY KEY,
      adset_id          TEXT NOT NULL REFERENCES ${SCHEMA}.adsets(adset_id) ON DELETE CASCADE,
      campaign_id       TEXT NOT NULL REFERENCES ${SCHEMA}.campaigns(campaign_id) ON DELETE CASCADE,
      ad_account_id     TEXT NOT NULL,
      name              TEXT NOT NULL,
      status            TEXT NOT NULL,
      effective_status  TEXT,
      creative_id       TEXT,
      thumbnail_url     TEXT,
      image_url         TEXT,
      video_id          TEXT,
      object_story_spec JSONB,
      first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_synced_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_meta_ads_adset ON ${SCHEMA}.ads(adset_id);
    CREATE INDEX IF NOT EXISTS idx_meta_ads_campaign ON ${SCHEMA}.ads(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_meta_ads_status ON ${SCHEMA}.ads(status);

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.ad_insights_daily (
      ad_id                TEXT NOT NULL REFERENCES ${SCHEMA}.ads(ad_id) ON DELETE CASCADE,
      date                 DATE NOT NULL,
      impressions          BIGINT NOT NULL DEFAULT 0,
      reach                BIGINT NOT NULL DEFAULT 0,
      clicks               BIGINT NOT NULL DEFAULT 0,
      spend                NUMERIC NOT NULL DEFAULT 0,
      ctr                  NUMERIC,
      cpc                  NUMERIC,
      cpm                  NUMERIC,
      frequency            NUMERIC,
      leads_meta           INTEGER NOT NULL DEFAULT 0,
      cost_per_lead_meta   NUMERIC,
      actions_raw          JSONB,
      cost_per_action_raw  JSONB,
      synced_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (ad_id, date)
    );
    CREATE INDEX IF NOT EXISTS idx_meta_insights_date ON ${SCHEMA}.ad_insights_daily(date);

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.sync_runs (
      id             BIGSERIAL PRIMARY KEY,
      sync_type      TEXT NOT NULL,
      started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at    TIMESTAMPTZ,
      status         TEXT NOT NULL DEFAULT 'running',
      rows_upserted  INTEGER,
      date_from      DATE,
      date_to        DATE,
      error          TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_meta_sync_runs_type_started ON ${SCHEMA}.sync_runs(sync_type, started_at DESC);

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.sync_state (
      key    TEXT PRIMARY KEY,
      value  TEXT
    );

    -- Colunas adicionadas depois do schema original (idempotente).
    -- url_tags: template de UTM do criativo (ex.: "utm_content={{ad.name}}") —
    -- prova de quais UTMs os cliques desse anúncio carregam.
    -- landing_url: página de destino do criativo (landing page/formulário),
    -- extraída de link_data/video_data/asset_feed_spec.
    ALTER TABLE ${SCHEMA}.ads ADD COLUMN IF NOT EXISTS url_tags TEXT;
    ALTER TABLE ${SCHEMA}.ads ADD COLUMN IF NOT EXISTS landing_url TEXT;
    `);
    await client.query("COMMIT");
    schemaEnsured = true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function ensureMetaAdsSchema(): Promise<void> {
  if (schemaEnsured) return;
  if (!schemaEnsurePromise) {
    schemaEnsurePromise = ensureMetaAdsSchemaOnce().catch((error) => {
      schemaEnsurePromise = null;
      throw error;
    });
  }
  await schemaEnsurePromise;
}

async function getSyncState(key: string): Promise<string | null> {
  const pool = getPool();
  const { rows } = await pool.query<{ value: string }>(
    `SELECT value FROM ${SCHEMA}.sync_state WHERE key = $1`,
    [key]
  );
  return rows[0]?.value ?? null;
}

async function setSyncState(key: string, value: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO ${SCHEMA}.sync_state (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value]
  );
}

async function recordSyncRun<T extends { rows: number }>(
  syncType: string,
  dateFrom: string | null,
  dateTo: string | null,
  fn: () => Promise<T>
): Promise<T> {
  const pool = getPool();
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO ${SCHEMA}.sync_runs (sync_type, date_from, date_to) VALUES ($1, $2, $3) RETURNING id`,
    [syncType, dateFrom, dateTo]
  );
  const runId = rows[0].id;

  try {
    const result = await fn();
    await pool.query(
      `UPDATE ${SCHEMA}.sync_runs SET finished_at = NOW(), status = 'success', rows_upserted = $2 WHERE id = $1`,
      [runId, result.rows]
    );
    return result;
  } catch (error) {
    await pool.query(
      `UPDATE ${SCHEMA}.sync_runs SET finished_at = NOW(), status = 'error', error = $2 WHERE id = $1`,
      [runId, error instanceof Error ? error.message : String(error)]
    );
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────
// Sincronização de estrutura (campanha → conjunto → anúncio + criativo)
// ─────────────────────────────────────────────────────────────

interface CampaignApiRow {
  id: string;
  name: string;
  status: string;
  effective_status?: string;
  objective?: string;
  buying_type?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  start_time?: string;
  stop_time?: string;
  created_time?: string;
  updated_time?: string;
}

interface AdsetApiRow {
  id: string;
  campaign_id: string;
  name: string;
  status: string;
  effective_status?: string;
  optimization_goal?: string;
  billing_event?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  start_time?: string;
  stop_time?: string;
}

interface AdCreative {
  id?: string;
  thumbnail_url?: string;
  image_url?: string;
  video_id?: string;
  object_story_spec?: Record<string, unknown>;
  url_tags?: string;
  asset_feed_spec?: {
    link_urls?: Array<{ website_url?: string; display_url?: string }>;
  };
}

/**
 * Página de destino do criativo. Anúncios de vídeo/link guardam o link em
 * object_story_spec; anúncios de imagem com posicionamento automático guardam
 * em asset_feed_spec.link_urls (object_story_spec fica só com page_id).
 */
function extractLandingUrl(creative: AdCreative): string | null {
  const spec = creative.object_story_spec as
    | {
        link_data?: { link?: string };
        video_data?: { call_to_action?: { value?: { link?: string } } };
      }
    | undefined;

  return (
    spec?.link_data?.link ??
    spec?.video_data?.call_to_action?.value?.link ??
    creative.asset_feed_spec?.link_urls?.find((l) => l.website_url)?.website_url ??
    null
  );
}

interface AdApiRow {
  id: string;
  adset_id: string;
  campaign_id: string;
  name: string;
  status: string;
  effective_status?: string;
  creative?: AdCreative;
}

interface CreativeThumbnailApiRow {
  id?: string;
  thumbnail_url?: string;
  image_url?: string;
}

/**
 * O thumbnail_url embutido em account/ads vem fixo em 64x64. A Graph API
 * aceita thumbnail_width/thumbnail_height quando consultamos o criativo
 * diretamente; fazemos multi-get em lotes para não transformar 151 anúncios
 * em 151 chamadas. A falha deste enriquecimento não pode impedir o restante
 * do sync — nesse caso preservamos a miniatura pequena como fallback.
 */
async function enrichCreativeImages(ads: AdApiRow[]): Promise<AdApiRow[]> {
  const creativeIds = Array.from(new Set(ads.map((ad) => ad.creative?.id).filter((id): id is string => Boolean(id))));
  if (creativeIds.length === 0) return ads;

  const enrichedById = new Map<string, CreativeThumbnailApiRow>();
  const batchSize = 50;
  for (let offset = 0; offset < creativeIds.length; offset += batchSize) {
    const batch = creativeIds.slice(offset, offset + batchSize);
    try {
      const response = await fetchGraphWithRetry<Record<string, CreativeThumbnailApiRow>>(
        `?ids=${batch.join(",")}&fields=id,thumbnail_url,image_url&thumbnail_width=600&thumbnail_height=750`
      );
      for (const [id, creative] of Object.entries(response)) {
        enrichedById.set(id, creative);
      }
    } catch (error) {
      console.warn("[metaAds] Não foi possível ampliar miniaturas de um lote de criativos:", error);
    }
  }

  return ads.map((ad) => {
    const creative = ad.creative;
    if (!creative?.id) return ad;
    const enriched = enrichedById.get(creative.id);
    if (!enriched) return ad;
    return {
      ...ad,
      creative: {
        ...creative,
        thumbnail_url: enriched.thumbnail_url ?? creative.thumbnail_url,
        image_url: enriched.image_url ?? creative.image_url,
      },
    };
  });
}

async function upsertCampaigns(rows: CampaignApiRow[], adAccountId: string): Promise<number> {
  if (rows.length === 0) return 0;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    for (const row of rows) {
      await client.query(
        `INSERT INTO ${SCHEMA}.campaigns
           (campaign_id, ad_account_id, name, status, effective_status, objective, buying_type,
            daily_budget, lifetime_budget, start_time, stop_time, created_time_meta, updated_time_meta, last_synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, NOW())
         ON CONFLICT (campaign_id) DO UPDATE SET
           name = EXCLUDED.name, status = EXCLUDED.status, effective_status = EXCLUDED.effective_status,
           objective = EXCLUDED.objective, buying_type = EXCLUDED.buying_type,
           daily_budget = EXCLUDED.daily_budget, lifetime_budget = EXCLUDED.lifetime_budget,
           start_time = EXCLUDED.start_time, stop_time = EXCLUDED.stop_time,
           created_time_meta = EXCLUDED.created_time_meta, updated_time_meta = EXCLUDED.updated_time_meta,
           last_synced_at = NOW()`,
        [
          row.id,
          adAccountId,
          row.name,
          row.status,
          row.effective_status ?? null,
          row.objective ?? null,
          row.buying_type ?? null,
          row.daily_budget ?? null,
          row.lifetime_budget ?? null,
          row.start_time ?? null,
          row.stop_time ?? null,
          row.created_time ?? null,
          row.updated_time ?? null,
        ]
      );
    }
    await client.query("COMMIT");
    return rows.length;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function upsertAdsets(rows: AdsetApiRow[], adAccountId: string): Promise<number> {
  if (rows.length === 0) return 0;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    for (const row of rows) {
      await client.query(
        `INSERT INTO ${SCHEMA}.adsets
           (adset_id, campaign_id, ad_account_id, name, status, effective_status, optimization_goal,
            billing_event, daily_budget, lifetime_budget, start_time, stop_time, last_synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, NOW())
         ON CONFLICT (adset_id) DO UPDATE SET
           name = EXCLUDED.name, status = EXCLUDED.status, effective_status = EXCLUDED.effective_status,
           optimization_goal = EXCLUDED.optimization_goal, billing_event = EXCLUDED.billing_event,
           daily_budget = EXCLUDED.daily_budget, lifetime_budget = EXCLUDED.lifetime_budget,
           start_time = EXCLUDED.start_time, stop_time = EXCLUDED.stop_time, last_synced_at = NOW()`,
        [
          row.id,
          row.campaign_id,
          adAccountId,
          row.name,
          row.status,
          row.effective_status ?? null,
          row.optimization_goal ?? null,
          row.billing_event ?? null,
          row.daily_budget ?? null,
          row.lifetime_budget ?? null,
          row.start_time ?? null,
          row.stop_time ?? null,
        ]
      );
    }
    await client.query("COMMIT");
    return rows.length;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function upsertAds(rows: AdApiRow[], adAccountId: string): Promise<number> {
  if (rows.length === 0) return 0;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    for (const row of rows) {
      const creative = row.creative ?? {};
      await client.query(
        `INSERT INTO ${SCHEMA}.ads
           (ad_id, adset_id, campaign_id, ad_account_id, name, status, effective_status,
            creative_id, thumbnail_url, image_url, video_id, object_story_spec, url_tags, landing_url, last_synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, NOW())
         ON CONFLICT (ad_id) DO UPDATE SET
           adset_id = EXCLUDED.adset_id, campaign_id = EXCLUDED.campaign_id,
           name = EXCLUDED.name, status = EXCLUDED.status, effective_status = EXCLUDED.effective_status,
           creative_id = EXCLUDED.creative_id, thumbnail_url = EXCLUDED.thumbnail_url,
           image_url = EXCLUDED.image_url, video_id = EXCLUDED.video_id,
           object_story_spec = EXCLUDED.object_story_spec, url_tags = EXCLUDED.url_tags,
           landing_url = EXCLUDED.landing_url, last_synced_at = NOW()`,
        [
          row.id,
          row.adset_id,
          row.campaign_id,
          adAccountId,
          row.name,
          row.status,
          row.effective_status ?? null,
          creative.id ?? null,
          creative.thumbnail_url ?? null,
          creative.image_url ?? null,
          creative.video_id ?? null,
          creative.object_story_spec ? JSON.stringify(creative.object_story_spec) : null,
          creative.url_tags ?? null,
          extractLandingUrl(creative),
        ]
      );
    }
    await client.query("COMMIT");
    return rows.length;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function syncMetaAdsStructure(): Promise<{ rows: number }> {
  const accountId = requireAdAccountId();

  const campaigns = await fetchAllPages<CampaignApiRow>(
    `${accountId}/campaigns?fields=id,name,status,effective_status,objective,buying_type,daily_budget,lifetime_budget,start_time,stop_time,created_time,updated_time&limit=200`
  );
  await upsertCampaigns(campaigns, accountId);

  const adsets = await fetchAllPages<AdsetApiRow>(
    `${accountId}/adsets?fields=id,campaign_id,name,status,effective_status,optimization_goal,billing_event,daily_budget,lifetime_budget,start_time,stop_time&limit=200`
  );
  await upsertAdsets(adsets, accountId);

  const rawAds = await fetchAllPages<AdApiRow>(
    `${accountId}/ads?fields=id,adset_id,campaign_id,name,status,effective_status,creative{id,thumbnail_url,image_url,video_id,object_story_spec,url_tags,asset_feed_spec{link_urls}}&limit=200`
  );
  const ads = await enrichCreativeImages(rawAds);
  await upsertAds(ads, accountId);

  await setSyncState("structure_last_full_sync_at", new Date().toISOString());
  return { rows: campaigns.length + adsets.length + ads.length };
}

// ─────────────────────────────────────────────────────────────
// Sincronização de métricas (insights diários por anúncio)
// ─────────────────────────────────────────────────────────────

interface ActionRow {
  action_type: string;
  value: string;
}

interface InsightApiRow {
  ad_id: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  spend?: string;
  frequency?: string;
  actions?: ActionRow[];
  cost_per_action_type?: ActionRow[];
  date_start: string;
}

const LEAD_ACTION_TYPES = new Set(["lead", "onsite_conversion.lead_grouped"]);

function extractActionValue(actions: ActionRow[] | undefined, types: Set<string>): number {
  if (!actions) return 0;
  const match = actions.find((a) => types.has(a.action_type));
  return match ? Number.parseInt(match.value, 10) || 0 : 0;
}

function extractActionCost(actions: ActionRow[] | undefined, types: Set<string>): number | null {
  if (!actions) return null;
  const match = actions.find((a) => types.has(a.action_type));
  return match ? Number.parseFloat(match.value) || null : null;
}

async function upsertInsightRows(rows: InsightApiRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const pool = getPool();

  // Se o insight chegar para um ad_id que o sync de estrutura ainda não viu
  // (ex.: anúncio criado há poucos minutos, ou já removido da conta), a FK
  // rejeitaria o INSERT. Em vez de depender de catch por linha — o que
  // abortaria a transação inteira no Postgres a partir do primeiro erro,
  // silenciando também as linhas válidas seguintes — filtramos aqui fora.
  const { rows: knownAds } = await pool.query<{ ad_id: string }>(`SELECT ad_id FROM ${SCHEMA}.ads`);
  const knownAdIds = new Set(knownAds.map((r) => r.ad_id));
  const validRows = rows.filter((row) => knownAdIds.has(row.ad_id));

  if (validRows.length === 0) return 0;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const row of validRows) {
      const leadsMeta = extractActionValue(row.actions, LEAD_ACTION_TYPES);
      const costPerLead = extractActionCost(row.cost_per_action_type, LEAD_ACTION_TYPES);

      await client.query(
        `INSERT INTO ${SCHEMA}.ad_insights_daily
           (ad_id, date, impressions, reach, clicks, spend, ctr, cpc, cpm, frequency,
            leads_meta, cost_per_lead_meta, actions_raw, cost_per_action_raw, synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, NOW())
         ON CONFLICT (ad_id, date) DO UPDATE SET
           impressions = EXCLUDED.impressions, reach = EXCLUDED.reach, clicks = EXCLUDED.clicks,
           spend = EXCLUDED.spend, ctr = EXCLUDED.ctr, cpc = EXCLUDED.cpc, cpm = EXCLUDED.cpm,
           frequency = EXCLUDED.frequency, leads_meta = EXCLUDED.leads_meta,
           cost_per_lead_meta = EXCLUDED.cost_per_lead_meta, actions_raw = EXCLUDED.actions_raw,
           cost_per_action_raw = EXCLUDED.cost_per_action_raw, synced_at = NOW()`,
        [
          row.ad_id,
          row.date_start,
          row.impressions ?? "0",
          row.reach ?? "0",
          row.clicks ?? "0",
          row.spend ?? "0",
          row.ctr ?? null,
          row.cpc ?? null,
          row.cpm ?? null,
          row.frequency ?? null,
          leadsMeta,
          costPerLead,
          row.actions ? JSON.stringify(row.actions) : null,
          row.cost_per_action_type ? JSON.stringify(row.cost_per_action_type) : null,
        ]
      );
    }
    await client.query("COMMIT");
    return validRows.length;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function syncMetaAdsInsights(options: { sinceDate: string; untilDate: string }): Promise<{ rows: number }> {
  const accountId = requireAdAccountId();
  const fields = "ad_id,impressions,reach,clicks,ctr,cpc,cpm,spend,frequency,actions,cost_per_action_type,date_start";
  const timeRange = encodeURIComponent(JSON.stringify({ since: options.sinceDate, until: options.untilDate }));
  const path = `${accountId}/insights?level=ad&time_increment=1&fields=${fields}&time_range=${timeRange}&limit=500`;

  const rows = await fetchAllPages<InsightApiRow>(path);
  await upsertInsightRows(rows);
  return { rows: rows.length };
}

export function shiftIsoDate(isoDate: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new Error(`Data ISO inválida: ${isoDate}`);
  const shifted = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return shifted.toISOString().slice(0, 10);
}

export function getMetaAdsToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: META_ADS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

function daysAgo(days: number): string {
  return shiftIsoDate(getMetaAdsToday(), -days);
}

function today(): string {
  return getMetaAdsToday();
}

function hoursSince(isoDate: string): number {
  return (Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60);
}

export interface RunSyncResult {
  skipped: boolean;
  reason?: string;
}

export async function runMetaAdsSync(options: { forceStructure?: boolean } = {}): Promise<RunSyncResult> {
  await ensureMetaAdsSchema();

  const pool = getPool();
  // Advisory locks do Postgres pertencem à SESSÃO, não ao pool. Mantemos a
  // mesma conexão reservada da aquisição até o unlock; usar pool.query() nos
  // dois pontos poderia liberar em outra conexão e deixar o lock preso.
  const lockClient = await pool.connect();

  try {
    const { rows: lockRows } = await lockClient.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [ADVISORY_LOCK_KEY]
    );
    if (!lockRows[0]?.locked) {
      return { skipped: true, reason: "sincronização já em andamento" };
    }

    try {
      const structureTtlHours = Number(process.env.META_ADS_STRUCTURE_TTL_HOURS ?? "6");
      const lastFullSync = await getSyncState("structure_last_full_sync_at");
      const structureStale = options.forceStructure || !lastFullSync || hoursSince(lastFullSync) >= structureTtlHours;

      if (structureStale) {
        await recordSyncRun("structure", null, null, () => syncMetaAdsStructure());
      }

      const backfillDone = await getSyncState("initial_backfill_done_at");
      const resyncDays = Number(process.env.META_ADS_INSIGHTS_RESYNC_DAYS ?? "3");

      if (!backfillDone) {
        const backfillDays = Number(process.env.META_ADS_INITIAL_BACKFILL_DAYS ?? "90");
        const since = daysAgo(backfillDays);
        const until = today();
        await recordSyncRun("insights", since, until, () => syncMetaAdsInsights({ sinceDate: since, untilDate: until }));
        await setSyncState("initial_backfill_done_at", new Date().toISOString());
      } else {
        const since = daysAgo(resyncDays);
        const until = today();
        await recordSyncRun("insights", since, until, () => syncMetaAdsInsights({ sinceDate: since, untilDate: until }));
      }

      return { skipped: false };
    } finally {
      const { rows: unlockRows } = await lockClient.query<{ unlocked: boolean }>(
        "SELECT pg_advisory_unlock($1) AS unlocked",
        [ADVISORY_LOCK_KEY]
      );
      if (!unlockRows[0]?.unlocked) {
        console.warn("[meta-ads-sync] advisory lock já não pertencia à sessão");
      }
    }
  } finally {
    lockClient.release();
  }
}

export async function getLatestSyncRuns(limit = 5): Promise<SyncRunSummary[]> {
  await ensureMetaAdsSchema();
  const pool = getPool();
  const { rows } = await pool.query<{
    sync_type: string;
    started_at: string;
    finished_at: string | null;
    status: string;
    rows_upserted: number | null;
  }>(
    `SELECT sync_type, started_at, finished_at, status, rows_upserted
     FROM ${SCHEMA}.sync_runs ORDER BY id DESC LIMIT $1`,
    [limit]
  );
  return rows.map((row) => ({
    syncType: row.sync_type,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    rowsUpserted: row.rows_upserted,
  }));
}

// ─────────────────────────────────────────────────────────────
// Leitura para a página (só Postgres — nunca chama a Graph API)
// ─────────────────────────────────────────────────────────────

interface ScopeParams {
  where: string;
  values: unknown[];
}

/**
 * WHERE compartilhado por getAdsHierarchy/getKpiTotals/getDailySeries, para
 * que o filtro de status/busca seja sempre idêntico entre a tabela, os KPIs
 * e o gráfico.
 */
function buildScopeParams(filters: MetaAdsFilters): ScopeParams {
  const values: unknown[] = [filters.status, filters.search?.trim() || ""];
  return {
    where: `
      ($1 = 'all' OR
       ($1 = 'active' AND COALESCE(a.effective_status, a.status) = 'ACTIVE') OR
       ($1 = 'inactive' AND COALESCE(a.effective_status, a.status) <> 'ACTIVE'))
      AND (
        $2 = ''
        OR a.name ILIKE '%' || $2 || '%'
        OR s.name ILIKE '%' || $2 || '%'
        OR c.name ILIKE '%' || $2 || '%'
      )
    `,
    values,
  };
}

/**
 * Anúncio de origem de um lead do CRM (alias "i" em inscricoes.inscricoes).
 * Leads do formulário nativo (Lead Ads) têm ad_id gravado pela ingestão da
 * Graph API. Leads de LANDING PAGE não têm ad_id — mas os criativos carimbam
 * utm_campaign={{campaign.name}}, utm_term={{adset.name}} e
 * utm_content={{ad.name}} na URL (ver ads.url_tags), então o anúncio é
 * resolvido pelo nome via UTM. Nomes de anúncio se repetem entre conjuntos;
 * utm_term/utm_campaign desambiguam e MIN(ad_id) desempata clones exatos.
 */
const LEAD_AD_ID = `COALESCE(
  NULLIF(TRIM(i.payload->>'ad_id'), ''),
  (SELECT MIN(a2.ad_id)
     FROM ${SCHEMA}.ads a2
     JOIN ${SCHEMA}.adsets s2 ON s2.adset_id = a2.adset_id
     JOIN ${SCHEMA}.campaigns c2 ON c2.campaign_id = a2.campaign_id
    WHERE NULLIF(TRIM(i.payload->>'utm_content'), '') IS NOT NULL
      AND LOWER(a2.name) = LOWER(TRIM(i.payload->>'utm_content'))
      AND (NULLIF(TRIM(i.payload->>'utm_term'), '') IS NULL OR LOWER(s2.name) = LOWER(TRIM(i.payload->>'utm_term')))
      AND (NULLIF(TRIM(i.payload->>'utm_campaign'), '') IS NULL OR LOWER(c2.name) = LOWER(TRIM(i.payload->>'utm_campaign'))))
)`;

// Cadastros de teste/excluídos nunca entram nas métricas. Um satélite de
// mesclagem, porém, continua sendo um envio real do formulário: ele entra em
// cadastrosCrm e fica fora apenas de leadsCrm (contatos novos/primários).
const LEAD_NOT_EXCLUDED = `COALESCE(i.payload->>'dashboard_excluido', '') != 'true'`;
const LEAD_VISIBLE = `${LEAD_NOT_EXCLUDED}
  AND COALESCE(i.payload->>'dashboard_merged_into', '') = ''`;

// Pré-filtro barato: só roda a resolução por UTM em leads que têm algum sinal
// de anúncio (ad_id direto ou utm_content com o nome do criativo).
const LEAD_HAS_AD_SIGNAL = `(NULLIF(TRIM(i.payload->>'ad_id'), '') IS NOT NULL OR NULLIF(TRIM(i.payload->>'utm_content'), '') IS NOT NULL)`;

/** Limites de data no fuso da conta Meta. Os placeholders são constantes
 * internas (ex.: "$3"), nunca entrada do usuário. */
function leadCreatedInPeriod(fromPlaceholder: string, toPlaceholder: string): string {
  return `i.criado_em >= (${fromPlaceholder}::date::timestamp AT TIME ZONE '${META_ADS_TIME_ZONE}')
    AND i.criado_em < ((${toPlaceholder}::date + 1)::timestamp AT TIME ZONE '${META_ADS_TIME_ZONE}')`;
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "string" ? Number.parseFloat(value) : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "string" ? Number.parseFloat(value) : Number(value);
  return Number.isFinite(n) ? n : null;
}

interface AdRowQueryResult {
  ad_id: string;
  ad_name: string;
  status: string;
  effective_status: string | null;
  thumbnail_url: string | null;
  image_url: string | null;
  video_id: string | null;
  landing_url: string | null;
  adset_id: string;
  adset_name: string;
  adset_status: string;
  campaign_id: string;
  campaign_name: string;
  campaign_status: string;
  spend: string | null;
  impressions: string | null;
  reach: string | null;
  clicks: string | null;
  leads_meta: string | null;
  cadastros_crm: string | null;
  ctr: string | null;
  cpc: string | null;
  cpm: string | null;
  frequency: string | null;
  leads_crm: string | null;
  stage_counts: Record<string, string> | null;
  valor_fechado: string | null;
  cpl_real: string | null;
}

function mapAdRow(row: AdRowQueryResult, stageKindByKey: Map<string, FunnelStageKind>): AdRow {
  const stageCounts: Record<string, number> = {};
  let leadsQualificados = 0;
  let leadsFechados = 0;
  for (const [key, rawCount] of Object.entries(row.stage_counts ?? {})) {
    const count = toNumber(rawCount);
    stageCounts[key] = count;
    const kind = stageKindByKey.get(key);
    if (kind === "normal" || kind === "won") leadsQualificados += count;
    if (kind === "won") leadsFechados += count;
  }

  const spend = toNumber(row.spend);

  return {
    adId: row.ad_id,
    adName: row.ad_name,
    status: row.status,
    effectiveStatus: row.effective_status,
    thumbnailUrl: row.thumbnail_url,
    imageUrl: row.image_url,
    videoId: row.video_id,
    landingUrl: row.landing_url,
    adsetId: row.adset_id,
    adsetName: row.adset_name,
    adsetStatus: row.adset_status,
    campaignId: row.campaign_id,
    campaignName: row.campaign_name,
    campaignStatus: row.campaign_status,
    spend,
    impressions: toNumber(row.impressions),
    reach: toNumber(row.reach),
    clicks: toNumber(row.clicks),
    ctr: toNullableNumber(row.ctr),
    cpc: toNullableNumber(row.cpc),
    cpm: toNullableNumber(row.cpm),
    frequency: toNullableNumber(row.frequency),
    leadsMeta: toNumber(row.leads_meta),
    cadastrosCrm: toNumber(row.cadastros_crm),
    leadsCrm: toNumber(row.leads_crm),
    leadsQualificados,
    leadsFechados,
    valorFechado: toNumber(row.valor_fechado),
    cplReal: toNullableNumber(row.cpl_real),
    cacReal: leadsFechados > 0 ? spend / leadsFechados : null,
    stageCounts,
  };
}

/** Lê as etapas do funil "padrão" (o único hoje em uso) para nomear/ordenar
 * as colunas de etapa da tabela e do gráfico de funil. */
export async function getDefaultFunnelStages(): Promise<FunnelStageDef[]> {
  const pool = getPool();
  const { rows } = await pool.query<{ position: number; key: string; label: string; kind: string }>(`
    SELECT fs.position, fs.key, fs.label, fs.kind
    FROM dashboard.funnel_stages fs
    JOIN dashboard.funnels f ON f.id = fs.funnel_id
    WHERE f.is_default = true
    ORDER BY fs.position
  `);
  return rows.map((row) => ({
    position: row.position,
    key: row.key,
    label: row.label,
    kind: row.kind as FunnelStageKind,
  }));
}

/** Resolve os ad_ids que atendem ao filtro atual (status/busca), opcionalmente
 * restrito a uma campanha — usado pelo gráfico de série temporal e pelo funil. */
export async function getAdIdsForScope(filters: MetaAdsFilters, campaignId?: string): Promise<string[]> {
  await ensureMetaAdsSchema();
  const pool = getPool();
  const scope = buildScopeParams(filters);
  const campaignClause = campaignId ? `AND a.campaign_id = $${scope.values.length + 1}` : "";
  const values = campaignId ? [...scope.values, campaignId] : scope.values;

  const { rows } = await pool.query<{ ad_id: string }>(
    `SELECT a.ad_id FROM ${SCHEMA}.ads a
     JOIN ${SCHEMA}.adsets s ON s.adset_id = a.adset_id
     JOIN ${SCHEMA}.campaigns c ON c.campaign_id = a.campaign_id
     WHERE ${scope.where} ${campaignClause}`,
    values
  );
  return rows.map((r) => r.ad_id);
}

/**
 * Métricas de mídia vêm de meta_ads.ad_insights_daily no período do filtro.
 * Métricas de CRM (leads_crm/stageCounts/valor) são contadas pela DATA DE
 * CRIAÇÃO do lead dentro do mesmo período — não pela data de fechamento —
 * para responder "do que esse anúncio gerou nesse período, quanto virou X"
 * sem misturar fechamentos de leads de outros períodos. leads_crm pode ser
 * menor que leads_meta (nem todo submit no Meta vira registro local, ou
 * falta ad_id em leads orgânicos do mesmo formulário) — por isso a UI
 * mostra as duas colunas lado a lado em vez de uma só. leadsQualificados/
 * leadsFechados/cacReal são derivados de stageCounts em JS (não em SQL) a
 * partir do kind de cada etapa, para não duplicar essa classificação.
 */
export async function getAdsHierarchy(filters: MetaAdsFilters): Promise<AdRow[]> {
  await ensureMetaAdsSchema();
  const pool = getPool();
  const scope = buildScopeParams(filters);
  const vozupFunnel = await getDefaultFunnel();
  const stageDefs = vozupFunnel.stages.map((stage) => ({
    position: stage.position,
    key: stage.key,
    label: stage.label,
    kind: stage.kind,
  }));
  const stageKindByKey = new Map(stageDefs.map((s) => [s.key, s.kind]));

  const { rows } = await pool.query<AdRowQueryResult>(
    `
    WITH scoped_ads AS (
      SELECT a.ad_id, a.name AS ad_name, a.status, a.effective_status, a.thumbnail_url, a.image_url, a.video_id, a.landing_url,
             a.adset_id, s.name AS adset_name, s.status AS adset_status,
             a.campaign_id, c.name AS campaign_name, c.status AS campaign_status
      FROM ${SCHEMA}.ads a
      JOIN ${SCHEMA}.adsets s ON s.adset_id = a.adset_id
      JOIN ${SCHEMA}.campaigns c ON c.campaign_id = a.campaign_id
      WHERE ${scope.where}
    ),
    ad_metrics AS (
      SELECT ad_id,
             SUM(spend) AS spend, SUM(impressions) AS impressions, SUM(reach) AS reach,
             SUM(clicks) AS clicks, SUM(leads_meta) AS leads_meta,
             CASE WHEN SUM(impressions) > 0 THEN SUM(clicks)::numeric / SUM(impressions) * 100 END AS ctr,
             CASE WHEN SUM(clicks) > 0 THEN SUM(spend) / SUM(clicks) END AS cpc,
             CASE WHEN SUM(impressions) > 0 THEN SUM(spend) / SUM(impressions) * 1000 END AS cpm,
             AVG(frequency) AS frequency
      FROM ${SCHEMA}.ad_insights_daily
      WHERE date BETWEEN $3 AND $4
      GROUP BY ad_id
    ),
    crm_registration_events AS (
      SELECT ${LEAD_AD_ID} AS ad_id
      FROM inscricoes.inscricoes i
      JOIN dashboard.commercial_leads cl ON cl.inscricao_id = i.id AND cl.funnel_id = $5
      WHERE ${LEAD_HAS_AD_SIGNAL}
        AND ${LEAD_NOT_EXCLUDED}
        AND ${leadCreatedInPeriod("$3", "$4")}
    ),
    crm_registrations AS (
      SELECT ad_id, COUNT(*) AS cadastros_crm
      FROM crm_registration_events
      WHERE ad_id IS NOT NULL
      GROUP BY ad_id
    ),
    crm_base AS (
      SELECT ${LEAD_AD_ID} AS ad_id, cl.commercial_stage AS stage_key,
             cl.commercial_stage_kind, cl.closed_value
      FROM inscricoes.inscricoes i
      JOIN dashboard.commercial_leads cl ON cl.inscricao_id = i.id
      WHERE ${LEAD_HAS_AD_SIGNAL}
        AND ${LEAD_VISIBLE}
        AND cl.funnel_id = $5
        AND ${leadCreatedInPeriod("$3", "$4")}
    ),
    crm_stage_counts AS (
      SELECT ad_id, stage_key, COUNT(*) AS cnt
      FROM crm_base
      WHERE ad_id IS NOT NULL
      GROUP BY 1, 2
    ),
    crm_leads AS (
      SELECT ad_id, SUM(cnt) AS leads_crm, jsonb_object_agg(stage_key, cnt) AS stage_counts
      FROM crm_stage_counts
      GROUP BY ad_id
    ),
    crm_value AS (
      SELECT ad_id,
             COALESCE(SUM(closed_value) FILTER (WHERE commercial_stage_kind = 'won'), 0) AS valor_fechado
      FROM crm_base
      WHERE ad_id IS NOT NULL
      GROUP BY 1
    )
    SELECT sa.*, am.spend, am.impressions, am.reach, am.clicks, am.leads_meta, am.ctr, am.cpc, am.cpm, am.frequency,
           cr.cadastros_crm, cl.leads_crm, cl.stage_counts, cv.valor_fechado,
           CASE WHEN cl.leads_crm > 0 THEN am.spend / cl.leads_crm END AS cpl_real
    FROM scoped_ads sa
    LEFT JOIN ad_metrics am ON am.ad_id = sa.ad_id
    LEFT JOIN crm_registrations cr ON cr.ad_id = sa.ad_id
    LEFT JOIN crm_leads cl ON cl.ad_id = sa.ad_id
    LEFT JOIN crm_value cv ON cv.ad_id = sa.ad_id
    ORDER BY sa.campaign_name, sa.adset_name, am.spend DESC NULLS LAST
    `,
    [...scope.values, filters.from, filters.to, vozupFunnel.id]
  );

  return rows.map((row) => mapAdRow(row, stageKindByKey));
}

/**
 * Funil de conversão CUMULATIVO (quantos leads chegaram a cada etapa OU
 * além, em algum momento) — usa o histórico real de commercial_events
 * (stage_changed), não apenas a etapa atual do lead, para não perder leads
 * que já passaram por uma etapa e seguiram adiante (ou foram perdidos
 * depois de já teram avançado). Todo lead conta a etapa de entrada do seu
 * próprio funil como "alcançada", mesmo sem evento registrado, porque é
 * onde ele nasce por construção (ver ingestFacebookLead/syncToPipeline).
 * Ganho/Perdido são ramos terminais (não fazem parte da progressão
 * sequencial) e são contados pela etapa atual (commercial_stage_kind).
 */
export async function getFunnelBreakdown(
  adIds: string[],
  filters: Pick<MetaAdsFilters, "from" | "to">
): Promise<FunnelStagePoint[]> {
  const stageDefs = await getDefaultFunnelStages();
  const vozupFunnel = await getDefaultFunnel();
  if (adIds.length === 0) {
    return stageDefs.map((stage) => ({ ...stage, count: 0 }));
  }

  const pool = getPool();
  const { rows: leadRows } = await pool.query<{
    inscricao_id: number;
    commercial_stage_kind: string | null;
  }>(
    `SELECT i.id AS inscricao_id, cl.commercial_stage_kind
     FROM inscricoes.inscricoes i
     JOIN dashboard.commercial_leads cl ON cl.inscricao_id = i.id AND cl.funnel_id = $4
     WHERE ${LEAD_HAS_AD_SIGNAL}
       AND ${LEAD_VISIBLE}
       AND ${LEAD_AD_ID} = ANY($1)
       AND ${leadCreatedInPeriod("$2", "$3")}`,
    [adIds, filters.from, filters.to, vozupFunnel.id]
  );

  if (leadRows.length === 0) {
    return stageDefs.map((stage) => ({ ...stage, count: 0 }));
  }

  const inscricaoIds = leadRows.map((r) => r.inscricao_id);
  const { rows: reachedRows } = await pool.query<{ inscricao_id: number; stage_key: string }>(
    `SELECT DISTINCT inscricao_id, to_stage AS stage_key
     FROM dashboard.commercial_events
     WHERE event_type = 'stage_changed' AND to_stage IS NOT NULL AND inscricao_id = ANY($1)`,
    [inscricaoIds]
  );

  const entryStageKey = stageDefs.find((s) => s.kind === "entry")?.key;
  const reachedByLead = new Map<number, Set<string>>();
  for (const lead of leadRows) {
    const set = new Set<string>();
    if (entryStageKey) set.add(entryStageKey);
    reachedByLead.set(lead.inscricao_id, set);
  }
  for (const row of reachedRows) {
    reachedByLead.get(row.inscricao_id)?.add(row.stage_key);
  }

  const stageByKey = new Map(stageDefs.map((s) => [s.key, s]));
  const maxSequentialPositionByLead = new Map<number, number>();
  for (const [inscricaoId, stageKeys] of reachedByLead.entries()) {
    let maxPosition = -1;
    for (const key of stageKeys) {
      const stage = stageByKey.get(key);
      if (stage && (stage.kind === "entry" || stage.kind === "normal")) {
        maxPosition = Math.max(maxPosition, stage.position);
      }
    }
    maxSequentialPositionByLead.set(inscricaoId, maxPosition);
  }

  const wonCount = leadRows.filter((r) => r.commercial_stage_kind === "won").length;
  const lostCount = leadRows.filter((r) => r.commercial_stage_kind === "lost").length;
  const sequentialPositions = Array.from(maxSequentialPositionByLead.values());

  return stageDefs.map((stage) => {
    if (stage.kind === "won") return { ...stage, count: wonCount };
    if (stage.kind === "lost") return { ...stage, count: lostCount };
    const count = sequentialPositions.filter((maxPosition) => maxPosition >= stage.position).length;
    return { ...stage, count };
  });
}

/** Lista os leads reais (nome, telefone, etapa) de um ou mais anúncios —
 * usado no detalhe do card, onde "Cadastros: 12" sozinho não diz quem são
 * essas 12 pessoas. Aceita vários `ad_id` porque um card representa um
 * criativo, e o mesmo criativo roda em vários conjuntos (ver
 * `groupAdsByCreative`); cada cadastro casa com exatamente um `ad_id`, então a
 * união não duplica. */
export async function getLeadsForAds(
  adIds: string[],
  filters: Pick<MetaAdsFilters, "from" | "to">
): Promise<AdLeadSummary[]> {
  await ensureMetaAdsSchema();
  if (adIds.length === 0) return [];
  const pool = getPool();
  const vozupFunnel = await getDefaultFunnel();
  const { rows } = await pool.query<{
    id: number;
    nome: string | null;
    telefone: string | null;
    email: string | null;
    criado_em: string;
    stage_label: string | null;
    stage_kind: string | null;
    is_returning: boolean;
  }>(
    `SELECT i.id, i.payload->>'nome' AS nome, i.payload->>'telefone' AS telefone, i.payload->>'email' AS email,
            i.criado_em, fs.label AS stage_label, cl.commercial_stage_kind AS stage_kind,
            COALESCE(i.payload->>'dashboard_merged_into', '') <> '' AS is_returning
     FROM inscricoes.inscricoes i
     LEFT JOIN dashboard.commercial_leads cl
       ON cl.inscricao_id = CASE
         WHEN i.payload->>'dashboard_merged_into' ~ '^\\d+$'
           THEN (i.payload->>'dashboard_merged_into')::int
         ELSE i.id
       END
     LEFT JOIN dashboard.funnel_stages fs ON fs.funnel_id = cl.funnel_id AND fs.key = cl.commercial_stage
     WHERE ${LEAD_HAS_AD_SIGNAL}
       AND ${LEAD_NOT_EXCLUDED}
       AND ${LEAD_AD_ID} = ANY($1::text[])
       AND ${leadCreatedInPeriod("$2", "$3")}
       AND cl.funnel_id = $4
     ORDER BY i.criado_em DESC`,
    [adIds, filters.from, filters.to, vozupFunnel.id]
  );

  return rows.map((row) => ({
    id: row.id,
    nome: row.nome,
    telefone: row.telefone,
    email: row.email,
    criadoEm: row.criado_em,
    stageLabel: row.stage_label,
    stageKind: (row.stage_kind as FunnelStageKind | null) ?? null,
    isReturning: row.is_returning,
  }));
}

/** Conveniência para um único anúncio (delega em `getLeadsForAds`). */
export async function getLeadsForAd(
  adId: string,
  filters: Pick<MetaAdsFilters, "from" | "to">
): Promise<AdLeadSummary[]> {
  return getLeadsForAds([adId], filters);
}

// Casa o lead com o registro comercial certo: se ele é um satélite de
// mesclagem, a etapa/vendedor moram no contato primário (dashboard_merged_into).
const LEAD_COMMERCIAL_JOIN_ID = `CASE
    WHEN i.payload->>'dashboard_merged_into' ~ '^\\d+$'
      THEN (i.payload->>'dashboard_merged_into')::int
    ELSE i.id
  END`;

/**
 * Últimos cadastros vindos de anúncios (Meta) no período — alimenta a aba
 * "Últimos Leads". Cada linha traz de qual campanha/conjunto/anúncio a pessoa
 * veio, a etapa atual no funil e o vendedor responsável, para o gestor ver de
 * relance quem chegou e como está. O JOIN em `meta_ads.ads` garante que só
 * entram leads que casam com um anúncio real (nome de campanha sempre presente).
 * Quando `scopedAdIds` é informado, restringe ao recorte de campanha/conjunto
 * escolhido nas outras abas; senão, mostra todos os anúncios da conta.
 */
export async function getRecentAdLeads(
  filters: Pick<MetaAdsFilters, "from" | "to">,
  options: { scopedAdIds?: string[]; limit?: number } = {}
): Promise<RecentAdLead[]> {
  await ensureMetaAdsSchema();
  const pool = getPool();
  const vozupFunnel = await getDefaultFunnel();
  const limit = Math.min(Math.max(options.limit ?? 60, 1), 200);
  const values: unknown[] = [filters.from, filters.to, vozupFunnel.id];
  let scopeClause = "";
  if (options.scopedAdIds && options.scopedAdIds.length > 0) {
    values.push(options.scopedAdIds);
    scopeClause = `AND la.ad_id = ANY($${values.length}::text[])`;
  }
  values.push(limit);
  const limitPlaceholder = `$${values.length}`;

  const { rows } = await pool.query<{
    id: number;
    nome: string | null;
    telefone: string | null;
    email: string | null;
    criado_em: string;
    stage_label: string | null;
    stage_kind: string | null;
    is_returning: boolean;
    campaign_name: string;
    adset_name: string;
    ad_name: string;
    seller_name: string | null;
  }>(
    `WITH lead_ad AS (
       SELECT i.id, i.criado_em,
              i.payload->>'nome' AS nome,
              i.payload->>'telefone' AS telefone,
              i.payload->>'email' AS email,
              COALESCE(i.payload->>'dashboard_merged_into', '') <> '' AS is_returning,
              ${LEAD_COMMERCIAL_JOIN_ID} AS commercial_id,
              ${LEAD_AD_ID} AS ad_id
       FROM inscricoes.inscricoes i
       WHERE ${LEAD_HAS_AD_SIGNAL}
         AND ${LEAD_NOT_EXCLUDED}
         AND ${leadCreatedInPeriod("$1", "$2")}
     )
     SELECT la.id, la.nome, la.telefone, la.email, la.criado_em, la.is_returning,
            c.name AS campaign_name, s.name AS adset_name, a.name AS ad_name,
            fs.label AS stage_label, cl.commercial_stage_kind AS stage_kind,
            cl.assigned_seller_name AS seller_name
     FROM lead_ad la
     JOIN ${SCHEMA}.ads a ON a.ad_id = la.ad_id
     JOIN ${SCHEMA}.adsets s ON s.adset_id = a.adset_id
     JOIN ${SCHEMA}.campaigns c ON c.campaign_id = a.campaign_id
     JOIN dashboard.commercial_leads cl ON cl.inscricao_id = la.commercial_id AND cl.funnel_id = $3
     LEFT JOIN dashboard.funnel_stages fs ON fs.funnel_id = cl.funnel_id AND fs.key = cl.commercial_stage
     WHERE la.ad_id IS NOT NULL ${scopeClause}
     ORDER BY la.criado_em DESC
     LIMIT ${limitPlaceholder}`,
    values
  );

  return rows.map((row) => ({
    id: row.id,
    nome: row.nome,
    telefone: row.telefone,
    email: row.email,
    criadoEm: row.criado_em,
    stageLabel: row.stage_label,
    stageKind: (row.stage_kind as FunnelStageKind | null) ?? null,
    isReturning: row.is_returning,
    campaignName: row.campaign_name,
    adsetName: row.adset_name,
    adName: row.ad_name,
    sellerName: row.seller_name,
  }));
}

/**
 * Desempenho por vendedor considerando SÓ leads vindos de anúncios (Meta) no
 * período — base da aba "Vendedores". Conta cada pessoa uma vez (LEAD_VISIBLE
 * exclui satélites de mesclagem) e agrega por vendedor responsável no CRM. A
 * linha "não distribuído" (sem vendedor) vem com sellerName null, para o gestor
 * ver quantos leads de anúncio ainda não têm dono.
 */
export async function getSellerAdPerformance(
  filters: Pick<MetaAdsFilters, "from" | "to">,
  options: { scopedAdIds?: string[] } = {}
): Promise<SellerAdPerformance[]> {
  await ensureMetaAdsSchema();
  const pool = getPool();
  const vozupFunnel = await getDefaultFunnel();
  const values: unknown[] = [filters.from, filters.to, vozupFunnel.id];
  let scopeClause = "";
  if (options.scopedAdIds && options.scopedAdIds.length > 0) {
    values.push(options.scopedAdIds);
    scopeClause = `AND la.ad_id = ANY($${values.length}::text[])`;
  }

  const { rows } = await pool.query<{
    seller_name: string | null;
    seller_email: string | null;
    total_leads: string;
    qualificados: string;
    ganhos: string;
    perdidos: string;
    valor_fechado: string | null;
  }>(
    `WITH lead_ad AS (
       SELECT ${LEAD_COMMERCIAL_JOIN_ID} AS commercial_id,
              ${LEAD_AD_ID} AS ad_id
       FROM inscricoes.inscricoes i
       WHERE ${LEAD_HAS_AD_SIGNAL}
         AND ${LEAD_VISIBLE}
         AND ${leadCreatedInPeriod("$1", "$2")}
     ),
     scoped AS (
       SELECT DISTINCT la.commercial_id
       FROM lead_ad la
       JOIN ${SCHEMA}.ads a ON a.ad_id = la.ad_id
       WHERE la.ad_id IS NOT NULL ${scopeClause}
     )
     SELECT cl.assigned_seller_name AS seller_name,
            cl.assigned_seller_email AS seller_email,
            COUNT(*)::text AS total_leads,
            COUNT(*) FILTER (WHERE cl.commercial_stage_kind IN ('normal','won'))::text AS qualificados,
            COUNT(*) FILTER (WHERE cl.commercial_stage_kind = 'won')::text AS ganhos,
            COUNT(*) FILTER (WHERE cl.commercial_stage_kind = 'lost')::text AS perdidos,
            COALESCE(SUM(cl.closed_value) FILTER (WHERE cl.commercial_stage_kind = 'won'), 0)::text AS valor_fechado
     FROM scoped sc
     JOIN dashboard.commercial_leads cl ON cl.inscricao_id = sc.commercial_id AND cl.funnel_id = $3
     GROUP BY cl.assigned_seller_name, cl.assigned_seller_email
     ORDER BY COUNT(*) DESC`,
    values
  );

  return rows.map((row) => ({
    sellerName: row.seller_name,
    sellerEmail: row.seller_email,
    totalLeads: toNumber(row.total_leads),
    qualificados: toNumber(row.qualificados),
    ganhos: toNumber(row.ganhos),
    perdidos: toNumber(row.perdidos),
    valorFechado: toNumber(row.valor_fechado),
  }));
}

/**
 * Resolve a URL tocável de um vídeo de criativo sob demanda. O `source` da
 * Graph API é um link de CDN temporário (expira em poucas horas), então NÃO é
 * guardado no banco — é buscado na hora em que o gestor abre o criativo. Falha
 * graciosamente: se a Graph recusar, devolve `source: null` e o chamador cai
 * pro `permalink_url`/thumbnail.
 */
export async function getCreativeVideoSource(videoId: string): Promise<CreativeVideoSource> {
  try {
    const data = await fetchGraphWithRetry<{ source?: string; permalink_url?: string }>(
      `${videoId}?fields=source,permalink_url`
    );
    // A Graph devolve o permalink relativo (ex.: "/reel/123/"); a UI precisa da
    // URL absoluta pra tocar no plugin do Facebook e pro link "abrir lá".
    let permalinkUrl = data.permalink_url ?? null;
    if (permalinkUrl && permalinkUrl.startsWith("/")) {
      permalinkUrl = `https://www.facebook.com${permalinkUrl}`;
    }
    return {
      source: data.source ?? null,
      permalinkUrl,
    };
  } catch (error) {
    console.warn("[metaAds] Não foi possível resolver a URL do vídeo do criativo:", error);
    return { source: null, permalinkUrl: null };
  }
}

function emptyMetrics(): AggregatedMetrics {
  return {
    spend: 0,
    impressions: 0,
    reach: 0,
    clicks: 0,
    leadsMeta: 0,
    cadastrosCrm: 0,
    leadsCrm: 0,
    leadsQualificados: 0,
    leadsFechados: 0,
    valorFechado: 0,
    stageCounts: {},
  };
}

function addMetrics(target: AggregatedMetrics, row: AdRow): void {
  target.spend += row.spend;
  target.impressions += row.impressions;
  target.reach += row.reach;
  target.clicks += row.clicks;
  target.leadsMeta += row.leadsMeta;
  target.cadastrosCrm += row.cadastrosCrm;
  target.leadsCrm += row.leadsCrm;
  target.leadsQualificados += row.leadsQualificados;
  target.leadsFechados += row.leadsFechados;
  target.valorFechado += row.valorFechado;
  for (const [key, count] of Object.entries(row.stageCounts)) {
    target.stageCounts[key] = (target.stageCounts[key] ?? 0) + count;
  }
}

export function buildHierarchyTree(adRows: AdRow[]): CampaignGroup[] {
  const campaignMap = new Map<string, CampaignGroup>();

  for (const row of adRows) {
    let campaign = campaignMap.get(row.campaignId);
    if (!campaign) {
      campaign = {
        campaignId: row.campaignId,
        campaignName: row.campaignName,
        status: row.campaignStatus,
        adsets: [],
        totals: emptyMetrics(),
      };
      campaignMap.set(row.campaignId, campaign);
    }

    let adset = campaign.adsets.find((a) => a.adsetId === row.adsetId);
    if (!adset) {
      adset = { adsetId: row.adsetId, adsetName: row.adsetName, status: row.adsetStatus, ads: [], totals: emptyMetrics() };
      campaign.adsets.push(adset);
    }

    adset.ads.push(row);
    addMetrics(adset.totals, row);
    addMetrics(campaign.totals, row);
  }

  return Array.from(campaignMap.values());
}

/** Deriva os KPIs a partir de um AdRow[] já carregado — usar quando o
 * chamador já tem os dados de getAdsHierarchy, para não repetir a query. */
export function computeKpiTotals(adRows: AdRow[]): KpiTotals {
  const totals = emptyMetrics();
  for (const row of adRows) addMetrics(totals, row);

  return {
    ...totals,
    ctr: totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : null,
    cpc: totals.clicks > 0 ? totals.spend / totals.clicks : null,
    cpm: totals.impressions > 0 ? (totals.spend / totals.impressions) * 1000 : null,
    cplReal: totals.leadsCrm > 0 ? totals.spend / totals.leadsCrm : null,
    cacReal: totals.leadsFechados > 0 ? totals.spend / totals.leadsFechados : null,
  };
}

export async function getKpiTotals(filters: MetaAdsFilters): Promise<KpiTotals> {
  const adRows = await getAdsHierarchy(filters);
  return computeKpiTotals(adRows);
}

/** `scopedAdIds` permite restringir a série a uma campanha/conjunto específico
 * (calculado a partir de um `hierarchy` já carregado, sem nova query) — se
 * omitido, usa todos os anúncios do período via getAdIdsForScope. */
export async function getDailySeries(filters: MetaAdsFilters, scopedAdIds?: string[]): Promise<DailySeriesPoint[]> {
  await ensureMetaAdsSchema();
  const pool = getPool();
  const vozupFunnel = await getDefaultFunnel();
  const adIds = scopedAdIds ?? (await getAdIdsForScope(filters));
  if (adIds.length === 0) return [];

  const { rows: mediaRows } = await pool.query<{ date: string; spend: string; leads_meta: string }>(
    `SELECT date::text, SUM(spend) AS spend, SUM(leads_meta) AS leads_meta
     FROM ${SCHEMA}.ad_insights_daily
     WHERE ad_id = ANY($1) AND date BETWEEN $2 AND $3
     GROUP BY date ORDER BY date`,
    [adIds, filters.from, filters.to]
  );

  const { rows: crmRows } = await pool.query<{ date: string; leads_crm: string }>(
    `SELECT (i.criado_em AT TIME ZONE '${META_ADS_TIME_ZONE}')::date::text AS date, COUNT(*) AS leads_crm
     FROM inscricoes.inscricoes i
     JOIN dashboard.commercial_leads cl ON cl.inscricao_id = i.id
     WHERE ${LEAD_HAS_AD_SIGNAL}
       AND ${LEAD_VISIBLE}
       AND ${LEAD_AD_ID} = ANY($1)
       AND ${leadCreatedInPeriod("$2", "$3")}
       AND cl.funnel_id = $4
     GROUP BY 1 ORDER BY 1`,
    [adIds, filters.from, filters.to, vozupFunnel.id]
  );

  const { rows: registrationRows } = await pool.query<{ date: string; cadastros_crm: string }>(
    `SELECT (i.criado_em AT TIME ZONE '${META_ADS_TIME_ZONE}')::date::text AS date,
            COUNT(*) AS cadastros_crm
     FROM inscricoes.inscricoes i
     JOIN dashboard.commercial_leads cl ON cl.inscricao_id = i.id AND cl.funnel_id = $4
     WHERE ${LEAD_HAS_AD_SIGNAL}
       AND ${LEAD_NOT_EXCLUDED}
       AND ${LEAD_AD_ID} = ANY($1)
       AND ${leadCreatedInPeriod("$2", "$3")}
     GROUP BY 1 ORDER BY 1`,
    [adIds, filters.from, filters.to, vozupFunnel.id]
  );

  const byDate = new Map<string, DailySeriesPoint>();
  for (const row of mediaRows) {
    byDate.set(row.date, {
      date: row.date,
      spend: toNumber(row.spend),
      leadsMeta: toNumber(row.leads_meta),
      cadastrosCrm: 0,
      leadsCrm: 0,
    });
  }
  for (const row of registrationRows) {
    const existing = byDate.get(row.date);
    if (existing) existing.cadastrosCrm = toNumber(row.cadastros_crm);
    else {
      byDate.set(row.date, {
        date: row.date,
        spend: 0,
        leadsMeta: 0,
        cadastrosCrm: toNumber(row.cadastros_crm),
        leadsCrm: 0,
      });
    }
  }
  for (const row of crmRows) {
    const existing = byDate.get(row.date);
    if (existing) existing.leadsCrm = toNumber(row.leads_crm);
    else {
      byDate.set(row.date, {
        date: row.date,
        spend: 0,
        leadsMeta: 0,
        cadastrosCrm: 0,
        leadsCrm: toNumber(row.leads_crm),
      });
    }
  }

  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}
