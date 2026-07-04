import { createHmac, timingSafeEqual } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { ingestVozupLead } from "@/lib/vozupLeadIngest";

export const dynamic = "force-dynamic";

const GRAPH_API_VERSION = "v21.0";

type FacebookFieldData = { name: string; values?: string[] };
type FacebookLeadDetails = {
  id: string;
  form_id?: string;
  field_data?: FacebookFieldData[];
  ad_id?: string;
  ad_name?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  platform?: string;
};

function verifySignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const provided = signatureHeader.slice("sha256=".length);
  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(provided, "hex");
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

/**
 * Formularios de Lead Ads geram o "name" de cada campo a partir do texto da pergunta
 * configurada no anuncio (ex.: "nome_completo", "seu_melhor_telefone"), que varia por
 * formulario. Por isso o match exato roda primeiro e cai para "contains" como fallback.
 */
function fieldValue(fieldData: FacebookFieldData[], keys: string[]): string {
  for (const key of keys) {
    const match = fieldData.find((f) => f.name?.toLowerCase() === key);
    if (match?.values?.[0]) return match.values[0];
  }
  for (const key of keys) {
    const match = fieldData.find((f) => f.name?.toLowerCase().includes(key));
    if (match?.values?.[0]) return match.values[0];
  }
  return "";
}

const LEAD_FIELDS =
  "id,form_id,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,platform";

async function fetchLeadDetails(leadgenId: string, accessToken: string): Promise<FacebookLeadDetails> {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${leadgenId}?fields=${LEAD_FIELDS}&access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Graph API ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function alreadyIngested(leadgenId: string): Promise<boolean> {
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT 1 FROM inscricoes.inscricoes WHERE payload->>'facebook_lead_id' = $1 LIMIT 1",
    [leadgenId]
  );
  return rows.length > 0;
}

/**
 * Handshake de verificação exigido pelo Facebook ao registrar o webhook
 * (Meta App > Webhooks > Page > campo "leadgen").
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const expectedToken = process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN;
  if (mode === "subscribe" && expectedToken && token === expectedToken) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const appSecret = process.env.FACEBOOK_APP_SECRET;
  const signature = req.headers.get("x-hub-signature-256");

  if (appSecret && !verifySignature(rawBody, signature, appSecret)) {
    console.error("[facebook-webhook] Assinatura inválida.");
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let body: { entry?: Array<{ id?: string; changes?: Array<{ field?: string; value?: Record<string, unknown> }> }> };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const accessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!accessToken) {
    console.error("[facebook-webhook] FACEBOOK_PAGE_ACCESS_TOKEN não configurado — lead ignorado.");
    return NextResponse.json({ ok: true });
  }

  const entries = body.entry ?? [];
  for (const entry of entries) {
    const changes = entry.changes ?? [];
    for (const change of changes) {
      if (change.field !== "leadgen") continue;
      const value = change.value ?? {};
      const leadgenId = String(value.leadgen_id ?? "").trim();
      if (!leadgenId) continue;

      try {
        if (await alreadyIngested(leadgenId)) continue;

        const lead = await fetchLeadDetails(leadgenId, accessToken);
        const fieldData = lead.field_data ?? [];

        const nome = fieldValue(fieldData, ["full_name", "nome", "name"]);
        const telefone = fieldValue(fieldData, ["phone_number", "telefone", "whatsapp"]);
        const email = fieldValue(fieldData, ["email"]);
        const objetivo = fieldValue(fieldData, ["objetivo", "interesse_workshop", "qual_seu_objetivo"]);

        const payload: Record<string, unknown> = {
          nome,
          telefone,
          email: email || undefined,
          objetivo,
          unidade_negocio: "Voz UP",
          origem: "Facebook Lead Ads",
          treinamento_nome: "Facebook Lead Ads",
          // Chaves reconhecidas por CAMPAIGN_*_EXPRESSION (lib/db.ts) para atribuicao/filtro
          // por criativo no CRM (filtro "Criativo" na tela /crm).
          ad_id: lead.ad_id ?? value.ad_id,
          ad_name: lead.ad_name,
          adset_id: lead.adset_id,
          adset_name: lead.adset_name,
          campaign_id: lead.campaign_id,
          campaign_name: lead.campaign_name,
          facebook_lead_id: leadgenId,
          facebook_form_id: lead.form_id ?? value.form_id,
          facebook_page_id: value.page_id ?? entry.id,
          facebook_platform: lead.platform,
          facebook_field_data: fieldData,
          _final: "true",
          aguarda_distribuicao: "true",
        };

        await ingestVozupLead(payload, { notify: true });
      } catch (err) {
        console.error("[facebook-webhook] Erro ao processar leadgen_id", leadgenId, err);
      }
    }
  }

  return NextResponse.json({ ok: true });
}
