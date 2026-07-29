import webpush, { type PushSubscription as WebPushSubscription } from "web-push";
import { createAppNotifications, type NewAppNotification } from "@/lib/appNotifications";
import { getPool, listInscricoesByIds } from "@/lib/db";
import { describeLeadSource, isMetaOuGoogleAdsOrigem } from "@/lib/leadFields";
import { hasPermission } from "@/lib/permissions";
import { parsePayload } from "@/lib/parsePayload";
import { isProductivityManager } from "@/lib/productivity";
import { listTeamMembers } from "@/lib/teamAuth";

const SCHEMA = "dashboard";
const INSCRICOES_SCHEMA = "inscricoes";
/** Mesmo teto do feed de notificações do navegador. */
const MAX_LEADS_PER_DISPATCH = 20;
/** Acima disso, agrupa em uma única notificação para não inundar o celular. */
const MAX_INDIVIDUAL_NOTIFICATIONS = 5;
/**
 * Conexões HTTPS simultâneas com os serviços de push (FCM/Apple). Sem esse
 * teto, um ciclo com dezenas de leads × dezenas de aparelhos abre centenas de
 * sockets de uma vez e o próprio host derruba a maioria com ETIMEDOUT/
 * ENETUNREACH (AggregateError de mensagem vazia) — foi o que fez ~76% dos
 * envios falharem em produção.
 */
const PUSH_CONCURRENCY = 6;

let schemaReady = false;
let staleAlertSchemaReady = false;
let undistributedAlertSchemaReady = false;

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

/**
 * Registra, por lead, qual foi a ultima atividade que ja gerou alerta de
 * "parado". A chave util e `last_activity_at`: enquanto o lead nao se mexer
 * (nova atribuicao, etapa, nota), ele nao alerta de novo. `assigned_at` fica
 * como referencia da atribuicao vigente.
 */
