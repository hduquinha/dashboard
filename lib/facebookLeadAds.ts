import { getPool } from "@/lib/db";
import { ingestVozupLead } from "@/lib/vozupLeadIngest";

const GRAPH_API_VERSION = "v21.0";

export type FacebookFieldData = { name: string; values?: string[] };

export type FacebookLeadDetails = {
  id: string;
  created_time?: string;
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

type FacebookLeadForm = {
  id: string;
  name?: string;
  status?: string;
  leads?: {
    data?: FacebookLeadDetails[];
  };
};

type GraphList<T> = {
  data?: T[];
};

export interface FacebookLeadSyncResult {
  imported: number;
  skipped: number;
  errors: Array<{ leadgenId: string; error: string }>;
}

const LEAD_FIELDS =
  "id,created_time,form_id,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,platform";

function getAccessToken(): string {
  const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN?.trim();
  if (!token) {
    throw new Error("FACEBOOK_PAGE_ACCESS_TOKEN não configurado");
  }
  return token;
}

async function fetchGraph<T>(path: string, accessToken = getAccessToken()): Promise<T> {
  const separator = path.includes("?") ? "&" : "?";
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${path}${separator}access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Graph API ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Formularios de Lead Ads geram o "name" de cada campo a partir do texto da
 * pergunta configurada no anuncio. O match exato roda primeiro e cai para
 * "contains" como fallback para perguntas em português.
 */
function fieldValue(fieldData: FacebookFieldData[], keys: string[]): string {
  const normalized = fieldData.map((field) => ({
    field,
    name: field.name?.toLowerCase() ?? "",
  }));

  for (const key of keys) {
    const match = normalized.find((item) => item.name === key);
    if (match?.field.values?.[0]) return match.field.values[0];
  }
  for (const key of keys) {
    const match = normalized.find((item) => item.name.includes(key));
    if (match?.field.values?.[0]) return match.field.values[0];
  }
  return "";
}

export async function fetchFacebookLeadDetails(leadgenId: string): Promise<FacebookLeadDetails> {
  return fetchGraph<FacebookLeadDetails>(`${leadgenId}?fields=${LEAD_FIELDS}`);
}

export async function alreadyIngestedFacebookLead(leadgenId: string): Promise<boolean> {
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT 1 FROM inscricoes.inscricoes WHERE payload->>'facebook_lead_id' = $1 LIMIT 1",
    [leadgenId]
  );
  return rows.length > 0;
}

export function buildFacebookLeadPayload(
  lead: FacebookLeadDetails,
  context: { formId?: string; formName?: string; pageId?: string } = {}
): Record<string, unknown> {
  const fieldData = lead.field_data ?? [];

  const nome = fieldValue(fieldData, ["full_name", "nome_completo", "nome", "name"]);
  const telefone = fieldValue(fieldData, ["phone_number", "telefone", "celular", "whatsapp"]);
  const email = fieldValue(fieldData, ["email", "e-mail"]);
  const objetivo = fieldValue(fieldData, [
    "objetivo",
    "interesse_workshop",
    "qual_seu_objetivo",
    "por_que",
    "interessou",
    "comunicação",
    "oratoria",
    "oratória",
  ]);

  return {
    nome,
    telefone,
    email: email || undefined,
    objetivo,
    unidade_negocio: "Voz UP",
    origem: "Facebook Lead Ads",
    treinamento_nome: "Facebook Lead Ads",
    form_name: context.formName,
    ad_id: lead.ad_id,
    ad_name: lead.ad_name,
    adset_id: lead.adset_id,
    adset_name: lead.adset_name,
    campaign_id: lead.campaign_id,
    campaign_name: lead.campaign_name,
    facebook_lead_id: lead.id,
    facebook_form_id: lead.form_id ?? context.formId,
    facebook_form_name: context.formName,
    facebook_page_id: context.pageId,
    facebook_platform: lead.platform,
    facebook_created_time: lead.created_time,
    facebook_field_data: fieldData,
    _final: "true",
    aguarda_distribuicao: "true",
  };
}

export async function ingestFacebookLead(
  lead: FacebookLeadDetails,
  context: { formId?: string; formName?: string; pageId?: string } = {}
): Promise<number | null> {
  if (await alreadyIngestedFacebookLead(lead.id)) {
    return null;
  }
  return ingestVozupLead(buildFacebookLeadPayload(lead, context), { notify: true });
}

export async function syncRecentFacebookLeads(options: {
  leadLimit?: number;
  formLimit?: number;
} = {}): Promise<FacebookLeadSyncResult> {
  const leadLimit = Math.max(1, Math.min(options.leadLimit ?? 25, 100));
  const formLimit = Math.max(1, Math.min(options.formLimit ?? 50, 100));
  const page = await fetchGraph<{ id: string; name?: string }>("me?fields=id,name");
  const forms = await fetchGraph<GraphList<FacebookLeadForm>>(
    `${page.id}/leadgen_forms?fields=id,name,status,leads.limit(${leadLimit}){${LEAD_FIELDS}}&limit=${formLimit}`
  );

  const result: FacebookLeadSyncResult = { imported: 0, skipped: 0, errors: [] };

  for (const form of forms.data ?? []) {
    for (const lead of form.leads?.data ?? []) {
      if (!lead.id) continue;
      try {
        if (await alreadyIngestedFacebookLead(lead.id)) {
          result.skipped += 1;
          continue;
        }
        const savedId = await ingestFacebookLead(lead, {
          formId: form.id,
          formName: form.name,
          pageId: page.id,
        });
        if (savedId) result.imported += 1;
        else result.skipped += 1;
      } catch (error) {
        result.errors.push({
          leadgenId: lead.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return result;
}
