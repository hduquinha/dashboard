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
  /** Uma linha por página sincronizada — mostra no log de onde vieram (ou não
   *  vieram) os leads. Página sem formulário aqui é o sintoma de token faltando. */
  pages: Array<{ pageId: string; pageName: string; forms: number; imported: number; skipped: number }>;
}

const LEAD_FIELDS =
  "id,created_time,form_id,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,platform";

/**
 * Tokens de página configurados. Aceita MAIS DE UM, separados por vírgula,
 * ponto e vírgula ou quebra de linha.
 *
 * Por que plural: um token de página só enxerga os formulários da própria
 * página — `me/leadgen_forms` devolve os dela e nada mais, e ler os de outra
 * página responde "(#10) User has insufficient privileges on the page". Quando
 * a operação anuncia por mais de uma página (é o caso aqui: os anúncios de
 * formulário nativo coletam pela página "VozUp", enquanto o token existente é
 * de outra página), um token só significa uma página inteira de leads que
 * nunca chega no CRM, em silêncio.
 */
export function getFacebookAccessTokens(): string[] {
  const raw = process.env.FACEBOOK_PAGE_ACCESS_TOKEN ?? "";
  const tokens = raw
    .split(/[,;\n]/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    throw new Error("FACEBOOK_PAGE_ACCESS_TOKEN não configurado");
  }
  return tokens;
}

/** Primeiro token — para as chamadas que não dependem de página (Insights). */
export function getFacebookAccessToken(): string {
  return getFacebookAccessTokens()[0];
}

export interface FacebookPageToken {
  token: string;
  pageId: string;
  pageName: string;
}

/**
 * Resolve qual página pertence a cada token. O resultado fica em cache no
 * processo porque isso não muda entre sincronizações (uma chamada por token a
 * cada ciclo seria desperdício).
 */
let pageTokensCache: { value: FacebookPageToken[]; expiresAt: number } | null = null;

export async function listFacebookPageTokens(): Promise<{
  pages: FacebookPageToken[];
  errors: Array<{ token: string; error: string }>;
}> {
  const now = Date.now();
  if (pageTokensCache && pageTokensCache.expiresAt > now) {
    return { pages: pageTokensCache.value, errors: [] };
  }

  const pages: FacebookPageToken[] = [];
  const errors: Array<{ token: string; error: string }> = [];

  for (const token of getFacebookAccessTokens()) {
    const apelido = `…${token.slice(-6)}`;
    try {
      // Token de usuário (ou de usuário de sistema) não lê formulário direto:
      // `/{page}/leadgen_forms` responde "(#190) This method must be called with
      // a Page Access Token". Mas ele CONHECE as páginas do negócio e entrega o
      // token de página de cada uma — é por aqui que um único token de sistema
      // cobre todas as páginas de uma vez.
      const contas = await fetchGraph<GraphList<{ id: string; name?: string; access_token?: string }>>(
        "me/accounts?fields=id,name,access_token&limit=100",
        token
      );

      const comToken = (contas.data ?? []).filter((conta) => conta.access_token);
      if (comToken.length > 0) {
        for (const conta of comToken) {
          pages.push({
            token: conta.access_token as string,
            pageId: conta.id,
            pageName: conta.name ?? conta.id,
          });
        }
        continue;
      }

      errors.push({ token: apelido, error: "token de usuário sem nenhuma página atribuída" });
      continue;
    } catch {
      // `me/accounts` não existe para token de página — segue como token de página.
    }

    try {
      const page = await fetchGraph<{ id: string; name?: string }>("me?fields=id,name", token);
      pages.push({ token, pageId: page.id, pageName: page.name ?? page.id });
    } catch (error) {
      // Token curto no log: identifica qual falhou sem vazar o segredo inteiro.
      errors.push({
        token: apelido,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (pages.length > 0) {
    pageTokensCache = { value: pages, expiresAt: now + 30 * 60_000 };
  }
  return { pages, errors };
}

async function fetchGraph<T>(path: string, accessToken = getFacebookAccessToken()): Promise<T> {
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

export async function fetchFacebookLeadDetails(
  leadgenId: string,
  pageId?: string
): Promise<FacebookLeadDetails> {
  const { pages } = await listFacebookPageTokens();
  // O lead só pode ser lido com o token da página que o coletou. Com o pageId
  // do webhook a escolha é direta; sem ele, tenta todos antes de desistir.
  const candidatos = pageId
    ? [...pages.filter((page) => page.pageId === pageId), ...pages.filter((page) => page.pageId !== pageId)]
    : pages;

  let ultimoErro: unknown = null;
  for (const page of candidatos) {
    try {
      return await fetchGraph<FacebookLeadDetails>(`${leadgenId}?fields=${LEAD_FIELDS}`, page.token);
    } catch (error) {
      ultimoErro = error;
    }
  }

  throw ultimoErro instanceof Error
    ? ultimoErro
    : new Error(`Nenhum token de página consegue ler o lead ${leadgenId}`);
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
  // A data do lead é a que a Meta informa, não a da importação — ver o
  // comentário de `createdAt` em ingestVozupLead.
  return ingestVozupLead(buildFacebookLeadPayload(lead, context), {
    notify: true,
    createdAt: lead.created_time ?? null,
  });
}

export async function syncRecentFacebookLeads(options: {
  leadLimit?: number;
  formLimit?: number;
} = {}): Promise<FacebookLeadSyncResult> {
  const leadLimit = Math.max(1, Math.min(options.leadLimit ?? 25, 100));
  const formLimit = Math.max(1, Math.min(options.formLimit ?? 50, 100));

  const result: FacebookLeadSyncResult = { imported: 0, skipped: 0, errors: [], pages: [] };
  const { pages, errors: tokenErrors } = await listFacebookPageTokens();

  for (const tokenError of tokenErrors) {
    result.errors.push({ leadgenId: `token ${tokenError.token}`, error: tokenError.error });
  }

  for (const page of pages) {
    const resumo = { pageId: page.pageId, pageName: page.pageName, forms: 0, imported: 0, skipped: 0 };
    result.pages.push(resumo);

    let forms: GraphList<FacebookLeadForm>;
    try {
      forms = await fetchGraph<GraphList<FacebookLeadForm>>(
        `${page.pageId}/leadgen_forms?fields=id,name,status,leads.limit(${leadLimit}){${LEAD_FIELDS}}&limit=${formLimit}`,
        page.token
      );
    } catch (error) {
      // Uma página com problema não pode derrubar a sincronização das outras.
      result.errors.push({
        leadgenId: `page ${page.pageId}`,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    for (const form of forms.data ?? []) {
      resumo.forms += 1;
      for (const lead of form.leads?.data ?? []) {
        if (!lead.id) continue;
        try {
          if (await alreadyIngestedFacebookLead(lead.id)) {
            resumo.skipped += 1;
            result.skipped += 1;
            continue;
          }
          const savedId = await ingestFacebookLead(lead, {
            formId: form.id,
            formName: form.name,
            pageId: page.pageId,
          });
          if (savedId) {
            resumo.imported += 1;
            result.imported += 1;
          } else {
            resumo.skipped += 1;
            result.skipped += 1;
          }
        } catch (error) {
          result.errors.push({
            leadgenId: lead.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }

  return result;
}