async function ensureStaleLeadAlertSchema(): Promise<void> {
  if (staleAlertSchemaReady) return;

  await getPool().query(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.stale_lead_alerts (
      inscricao_id INTEGER PRIMARY KEY,
      assigned_at TIMESTAMP WITH TIME ZONE NOT NULL,
      alerted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    ALTER TABLE ${SCHEMA}.stale_lead_alerts
      ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP WITH TIME ZONE;

    -- Backfill das linhas gravadas pelo esquema antigo: assume a atividade
    -- atual do lead, para que a correcao do bug de precisao nao dispare de
    -- uma vez um alerta de todo lead ja alertado antes.
    UPDATE ${SCHEMA}.stale_lead_alerts sla
    SET last_activity_at = COALESCE(cl.updated_at, cl.assigned_at)
    FROM ${SCHEMA}.commercial_leads cl
    WHERE cl.inscricao_id = sla.inscricao_id AND sla.last_activity_at IS NULL;

    UPDATE ${SCHEMA}.stale_lead_alerts
    SET last_activity_at = assigned_at
    WHERE last_activity_at IS NULL;
  `);

  staleAlertSchemaReady = true;
}

/**
 * Registra, por lead, se ja alertamos os masters de que ele chegou na
 * Chegada de Leads e passou do prazo sem ser distribuido. Chave só em
 * inscricao_id (nao muda depois de distribuido) — é um aviso de "uma vez só".
 */
async function ensureUndistributedLeadAlertSchema(): Promise<void> {
  if (undistributedAlertSchemaReady) return;

  await getPool().query(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.undistributed_lead_alerts (
      inscricao_id INTEGER PRIMARY KEY,
      alerted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  undistributedAlertSchemaReady = true;
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

interface PushTarget {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

interface SendResult {
  sent: number;
  failed: number;
  pruned: number;
}

/**
 * Rótulo curto e agregável do erro. Falha de rede vem como AggregateError com
 * `message` vazia — logar só `error.message` produzia dezenas de milhares de
 * linhas em branco por dia, sem dizer o que estava acontecendo.
 */
function describePushError(error: unknown): string {
  const err = error as { statusCode?: number; code?: string; name?: string; message?: string };
  if (typeof err?.statusCode === "number") return `HTTP ${err.statusCode}`;
  const parts = [err?.name || "Error"];
  if (err?.code) parts.push(err.code);
  else if (err?.message) parts.push(err.message);
  return parts.join(" ");
}

/**
 * Envia as mensagens para os aparelhos em lotes de PUSH_CONCURRENCY, remove
 * inscrições mortas (404/410) e agrega os erros num log só por tipo. Todos os
 * despachos passam por aqui — é o único ponto que fala com o serviço de push.
 */
async function sendPushMessages(
  targets: readonly PushTarget[],
  messages: readonly PushMessage[],
  options: { urgency?: "very-low" | "low" | "normal" | "high"; context: string }
): Promise<SendResult> {
  const result: SendResult = { sent: 0, failed: 0, pruned: 0 };
  if (targets.length === 0 || messages.length === 0) return result;

  const keys = await getVapidKeys();
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:contato@vozup.com.br",
    keys.publicKey,
    keys.privateKey
  );

  const jobs = targets.flatMap((target) => messages.map((message) => ({ target, message })));
  const deadSubscriptionIds = new Set<number>();
  const errorCounts = new Map<string, number>();

  for (let index = 0; index < jobs.length; index += PUSH_CONCURRENCY) {
    const batch = jobs.slice(index, index + PUSH_CONCURRENCY);
    await Promise.all(
      batch.map(async ({ target, message }) => {
        // Inscrição já removida neste ciclo: não insiste com as demais mensagens.
        if (deadSubscriptionIds.has(target.id)) return;

        const subscription: WebPushSubscription = {
          endpoint: target.endpoint,
          keys: { p256dh: target.p256dh, auth: target.auth },
        };

        try {
          await webpush.sendNotification(subscription, JSON.stringify(message), {
            TTL: 60 * 60,
            ...(options.urgency ? { urgency: options.urgency } : {}),
          });
          result.sent += 1;
        } catch (error) {
          result.failed += 1;
          const statusCode = (error as { statusCode?: number }).statusCode;
          // 404/410: inscrição expirada/revogada no aparelho — remover.
          if (statusCode === 404 || statusCode === 410) {
            deadSubscriptionIds.add(target.id);
            return;
          }
          const label = describePushError(error);
          errorCounts.set(label, (errorCounts.get(label) ?? 0) + 1);
        }
      })
    );
  }

  if (deadSubscriptionIds.size > 0) {
    await getPool().query(`DELETE FROM ${SCHEMA}.push_subscriptions WHERE id = ANY($1::int[])`, [
      [...deadSubscriptionIds],
    ]);
    result.pruned = deadSubscriptionIds.size;
  }

  if (errorCounts.size > 0) {
    const summary = [...errorCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => `${label} x${count}`)
      .join(", ");
    console.error(`[push] ${options.context}: ${result.failed} envio(s) falharam — ${summary}`);
  }

  return result;
}

/** E-mails ativos que devem receber avisos de lead novo / não distribuído. */
async function listDistributionRecipientEmails(): Promise<string[]> {
  const members = await listTeamMembers({ activeOnly: true });
  return [
    ...new Set(
      members
        .filter((member) => hasPermission(member, "view.distribution"))
        .map((member) => member.email.trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
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

  // Uma entrada por lead no feed do site (mesmo quando o push vai agrupado):
  // lá o espaço não é escasso e cada lead precisa do próprio link.
  const feedItems: NewAppNotification[] = [];
  const individualMessages: PushMessage[] = [];

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
    const body = `${nome} ${acao}.${hora ? ` (${hora})` : ""}`;

    individualMessages.push({
      title: "Novo Lead Recebido",
      body,
      tag: `lead-${row.id}`,
      url: "/distribuicao",
    });
    feedItems.push({
      kind: "new_lead",
      title: "Novo lead recebido",
      body,
      url: "/distribuicao",
      inscricaoId: row.id,
      dedupeKey: `new_lead:${row.id}`,
    });
  }

  const messages: PushMessage[] =
    matchingRows.length > MAX_INDIVIDUAL_NOTIFICATIONS
      ? [
          {
            title: "Novos Leads Recebidos",
            body: `${matchingRows.length} novos cadastros chegaram ao sistema.`,
            tag: `leads-batch-${latestId}`,
            url: "/distribuicao",
          },
        ]
      : individualMessages;

  try {
    await createAppNotifications(await listDistributionRecipientEmails(), feedItems);
  } catch (error) {
    console.error("[push] falha ao gravar notificacoes de lead novo no feed do site:", error);
  }

  const subs = await pool.query<PushTarget>(
    `SELECT id, endpoint, p256dh, auth FROM ${SCHEMA}.push_subscriptions`
  );
  result.subscriptions = subs.rows.length;
  if (subs.rows.length === 0) return result;

  const sendResult = await sendPushMessages(subs.rows, messages, { context: "lead novo" });
  result.sent = sendResult.sent;
  result.pruned = sendResult.pruned;

  return result;
}

interface SellerPushResult {
  subscriptions: number;
  sent: number;
}

/**
 * Push dirigido a UM vendedor especifico, disparado no momento em que o
 * master atribui um lead a ele (distribuicao manual). Diferente de
 * dispatchNewLeadPushes (que avisa todo mundo que um lead novo chegou ao
 * pool): este aqui é o "esse lead agora é seu" e vai só pros aparelhos
 * inscritos com aquele user_email.
 */
export async function notifySellerLeadAssigned(
  sellerEmail: string,
  lead: { id: number; nome: string | null }
): Promise<SellerPushResult> {
  await ensurePushSchema();
  const pool = getPool();
  const result: SellerPushResult = { subscriptions: 0, sent: 0 };

  const email = sellerEmail.trim().toLowerCase();
  if (!email) return result;

  const nome = lead.nome?.trim() || "Novo lead";
  const body = `${nome} acabou de ser atribuido a voce. Responda o quanto antes.`;

  try {
    await createAppNotifications(
      [email],
      [
        {
          kind: "lead_assigned",
          title: "Lead atribuído a você",
          body,
          url: "/crm",
          inscricaoId: lead.id,
          dedupeKey: null,
        },
      ]
    );
  } catch (error) {
    console.error("[push] falha ao gravar notificacao de atribuicao no feed do site:", error);
  }

  const subs = await pool.query<PushTarget>(
    `SELECT id, endpoint, p256dh, auth FROM ${SCHEMA}.push_subscriptions WHERE lower(user_email) = $1`,
    [email]
  );
  result.subscriptions = subs.rows.length;
  if (subs.rows.length === 0) return result;

  const message: PushMessage = {
    title: "Lead atribuido a voce",
    body,
    tag: `lead-assigned-${lead.id}`,
    url: "/crm",
  };

  const sendResult = await sendPushMessages(subs.rows, [message], {
    urgency: "high",
    context: "atribuicao de lead",
  });
  result.sent = sendResult.sent;

  return result;
}

interface StaleLeadAlertResult {
  stale: number;
  recipients: number;
  sent: number;
}

interface ManagerAudience {
  emails: string[];
  subscriptions: PushTarget[];
}

/** Gestores (masters/SDR) e os aparelhos inscritos deles. */
async function getManagerAudience(): Promise<ManagerAudience> {
  const managers = (await listTeamMembers({ activeOnly: true })).filter((member) =>
    isProductivityManager(member)
  );
  const emails = [...new Set(managers.map((member) => member.email.trim().toLowerCase()).filter(Boolean))];
  if (emails.length === 0) return { emails, subscriptions: [] };

  const { rows } = await getPool().query<PushTarget>(
    `SELECT id, endpoint, p256dh, auth FROM ${SCHEMA}.push_subscriptions WHERE lower(user_email) = ANY($1::text[])`,
    [emails]
  );
  return { emails, subscriptions: rows };
}

/**
 * Push do alerta de lead parado para os proprios vendedores donos dos leads.
 * Cada um recebe so o que e dele, agrupado quando sao muitos.
 */
async function dispatchSellerStaleAlerts(
  alertsBySeller: Map<string, { messages: PushMessage[] }>
): Promise<number> {
  const emails = [...alertsBySeller.keys()];
  if (emails.length === 0) return 0;

  const { rows } = await getPool().query<PushTarget & { user_email: string | null }>(
    `SELECT id, endpoint, p256dh, auth, user_email FROM ${SCHEMA}.push_subscriptions
     WHERE lower(user_email) = ANY($1::text[])`,
    [emails]
  );
  if (rows.length === 0) return 0;

  let sent = 0;
  for (const [email, bundle] of alertsBySeller) {
    const targets = rows.filter((row) => row.user_email?.trim().toLowerCase() === email);
    if (targets.length === 0) continue;

    const messages =
      bundle.messages.length > MAX_INDIVIDUAL_NOTIFICATIONS
        ? [
            {
              title: `${bundle.messages.length} leads seus parados`,
              body: "Voce tem leads sem andamento. Abra o CRM para retomar.",
              tag: "stale-leads-mine",
              url: "/crm",
            },
          ]
        : bundle.messages;

    const result = await sendPushMessages(targets, messages, {
      urgency: "high",
      context: "lead parado (vendedor)",
    });
    sent += result.sent;
  }

  return sent;
}

/**
 * Avisa os masters/gestores sobre lead atribuido que travou, em duas
 * situacoes distintas:
 *
 * - `sem_primeiro_contato`: foi atribuido ha mais de STALE_LEAD_ALERT_MINUTES
 *   e o vendedor nunca encostou nele (nenhuma etapa, nota ou tentativa).
 * - `sem_atividade`: o vendedor ate mexeu, mas a ultima atividade ja passou de
 *   STALE_LEAD_IDLE_HOURS (mesmo corte do card "Parados ha 48h" da home).
 *
 * Nao redistribui nada sozinho — so da visibilidade pro master decidir.
 *
 * O controle de repeticao usa `last_activity_at` e e feito DENTRO da mesma
 * query (CTE que insere): antes, o valor voltava pro Node como Date (precisao
 * de milissegundo), era regravado truncado e nunca mais casava com o
 * timestamptz do banco (microssegundos) — o mesmo lead era realertado a cada
 * ciclo, para sempre. Enquanto a atividade do lead nao muda, ele nao volta.
 */
export async function dispatchStaleLeadAlerts(): Promise<StaleLeadAlertResult> {
  await ensureStaleLeadAlertSchema();
  const pool = getPool();
  const result: StaleLeadAlertResult = { stale: 0, recipients: 0, sent: 0 };

  const thresholdMinutes = Number.parseInt(process.env.STALE_LEAD_ALERT_MINUTES || "30", 10) || 30;
  const idleHours = Number.parseInt(process.env.STALE_LEAD_IDLE_HOURS || "48", 10) || 48;

  const { rows } = await pool.query<{
    inscricao_id: number;
    assigned_seller_name: string | null;
    assigned_seller_email: string | null;
    reason: "sem_primeiro_contato" | "sem_atividade";
    horas_parado: number | string;
  }>(
    `
      WITH candidatos AS (
        SELECT
          cl.inscricao_id,
          cl.assigned_seller_name,
          cl.assigned_seller_email,
          cl.assigned_at,
          COALESCE(cl.updated_at, cl.assigned_at) AS last_activity_at,
          CASE
            WHEN cl.updated_at IS NULL OR cl.updated_at = cl.assigned_at THEN 'sem_primeiro_contato'
            ELSE 'sem_atividade'
          END AS reason,
          ROUND(EXTRACT(EPOCH FROM (NOW() - COALESCE(cl.updated_at, cl.assigned_at))) / 3600)::int AS horas_parado
        FROM ${SCHEMA}.commercial_leads cl
        LEFT JOIN ${SCHEMA}.stale_lead_alerts sla ON sla.inscricao_id = cl.inscricao_id
        WHERE cl.assigned_seller_id IS NOT NULL
          AND cl.assigned_at IS NOT NULL
          AND cl.commercial_stage_kind NOT IN ('won', 'lost')
          AND (
            (
              (cl.updated_at IS NULL OR cl.updated_at = cl.assigned_at)
              AND cl.assigned_at <= NOW() - ($1 || ' minutes')::interval
            )
            OR (
              cl.updated_at IS NOT NULL
              AND cl.updated_at <> cl.assigned_at
              AND cl.updated_at <= NOW() - ($2 || ' hours')::interval
            )
          )
          AND (
            sla.inscricao_id IS NULL
            OR sla.last_activity_at IS DISTINCT FROM COALESCE(cl.updated_at, cl.assigned_at)
          )
        ORDER BY COALESCE(cl.updated_at, cl.assigned_at) ASC
        LIMIT $3
      ),
      marcados AS (
        INSERT INTO ${SCHEMA}.stale_lead_alerts (inscricao_id, assigned_at, last_activity_at)
        SELECT inscricao_id, assigned_at, last_activity_at FROM candidatos
        ON CONFLICT (inscricao_id) DO UPDATE SET
          assigned_at = EXCLUDED.assigned_at,
          last_activity_at = EXCLUDED.last_activity_at,
          alerted_at = NOW()
        RETURNING inscricao_id
      )
      SELECT inscricao_id, assigned_seller_name, assigned_seller_email, reason, horas_parado
      FROM candidatos
      WHERE inscricao_id IN (SELECT inscricao_id FROM marcados)
    `,
    [thresholdMinutes, idleHours, MAX_LEADS_PER_DISPATCH]
  );

  if (rows.length === 0) return result;
  result.stale = rows.length;

  // Sem gestor cadastrado o alerta ainda faz sentido: o dono do lead recebe.
  const audience = await getManagerAudience();
  result.recipients = audience.subscriptions.length;

  const items = await listInscricoesByIds(rows.map((row) => row.inscricao_id));
  const itemsById = new Map(items.map((item) => [item.id, item]));

  const feedItems: NewAppNotification[] = [];
  const individualMessages: PushMessage[] = [];
  /**
   * Avisos na voz do dono do lead. Vendedor que tambem e gestor fica de fora
   * daqui — ja recebe a versao de gestor e receberia o mesmo lead duas vezes.
   */
  const sellerAlerts = new Map<string, { feed: NewAppNotification[]; messages: PushMessage[] }>();

  for (const row of rows) {
    const nome = itemsById.get(row.inscricao_id)?.nome?.trim() || "Lead";
    const sellerName = row.assigned_seller_name?.trim() || "o vendedor";
    const horas = Number(row.horas_parado) || 0;
    const title =
      row.reason === "sem_primeiro_contato"
        ? `Lead sem primeiro contato ha mais de ${thresholdMinutes} min`
        : `Lead parado ha ${horas}h`;
    const body =
      row.reason === "sem_primeiro_contato"
        ? `${nome} foi atribuido a ${sellerName} e ainda nao teve nenhuma atualizacao.`
        : `${nome} esta com ${sellerName} e nao tem atividade ha ${horas}h.`;
    const dedupeKey = `stale_lead:${row.inscricao_id}:${row.reason}:${horas}`;

    individualMessages.push({
      title,
      body,
      tag: `stale-lead-${row.inscricao_id}`,
      url: "/crm",
    });
    feedItems.push({
      kind: "stale_lead",
      title,
      body,
      url: "/crm",
      inscricaoId: row.inscricao_id,
      // A marcacao em stale_lead_alerts ja garante um alerta por parada; a
      // chave aqui protege contra reprocesso do mesmo ciclo.
      dedupeKey,
    });

    const sellerEmail = row.assigned_seller_email?.trim().toLowerCase() ?? "";
    if (!sellerEmail || audience.emails.includes(sellerEmail)) continue;

    const sellerTitle =
      row.reason === "sem_primeiro_contato"
        ? "Lead seu ainda sem primeiro contato"
        : `Lead seu parado ha ${horas}h`;
    const sellerBody =
      row.reason === "sem_primeiro_contato"
        ? `${nome} foi atribuido a voce ha mais de ${thresholdMinutes} min e ainda nao teve nenhum retorno.`
        : `${nome} esta sem nenhuma atualizacao ha ${horas}h. Retome o contato ou atualize a etapa.`;

    const bundle = sellerAlerts.get(sellerEmail) ?? { feed: [], messages: [] };
    bundle.feed.push({
      kind: "stale_lead",
      title: sellerTitle,
      body: sellerBody,
      url: "/crm",
      inscricaoId: row.inscricao_id,
      dedupeKey,
    });
    bundle.messages.push({
      title: sellerTitle,
      body: sellerBody,
      tag: `stale-lead-${row.inscricao_id}`,
      url: "/crm",
    });
    sellerAlerts.set(sellerEmail, bundle);
  }

  try {
    if (audience.emails.length > 0) {
      await createAppNotifications(audience.emails, feedItems);
    }
    for (const [sellerEmail, bundle] of sellerAlerts) {
      await createAppNotifications([sellerEmail], bundle.feed);
    }
  } catch (error) {
    console.error("[push] falha ao gravar notificacoes de lead parado no feed do site:", error);
  }

  result.sent += await dispatchSellerStaleAlerts(sellerAlerts);

  if (audience.subscriptions.length === 0) return result;

  const messages: PushMessage[] =
    rows.length > MAX_INDIVIDUAL_NOTIFICATIONS
      ? [
          {
            title: `${rows.length} leads parados`,
            body: "Leads atribuidos sem andamento. Abra o CRM para redistribuir ou cobrar.",
            tag: "stale-leads-batch",
            url: "/crm",
          },
        ]
      : individualMessages;

  const sendResult = await sendPushMessages(audience.subscriptions, messages, {
    urgency: "high",
    context: "lead parado",
  });
  result.sent += sendResult.sent;

  return result;
}

/**
 * Avisa os masters/gestores quando um lead cai na Chegada de Leads (Meta/
 * Google Ads) e passa do prazo sem ser distribuido a um vendedor. Complementa
 * dispatchNewLeadPushes (que avisa na hora que o lead chega, mas so uma vez);
 * este aqui cobre o caso do lead ficar esquecido no pool. Alerta uma unica
 * vez por lead (undistributed_lead_alerts) — uma vez distribuido, sai do
 * filtro de "nao atribuido" e nunca mais entra aqui.
 */
export async function dispatchUndistributedLeadAlerts(): Promise<StaleLeadAlertResult> {
  await ensureUndistributedLeadAlertSchema();
  const pool = getPool();
  const result: StaleLeadAlertResult = { stale: 0, recipients: 0, sent: 0 };

  const thresholdMinutes = Number.parseInt(process.env.UNDISTRIBUTED_LEAD_ALERT_MINUTES || "20", 10) || 20;

  const { rows } = await pool.query<{
    id: number;
    payload: Record<string, unknown> | null;
    criado_em: Date | string;
  }>(
    `
      SELECT i.id, i.payload, i.criado_em
      FROM ${INSCRICOES_SCHEMA}.inscricoes i
      LEFT JOIN ${SCHEMA}.commercial_leads cl ON cl.inscricao_id = i.id
      LEFT JOIN ${SCHEMA}.undistributed_lead_alerts ula ON ula.inscricao_id = i.id
      WHERE i.criado_em <= NOW() - ($1 || ' minutes')::interval
        AND i.criado_em >= NOW() - INTERVAL '24 hours'
        AND cl.assigned_seller_id IS NULL
        AND ula.inscricao_id IS NULL
        AND COALESCE(i.payload->>'dashboard_excluido', 'false') <> 'true'
      ORDER BY i.criado_em ASC
      LIMIT 200
    `,
    [thresholdMinutes]
  );

  const matching = rows.filter((row) => isMetaOuGoogleAdsOrigem((row.payload ?? {}).origem as string | undefined));
  if (matching.length === 0) return result;
  result.stale = matching.length;

  const audience = await getManagerAudience();
  result.recipients = audience.subscriptions.length;

  const feedItems: NewAppNotification[] = [];
  const individualMessages: PushMessage[] = [];

  for (const row of matching) {
    const parsed = parsePayload(row.payload ?? {});
    const nome =
      typeof parsed.nome === "string" && parsed.nome.trim() ? parsed.nome.trim() : "Novo cadastro";
    const title = `Lead sem distribuir ha mais de ${thresholdMinutes} min`;
    const body = `${nome} chegou na Chegada de Leads e ainda nao foi distribuido a ninguem.`;

    individualMessages.push({
      title,
      body,
      tag: `undistributed-lead-${row.id}`,
      url: "/distribuicao",
    });
    feedItems.push({
      kind: "undistributed_lead",
      title: `Lead sem distribuir há mais de ${thresholdMinutes} min`,
      body,
      url: "/distribuicao",
      inscricaoId: row.id,
      dedupeKey: `undistributed_lead:${row.id}`,
    });
  }

  if (audience.emails.length > 0) {
    try {
      await createAppNotifications(audience.emails, feedItems);
    } catch (error) {
      console.error("[push] falha ao gravar notificacoes de lead sem distribuir no feed:", error);
    }
  }

  if (audience.subscriptions.length > 0) {
    const messages: PushMessage[] =
      matching.length > MAX_INDIVIDUAL_NOTIFICATIONS
        ? [
            {
              title: `${matching.length} leads sem distribuir`,
              body: "Chegaram na Chegada de Leads e continuam sem vendedor.",
              tag: "undistributed-leads-batch",
              url: "/distribuicao",
            },
          ]
        : individualMessages;

    const sendResult = await sendPushMessages(audience.subscriptions, messages, {
      urgency: "high",
      context: "lead sem distribuir",
    });
    result.sent = sendResult.sent;
  }

  await pool.query(
    `
      INSERT INTO ${SCHEMA}.undistributed_lead_alerts (inscricao_id)
      SELECT * FROM UNNEST($1::int[])
      ON CONFLICT (inscricao_id) DO NOTHING
    `,
    [matching.map((row) => row.id)]
  );

  return result;
}
