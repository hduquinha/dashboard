import { getPool, autoMergeNewLeadByPhone } from "@/lib/db";
import { ensureCommercialSchema } from "@/lib/commercial";

const NOTIFY_NUMBER = "5511988874277";
const COMMERCIAL_SCHEMA = "dashboard";

function buildNotifyMessage(payload: Record<string, unknown>): string {
  const nome = String(payload.nome || payload.name || "—");
  const tel = String(payload.telefone || payload.whatsapp || payload.phone || "—");
  const objetivo = String(payload.objetivo || payload.interesse_workshop || "—");
  const origem = String(payload.origem || "VozUP");
  const hora = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

  return [
    "🎤 *Novo lead VozUP*",
    `Nome: ${nome}`,
    `WhatsApp: ${tel}`,
    `Objetivo: ${objetivo}`,
    `Origem: ${origem}`,
    `Recebido: ${hora}`,
  ].join("\n");
}

async function sendWhatsApp(text: string): Promise<void> {
  const baseUrl = (process.env.UAZAPI_SERVER_URL ?? "https://vozup.uazapi.com").replace(/\/+$/, "");
  const token = process.env.UAZAPI_INSTANCE_TOKEN?.trim();
  if (!token) {
    console.warn("[vozupLeadIngest] UAZAPI_INSTANCE_TOKEN não configurado — WhatsApp ignorado.");
    return;
  }

  const res = await fetch(`${baseUrl}/send/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json", token },
    body: JSON.stringify({ number: NOTIFY_NUMBER, text, readchat: false }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[vozupLeadIngest] Falha UazAPI:", res.status, body.slice(0, 200));
  }
}

/**
 * Cria (ou garante) o registro na pipeline comercial para o lead.
 * Usa ON CONFLICT DO NOTHING para não sobrescrever stage já existente.
 */
async function syncToPipeline(inscricaoId: number, origemValor: string): Promise<void> {
  try {
    await ensureCommercialSchema();
    const pool = getPool();
    await pool.query(
      `INSERT INTO ${COMMERCIAL_SCHEMA}.commercial_leads (inscricao_id, campaign_source, commercial_stage)
       VALUES ($1, $2, 'novo')
       ON CONFLICT (inscricao_id) DO NOTHING`,
      [inscricaoId, origemValor]
    );
  } catch (err) {
    console.error("[vozupLeadIngest] Erro ao sincronizar com Pipeline:", err);
  }
}

/**
 * Grava um lead VozUP em inscricoes.inscricoes e dispara, em segundo plano,
 * o merge por telefone, a sincronização com a pipeline comercial e o aviso no WhatsApp.
 * Usado tanto pelo POST direto da landing page quanto pelo webhook de Lead Ads do Facebook.
 */
export async function ingestVozupLead(
  payload: Record<string, unknown>,
  options: { notify: boolean }
): Promise<number | null> {
  const telefone = String(payload.telefone || payload.whatsapp || payload.phone || "").trim();
  const origemValor = String(payload.origem || "Voz UP").trim();

  let savedId: number | null = null;
  try {
    const pool = getPool();
    const result = await pool.query<{ id: number }>(
      "INSERT INTO inscricoes.inscricoes (payload) VALUES ($1) RETURNING id",
      [JSON.stringify(payload)]
    );
    savedId = result.rows[0]?.id ?? null;
  } catch (err) {
    console.error("[vozupLeadIngest] Erro ao salvar no banco:", err);
    return null;
  }

  if (savedId && telefone) {
    autoMergeNewLeadByPhone(savedId, telefone)
      .then(async (mergeResult) => {
        const targetId = mergeResult.merged ? mergeResult.primaryId : savedId!;
        await syncToPipeline(targetId, origemValor);
      })
      .catch((err) => {
        console.error("[vozupLeadIngest] Erro no pós-processamento:", err);
      });
  } else if (savedId) {
    syncToPipeline(savedId, origemValor).catch((err) => {
      console.error("[vozupLeadIngest] Erro ao sincronizar Pipeline:", err);
    });
  }

  if (savedId && options.notify) {
    sendWhatsApp(buildNotifyMessage(payload)).catch((err) => {
      console.error("[vozupLeadIngest] Erro ao enviar WhatsApp:", err);
    });
  }

  return savedId;
}
