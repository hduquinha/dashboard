import { costPer } from "@/lib/adDestinationGroups";
import { classifyCampaignPurpose } from "@/lib/campaignObjectives";
import { getPool } from "@/lib/db";
import { getFacebookAccessToken } from "@/lib/facebookLeadAds";
import { snapshotInstagramProfiles } from "@/lib/instagramProfiles";
import {
  addEngagement,
  emptyEngagement,
  engagementFromActionTotals,
  TRACKED_ACTION_TYPES,
} from "@/lib/metaAdsEngagement";
import type {
  AdLeadDetail,
  AdLeadSummary,
  AdRow,
  AggregatedMetrics,
  CampaignGroup,
  CreativeVideoSource,
  DailyAdRow,
  DailySeriesPoint,
  FunnelStageDef,
  FunnelStageKind,
  FunnelStagePoint,
  KpiTotals,
  LeadBucket,
  MetaAdsFilters,
  MetaReconciliation,
  PeriodReachData,
  PeriodReachRow,
  ReconciliationLine,
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

    -- Alcance REAL (pessoas únicas) do período, como a Meta calcula.
    -- ad_insights_daily guarda o alcance de cada anúncio em cada dia; somar
    -- essas linhas conta a mesma pessoa várias vezes (ela viu dois anúncios,
    -- ou o mesmo anúncio em dois dias) e infla o número em ~30%. Alcance só é
    -- deduplicável pela própria Meta, para a janela e o recorte exatos — então
    -- guardamos aqui a resposta dela por (nível, objeto, janela).
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.period_insights (
      level        TEXT NOT NULL,
      object_id    TEXT NOT NULL,
      date_from    DATE NOT NULL,
      date_to      DATE NOT NULL,
      reach        BIGINT NOT NULL DEFAULT 0,
      impressions  BIGINT NOT NULL DEFAULT 0,
      spend        NUMERIC NOT NULL DEFAULT 0,
      clicks       BIGINT NOT NULL DEFAULT 0,
      leads        BIGINT NOT NULL DEFAULT 0,
      frequency    NUMERIC,
      synced_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (level, object_id, date_from, date_to)
    );
    ALTER TABLE ${SCHEMA}.period_insights ADD COLUMN IF NOT EXISTS leads BIGINT NOT NULL DEFAULT 0;
    CREATE INDEX IF NOT EXISTS idx_meta_period_insights_window
      ON ${SCHEMA}.period_insights(date_from, date_to);

    -- Todo nome que cada anúncio já teve. A Meta permite renomear criativo a
    -- qualquer momento e esta conta recicla os códigos VOZUP_ADxx, então o nome
    -- que o lead gravou na UTM pode já pertencer a outro anúncio — ou a nenhum.
    -- Com o histórico, o nome antigo continua apontando para o ad_id certo.
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.ad_name_history (
      ad_id         TEXT NOT NULL REFERENCES ${SCHEMA}.ads(ad_id) ON DELETE CASCADE,
      name_lower    TEXT NOT NULL,
      name          TEXT NOT NULL,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (ad_id, name_lower)
    );
    CREATE INDEX IF NOT EXISTS idx_meta_ad_name_history_name ON ${SCHEMA}.ad_name_history(name_lower);

    -- Atribuição lead → anúncio CONGELADA no momento em que foi resolvida.
    -- A resolução por UTM depende do NOME atual do anúncio/conjunto/campanha;
    -- renomear ou excluir um anúncio quebra retroativamente o vínculo de todos
    -- os leads antigos dele (em julho/2026 isso escondeu 23 dos 110 cadastros
    -- pagos). Gravando o ad_id assim que ele é conhecido, o vínculo sobrevive a
    -- qualquer mudança posterior de nome.
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.lead_ad_attribution (
      inscricao_id  BIGINT PRIMARY KEY,
      ad_id         TEXT NOT NULL REFERENCES ${SCHEMA}.ads(ad_id) ON DELETE CASCADE,
      method        TEXT NOT NULL,
      resolved_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_meta_lead_attr_ad ON ${SCHEMA}.lead_ad_attribution(ad_id);

    -- Colunas adicionadas depois do schema original (idempotente).
    -- url_tags: template de UTM do criativo (ex.: "utm_content={{ad.name}}") —
    -- prova de quais UTMs os cliques desse anúncio carregam.
    -- landing_url: página de destino do criativo (landing page/formulário),
    -- extraída de link_data/video_data/asset_feed_spec.
    ALTER TABLE ${SCHEMA}.ads ADD COLUMN IF NOT EXISTS url_tags TEXT;
    ALTER TABLE ${SCHEMA}.ads ADD COLUMN IF NOT EXISTS landing_url TEXT;

    -- is_placeholder: linha que NÃO existe (mais) na Meta, criada a partir do
    -- UTM gravado no próprio lead para que o cadastro não suma da campanha que
    -- de fato o gerou. Nunca recebe insight — gasto e entrega ficam zerados.
    ALTER TABLE ${SCHEMA}.ads ADD COLUMN IF NOT EXISTS is_placeholder BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE ${SCHEMA}.adsets ADD COLUMN IF NOT EXISTS is_placeholder BOOLEAN NOT NULL DEFAULT false;
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
      await client.query(
        `INSERT INTO ${SCHEMA}.ad_name_history (ad_id, name_lower, name)
         VALUES ($1, LOWER($2), $2)
         ON CONFLICT (ad_id, name_lower) DO UPDATE SET last_seen_at = NOW()`,
        [row.id, row.name]
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

/**
 * Sem `filtering`, a Graph API devolve só o que está "vivo" e ESCONDE o que foi
 * arquivado. Anúncio arquivado, porém, gastou dinheiro e trouxe lead enquanto
 * rodava: sem ele, o insight daquele período é descartado em upsertInsightRows
 * (que só aceita ad_id conhecido) e o lead perde a que campanha pertence. Por
 * isso pedimos explicitamente todos os status.
 */
function effectiveStatusFilter(level: "campaign" | "adset" | "ad"): string {
  const statuses =
    level === "campaign"
      ? ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"]
      : level === "adset"
        ? ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED", "CAMPAIGN_PAUSED"]
        : [
            "ACTIVE",
            "PAUSED",
            "DELETED",
            "ARCHIVED",
            "ADSET_PAUSED",
            "CAMPAIGN_PAUSED",
            "DISAPPROVED",
            "PENDING_REVIEW",
            "IN_PROCESS",
            "WITH_ISSUES",
          ];
  const filtering = JSON.stringify([{ field: `${level}.effective_status`, operator: "IN", value: statuses }]);
  return `&filtering=${encodeURIComponent(filtering)}`;
}

export async function syncMetaAdsStructure(): Promise<{ rows: number }> {
  const accountId = requireAdAccountId();

  const campaigns = await fetchAllPages<CampaignApiRow>(
    `${accountId}/campaigns?fields=id,name,status,effective_status,objective,buying_type,daily_budget,lifetime_budget,start_time,stop_time,created_time,updated_time&limit=200${effectiveStatusFilter("campaign")}`
  );
  await upsertCampaigns(campaigns, accountId);

  const adsets = await fetchAllPages<AdsetApiRow>(
    `${accountId}/adsets?fields=id,campaign_id,name,status,effective_status,optimization_goal,billing_event,daily_budget,lifetime_budget,start_time,stop_time&limit=200${effectiveStatusFilter("adset")}`
  );
  await upsertAdsets(adsets, accountId);

  const rawAds = await fetchAllPages<AdApiRow>(
    `${accountId}/ads?fields=id,adset_id,campaign_id,name,status,effective_status,creative{id,thumbnail_url,image_url,video_id,object_story_spec,url_tags,asset_feed_spec{link_urls}}&limit=200${effectiveStatusFilter("ad")}`
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

// ─────────────────────────────────────────────────────────────
// Alcance deduplicado do período (o número que o gerenciador mostra)
// ─────────────────────────────────────────────────────────────

interface PeriodInsightApiRow {
  campaign_id?: string;
  adset_id?: string;
  reach?: string;
  impressions?: string;
  spend?: string;
  clicks?: string;
  frequency?: string;
  actions?: ActionRow[];
}

const PERIOD_LEVELS = ["account", "campaign", "adset"] as const;
type PeriodLevel = (typeof PERIOD_LEVELS)[number];

/** Janela ainda em curso muda a cada entrega; janela fechada não muda mais. */
function periodCacheMaxAgeMinutes(dateTo: string): number {
  return dateTo >= getMetaAdsToday() ? 15 : 60 * 12;
}

// Se a Graph API falhar (token, rate limit, rede), não adianta tentar de novo a
// cada render — a tela cairia para o alcance somado do mesmo jeito, só que
// lenta. Uma tentativa por minuto por janela é suficiente.
const periodFetchAttempts = new Map<string, number>();
const PERIOD_RETRY_COOLDOWN_MS = 60_000;
const PERIOD_FETCH_TIMEOUT_MS = 9_000;

async function fetchPeriodLevel(
  accountId: string,
  level: PeriodLevel,
  from: string,
  to: string
): Promise<Array<{ objectId: string; row: PeriodInsightApiRow }>> {
  const idField = level === "campaign" ? "campaign_id," : level === "adset" ? "adset_id," : "";
  const fields = `${idField}reach,impressions,spend,clicks,frequency,actions`;
  const timeRange = encodeURIComponent(JSON.stringify({ since: from, until: to }));
  // Sem time_increment: a Meta devolve UMA linha por objeto para a janela
  // inteira, com o alcance já deduplicado (é isso que a soma diária não dá).
  const rows = await fetchAllPages<PeriodInsightApiRow>(
    `${accountId}/insights?level=${level}&fields=${fields}&time_range=${timeRange}&limit=500`
  );

  return rows.map((row) => ({
    objectId: level === "campaign" ? (row.campaign_id ?? "") : level === "adset" ? (row.adset_id ?? "") : accountId,
    row,
  }));
}

async function upsertPeriodInsights(
  level: PeriodLevel,
  from: string,
  to: string,
  entries: Array<{ objectId: string; row: PeriodInsightApiRow }>
): Promise<void> {
  const pool = getPool();
  for (const entry of entries) {
    if (!entry.objectId) continue;
    await pool.query(
      `INSERT INTO ${SCHEMA}.period_insights
         (level, object_id, date_from, date_to, reach, impressions, spend, clicks, leads, frequency, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, NOW())
       ON CONFLICT (level, object_id, date_from, date_to) DO UPDATE SET
         reach = EXCLUDED.reach, impressions = EXCLUDED.impressions, spend = EXCLUDED.spend,
         clicks = EXCLUDED.clicks, leads = EXCLUDED.leads, frequency = EXCLUDED.frequency, synced_at = NOW()`,
      [
        level,
        entry.objectId,
        from,
        to,
        entry.row.reach ?? "0",
        entry.row.impressions ?? "0",
        entry.row.spend ?? "0",
        entry.row.clicks ?? "0",
        extractActionValue(entry.row.actions, LEAD_ACTION_TYPES),
        entry.row.frequency ?? null,
      ]
    );
  }
}

/** Busca na Meta o alcance real da janela nos três níveis (conta, campanha e
 * conjunto) e grava no cache. Três chamadas, em paralelo. */
export async function syncPeriodInsights(from: string, to: string): Promise<{ rows: number }> {
  const accountId = requireAdAccountId();
  const results = await Promise.all(PERIOD_LEVELS.map((level) => fetchPeriodLevel(accountId, level, from, to)));

  let total = 0;
  for (const [index, entries] of results.entries()) {
    await upsertPeriodInsights(PERIOD_LEVELS[index], from, to, entries);
    total += entries.length;
  }
  return { rows: total };
}

const EMPTY_PERIOD_REACH: PeriodReachData = {
  from: "",
  to: "",
  account: null,
  byCampaign: {},
  byAdset: {},
  syncedAt: null,
};

async function readPeriodInsights(from: string, to: string): Promise<PeriodReachData> {
  const accountId = requireAdAccountId();
  const { rows } = await getPool().query<{
    level: string;
    object_id: string;
    reach: string;
    impressions: string;
    spend: string;
    clicks: string;
    leads: string;
    frequency: string | null;
    synced_at: string;
  }>(
    `SELECT level, object_id, reach, impressions, spend, clicks, leads, frequency, synced_at
     FROM ${SCHEMA}.period_insights WHERE date_from = $1 AND date_to = $2`,
    [from, to]
  );

  const data: PeriodReachData = { from, to, account: null, byCampaign: {}, byAdset: {}, syncedAt: null };
  for (const row of rows) {
    const value: PeriodReachRow = {
      reach: toNumber(row.reach),
      impressions: toNumber(row.impressions),
      spend: toNumber(row.spend),
      clicks: toNumber(row.clicks),
      leads: toNumber(row.leads),
      frequency: toNullableNumber(row.frequency),
    };
    if (row.level === "account" && row.object_id === accountId) data.account = value;
    else if (row.level === "campaign") data.byCampaign[row.object_id] = value;
    else if (row.level === "adset") data.byAdset[row.object_id] = value;
    if (!data.syncedAt || row.synced_at > data.syncedAt) data.syncedAt = row.synced_at;
  }
  return data;
}

/**
 * Alcance real do período, do jeito que a Meta calcula. Lê do cache; se a
 * janela estiver velha (ou nunca consultada), atualiza na Graph API antes de
 * responder. Nunca derruba a página: se a Meta não responder, devolve o que
 * tiver em cache (ou nada) e quem chama mostra o alcance somado com ressalva.
 */
export async function getPeriodReach(from: string, to: string): Promise<PeriodReachData> {
  if (!from || !to) return EMPTY_PERIOD_REACH;
  await ensureMetaAdsSchema();

  const cached = await readPeriodInsights(from, to);
  const maxAgeMs = periodCacheMaxAgeMinutes(to) * 60 * 1000;
  const fresh = cached.syncedAt !== null && Date.now() - new Date(cached.syncedAt).getTime() < maxAgeMs;
  if (fresh) return cached;

  const attemptKey = `${from}|${to}`;
  const lastAttempt = periodFetchAttempts.get(attemptKey) ?? 0;
  if (Date.now() - lastAttempt < PERIOD_RETRY_COOLDOWN_MS) return cached;
  periodFetchAttempts.set(attemptKey, Date.now());

  try {
    await Promise.race([
      syncPeriodInsights(from, to),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), PERIOD_FETCH_TIMEOUT_MS)),
    ]);
    return await readPeriodInsights(from, to);
  } catch (error) {
    console.warn("[metaAds] alcance deduplicado indisponível para", from, to, error);
    return cached;
  }
}

// ─────────────────────────────────────────────────────────────
// Conferência automática: a tela tem que fechar com o gerenciador
// ─────────────────────────────────────────────────────────────

/** Centavos de tolerância no gasto. A Meta arredonda o valor exibido no
 * gerenciador (mostra 1.516,60 para 1.516,65 devolvido pela própria API dela),
 * então exigir igualdade absoluta acusaria erro onde não há. */
const SPEND_TOLERANCE = 0.05;
/** Impressão em janela ainda aberta muda enquanto a conferência roda. */
const COUNT_TOLERANCE = 2;

const reconciliationHealAttempts = new Map<string, number>();
const HEAL_COOLDOWN_MS = 5 * 60 * 1000;
const RECONCILIATION_HEAL_TIMEOUT_MS = 12_000;

async function readDbTotals(from: string, to: string): Promise<{
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
}> {
  const { rows } = await getPool().query<{
    spend: string | null;
    impressions: string | null;
    clicks: string | null;
    leads: string | null;
  }>(
    `SELECT SUM(spend) AS spend, SUM(impressions) AS impressions,
            SUM(clicks) AS clicks, SUM(leads_meta) AS leads
     FROM ${SCHEMA}.ad_insights_daily WHERE date BETWEEN $1 AND $2`,
    [from, to]
  );
  return {
    spend: toNumber(rows[0]?.spend),
    impressions: toNumber(rows[0]?.impressions),
    clicks: toNumber(rows[0]?.clicks),
    leads: toNumber(rows[0]?.leads),
  };
}

/** Decomposição do lado do CRM: por que "pessoas" é menor que "leads da Meta". */
async function readCrmBreakdown(from: string, to: string): Promise<MetaReconciliation["crm"]> {
  const { rows } = await getPool().query<{
    envios: string;
    excluidos: string;
    duplicados: string;
    recontatos: string;
    novos: string;
    pessoas: string;
    sem_anuncio: string;
  }>(
    `WITH brutos AS (
       SELECT ${LEAD_AD_ID} AS ad_id, ${leadBucketExpr("$1")} AS bucket
       FROM inscricoes.inscricoes i
       WHERE ${LEAD_HAS_AD_SIGNAL}
         AND ${leadCreatedInPeriod("$1", "$2")}
     ),
     -- Resolver para um id que não existe em meta_ads.ads é o mesmo que não
     -- resolver: a tela junta com a estrutura real e não mostraria esse envio.
     -- Sem este filtro o painel contava um envio a mais que a tela e a
     -- conferência acusava diferença onde não havia nenhuma.
     leads AS (
       SELECT CASE WHEN EXISTS (SELECT 1 FROM ${SCHEMA}.ads a WHERE a.ad_id = b.ad_id) THEN b.ad_id END AS ad_id,
              b.bucket
       FROM brutos b
     ),
     atribuidos AS (SELECT bucket FROM leads WHERE ad_id IS NOT NULL)
     SELECT
       (SELECT COUNT(*) FROM atribuidos) AS envios,
       (SELECT COUNT(*) FROM atribuidos WHERE bucket = 'descartado') AS excluidos,
       (SELECT COUNT(*) FROM atribuidos WHERE bucket = 'repetido') AS duplicados,
       (SELECT COUNT(*) FROM atribuidos WHERE bucket = 'recontato') AS recontatos,
       (SELECT COUNT(*) FROM atribuidos WHERE bucket = 'novo') AS novos,
       (SELECT COUNT(*) FROM atribuidos WHERE bucket IN ('novo', 'recontato')) AS pessoas,
       (SELECT COUNT(*) FROM leads WHERE ad_id IS NULL) AS sem_anuncio`,
    [from, to]
  );
  const row = rows[0];
  return {
    envios: toNumber(row?.envios),
    excluidos: toNumber(row?.excluidos),
    duplicados: toNumber(row?.duplicados),
    recontatos: toNumber(row?.recontatos),
    novos: toNumber(row?.novos),
    pessoas: toNumber(row?.pessoas),
    semAnuncio: toNumber(row?.sem_anuncio),
  };
}

function compare(meta: number, dash: number, tolerance: number): ReconciliationLine {
  const diff = dash - meta;
  return { meta, dash, diff, ok: Math.abs(diff) <= tolerance };
}

/**
 * Janela que inclui HOJE não fecha ao centavo, e não é defeito: o dia ainda
 * está rodando, a Meta recalcula o gasto durante o dia e as duas leituras
 * (cache do período × soma diária) acontecem em instantes diferentes. Exigir
 * igualdade absoluta aí faz a tela gritar "divergente" por R$ 0,11 e treina
 * todo mundo a ignorar o aviso — que é o oposto do que ele existe para fazer.
 * Janela fechada continua exigindo precisão de centavo.
 */
function toleranciasDaJanela(metaRow: PeriodReachRow | null, janelaAberta: boolean) {
  if (!janelaAberta) return { spend: SPEND_TOLERANCE, count: COUNT_TOLERANCE };
  return {
    spend: Math.max(SPEND_TOLERANCE, (metaRow?.spend ?? 0) * 0.02),
    count: Math.max(COUNT_TOLERANCE, Math.ceil((metaRow?.impressions ?? 0) * 0.02)),
  };
}

/**
 * Confere a tela contra o gerenciador e, quando o gasto não fecha, RESSINCRONIZA
 * a janela e confere de novo antes de responder. É o que mantém a paridade sem
 * ninguém precisar lembrar de olhar: divergência costuma ser insight que chegou
 * atrasado ou foi ajustado pela Meta depois, e é exatamente isso que um novo
 * `syncMetaAdsInsights` daquela janela resolve.
 *
 * O lado do CRM não "tem que bater": a Meta conta ENVIO de formulário e o CRM
 * conta PESSOA. A conferência mostra a ponte entre os dois — envios atribuídos,
 * quantos foram a mesma pessoa preenchendo de novo, quantos foram excluídos à
 * mão — em vez de forçar os números a serem iguais.
 */
export async function getMetaReconciliation(from: string, to: string): Promise<MetaReconciliation> {
  await ensureMetaAdsSchema();

  const janelaAberta = to >= getMetaAdsToday();

  const build = async (
    metaRow: PeriodReachRow | null,
    healed: boolean
  ): Promise<MetaReconciliation> => {
    const [dash, crm] = await Promise.all([readDbTotals(from, to), readCrmBreakdown(from, to)]);
    const tol = toleranciasDaJanela(metaRow, janelaAberta);

    if (!metaRow) {
      // Sem linha na Meta E sem nada no banco = período que simplesmente não
      // teve veiculação (esta conta só entrega desde 04/07/2026). Chamar isso
      // de "não deu para falar com a Meta" assusta à toa.
      const semEntregaDosDoisLados = dash.spend === 0 && dash.impressions === 0;
      return {
        from,
        to,
        status: semEntregaDosDoisLados ? "ok" : "indisponivel",
        healed,
        parcial: janelaAberta,
        spend: compare(0, dash.spend, tol.spend),
        impressions: compare(0, dash.impressions, tol.count),
        clicks: compare(0, dash.clicks, tol.count),
        leads: compare(0, dash.leads, tol.count),
        crm,
        checkedAt: new Date().toISOString(),
      };
    }
    const spend = compare(metaRow.spend, dash.spend, tol.spend);
    const impressions = compare(metaRow.impressions, dash.impressions, tol.count);
    const clicks = compare(metaRow.clicks, dash.clicks, tol.count);
    const leads = compare(metaRow.leads, dash.leads, tol.count);
    return {
      from,
      to,
      status: spend.ok && impressions.ok && clicks.ok && leads.ok ? (healed ? "ajustado" : "ok") : "divergente",
      healed,
      parcial: janelaAberta,
      spend,
      impressions,
      clicks,
      leads,
      crm,
      checkedAt: new Date().toISOString(),
    };
  };

  const first = await build((await getPeriodReach(from, to)).account, false);
  if (first.status !== "divergente") return first;

  // Divergiu: puxa os insights da janela de novo (é o conserto que funciona) e
  // reconfere. Com trava de tempo, para uma tela recarregada em looping não
  // virar rajada de chamadas na Graph API.
  const key = `${from}|${to}`;
  const lastHeal = reconciliationHealAttempts.get(key) ?? 0;
  if (Date.now() - lastHeal < HEAL_COOLDOWN_MS) return first;
  reconciliationHealAttempts.set(key, Date.now());

  try {
    // O conserto acontece no meio do carregamento da página, então tem hora
    // para acabar: estourando o limite, a tela mostra a divergência (com o
    // aviso) em vez de ficar em branco esperando a Graph API.
    await Promise.race([
      (async () => {
        await syncMetaAdsInsights({ sinceDate: from, untilDate: to });
        await syncPeriodInsights(from, to);
      })(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), RECONCILIATION_HEAL_TIMEOUT_MS)),
    ]);
    return await build((await readPeriodInsights(from, to)).account, true);
  } catch (error) {
    console.warn("[metaAds] não foi possível ressincronizar a janela divergente:", from, to, error);
    return first;
  }
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

      // Depois da estrutura: enquanto os nomes recém-sincronizados ainda são os
      // mesmos que os criativos carimbaram nas UTMs, congela o vínculo lead →
      // anúncio. Nunca derruba o sync de mídia se falhar.
      try {
        await recordSyncRun("lead_attribution", null, null, () => reconcileLeadAttribution());
      } catch (error) {
        console.warn("[metaAds] falha ao reconciliar atribuição de leads:", error);
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

      // Foto do dia dos perfis do Instagram. É a ÚNICA forma de ter série de
      // seguidores com o token atual (ver lib/instagramProfiles.ts), então roda
      // junto do sync — e nunca derruba o sync de mídia se falhar.
      try {
        await recordSyncRun("instagram_profiles", null, null, async () => {
          const { profiles } = await snapshotInstagramProfiles();
          return { rows: profiles };
        });
      } catch (error) {
        console.warn("[metaAds] falha ao fotografar perfis do Instagram:", error);
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

/**
 * Meses (YYYY-MM) que têm alguma entrega registrada, do mais novo para o mais
 * antigo — o seletor do relatório mensal só oferece mês que existe, em vez de
 * deixar escolher um mês que devolveria uma página zerada.
 */
export async function getReportMonths(limit = 24): Promise<string[]> {
  await ensureMetaAdsSchema();
  const { rows } = await getPool().query<{ month: string }>(
    `SELECT to_char(date_trunc('month', date), 'YYYY-MM') AS month
     FROM ${SCHEMA}.ad_insights_daily
     GROUP BY 1
     ORDER BY 1 DESC
     LIMIT $1`,
    [limit]
  );
  return rows.map((row) => row.month);
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
 * Universo da tela: o que ENTREGOU no período (ou trouxe cadastro nele),
 * independente do status de hoje.
 *
 * O status ("Ativas"/"Inativas") é um filtro de listagem, não de contabilidade:
 * dinheiro gasto por um anúncio que foi pausado ontem continua tendo saído do
 * caixa e aparece no gerenciador da Meta. Quando o status recortava os totais,
 * o investimento da tela ficava menor que o da Meta (era essa a divergência de
 * R$ 356,49 em 03/08/2026) — e sumiam junto os cadastros que esses anúncios
 * geraram. Na outra ponta, anúncio sem entrega no período só rendia linha
 * zerada, então fica fora.
 *
 * Versão para a query com CTEs (getAdsHierarchy).
 */
// "Trouxe cadastro" aqui é trouxe GENTE. Um anúncio que não entregou nada no
// período e cuja única marca é um envio descartado ou repetido não vira linha
// na tela — mas se ele entregou, seus descartados e repetidos entram normalmente
// na coluna Envios. Ou seja: quem some é linha vazia, nunca envio de um anúncio
// que a tela já lista.
const DELIVERED_OR_HAS_LEAD = `(
  a.ad_id IN (SELECT ad_id FROM delivered_ads)
  OR a.ad_id IN (
    SELECT ad_id FROM crm_registration_events
    WHERE ad_id IS NOT NULL AND bucket IN ('novo', 'recontato')
  )
)`;

/** Mesma regra do DELIVERED_OR_HAS_LEAD, autocontida, para as consultas que não
 * montam CTEs. Os placeholders são posições internas, nunca entrada do usuário. */
function deliveredOrHasLeadClause(fromPlaceholder: string, toPlaceholder: string): string {
  return `(
    EXISTS (
      SELECT 1 FROM ${SCHEMA}.ad_insights_daily i2
      WHERE i2.ad_id = a.ad_id
        AND i2.date BETWEEN ${fromPlaceholder} AND ${toPlaceholder}
        AND (i2.spend > 0 OR i2.impressions > 0)
    )
    OR a.ad_id IN (
      SELECT ${LEAD_AD_ID}
      FROM inscricoes.inscricoes i
      WHERE ${LEAD_HAS_AD_SIGNAL}
        AND ${leadCountsAsPerson(fromPlaceholder)}
        AND ${leadCreatedInPeriod(fromPlaceholder, toPlaceholder)}
    )
  )`;
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
 * Anúncio de origem de um lead do CRM (alias "i" em inscricoes.inscricoes),
 * resolvido em CASCATA — da prova mais forte para a mais fraca.
 *
 * Leads do formulário nativo (Lead Ads) têm ad_id gravado pela ingestão da
 * Graph API. Leads de LANDING PAGE não têm ad_id — os criativos carimbam
 * utm_campaign={{campaign.name}}, utm_term={{adset.name}} e
 * utm_content={{ad.name}} na URL (ver ads.url_tags), então sobra o NOME.
 *
 * O problema do nome é que ele é do dia do clique, e a Meta deixa renomear
 * tudo depois. Em julho/2026, 23 dos 110 cadastros pagos sumiram da tela assim:
 * 6 porque o conjunto virou "Conjunto 3 - Engajamento IG/FB ADV+" (era
 * "Envolvimento"), 16 porque o anúncio foi renomeado/excluído e 1 porque o
 * criativo carimbou ID em vez de nome. Daí as camadas:
 *
 *   1. atribuição já congelada em lead_ad_attribution (imune a renomeação);
 *   2. ad_id gravado no próprio lead (Lead Ads);
 *   3. utm_content é um ad_id numérico ({{ad.id}} no lugar de {{ad.name}});
 *   4. nome do anúncio + conjunto + campanha (o caso normal);
 *   5. nome do anúncio + campanha — cobre conjunto renomeado.
 *
 * Não existe camada "só pelo nome do anúncio": o mesmo nome de criativo é
 * reusado em campanhas diferentes (VOZUP_AD27_VID_AUTO está hoje em "Falar em
 * público" e trouxe leads em "Vendas"), então cair para ela jogaria o cadastro
 * na campanha errada — pior que não atribuir.
 */
/**
 * Trava temporal do match por NOME: o anúncio candidato precisa ter entregado
 * perto da data do lead.
 *
 * Nome de criativo nesta conta não é identificador — ele é reciclado. O
 * "VOZUP_AD28_VID_AUTO" que existe hoje começou a rodar em 02/08/2026, mas o
 * mesmo nome já tinha sido usado em 2025; sem esta trava, o match por nome
 * levava 27 cadastros (o mais antigo de dezembro/2025) para um anúncio que nem
 * existia na época, enquanto o VOZUP_AD26 real ficava com R$ 452,42, 22 leads
 * da Meta e 1 cadastro. A janela de 7 dias é a mesma que a Meta usa para
 * atribuir clique → conversão.
 */
function deliveredNearLead(adAlias: string): string {
  return `EXISTS (
    SELECT 1 FROM ${SCHEMA}.ad_insights_daily ins
    WHERE ins.ad_id = ${adAlias}.ad_id
      AND (ins.spend > 0 OR ins.impressions > 0)
      AND ins.date BETWEEN ((i.criado_em AT TIME ZONE '${META_ADS_TIME_ZONE}')::date - 7)
                       AND ((i.criado_em AT TIME ZONE '${META_ADS_TIME_ZONE}')::date)
  )`;
}

/** Camada 1 — atribuição já congelada; imune a renomeação posterior. */
const ATTR_FROZEN = `(SELECT la.ad_id FROM ${SCHEMA}.lead_ad_attribution la WHERE la.inscricao_id = i.id)`;
/** Camada 2 — Lead Ads: a própria ingestão da Graph API gravou o ad_id. */
const ATTR_DIRECT = `NULLIF(TRIM(i.payload->>'ad_id'), '')`;
/** Camada 3 — criativo carimbou {{ad.id}} em vez de {{ad.name}}. */
const ATTR_BY_ID = `(SELECT a2.ad_id FROM ${SCHEMA}.ads a2
    WHERE a2.ad_id = NULLIF(TRIM(i.payload->>'utm_content'), '') AND NOT a2.is_placeholder)`;
/** Camada 4 — anúncio + conjunto + campanha pelo nome (o caso normal). */
const ATTR_EXACT = `(SELECT MIN(a2.ad_id)
     FROM ${SCHEMA}.ads a2
     JOIN ${SCHEMA}.adsets s2 ON s2.adset_id = a2.adset_id
     JOIN ${SCHEMA}.campaigns c2 ON c2.campaign_id = a2.campaign_id
    WHERE NOT a2.is_placeholder
      AND NULLIF(TRIM(i.payload->>'utm_content'), '') IS NOT NULL
      AND LOWER(a2.name) = LOWER(TRIM(i.payload->>'utm_content'))
      AND (NULLIF(TRIM(i.payload->>'utm_term'), '') IS NULL OR LOWER(s2.name) = LOWER(TRIM(i.payload->>'utm_term')))
      AND (NULLIF(TRIM(i.payload->>'utm_campaign'), '') IS NULL OR LOWER(c2.name) = LOWER(TRIM(i.payload->>'utm_campaign')))
      AND ${deliveredNearLead("a2")})`;
/** Camada 6 — o nome que o lead gravou é um nome ANTIGO deste anúncio. Só vale
 * dentro da campanha do UTM, porque o mesmo código de criativo é reciclado
 * entre campanhas. Cobre renomeação a partir do momento em que passamos a
 * guardar histórico (ad_name_history). */
const ATTR_HISTORIC_NAME = `(SELECT MIN(h.ad_id)
     FROM ${SCHEMA}.ad_name_history h
     JOIN ${SCHEMA}.ads a2 ON a2.ad_id = h.ad_id
     JOIN ${SCHEMA}.campaigns c2 ON c2.campaign_id = a2.campaign_id
    WHERE NOT a2.is_placeholder
      AND NULLIF(TRIM(i.payload->>'utm_content'), '') IS NOT NULL
      AND NULLIF(TRIM(i.payload->>'utm_campaign'), '') IS NOT NULL
      AND h.name_lower = LOWER(TRIM(i.payload->>'utm_content'))
      AND LOWER(c2.name) = LOWER(TRIM(i.payload->>'utm_campaign'))
      AND ${deliveredNearLead("a2")})`;

/** Camada 5 — anúncio + campanha: salva quando só o CONJUNTO foi renomeado. */
const ATTR_NAME_IN_CAMPAIGN = `(SELECT MIN(a2.ad_id)
     FROM ${SCHEMA}.ads a2
     JOIN ${SCHEMA}.campaigns c2 ON c2.campaign_id = a2.campaign_id
    WHERE NOT a2.is_placeholder
      AND NULLIF(TRIM(i.payload->>'utm_content'), '') IS NOT NULL
      AND NULLIF(TRIM(i.payload->>'utm_campaign'), '') IS NOT NULL
      AND LOWER(a2.name) = LOWER(TRIM(i.payload->>'utm_content'))
      AND LOWER(c2.name) = LOWER(TRIM(i.payload->>'utm_campaign'))
      AND ${deliveredNearLead("a2")})`;

/** Exportado para que a conciliação de matrículas use EXATAMENTE a mesma regra
 * de atribuição lead → anúncio do resto da tela (ver lib/enrollmentOrigin.ts);
 * duplicar essa lógica é como duas telas passarem a discordar. */
export const LEAD_AD_ID = `COALESCE(
  ${ATTR_FROZEN},
  ${ATTR_DIRECT},
  ${ATTR_BY_ID},
  ${ATTR_EXACT},
  ${ATTR_NAME_IN_CAMPAIGN},
  ${ATTR_HISTORIC_NAME}
)`;

// Cadastros de teste/excluídos nunca entram nas métricas. Um satélite de
// mesclagem, porém, continua sendo um envio real do formulário: ele entra em
// cadastrosCrm e fica fora apenas de leadsCrm (leads com card no funil).
const LEAD_NOT_EXCLUDED = `COALESCE(i.payload->>'dashboard_excluido', '') != 'true'`;
const LEAD_VISIBLE = `${LEAD_NOT_EXCLUDED}
  AND COALESCE(i.payload->>'dashboard_merged_into', '') = ''`;

/**
 * As quatro caixas em que TODO envio de formulário atribuído a um anúncio cai,
 * sem sobra e sem sobreposição:
 *
 *     envios = descartados + repetidos + recontatos + novos
 *
 * Existe porque "Cadastros" sozinho escondia dois fenômenos diferentes debaixo
 * do mesmo desconto. A Meta conta ENVIO; o CRM conta PESSOA — e a diferença
 * entre os dois números não é uma só, são três causas com significados opostos
 * para quem compra mídia:
 *
 * - **descartado** — alguém marcou como lixo/teste na mão. Dinheiro perdido.
 * - **repetido** — a mesma pessoa preencheu de novo DENTRO da janela olhada.
 *   Não é contato a mais; é o mesmo contato contado duas vezes pela Meta.
 * - **recontato** — a pessoa JÁ ERA da base (o primário nasceu antes da janela)
 *   e voltou pelo anúncio. É pessoa de verdade que o anúncio trouxe de volta, e
 *   até 2026-08-03 sumia inteira da tela: virava satélite de mesclagem e o
 *   anúncio pagava o clique sem receber crédito nenhum.
 * - **novo** — pessoa inédita no CRM.
 *
 * "Repetido" e "recontato" são o MESMO estado no banco (satélite de mesclagem);
 * o que os separa é a data de nascimento do primário em relação à janela
 * consultada. Por isso a régua é relativa ao filtro de período da tela, e não
 * uma constante de dias — trocar a janela reclassifica, como deve ser.
 */
/** `dashboard_merged_into` guarda o id do primário como texto; nem todo valor
 * histórico é numérico, então a conversão é guardada por regex em vez de cast
 * direto (um `::int` cru derruba a query inteira num único payload torto). */
const LEAD_MERGE_PARENT_ID = `CASE
  WHEN COALESCE(i.payload->>'dashboard_merged_into', '') ~ '^[0-9]+$'
  THEN (i.payload->>'dashboard_merged_into')::int
END`;

/** Satélite cujo primário nasceu ANTES da janela = pessoa que já era da base.
 * Primário desconhecido (apagado ou id não numérico) fica de fora de propósito:
 * na dúvida, o envio é tratado como repetição e não infla o número real. */
function leadIsRecontato(fromPlaceholder: string): string {
  return `EXISTS (
    SELECT 1 FROM inscricoes.inscricoes pai
    WHERE pai.id = ${LEAD_MERGE_PARENT_ID}
      AND pai.criado_em < (${fromPlaceholder}::date::timestamp AT TIME ZONE '${META_ADS_TIME_ZONE}')
  )`;
}

/** Em qual das quatro caixas este envio cai. */
function leadBucketExpr(fromPlaceholder: string): string {
  return `CASE
    WHEN COALESCE(i.payload->>'dashboard_excluido', '') = 'true' THEN 'descartado'
    WHEN COALESCE(i.payload->>'dashboard_merged_into', '') = '' THEN 'novo'
    WHEN ${leadIsRecontato(fromPlaceholder)} THEN 'recontato'
    ELSE 'repetido'
  END`;
}

/**
 * PESSOA que o anúncio trouxe = novo + recontato. É o que a tela mostra em
 * "Cadastros" e o denominador do custo por cadastro.
 *
 * Sucessor de LEAD_VISIBLE para contagem de gente. LEAD_VISIBLE continua certo
 * para tudo que depende de card no funil (leadsCrm, etapas, funil de conversão,
 * vendedores): o recontato não abre card novo, quem carrega a pipeline dele é o
 * primário — que entrou em outro período e já foi contado lá.
 */
function leadCountsAsPerson(fromPlaceholder: string): string {
  return `${LEAD_NOT_EXCLUDED}
    AND (COALESCE(i.payload->>'dashboard_merged_into', '') = '' OR ${leadIsRecontato(fromPlaceholder)})`;
}

// Pré-filtro barato: só roda a resolução por UTM em leads que têm algum sinal
// de anúncio (ad_id direto ou utm_content com o nome do criativo).
const LEAD_HAS_AD_SIGNAL = `(NULLIF(TRIM(i.payload->>'ad_id'), '') IS NOT NULL OR NULLIF(TRIM(i.payload->>'utm_content'), '') IS NOT NULL)`;

/** Anúncio placeholder tem que se anunciar como tal em toda listagem: sem isso
 * ele parece um anúncio real que gastou R$ 0 e mesmo assim trouxe cadastro. */
const PLACEHOLDER_AWARE_AD_NAME = `CASE WHEN a.is_placeholder THEN a.name || ' (não encontrado na Meta)' ELSE a.name END`;

// Quanto tempo para trás a reconciliação olha. Leads mais antigos que isso já
// estão congelados de execuções anteriores.
const ATTRIBUTION_LOOKBACK_DAYS = 365;

/**
 * Conserta e CONGELA a atribuição lead → anúncio. Roda junto do sync, depois da
 * estrutura, em duas etapas:
 *
 * 1. **Nome que não existe mais = anúncio renomeado.** Esta conta recicla os
 *    códigos VOZUP_ADxx, então o nome gravado na UTM pode não bater com nada.
 *    Quando isso acontece, quem responde é a ENTREGA: dentro da campanha (e do
 *    conjunto, quando o utm_term ainda existe), procura-se o anúncio que de
 *    fato entregou lead NAQUELE DIA. Foi assim que se descobriu que o
 *    "VOZUP_AD29_VID_AUTO" dos leads de 27/07 a 01/08 é o anúncio hoje chamado
 *    VOZUP_AD27_VID_AUTO — que aparecia com 9 leads na Meta e 0 cadastros,
 *    enquanto os cadastros iam parar num anúncio fantasma.
 * 2. **Placeholder é último recurso.** Só quando nem a entrega identifica o
 *    anúncio (nenhuma veiculação naquele dia na campanha) é que se cria a linha
 *    "(não encontrado na Meta)", para o cadastro ao menos não sumir da campanha
 *    que o gerou. Ela nunca recebe insight: fica com R$ 0 de gasto.
 * 3. **Congelamento.** Todo lead resolvido tem o vínculo gravado em
 *    lead_ad_attribution, para a próxima renomeação não o desfazer.
 */
export async function reconcileLeadAttribution(): Promise<{ rows: number }> {
  await ensureMetaAdsSchema();
  const pool = getPool();
  const client = await pool.connect();

  const orphanCte = `
    orphans AS (
      SELECT i.id AS inscricao_id,
             TRIM(i.payload->>'utm_content') AS ad_name,
             NULLIF(TRIM(i.payload->>'utm_term'), '') AS adset_name,
             (i.criado_em AT TIME ZONE '${META_ADS_TIME_ZONE}')::date AS dia,
             (SELECT MIN(c.campaign_id) FROM ${SCHEMA}.campaigns c
               WHERE LOWER(c.name) = LOWER(TRIM(i.payload->>'utm_campaign'))) AS campaign_id
      FROM inscricoes.inscricoes i
      WHERE i.criado_em >= NOW() - INTERVAL '${ATTRIBUTION_LOOKBACK_DAYS} days'
        AND NULLIF(TRIM(i.payload->>'utm_content'), '') IS NOT NULL
        AND NULLIF(TRIM(i.payload->>'utm_campaign'), '') IS NOT NULL
        AND ${LEAD_AD_ID} IS NULL
    )`;

  // O anúncio que entregou lead naquele dia, dentro da campanha do UTM. O
  // conjunto entra como filtro quando o utm_term ainda casa com um conjunto
  // existente — se ele também foi renomeado, a busca se abre para a campanha
  // inteira em vez de desistir. Ordem de preferência: quem marcou lead na Meta
  // naquele dia; empatado, quem investiu mais.
  const deliveryMatch = `(
    SELECT ins.ad_id
    FROM ${SCHEMA}.ad_insights_daily ins
    JOIN ${SCHEMA}.ads a ON a.ad_id = ins.ad_id AND NOT a.is_placeholder
    JOIN ${SCHEMA}.adsets s ON s.adset_id = a.adset_id
    WHERE a.campaign_id = o.campaign_id
      AND ins.date = o.dia
      AND (ins.leads_meta > 0 OR ins.spend > 0)
      AND (
        o.adset_name IS NULL
        OR LOWER(s.name) = LOWER(o.adset_name)
        OR NOT EXISTS (
          SELECT 1 FROM ${SCHEMA}.adsets s2
          WHERE s2.campaign_id = o.campaign_id AND LOWER(s2.name) = LOWER(o.adset_name)
        )
      )
    ORDER BY ins.leads_meta DESC, ins.spend DESC
    LIMIT 1
  )`;

  try {
    await client.query("BEGIN");

    // Atribuições feitas para anúncio fantasma são recalculadas a cada rodada:
    // basta a entrega daquele dia estar sincronizada para o lead reencontrar o
    // anúncio de verdade e o fantasma deixar de ser necessário.
    await client.query(`
      DELETE FROM ${SCHEMA}.lead_ad_attribution la
      USING ${SCHEMA}.ads a
      WHERE a.ad_id = la.ad_id AND a.is_placeholder
    `);

    // Atribuição por NOME que não sobrevive à trava temporal é reciclagem de
    // nome, não acerto: o anúncio não estava no ar quando o lead chegou. Apaga
    // para o lead voltar à cascata e cair na regra de entrega.
    await client.query(`
      DELETE FROM ${SCHEMA}.lead_ad_attribution la
      USING inscricoes.inscricoes i, ${SCHEMA}.ads a2
      WHERE la.inscricao_id = i.id
        AND a2.ad_id = la.ad_id
        AND la.method IN ('utm_exato', 'utm_conjunto_renomeado', 'nome_antigo_do_anuncio')
        AND NOT ${deliveredNearLead("a2")}
    `);

    // Renomeação identificada pela entrega — antes de cogitar placeholder.
    const { rowCount: byDelivery } = await client.query(`
      WITH ${orphanCte}
      INSERT INTO ${SCHEMA}.lead_ad_attribution (inscricao_id, ad_id, method)
      SELECT o.inscricao_id, ${deliveryMatch}, 'entrega_no_dia'
      FROM orphans o
      WHERE o.campaign_id IS NOT NULL AND ${deliveryMatch} IS NOT NULL
      ON CONFLICT (inscricao_id) DO NOTHING
    `);

    // Conjunto placeholder só quando o conjunto do UTM também não existe mais.
    await client.query(`
      WITH ${orphanCte}
      INSERT INTO ${SCHEMA}.adsets (adset_id, campaign_id, ad_account_id, name, status, effective_status, is_placeholder)
      SELECT DISTINCT 'orphan:' || o.campaign_id, o.campaign_id, c.ad_account_id,
             'Conjunto não encontrado na Meta', 'REMOVED', 'REMOVED', true
      FROM orphans o
      JOIN ${SCHEMA}.campaigns c ON c.campaign_id = o.campaign_id
      WHERE o.campaign_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM ${SCHEMA}.adsets s
          WHERE s.campaign_id = o.campaign_id AND o.adset_name IS NOT NULL
            AND LOWER(s.name) = LOWER(o.adset_name)
        )
      ON CONFLICT (adset_id) DO NOTHING
    `);

    const { rowCount: ads } = await client.query(`
      WITH ${orphanCte}
      INSERT INTO ${SCHEMA}.ads (ad_id, adset_id, campaign_id, ad_account_id, name, status, effective_status, is_placeholder)
      SELECT DISTINCT ON (o.campaign_id, LOWER(o.ad_name))
             'orphan:' || o.campaign_id || ':' || LOWER(o.ad_name),
             COALESCE(
               (SELECT MIN(s.adset_id) FROM ${SCHEMA}.adsets s
                 WHERE s.campaign_id = o.campaign_id AND o.adset_name IS NOT NULL
                   AND LOWER(s.name) = LOWER(o.adset_name)),
               'orphan:' || o.campaign_id
             ),
             o.campaign_id, c.ad_account_id, o.ad_name, 'REMOVED', 'REMOVED', true
      FROM orphans o
      JOIN ${SCHEMA}.campaigns c ON c.campaign_id = o.campaign_id
      WHERE o.campaign_id IS NOT NULL
      ON CONFLICT (ad_id) DO NOTHING
    `);

    // Congela tudo que resolve agora — inclusive pelos placeholders recém-criados.
    const { rowCount: frozen } = await client.query(`
      INSERT INTO ${SCHEMA}.lead_ad_attribution (inscricao_id, ad_id, method)
      SELECT i.id, ${LEAD_AD_ID},
             CASE
               WHEN ${ATTR_DIRECT} IS NOT NULL THEN 'lead_ads'
               WHEN ${ATTR_BY_ID} IS NOT NULL THEN 'utm_id'
               WHEN ${ATTR_EXACT} IS NOT NULL THEN 'utm_exato'
               WHEN ${ATTR_NAME_IN_CAMPAIGN} IS NOT NULL THEN 'utm_conjunto_renomeado'
               WHEN ${ATTR_HISTORIC_NAME} IS NOT NULL THEN 'nome_antigo_do_anuncio'
               ELSE 'utm_anuncio_ausente'
             END
      FROM inscricoes.inscricoes i
      WHERE i.criado_em >= NOW() - INTERVAL '${ATTRIBUTION_LOOKBACK_DAYS} days'
        AND ${LEAD_HAS_AD_SIGNAL}
        AND NOT EXISTS (SELECT 1 FROM ${SCHEMA}.lead_ad_attribution la WHERE la.inscricao_id = i.id)
        -- Lead Ads pode ter gravado o ad_id de um anúncio que a estrutura não
        -- conhece (excluído de vez, ou de outra conta): congelar isso quebraria
        -- a FK e, pior, apontaria para um anúncio que a tela não sabe exibir.
        AND ${LEAD_AD_ID} IN (SELECT a3.ad_id FROM ${SCHEMA}.ads a3)
      ON CONFLICT (inscricao_id) DO NOTHING
    `);

    // Fantasma que ficou sem nenhum lead perde a razão de existir.
    await client.query(`
      DELETE FROM ${SCHEMA}.ads a
      WHERE a.is_placeholder
        AND NOT EXISTS (SELECT 1 FROM ${SCHEMA}.lead_ad_attribution la WHERE la.ad_id = a.ad_id)
    `);
    await client.query(`
      DELETE FROM ${SCHEMA}.adsets s
      WHERE s.is_placeholder
        AND NOT EXISTS (SELECT 1 FROM ${SCHEMA}.ads a WHERE a.adset_id = s.adset_id)
    `);

    await client.query("COMMIT");
    return { rows: (byDelivery ?? 0) + (ads ?? 0) + (frozen ?? 0) };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

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
  envios: string | null;
  descartados: string | null;
  repetidos: string | null;
  recontatos: string | null;
  novos: string | null;
  ctr: string | null;
  cpc: string | null;
  cpm: string | null;
  frequency: string | null;
  leads_crm: string | null;
  stage_counts: Record<string, string> | null;
  valor_fechado: string | null;
  cpl_real: string | null;
  campaign_objective: string | null;
  action_totals: Record<string, string> | null;
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
    ...engagementFromActionTotals(row.action_totals),
    adId: row.ad_id,
    adName: row.ad_name,
    campaignObjective: row.campaign_objective,
    campaignPurpose: classifyCampaignPurpose(row.campaign_objective),
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
    envios: toNumber(row.envios),
    descartados: toNumber(row.descartados),
    repetidos: toNumber(row.repetidos),
    recontatos: toNumber(row.recontatos),
    novos: toNumber(row.novos),
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
  const values: unknown[] = [...scope.values, filters.from, filters.to];
  const campaignClause = campaignId ? `AND a.campaign_id = $${values.length + 1}` : "";
  if (campaignId) values.push(campaignId);

  const { rows } = await pool.query<{ ad_id: string }>(
    `SELECT a.ad_id FROM ${SCHEMA}.ads a
     JOIN ${SCHEMA}.adsets s ON s.adset_id = a.adset_id
     JOIN ${SCHEMA}.campaigns c ON c.campaign_id = a.campaign_id
     WHERE ${scope.where}
       AND ${deliveredOrHasLeadClause("$3", "$4")}
       ${campaignClause}`,
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
    WITH delivered_ads AS (
      SELECT DISTINCT ad_id
      FROM ${SCHEMA}.ad_insights_daily
      WHERE date BETWEEN $3 AND $4 AND (spend > 0 OR impressions > 0)
    ),
    -- Um registro por ENVIO de formulário atribuído a anúncio, já etiquetado
    -- com a caixa em que cai (ver leadBucketExpr). É a única passada pelo CRM:
    -- daqui saem tanto o número que fala a língua da Meta (envios) quanto o
    -- número de gente de verdade (novos + recontatos). Não depende de haver
    -- linha em commercial_leads: pessoa que chegou é pessoa que chegou, mesmo
    -- antes de entrar em algum funil.
    crm_registration_events AS (
      SELECT ${LEAD_AD_ID} AS ad_id, ${leadBucketExpr("$3")} AS bucket
      FROM inscricoes.inscricoes i
      WHERE ${LEAD_HAS_AD_SIGNAL}
        AND ${leadCreatedInPeriod("$3", "$4")}
    ),
    scoped_ads AS (
      SELECT a.ad_id, ${PLACEHOLDER_AWARE_AD_NAME} AS ad_name, a.status, a.effective_status, a.thumbnail_url, a.image_url, a.video_id, a.landing_url,
             a.adset_id, s.name AS adset_name, s.status AS adset_status,
             a.campaign_id, c.name AS campaign_name, c.status AS campaign_status, c.objective AS campaign_objective
      FROM ${SCHEMA}.ads a
      JOIN ${SCHEMA}.adsets s ON s.adset_id = a.adset_id
      JOIN ${SCHEMA}.campaigns c ON c.campaign_id = a.campaign_id
      WHERE ${scope.where}
        AND ${DELIVERED_OR_HAS_LEAD}
    ),
    -- Entrega e interação já vinham no sync dentro de actions_raw; aqui elas
    -- viram colunas somadas do período, só para os tipos que a tela usa.
    ad_actions AS (
      SELECT t.ad_id, jsonb_object_agg(t.action_type, t.total) AS action_totals
      FROM (
        SELECT i2.ad_id, act->>'action_type' AS action_type, SUM((act->>'value')::numeric) AS total
        FROM ${SCHEMA}.ad_insights_daily i2,
             LATERAL jsonb_array_elements(COALESCE(i2.actions_raw, '[]'::jsonb)) act
        WHERE i2.date BETWEEN $3 AND $4
          AND act->>'action_type' = ANY($6::text[])
        GROUP BY 1, 2
      ) t
      GROUP BY t.ad_id
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
    crm_registrations AS (
      SELECT ad_id,
             COUNT(*) AS envios,
             COUNT(*) FILTER (WHERE bucket = 'descartado') AS descartados,
             COUNT(*) FILTER (WHERE bucket = 'repetido') AS repetidos,
             COUNT(*) FILTER (WHERE bucket = 'recontato') AS recontatos,
             COUNT(*) FILTER (WHERE bucket = 'novo') AS novos,
             COUNT(*) FILTER (WHERE bucket IN ('novo', 'recontato')) AS cadastros_crm
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
           cr.cadastros_crm, cr.envios, cr.descartados, cr.repetidos, cr.recontatos, cr.novos,
           cl.leads_crm, cl.stage_counts, cv.valor_fechado, aa.action_totals,
           CASE WHEN cl.leads_crm > 0 THEN am.spend / cl.leads_crm END AS cpl_real
    FROM scoped_ads sa
    LEFT JOIN ad_metrics am ON am.ad_id = sa.ad_id
    LEFT JOIN ad_actions aa ON aa.ad_id = sa.ad_id
    LEFT JOIN crm_registrations cr ON cr.ad_id = sa.ad_id
    LEFT JOIN crm_leads cl ON cl.ad_id = sa.ad_id
    LEFT JOIN crm_value cv ON cv.ad_id = sa.ad_id
    ORDER BY sa.campaign_name, sa.adset_name, am.spend DESC NULLS LAST
    `,
    [...scope.values, filters.from, filters.to, vozupFunnel.id, TRACKED_ACTION_TYPES]
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
    bucket: LeadBucket;
  }>(
    `SELECT i.id, i.payload->>'nome' AS nome, i.payload->>'telefone' AS telefone, i.payload->>'email' AS email,
            i.criado_em, fs.label AS stage_label, cl.commercial_stage_kind AS stage_kind,
            ${leadBucketExpr("$2")} AS bucket
     FROM inscricoes.inscricoes i
     LEFT JOIN dashboard.commercial_leads cl
       ON cl.inscricao_id = CASE
         WHEN i.payload->>'dashboard_merged_into' ~ '^\\d+$'
           THEN (i.payload->>'dashboard_merged_into')::int
         ELSE i.id
       END
       -- O funil é condição do LEFT JOIN, nunca filtro de linha: quem entrou
       -- em "Cadastros" tem que aparecer nesta lista, inclusive o recontato
       -- cujo primário vive em outro funil (ou em nenhum). Com a condição no
       -- WHERE, a lista mostrava 19 onde o card contava 20 — e o número da
       -- tela virava palavra contra palavra.
       AND cl.funnel_id = $4
     LEFT JOIN dashboard.funnel_stages fs ON fs.funnel_id = cl.funnel_id AND fs.key = cl.commercial_stage
     WHERE ${LEAD_HAS_AD_SIGNAL}
       AND ${LEAD_NOT_EXCLUDED}
       AND ${LEAD_AD_ID} = ANY($1::text[])
       AND ${leadCreatedInPeriod("$2", "$3")}
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
    bucket: row.bucket,
    isReturning: row.bucket !== "novo",
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
    bucket: LeadBucket;
    campaign_name: string;
    adset_name: string;
    ad_name: string;
    thumbnail_url: string | null;
    image_url: string | null;
    video_id: string | null;
    seller_name: string | null;
  }>(
    `WITH lead_ad AS (
       SELECT i.id, i.criado_em,
              i.payload->>'nome' AS nome,
              i.payload->>'telefone' AS telefone,
              i.payload->>'email' AS email,
              ${leadBucketExpr("$1")} AS bucket,
              ${LEAD_COMMERCIAL_JOIN_ID} AS commercial_id,
              ${LEAD_AD_ID} AS ad_id
       FROM inscricoes.inscricoes i
       WHERE ${LEAD_HAS_AD_SIGNAL}
         AND ${LEAD_NOT_EXCLUDED}
         AND ${leadCreatedInPeriod("$1", "$2")}
     )
     SELECT la.id, la.nome, la.telefone, la.email, la.criado_em, la.bucket,
            c.name AS campaign_name, s.name AS adset_name, a.name AS ad_name,
            a.thumbnail_url, a.image_url, a.video_id,
            fs.label AS stage_label, cl.commercial_stage_kind AS stage_kind,
            cl.assigned_seller_name AS seller_name
     FROM lead_ad la
     JOIN ${SCHEMA}.ads a ON a.ad_id = la.ad_id
     JOIN ${SCHEMA}.adsets s ON s.adset_id = a.adset_id
     JOIN ${SCHEMA}.campaigns c ON c.campaign_id = a.campaign_id
     LEFT JOIN dashboard.commercial_leads cl ON cl.inscricao_id = la.commercial_id AND cl.funnel_id = $3
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
    bucket: row.bucket,
    isReturning: row.bucket !== "novo",
    campaignName: row.campaign_name,
    adsetName: row.adset_name,
    adName: row.ad_name,
    thumbnailUrl: row.thumbnail_url,
    imageUrl: row.image_url,
    videoId: row.video_id,
    sellerName: row.seller_name,
  }));
}

/**
 * Todos os leads de anúncio do período, um por pessoa, com hora de chegada e
 * desfecho — base das abas "Horários" e da análise de leads dentro de "Grupos".
 *
 * Duas escolhas importantes:
 * - **Hora/dia da semana vêm do Postgres já convertidos** para o fuso da conta
 *   Meta (America/Sao_Paulo). Fazer isso no navegador usaria o fuso da máquina
 *   de quem abre a tela, e o mesmo lead cairia em horas diferentes para pessoas
 *   diferentes — inaceitável numa análise cujo eixo É a hora.
 * - **Etapas alcançadas vêm do histórico** (commercial_events), não só da etapa
 *   atual: quem agendou e depois fechou ou foi perdido continua contando como
 *   "agendou" (mesma regra do funil da Visão Geral, ver getFunnelBreakdown).
 *
 * O recorte de leads é o mesmo do resto da tela (`cl.funnel_id` do funil padrão
 * + LEAD_NOT_EXCLUDED), então "cadastros" aqui bate com a coluna Cadastros das
 * outras abas.
 */
export async function getAdLeadDetails(
  filters: Pick<MetaAdsFilters, "from" | "to">,
  scopedAdIds?: string[]
): Promise<AdLeadDetail[]> {
  await ensureMetaAdsSchema();
  const pool = getPool();
  const vozupFunnel = await getDefaultFunnel();
  const values: unknown[] = [filters.from, filters.to, vozupFunnel.id];
  let scopeClause = "";
  if (scopedAdIds) {
    if (scopedAdIds.length === 0) return [];
    values.push(scopedAdIds);
    scopeClause = `AND la.ad_id = ANY($${values.length}::text[])`;
  }

  const { rows } = await pool.query<{
    id: number;
    nome: string | null;
    telefone: string | null;
    email: string | null;
    criado_em: string;
    hora: number;
    dia_semana: number;
    dia: string;
    ad_id: string;
    ad_name: string;
    adset_name: string;
    campaign_name: string;
    landing_url: string | null;
    thumbnail_url: string | null;
    image_url: string | null;
    video_id: string | null;
    stage_key: string | null;
    stage_label: string | null;
    stage_kind: string | null;
    seller_name: string | null;
    bucket: LeadBucket;
    reached_stages: string[] | null;
  }>(
    `WITH lead_ad AS (
       SELECT i.id, i.criado_em,
              i.payload->>'nome' AS nome,
              i.payload->>'telefone' AS telefone,
              i.payload->>'email' AS email,
              ${leadBucketExpr("$1")} AS bucket,
              ${LEAD_COMMERCIAL_JOIN_ID} AS commercial_id,
              ${LEAD_AD_ID} AS ad_id
       FROM inscricoes.inscricoes i
       WHERE ${LEAD_HAS_AD_SIGNAL}
         AND ${LEAD_NOT_EXCLUDED}
         AND ${leadCreatedInPeriod("$1", "$2")}
     )
     SELECT la.id, la.nome, la.telefone, la.email, la.criado_em, la.bucket,
            EXTRACT(HOUR FROM (la.criado_em AT TIME ZONE '${META_ADS_TIME_ZONE}'))::int AS hora,
            EXTRACT(DOW FROM (la.criado_em AT TIME ZONE '${META_ADS_TIME_ZONE}'))::int AS dia_semana,
            TO_CHAR(la.criado_em AT TIME ZONE '${META_ADS_TIME_ZONE}', 'YYYY-MM-DD') AS dia,
            a.ad_id, a.name AS ad_name, a.landing_url, a.thumbnail_url, a.image_url, a.video_id,
            s.name AS adset_name, c.name AS campaign_name,
            cl.commercial_stage AS stage_key, fs.label AS stage_label,
            cl.commercial_stage_kind AS stage_kind, cl.assigned_seller_name AS seller_name,
            ev.reached_stages
     FROM lead_ad la
     JOIN ${SCHEMA}.ads a ON a.ad_id = la.ad_id
     JOIN ${SCHEMA}.adsets s ON s.adset_id = a.adset_id
     JOIN ${SCHEMA}.campaigns c ON c.campaign_id = a.campaign_id
     LEFT JOIN dashboard.commercial_leads cl ON cl.inscricao_id = la.commercial_id AND cl.funnel_id = $3
     LEFT JOIN dashboard.funnel_stages fs ON fs.funnel_id = cl.funnel_id AND fs.key = cl.commercial_stage
     LEFT JOIN LATERAL (
       SELECT ARRAY_AGG(DISTINCT e.to_stage) AS reached_stages
       FROM dashboard.commercial_events e
       WHERE e.inscricao_id = la.commercial_id
         AND e.event_type = 'stage_changed'
         AND e.to_stage IS NOT NULL
     ) ev ON TRUE
     WHERE la.ad_id IS NOT NULL ${scopeClause}
     ORDER BY la.criado_em DESC`,
    values
  );

  return rows.map((row) => {
    const etapas = new Set(row.reached_stages ?? []);
    if (row.stage_key) etapas.add(row.stage_key);
    return {
      id: row.id,
      nome: row.nome,
      telefone: row.telefone,
      email: row.email,
      criadoEm: row.criado_em,
      hora: row.hora,
      diaSemana: row.dia_semana,
      dia: row.dia,
      adId: row.ad_id,
      adName: row.ad_name,
      adsetName: row.adset_name,
      campaignName: row.campaign_name,
      landingUrl: row.landing_url,
      thumbnailUrl: row.thumbnail_url,
      imageUrl: row.image_url,
      videoId: row.video_id,
      stageKey: row.stage_key,
      stageLabel: row.stage_label,
      stageKind: (row.stage_kind as FunnelStageKind | null) ?? null,
      sellerName: row.seller_name,
      bucket: row.bucket,
      isReturning: row.bucket !== "novo",
      etapasAlcancadas: Array.from(etapas),
    };
  });
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
    ...emptyEngagement(),
    spend: 0,
    impressions: 0,
    reach: 0,
    clicks: 0,
    leadsMeta: 0,
    cadastrosCrm: 0,
    envios: 0,
    descartados: 0,
    repetidos: 0,
    recontatos: 0,
    novos: 0,
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
  target.envios += row.envios;
  target.descartados += row.descartados;
  target.repetidos += row.repetidos;
  target.recontatos += row.recontatos;
  target.novos += row.novos;
  target.leadsCrm += row.leadsCrm;
  target.leadsQualificados += row.leadsQualificados;
  target.leadsFechados += row.leadsFechados;
  target.valorFechado += row.valorFechado;
  addEngagement(target, row);
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
        objective: row.campaignObjective,
        purpose: row.campaignPurpose,
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
    cpc: costPer(totals.spend, totals.clicks),
    cpm: totals.impressions > 0 ? (totals.spend / totals.impressions) * 1000 : null,
    custoPorCadastro: costPer(totals.spend, totals.cadastrosCrm),
    cplReal: costPer(totals.spend, totals.leadsCrm),
    cacReal: costPer(totals.spend, totals.leadsFechados),
  };
}

export async function getKpiTotals(filters: MetaAdsFilters): Promise<KpiTotals> {
  const adRows = await getAdsHierarchy(filters);
  return computeKpiTotals(adRows);
}

/**
 * Uma linha por (dia × anúncio) no período — base da análise diária. Mídia vem
 * de ad_insights_daily; cadastros/contatos vêm do CRM pela DATA DE CRIAÇÃO do
 * lead no fuso da conta, com a mesma atribuição das outras telas (LEAD_AD_ID).
 * O FULL JOIN mantém o dia em que um anúncio já pausado ainda recebeu cadastro
 * (gasto 0, cadastro > 0) e o dia em que gastou sem cadastrar — os dois casos
 * são exatamente o que o gestor procura numa leitura dia a dia. Linhas
 * totalmente vazias (sem gasto, exibição ou cadastro) ficam fora.
 */
export async function getDailyAdRows(filters: MetaAdsFilters, scopedAdIds?: string[]): Promise<DailyAdRow[]> {
  await ensureMetaAdsSchema();
  const pool = getPool();
  const vozupFunnel = await getDefaultFunnel();
  const adIds = scopedAdIds ?? (await getAdIdsForScope(filters));
  if (adIds.length === 0) return [];

  const { rows } = await pool.query<{
    date: string;
    ad_id: string;
    ad_name: string;
    adset_name: string;
    campaign_name: string;
    landing_url: string | null;
    thumbnail_url: string | null;
    image_url: string | null;
    video_id: string | null;
    spend: string | null;
    impressions: string | null;
    clicks: string | null;
    leads_meta: string | null;
    cadastros_crm: string | null;
    novos: string | null;
    envios: string | null;
    leads_crm: string | null;
  }>(
    `
    WITH media AS (
      SELECT ad_id, date::text AS date,
             SUM(spend) AS spend, SUM(impressions) AS impressions,
             SUM(clicks) AS clicks, SUM(leads_meta) AS leads_meta
      FROM ${SCHEMA}.ad_insights_daily
      WHERE ad_id = ANY($1) AND date BETWEEN $2 AND $3
      GROUP BY 1, 2
    ),
    crm_events AS (
      -- LEAD_AD_ID é uma subconsulta correlacionada: resolvida uma vez aqui e
      -- filtrada no nível de fora, para não rodar duas vezes por lead.
      SELECT (i.criado_em AT TIME ZONE '${META_ADS_TIME_ZONE}')::date::text AS date,
             ${LEAD_AD_ID} AS ad_id,
             ${leadBucketExpr("$2")} AS bucket,
             EXISTS (
                 SELECT 1 FROM dashboard.commercial_leads cl
                 WHERE cl.inscricao_id = i.id AND cl.funnel_id = $4
               ) AS is_new_contact
      FROM inscricoes.inscricoes i
      WHERE ${LEAD_HAS_AD_SIGNAL}
        AND ${leadCreatedInPeriod("$2", "$3")}
    ),
    crm AS (
      SELECT date, ad_id,
             COUNT(*) FILTER (WHERE bucket IN ('novo', 'recontato')) AS cadastros_crm,
             COUNT(*) FILTER (WHERE bucket = 'novo') AS novos,
             COUNT(*) AS envios,
             COUNT(*) FILTER (WHERE is_new_contact AND bucket IN ('novo', 'recontato')) AS leads_crm
      FROM crm_events
      WHERE ad_id = ANY($1)
      GROUP BY 1, 2
    )
    SELECT COALESCE(m.date, c.date) AS date,
           COALESCE(m.ad_id, c.ad_id) AS ad_id,
           a.name AS ad_name, s.name AS adset_name, ca.name AS campaign_name, a.landing_url,
           a.thumbnail_url, a.image_url, a.video_id,
           m.spend, m.impressions, m.clicks, m.leads_meta,
           c.cadastros_crm, c.novos, c.envios, c.leads_crm
    FROM media m
    FULL JOIN crm c ON c.ad_id = m.ad_id AND c.date = m.date
    JOIN ${SCHEMA}.ads a ON a.ad_id = COALESCE(m.ad_id, c.ad_id)
    JOIN ${SCHEMA}.adsets s ON s.adset_id = a.adset_id
    JOIN ${SCHEMA}.campaigns ca ON ca.campaign_id = a.campaign_id
    WHERE COALESCE(m.spend, 0) > 0
       OR COALESCE(m.impressions, 0) > 0
       OR COALESCE(c.cadastros_crm, 0) > 0
    ORDER BY 1 DESC, m.spend DESC NULLS LAST
    `,
    [adIds, filters.from, filters.to, vozupFunnel.id]
  );

  return rows.map((row) => ({
    date: row.date,
    adId: row.ad_id,
    adName: row.ad_name,
    adsetName: row.adset_name,
    campaignName: row.campaign_name,
    landingUrl: row.landing_url,
    thumbnailUrl: row.thumbnail_url,
    imageUrl: row.image_url,
    videoId: row.video_id,
    spend: toNumber(row.spend),
    impressions: toNumber(row.impressions),
    clicks: toNumber(row.clicks),
    leadsMeta: toNumber(row.leads_meta),
    cadastrosCrm: toNumber(row.cadastros_crm),
    novos: toNumber(row.novos),
    envios: toNumber(row.envios),
    leadsCrm: toNumber(row.leads_crm),
  }));
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

  const { rows: mediaRows } = await pool.query<{
    date: string;
    spend: string;
    leads_meta: string;
    impressions: string;
    reach: string;
    video_views: string;
  }>(
    `SELECT date::text, SUM(spend) AS spend, SUM(leads_meta) AS leads_meta,
            SUM(impressions) AS impressions, SUM(reach) AS reach,
            COALESCE(SUM((
              SELECT SUM((act->>'value')::numeric)
              FROM jsonb_array_elements(COALESCE(actions_raw, '[]'::jsonb)) act
              WHERE act->>'action_type' = 'video_view'
            )), 0) AS video_views
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

  const { rows: registrationRows } = await pool.query<{
    date: string;
    cadastros_crm: string;
    novos: string;
  }>(
    `SELECT (i.criado_em AT TIME ZONE '${META_ADS_TIME_ZONE}')::date::text AS date,
            COUNT(*) AS cadastros_crm,
            COUNT(*) FILTER (WHERE COALESCE(i.payload->>'dashboard_merged_into', '') = '') AS novos
     FROM inscricoes.inscricoes i
     WHERE ${LEAD_HAS_AD_SIGNAL}
       AND ${leadCountsAsPerson("$2")}
       AND ${LEAD_AD_ID} = ANY($1)
       AND ${leadCreatedInPeriod("$2", "$3")}
     GROUP BY 1 ORDER BY 1`,
    [adIds, filters.from, filters.to]
  );

  const emptyPoint = (date: string): DailySeriesPoint => ({
    date,
    spend: 0,
    leadsMeta: 0,
    cadastrosCrm: 0,
    novos: 0,
    leadsCrm: 0,
    impressions: 0,
    reach: 0,
    videoViews: 0,
  });

  const byDate = new Map<string, DailySeriesPoint>();
  for (const row of mediaRows) {
    byDate.set(row.date, {
      ...emptyPoint(row.date),
      spend: toNumber(row.spend),
      leadsMeta: toNumber(row.leads_meta),
      impressions: toNumber(row.impressions),
      reach: toNumber(row.reach),
      videoViews: toNumber(row.video_views),
    });
  }
  for (const row of registrationRows) {
    const existing = byDate.get(row.date) ?? emptyPoint(row.date);
    existing.cadastrosCrm = toNumber(row.cadastros_crm);
    existing.novos = toNumber(row.novos);
    byDate.set(row.date, existing);
  }
  for (const row of crmRows) {
    const existing = byDate.get(row.date) ?? emptyPoint(row.date);
    existing.leadsCrm = toNumber(row.leads_crm);
    byDate.set(row.date, existing);
  }

  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}
