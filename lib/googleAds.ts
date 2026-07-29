import { getPool } from "@/lib/db";
import type { SyncRunSummary } from "@/types/metaAds";

const SCHEMA = "google_ads";
const ADVISORY_LOCK_KEY = 982341;
const SCHEMA_ADVISORY_LOCK_KEY = 982342;
const GOOGLE_ADS_TIME_ZONE = "America/Sao_Paulo";

let schemaEnsured = false;
let schemaEnsurePromise: Promise<void> | null = null;

function compactCustomerId(value: string): string {
  return value.replace(/\D/g, "");
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} não configurado`);
  return value;
}

function getApiVersion(): string {
  return process.env.GOOGLE_ADS_API_VERSION?.trim() || "v24";
}

function getCustomerId(): string {
  const customerId = compactCustomerId(requireEnv("GOOGLE_ADS_CUSTOMER_ID"));
  if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID inválido");
  return customerId;
}

export function hasGoogleAdsConfig(): boolean {
  return Boolean(
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim() &&
      process.env.GOOGLE_ADS_CLIENT_ID?.trim() &&
      process.env.GOOGLE_ADS_CLIENT_SECRET?.trim() &&
      process.env.GOOGLE_ADS_REFRESH_TOKEN?.trim() &&
      process.env.GOOGLE_ADS_CUSTOMER_ID?.trim()
  );
}

async function ensureGoogleAdsSchemaOnce(): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [SCHEMA_ADVISORY_LOCK_KEY]);
    await client.query(`
      CREATE SCHEMA IF NOT EXISTS ${SCHEMA};

      CREATE TABLE IF NOT EXISTS ${SCHEMA}.campaigns (
        campaign_id       TEXT PRIMARY KEY,
        customer_id       TEXT NOT NULL,
        name              TEXT NOT NULL,
        status            TEXT,
        advertising_channel_type TEXT,
        first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_synced_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS ${SCHEMA}.ad_groups (
        ad_group_id       TEXT PRIMARY KEY,
        campaign_id       TEXT NOT NULL REFERENCES ${SCHEMA}.campaigns(campaign_id) ON DELETE CASCADE,
        customer_id       TEXT NOT NULL,
        name              TEXT NOT NULL,
        status            TEXT,
        type              TEXT,
        first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_synced_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_google_ad_groups_campaign ON ${SCHEMA}.ad_groups(campaign_id);

      CREATE TABLE IF NOT EXISTS ${SCHEMA}.ads (
        ad_id             TEXT PRIMARY KEY,
        ad_group_id       TEXT NOT NULL REFERENCES ${SCHEMA}.ad_groups(ad_group_id) ON DELETE CASCADE,
        campaign_id       TEXT NOT NULL REFERENCES ${SCHEMA}.campaigns(campaign_id) ON DELETE CASCADE,
        customer_id       TEXT NOT NULL,
        name              TEXT,
        status            TEXT,
        final_urls        JSONB,
        tracking_url_template TEXT,
        first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_synced_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_google_ads_ad_group ON ${SCHEMA}.ads(ad_group_id);
      CREATE INDEX IF NOT EXISTS idx_google_ads_campaign ON ${SCHEMA}.ads(campaign_id);

      CREATE TABLE IF NOT EXISTS ${SCHEMA}.ad_insights_daily (
        ad_id             TEXT NOT NULL REFERENCES ${SCHEMA}.ads(ad_id) ON DELETE CASCADE,
        date              DATE NOT NULL,
        impressions       BIGINT NOT NULL DEFAULT 0,
        clicks            BIGINT NOT NULL DEFAULT 0,
        cost_micros       BIGINT NOT NULL DEFAULT 0,
        conversions       NUMERIC NOT NULL DEFAULT 0,
        conversion_value  NUMERIC NOT NULL DEFAULT 0,
        synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (ad_id, date)
      );
      CREATE INDEX IF NOT EXISTS idx_google_insights_date ON ${SCHEMA}.ad_insights_daily(date);

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
      CREATE INDEX IF NOT EXISTS idx_google_sync_runs_type_started ON ${SCHEMA}.sync_runs(sync_type, started_at DESC);

      CREATE TABLE IF NOT EXISTS ${SCHEMA}.sync_state (
        key    TEXT PRIMARY KEY,
        value  TEXT
      );
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

export async function ensureGoogleAdsSchema(): Promise<void> {
  if (schemaEnsured) return;
  if (!schemaEnsurePromise) {
    schemaEnsurePromise = ensureGoogleAdsSchemaOnce().catch((error) => {
      schemaEnsurePromise = null;
      throw error;
    });
  }
  await schemaEnsurePromise;
}

async function getAccessToken(): Promise<string> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requireEnv("GOOGLE_ADS_CLIENT_ID"),
      client_secret: requireEnv("GOOGLE_ADS_CLIENT_SECRET"),
      refresh_token: requireEnv("GOOGLE_ADS_REFRESH_TOKEN"),
      grant_type: "refresh_token",
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`OAuth Google Ads ${response.status}: ${body.slice(0, 300)}`);
  }
  const parsed = JSON.parse(body) as { access_token?: string };
  if (!parsed.access_token) throw new Error("OAuth Google Ads não retornou access_token");
  return parsed.access_token;
}

