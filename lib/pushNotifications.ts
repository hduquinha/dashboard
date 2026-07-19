import webpush, { type PushSubscription as WebPushSubscription } from "web-push";
import { getPool } from "@/lib/db";
import { describeLeadSource, isMetaOuGoogleAdsOrigem } from "@/lib/leadFields";
import { parsePayload } from "@/lib/parsePayload";

const SCHEMA = "dashboard";
const INSCRICOES_SCHEMA = "inscricoes";
/** Mesmo teto do feed de notificações do navegador. */
const MAX_LEADS_PER_DISPATCH = 20;
/** Acima disso, agrupa em uma única notificação para não inundar o celular. */
const MAX_INDIVIDUAL_NOTIFICATIONS = 5;

let schemaReady = false;

async function ensurePushSchema(): Promise<void> {
  if (schemaReady) return;

  await getPool().query(`
    CREATE SCHEMA IF NOT EXISTS ${SCHEMA};

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.push_subscriptions (
      id SERIAL PRIMARY KEY,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_email TEXT,
      user_agent TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    -- Chaves VAPID geradas uma única vez + cursor do despacho (id da última
    -- inscrição notificada). Uma linha só (id = 1).
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.push_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      vapid_public_key TEXT NOT NULL,
      vapid_private_key TEXT NOT NULL,
      last_notified_inscricao_id INTEGER,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  schemaReady = true;
}

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

/**
 * Chaves VAPID persistidas no banco: geradas na primeira chamada e reusadas
 * para sempre (trocar a chave invalidaria todas as inscrições de push já
 * feitas nos celulares). Podem ser sobrepostas por env VAPID_PUBLIC_KEY /
 * VAPID_PRIVATE_KEY se um dia for preciso fixá-las.
 */
export async function getVapidKeys(): Promise<VapidKeys> {
  const envPublic = process.env.VAPID_PUBLIC_KEY;
  const envPrivate = process.env.VAPID_PRIVATE_KEY;
  if (envPublic && envPrivate) {
    return { publicKey: envPublic, privateKey: envPrivate };
  }

  await ensurePushSchema();
  const pool = getPool();

  const existing = await pool.query<{ vapid_public_key: string; vapid_private_key: string }>(
    `SELECT vapid_public_key, vapid_private_key FROM ${SCHEMA}.push_state WHERE id = 1`
  );
  if (existing.rows[0]) {
    return {
      publicKey: existing.rows[0].vapid_public_key,
      privateKey: existing.rows[0].vapid_private_key,
    };
  }

  const generated = webpush.generateVAPIDKeys();
  // ON CONFLICT: outro worker pode ter gerado ao mesmo tempo — vence o primeiro.
  const inserted = await pool.query<{ vapid_public_key: string; vapid_private_key: string }>(
    `
      INSERT INTO ${SCHEMA}.push_state (id, vapid_public_key, vapid_private_key)
      VALUES (1, $1, $2)
      ON CONFLICT (id) DO UPDATE SET updated_at = ${SCHEMA}.push_state.updated_at
      RETURNING vapid_public_key, vapid_private_key
    `,
    [generated.publicKey, generated.privateKey]
  );
  return {
    publicKey: inserted.rows[0].vapid_public_key,
    privateKey: inserted.rows[0].vapid_private_key,
  };
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export function parseSubscriptionInput(value: unknown): PushSubscriptionInput | null {
  if (!value || typeof value !== "object") return null;
  const sub = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof sub.endpoint !== "string" || !sub.endpoint.startsWith("https://")) return null;
  if (typeof sub.keys?.p256dh !== "string" || typeof sub.keys?.auth !== "string") return null;
  return { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
}

export async function saveSubscription(
  subscription: PushSubscriptionInput,
  userEmail: string | null,
  userAgent: string | null
): Promise<void> {
  await ensurePushSchema();
  await getPool().query(
    `
      INSERT INTO ${SCHEMA}.push_subscriptions (endpoint, p256dh, auth, user_email, user_agent)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (endpoint) DO UPDATE SET
        p256dh = EXCLUDED.p256dh,
        auth = EXCLUDED.auth,
        user_email = COALESCE(EXCLUDED.user_email, ${SCHEMA}.push_subscriptions.user_email),
        user_agent = EXCLUDED.user_agent,
        updated_at = NOW()
    `,
    [
      subscription.endpoint,
      subscription.keys.p256dh,
      subscription.keys.auth,
      userEmail,
      userAgent,
    ]
  );
}

export async function deleteSubscription(endpoint: string): Promise<void> {
  await ensurePushSchema();
  await getPool().query(`DELETE FROM ${SCHEMA}.push_subscriptions WHERE endpoint = $1`, [endpoint]);
}

interface DispatchResult {
  newLeads: number;
  subscriptions: number;
  sent: number;
  pruned: number;
}

interface PushMessage {
  title: string;
  body: string;
  tag: string;
  url: string;
}

function formatHora(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

/**
 * Despacha web push de leads novos para todos os aparelhos inscritos. Chamado
 * pelo server.js (loopback em /api/internal/push-dispatch) no mesmo padrão do
 * merge sweep. Cursor em push_state.last_notified_inscricao_id: na primeira
 * execução só grava a baseline (sem rajada de notificações antigas).
 */
export async function dispatchNewLeadPushes(): Promise<DispatchResult> {
  await ensurePushSchema();
  const pool = getPool();
  const result: DispatchResult = { newLeads: 0, subscriptions: 0, sent: 0, pruned: 0 };

  const stateRows = await pool.query<{ last_notified_inscricao_id: number | null }>(
    `SELECT last_notified_inscricao_id FROM ${SCHEMA}.push_state WHERE id = 1`
  );
  // getVapidKeys garante a linha 1 e configura o web-push.
  const keys = await getVapidKeys();
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:contato@vozup.com.br",
    keys.publicKey,
    keys.privateKey
  );

  const cursor = stateRows.rows[0]?.last_notified_inscricao_id ?? null;

  const latestRows = await pool.query<{ latest_id: number | string | null }>(
    `SELECT COALESCE(MAX(id), 0) AS latest_id FROM ${INSCRICOES_SCHEMA}.inscricoes`
  );
  const latestId = Number(latestRows.rows[0]?.latest_id ?? 0);

  if (cursor === null) {
    await pool.query(
      `UPDATE ${SCHEMA}.push_state SET last_notified_inscricao_id = $1, updated_at = NOW() WHERE id = 1`,
      [latestId]
    );
    return result;
  }

  if (latestId <= cursor) return result;

  const { rows } = await pool.query<{
    id: number;
    payload: Record<string, unknown> | null;
    criado_em: Date | string;
  }>(
    `
      SELECT id, payload, criado_em
      FROM ${INSCRICOES_SCHEMA}.inscricoes
      WHERE id > $1
      ORDER BY id ASC
      LIMIT $2
    `,
    [cursor, MAX_LEADS_PER_DISPATCH]
  );

  await pool.query(
    `UPDATE ${SCHEMA}.push_state SET last_notified_inscricao_id = $1, updated_at = NOW() WHERE id = 1`,
    [latestId]
  );

  // Push restrito a leads de tráfego pago Meta/Google Ads — o cursor acima já
  // avançou sobre todas as linhas (inclusive as que não casam), então elas
  // não voltam a ser reavaliadas no próximo despacho.
  const matchingRows = rows.filter((row) => {
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    return isMetaOuGoogleAdsOrigem(payload.origem as string | undefined);
  });

  result.newLeads = matchingRows.length;
  if (matchingRows.length === 0) return result;

  const messages: PushMessage[] = [];
  if (matchingRows.length > MAX_INDIVIDUAL_NOTIFICATIONS) {
    messages.push({
      title: "Novos Leads Recebidos",
      body: `${matchingRows.length} novos cadastros chegaram ao sistema.`,
      tag: `leads-batch-${latestId}`,
      url: "/distribuicao",
    });
  } else {
    for (const row of matchingRows) {
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      const parsed = parsePayload(payload);
      const source = describeLeadSource(payload);
      const nome =
        typeof parsed.nome === "string" && parsed.nome.trim() ? parsed.nome.trim() : "Novo cadastro";
      const origem = source.formName ?? source.origem ?? source.paginaOrigem ?? source.fonte ?? null;
      const criadoEm =
        row.criado_em instanceof Date ? row.criado_em.toISOString() : String(row.criado_em ?? "");
      const hora = formatHora(criadoEm);
      const acao = origem ? `acabou de preencher o formulário "${origem}"` : "acabou de se cadastrar";
      messages.push({
        title: "Novo Lead Recebido",
        body: `${nome} ${acao}.${hora ? ` (${hora})` : ""}`,
        tag: `lead-${row.id}`,
        url: "/distribuicao",
      });
    }
  }

  const subs = await pool.query<{ id: number; endpoint: string; p256dh: string; auth: string }>(
    `SELECT id, endpoint, p256dh, auth FROM ${SCHEMA}.push_subscriptions`
  );
  result.subscriptions = subs.rows.length;
  if (subs.rows.length === 0) return result;

  const staleIds: number[] = [];
  await Promise.all(
    subs.rows.flatMap((sub) => {
      const target: WebPushSubscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      };
      return messages.map(async (message) => {
        try {
          await webpush.sendNotification(target, JSON.stringify(message), { TTL: 60 * 60 });
          result.sent += 1;
        } catch (error) {
          const statusCode = (error as { statusCode?: number }).statusCode;
          // 404/410: inscrição expirada/revogada no aparelho — remover.
          if (statusCode === 404 || statusCode === 410) {
            staleIds.push(sub.id);
          } else {
            console.error(
              `[push] falha ao enviar para ${sub.endpoint.slice(0, 60)}…:`,
              (error as Error).message ?? error
            );
          }
        }
      });
    })
  );

  if (staleIds.length > 0) {
    const unique = [...new Set(staleIds)];
    await pool.query(`DELETE FROM ${SCHEMA}.push_subscriptions WHERE id = ANY($1::int[])`, [unique]);
    result.pruned = unique.length;
  }

  return result;
}
