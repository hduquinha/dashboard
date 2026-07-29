import { getPool } from "@/lib/db";
import type {
  AppNotification,
  AppNotificationFeed,
  AppNotificationKind,
} from "@/types/notifications";

const SCHEMA = "dashboard";
/** Notificacoes mais antigas que isso somem sozinhas (feed nao e historico). */
const RETENTION_DAYS = 60;

let schemaReady = false;

export type { AppNotification, AppNotificationFeed, AppNotificationKind };

export interface NewAppNotification {
  kind: AppNotificationKind;
  title: string;
  body: string;
  url?: string | null;
  inscricaoId?: number | null;
  /**
   * Chave de idempotencia por destinatario. Com ela, reprocessar o mesmo
   * evento (ciclo de alerta que roda a cada 5 min) nao duplica a linha no
   * feed. Sem ela, cada chamada cria uma notificacao nova.
   */
  dedupeKey?: string | null;
}

/**
 * Feed de notificacoes dentro do site — o mesmo evento que vira web push
 * (lead novo, lead atribuido, lead parado, lead sem distribuir) fica gravado
 * aqui por destinatario. E o canal duravel: o push depende de permissao do
 * navegador e da rede ate o FCM/Apple, enquanto isto aqui sempre aparece
 * quando a pessoa abre o dashboard.
 */
async function ensureAppNotificationSchema(): Promise<void> {
  if (schemaReady) return;

  await getPool().query(`
    CREATE SCHEMA IF NOT EXISTS ${SCHEMA};

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.app_notifications (
      id SERIAL PRIMARY KEY,
      user_email TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      url TEXT,
      inscricao_id INTEGER,
      dedupe_key TEXT,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      read_at TIMESTAMP WITH TIME ZONE
    );

    CREATE INDEX IF NOT EXISTS app_notifications_user_created_idx
      ON ${SCHEMA}.app_notifications (user_email, created_at DESC);

    CREATE INDEX IF NOT EXISTS app_notifications_unread_idx
      ON ${SCHEMA}.app_notifications (user_email) WHERE read_at IS NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS app_notifications_dedupe_idx
      ON ${SCHEMA}.app_notifications (user_email, dedupe_key) WHERE dedupe_key IS NOT NULL;
  `);

  schemaReady = true;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Grava as notificacoes para cada destinatario. Chamado junto do despacho de
 * push — de proposito ANTES/independente do envio, para que uma falha de rede
 * no push nao apague o aviso: o feed do site continua correto.
 */
export async function createAppNotifications(
  recipientEmails: readonly string[],
  notifications: readonly NewAppNotification[]
): Promise<number> {
  const emails = [...new Set(recipientEmails.map(normalizeEmail).filter(Boolean))];
  if (emails.length === 0 || notifications.length === 0) return 0;

  await ensureAppNotificationSchema();

  const { rowCount } = await getPool().query(
    `
      INSERT INTO ${SCHEMA}.app_notifications
        (user_email, kind, title, body, url, inscricao_id, dedupe_key)
      SELECT r.email, n.kind, n.title, n.body, n.url, n.inscricao_id, n.dedupe_key
      FROM UNNEST($1::text[]) AS r(email)
      CROSS JOIN UNNEST($2::text[], $3::text[], $4::text[], $5::text[], $6::int[], $7::text[])
        AS n(kind, title, body, url, inscricao_id, dedupe_key)
      ON CONFLICT DO NOTHING
    `,
    [
      emails,
      notifications.map((item) => item.kind),
      notifications.map((item) => item.title),
      notifications.map((item) => item.body),
      notifications.map((item) => item.url ?? null),
      notifications.map((item) => item.inscricaoId ?? null),
      notifications.map((item) => item.dedupeKey ?? null),
    ]
  );

  return rowCount ?? 0;
}

interface NotificationRow {
  id: number;
  kind: string;
  title: string;
  body: string;
  url: string | null;
  inscricao_id: number | null;
  created_at: Date | string;
  read_at: Date | string | null;
}

function mapRow(row: NotificationRow): AppNotification {
  const toIso = (value: Date | string | null): string | null => {
    if (!value) return null;
    return value instanceof Date ? value.toISOString() : String(value);
  };

  return {
    id: row.id,
    kind: row.kind as AppNotificationKind,
    title: row.title,
    body: row.body,
    url: row.url,
    inscricaoId: row.inscricao_id,
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    readAt: toIso(row.read_at),
  };
}

export async function getAppNotificationFeed(
  userEmail: string,
  options: { limit?: number; onlyUnread?: boolean } = {}
): Promise<AppNotificationFeed> {
  const email = normalizeEmail(userEmail);
  if (!email) return { items: [], unread: 0 };

  await ensureAppNotificationSchema();

  const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
  const unreadCondition = options.onlyUnread ? "AND read_at IS NULL" : "";

  const [listRes, unreadRes] = await Promise.all([
    getPool().query<NotificationRow>(
      `
        SELECT id, kind, title, body, url, inscricao_id, created_at, read_at
        FROM ${SCHEMA}.app_notifications
        WHERE user_email = $1 ${unreadCondition}
        ORDER BY created_at DESC, id DESC
        LIMIT $2
      `,
      [email, limit]
    ),
    getPool().query<{ unread: string }>(
      `SELECT COUNT(*)::bigint AS unread FROM ${SCHEMA}.app_notifications WHERE user_email = $1 AND read_at IS NULL`,
      [email]
    ),
  ]);

  return {
    items: listRes.rows.map(mapRow),
    unread: Number.parseInt(unreadRes.rows[0]?.unread ?? "0", 10) || 0,
  };
}

/** Marca como lidas. Sem `ids`, marca todas as pendentes do usuario. */
export async function markAppNotificationsRead(
  userEmail: string,
  ids?: readonly number[]
): Promise<number> {
  const email = normalizeEmail(userEmail);
  if (!email) return 0;

  await ensureAppNotificationSchema();

  if (ids && ids.length === 0) return 0;

  const { rowCount } = ids
    ? await getPool().query(
        `UPDATE ${SCHEMA}.app_notifications SET read_at = NOW()
         WHERE user_email = $1 AND read_at IS NULL AND id = ANY($2::int[])`,
        [email, [...ids]]
      )
    : await getPool().query(
        `UPDATE ${SCHEMA}.app_notifications SET read_at = NOW() WHERE user_email = $1 AND read_at IS NULL`,
        [email]
      );

  return rowCount ?? 0;
}

/** Limpeza de retencao, chamada pelo ciclo de alertas (nao pelo request do usuario). */
export async function pruneAppNotifications(): Promise<number> {
  await ensureAppNotificationSchema();

  const { rowCount } = await getPool().query(
    `DELETE FROM ${SCHEMA}.app_notifications WHERE created_at < NOW() - INTERVAL '${RETENTION_DAYS} days'`
  );

  return rowCount ?? 0;
}