function cleanGoogleAdsError(status: number, body: string): Error {
  const lower = body.toLowerCase();
  if (lower.includes("developer_token_not_approved") || lower.includes("test account")) {
    return new Error(
      "Google Ads API bloqueada: o Developer Token ainda parece estar em Acesso à conta de teste. Solicite Acesso Básico no API Center para ler contas de produção."
    );
  }
  if (lower.includes("customer_not_enabled") || lower.includes("permission_denied")) {
    return new Error(
      "Google Ads API sem permissão para esta conta. Confira GOOGLE_ADS_CUSTOMER_ID, GOOGLE_ADS_LOGIN_CUSTOMER_ID e se o usuário OAuth tem acesso ao Google Ads."
    );
  }
  return new Error(`Google Ads API ${status}: ${body.slice(0, 500)}`);
}

async function searchGoogleAds(query: string): Promise<GoogleAdsResult[]> {
  const customerId = getCustomerId();
  const accessToken = await getAccessToken();
  const url = `https://googleads.googleapis.com/${getApiVersion()}/customers/${customerId}/googleAds:searchStream`;
  const headers: Record<string, string> = {
    authorization: `Bearer ${accessToken}`,
    "developer-token": requireEnv("GOOGLE_ADS_DEVELOPER_TOKEN"),
    "content-type": "application/json",
  };
  const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.trim();
  if (loginCustomerId) headers["login-customer-id"] = compactCustomerId(loginCustomerId);

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ query }),
    cache: "no-store",
  });
  const body = await response.text();

  if (!response.ok) throw cleanGoogleAdsError(response.status, body);

  const batches = JSON.parse(body) as Array<{ results?: GoogleAdsResult[] }>;
  return batches.flatMap((batch) => batch.results ?? []);
}

interface GoogleAdsResult {
  campaign?: {
    id?: string;
    name?: string;
    status?: string;
    advertisingChannelType?: string;
  };
  adGroup?: {
    id?: string;
    name?: string;
    status?: string;
    type?: string;
  };
  adGroupAd?: {
    status?: string;
    ad?: {
      id?: string;
      name?: string;
      finalUrls?: string[];
      trackingUrlTemplate?: string;
    };
  };
  metrics?: {
    impressions?: string;
    clicks?: string;
    costMicros?: string;
    conversions?: number | string;
    conversionsValue?: number | string;
  };
  segments?: {
    date?: string;
  };
}

async function setSyncState(key: string, value: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO ${SCHEMA}.sync_state (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value]
  );
}

async function getSyncState(key: string): Promise<string | null> {
  const { rows } = await getPool().query<{ value: string }>(
    `SELECT value FROM ${SCHEMA}.sync_state WHERE key = $1`,
    [key]
  );
  return rows[0]?.value ?? null;
}

async function recordSyncRun<T extends { rows: number }>(
  syncType: string,
  dateFrom: string | null,
  dateTo: string | null,
  fn: () => Promise<T>
): Promise<T> {
  const { rows } = await getPool().query<{ id: number }>(
    `INSERT INTO ${SCHEMA}.sync_runs (sync_type, date_from, date_to) VALUES ($1, $2, $3) RETURNING id`,
    [syncType, dateFrom, dateTo]
  );
  const runId = rows[0].id;

  try {
    const result = await fn();
    await getPool().query(
      `UPDATE ${SCHEMA}.sync_runs SET finished_at = NOW(), status = 'success', rows_upserted = $2 WHERE id = $1`,
      [runId, result.rows]
    );
    return result;
  } catch (error) {
    await getPool().query(
      `UPDATE ${SCHEMA}.sync_runs SET finished_at = NOW(), status = 'error', error = $2 WHERE id = $1`,
      [runId, error instanceof Error ? error.message : String(error)]
    );
    throw error;
  }
}

async function upsertStructure(rows: GoogleAdsResult[], customerId: string): Promise<number> {
  const validRows = rows.filter((row) => row.campaign?.id && row.adGroup?.id && row.adGroupAd?.ad?.id);
  if (validRows.length === 0) return 0;

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    for (const row of validRows) {
      await client.query(
        `INSERT INTO ${SCHEMA}.campaigns
           (campaign_id, customer_id, name, status, advertising_channel_type, last_synced_at)
         VALUES ($1,$2,$3,$4,$5,NOW())
         ON CONFLICT (campaign_id) DO UPDATE SET
           name = EXCLUDED.name, status = EXCLUDED.status,
           advertising_channel_type = EXCLUDED.advertising_channel_type,
           last_synced_at = NOW()`,
        [
          row.campaign?.id,
          customerId,
          row.campaign?.name ?? "(sem nome)",
          row.campaign?.status ?? null,
          row.campaign?.advertisingChannelType ?? null,
        ]
      );
      await client.query(
        `INSERT INTO ${SCHEMA}.ad_groups
           (ad_group_id, campaign_id, customer_id, name, status, type, last_synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW())
         ON CONFLICT (ad_group_id) DO UPDATE SET
           campaign_id = EXCLUDED.campaign_id, name = EXCLUDED.name, status = EXCLUDED.status,
           type = EXCLUDED.type, last_synced_at = NOW()`,
        [
          row.adGroup?.id,
          row.campaign?.id,
          customerId,
          row.adGroup?.name ?? "(sem nome)",
          row.adGroup?.status ?? null,
          row.adGroup?.type ?? null,
        ]
      );
      await client.query(
        `INSERT INTO ${SCHEMA}.ads
           (ad_id, ad_group_id, campaign_id, customer_id, name, status, final_urls, tracking_url_template, last_synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
         ON CONFLICT (ad_id) DO UPDATE SET
           ad_group_id = EXCLUDED.ad_group_id, campaign_id = EXCLUDED.campaign_id,
           name = EXCLUDED.name, status = EXCLUDED.status, final_urls = EXCLUDED.final_urls,
           tracking_url_template = EXCLUDED.tracking_url_template, last_synced_at = NOW()`,
        [
          row.adGroupAd?.ad?.id,
          row.adGroup?.id,
          row.campaign?.id,
          customerId,
          row.adGroupAd?.ad?.name ?? null,
          row.adGroupAd?.status ?? null,
          row.adGroupAd?.ad?.finalUrls ? JSON.stringify(row.adGroupAd.ad.finalUrls) : null,
          row.adGroupAd?.ad?.trackingUrlTemplate ?? null,
        ]
      );
    }
    await client.query("COMMIT");
    return validRows.length;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function syncGoogleAdsStructure(): Promise<{ rows: number }> {
  const customerId = getCustomerId();
  const rows = await searchGoogleAds(`
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      ad_group.id,
      ad_group.name,
      ad_group.status,
      ad_group.type,
      ad_group_ad.status,
      ad_group_ad.ad.id,
      ad_group_ad.ad.name,
      ad_group_ad.ad.final_urls,
      ad_group_ad.ad.tracking_url_template
    FROM ad_group_ad
    WHERE ad_group_ad.status != 'REMOVED'
  `);
  const count = await upsertStructure(rows, customerId);
  await setSyncState("structure_last_full_sync_at", new Date().toISOString());
  return { rows: count };
}

async function upsertInsightRows(rows: GoogleAdsResult[]): Promise<number> {
  const validRows = rows.filter((row) => row.adGroupAd?.ad?.id && row.segments?.date);
  if (validRows.length === 0) return 0;

  const { rows: knownAds } = await getPool().query<{ ad_id: string }>(`SELECT ad_id FROM ${SCHEMA}.ads`);
  const knownAdIds = new Set(knownAds.map((row) => row.ad_id));
  const filteredRows = validRows.filter((row) => knownAdIds.has(row.adGroupAd?.ad?.id ?? ""));
  if (filteredRows.length === 0) return 0;

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    for (const row of filteredRows) {
      await client.query(
        `INSERT INTO ${SCHEMA}.ad_insights_daily
           (ad_id, date, impressions, clicks, cost_micros, conversions, conversion_value, synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
         ON CONFLICT (ad_id, date) DO UPDATE SET
           impressions = EXCLUDED.impressions, clicks = EXCLUDED.clicks,
           cost_micros = EXCLUDED.cost_micros, conversions = EXCLUDED.conversions,
           conversion_value = EXCLUDED.conversion_value, synced_at = NOW()`,
        [
          row.adGroupAd?.ad?.id,
          row.segments?.date,
          row.metrics?.impressions ?? "0",
          row.metrics?.clicks ?? "0",
          row.metrics?.costMicros ?? "0",
          row.metrics?.conversions ?? "0",
          row.metrics?.conversionsValue ?? "0",
        ]
      );
    }
    await client.query("COMMIT");
    return filteredRows.length;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function syncGoogleAdsInsights(options: { sinceDate: string; untilDate: string }): Promise<{ rows: number }> {
  const rows = await searchGoogleAds(`
    SELECT
      segments.date,
      campaign.id,
      campaign.name,
      ad_group.id,
      ad_group.name,
      ad_group_ad.ad.id,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value
    FROM ad_group_ad
    WHERE segments.date BETWEEN '${options.sinceDate}' AND '${options.untilDate}'
      AND ad_group_ad.status != 'REMOVED'
  `);
  const count = await upsertInsightRows(rows);
  return { rows: count };
}

export function shiftGoogleAdsIsoDate(isoDate: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new Error(`Data ISO inválida: ${isoDate}`);
  const shifted = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return shifted.toISOString().slice(0, 10);
}

export function getGoogleAdsToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: GOOGLE_ADS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

function daysAgo(days: number): string {
  return shiftGoogleAdsIsoDate(getGoogleAdsToday(), -days);
}

function hoursSince(isoDate: string): number {
  return (Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60);
}

export interface RunGoogleAdsSyncResult {
  skipped: boolean;
  reason?: string;
}

export async function runGoogleAdsSync(options: { forceStructure?: boolean } = {}): Promise<RunGoogleAdsSyncResult> {
  await ensureGoogleAdsSchema();
  if (!hasGoogleAdsConfig()) {
    return { skipped: true, reason: "credenciais Google Ads incompletas" };
  }

  const lockClient = await getPool().connect();
  try {
    const { rows: lockRows } = await lockClient.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [ADVISORY_LOCK_KEY]
    );
    if (!lockRows[0]?.locked) return { skipped: true, reason: "sincronização Google Ads já em andamento" };

    try {
      const structureTtlHours = Number(process.env.GOOGLE_ADS_STRUCTURE_TTL_HOURS ?? "6");
      const lastFullSync = await getSyncState("structure_last_full_sync_at");
      const structureStale = options.forceStructure || !lastFullSync || hoursSince(lastFullSync) >= structureTtlHours;

      if (structureStale) {
        await recordSyncRun("structure", null, null, () => syncGoogleAdsStructure());
      }

      const backfillDone = await getSyncState("initial_backfill_done_at");
      const resyncDays = Number(process.env.GOOGLE_ADS_INSIGHTS_RESYNC_DAYS ?? "3");

      if (!backfillDone) {
        const backfillDays = Number(process.env.GOOGLE_ADS_INITIAL_BACKFILL_DAYS ?? "90");
        const since = daysAgo(backfillDays);
        const until = getGoogleAdsToday();
        await recordSyncRun("insights", since, until, () => syncGoogleAdsInsights({ sinceDate: since, untilDate: until }));
        await setSyncState("initial_backfill_done_at", new Date().toISOString());
      } else {
        const since = daysAgo(resyncDays);
        const until = getGoogleAdsToday();
        await recordSyncRun("insights", since, until, () => syncGoogleAdsInsights({ sinceDate: since, untilDate: until }));
      }

      return { skipped: false };
    } finally {
      await lockClient.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]).catch(() => undefined);
    }
  } finally {
    lockClient.release();
  }
}

export async function getLatestGoogleAdsSyncRuns(limit = 5): Promise<SyncRunSummary[]> {
  await ensureGoogleAdsSchema();
  const { rows } = await getPool().query<{
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
    syncType: `google_${row.sync_type}`,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    rowsUpserted: row.rows_upserted,
  }));
}
