import { effectiveLeadOrigin } from "@/lib/leadOriginPriority";
import { TRAINING_FIELD_KEYS } from "@/lib/parsePayload";
import { UP_DAY_FIELD_KEYS } from "@/lib/inscricaoForm";

export type LeadFieldCategory = "pessoal" | "endereco" | "profissional" | "origem";

export interface LeadFieldDef {
  key: string;
  label: string;
  category: LeadFieldCategory;
  /** Aparece nos seletores de "adicionar campo" / criar lead. Campos de origem
   *  costumam vir automaticamente do formulário, então não entram por padrão. */
  addable?: boolean;
}

export const LEAD_FIELD_CATEGORY_LABELS: Record<LeadFieldCategory, string> = {
  pessoal: "Pessoal",
  endereco: "Endereço",
  profissional: "Profissional",
  origem: "Origem",
};

export const LEAD_FIELD_CATALOG: LeadFieldDef[] = [
  // Pessoal
  { key: "nome", label: "Nome", category: "pessoal" },
  { key: "sobrenome", label: "Sobrenome", category: "pessoal" },
  { key: "email", label: "E-mail", category: "pessoal" },
  { key: "telefone", label: "Telefone / WhatsApp", category: "pessoal" },
  { key: "data_nascimento", label: "Data de nascimento", category: "pessoal" },
  // Endereço
  { key: "endereco", label: "Endereço", category: "endereco" },
  { key: "cidade", label: "Cidade", category: "endereco" },
  { key: "estado", label: "Estado", category: "endereco" },
  { key: "cep", label: "CEP", category: "endereco" },
  { key: "pais", label: "País", category: "endereco" },
  // Profissional
  { key: "profissao", label: "Profissão", category: "profissional" },
  { key: "cargo", label: "Cargo", category: "profissional" },
  { key: "empresa", label: "Empresa", category: "profissional" },
  { key: "setor_profissional", label: "Setor (empresa)", category: "profissional" },
  // Origem — normalmente preenchido automaticamente pelo formulário de origem.
  { key: "origem", label: "Origem", category: "origem" },
  // Identifica a aula/turma VozUP do lead — preenchido pelo seletor de aula do
  // cadastro manual, não digitado livremente (por isso addable: false).
  { key: "data_treinamento", label: "Data do treinamento", category: "origem", addable: false },
  { key: "traffic_source", label: "Indicador / canal", category: "origem" },
  { key: "campaign_source", label: "Fonte (campanha)", category: "origem", addable: false },
  { key: "campaign_name", label: "Campanha", category: "origem", addable: false },
  { key: "utm_source", label: "Fonte (UTM)", category: "origem", addable: false },
  { key: "utm_campaign", label: "Campanha (UTM)", category: "origem", addable: false },
];

/**
 * Mapa completo de labels — inclui o catálogo acima mais os aliases usados
 * historicamente pelos formulários (name/phone/city em inglês, variantes
 * camelCase etc). Fonte única de verdade para exibir qualquer chave de payload
 * de forma legível (substitui os FIELD_LABELS antes duplicados em
 * LeadEditForm.tsx e FormHistoryView.tsx).
 */
export const LEAD_FIELD_LABELS: Record<string, string> = {
  ...Object.fromEntries(LEAD_FIELD_CATALOG.map((f) => [f.key, f.label])),
  name: "Nome",
  phone: "Telefone",
  celular: "Celular",
  whatsapp: "WhatsApp",
  city: "Cidade",
  profissao_area: "Área de atuação",
  profissaoArea: "Área de atuação",
  ocupacao: "Ocupação",
  occupation: "Ocupação",
  objetivo: "Objetivo",
  quer_resultado_rapido: "Quer resultado rápido",
  landing_page_grupo: "Página (tema)",
  maior_dor_comunicacao: "Maior dor em comunicação",
  maior_desafio_comunicacao: "Maior desafio em comunicação",
  interesse_workshop: "Interesse no workshop",
  interesse: "Interesse",
  treinamento: "Treinamento",
  treinamento_nome: "Treinamento",
  treinamentoNome: "Treinamento",
  data_treinamento: "Data do treinamento",
  dataTreinamento: "Data do treinamento",
  training_date: "Data do treinamento",
  unidade_negocio: "Produto",
  lead_setor: "Departamento",
  lead_produto: "Produto",
  produto_interesse: "Produto de interesse",
  lead_origem: "Origem do lead",
  campaignSource: "Fonte",
  campaignName: "Campanha",
  codigo_indicador: "Cód. indicador",
  indicador: "Indicador",
  tamanho_camiseta: "Camiseta",
  tamanhoCamiseta: "Camiseta",
  cpf: "CPF",
  documento: "Documento",
  timestamp: "Data de envio",
  landing_page: "Página de origem",
  landingPage: "Página de origem",
  como_conheceu: "Como conheceu",
  indicacao_nome: "Indicado por",
};

export function leadFieldLabel(key: string): string {
  return LEAD_FIELD_LABELS[key] ?? key.replace(/_/g, " ").replace(/([A-Z])/g, " $1").trim();
}

/**
 * Campos que fazem parte do payload do formulário mas são metadados técnicos
 * (rastreamento de anúncio/campanha, IDs internos do Facebook, valor fixo de
 * unidade de negócio) — não são relevantes pra quem olha a ficha do lead, então
 * saem do bloco "Informações Padrão do Lead" e vão pra uma seção própria no
 * final da visualização ("Dados técnicos do formulário").
 */
export const FORM_TRACKING_KEYS = new Set<string>([
  "ad_id", "adId",
  "ad_name", "adName",
  "adset_id", "adsetId",
  "adset_name", "adsetName",
  "campaign_id", "campaignId",
  "objetivo",
  "unidade_negocio", "unidadeNegocio",
  "facebook_form_id", "facebookFormId",
  "facebook_lead_id", "facebookLeadId",
  "facebook_page_id", "facebookPageId",
  "facebook_platform", "facebookPlatform",
  "facebook_created_time", "facebookCreatedTime",
  "aguarda_distribuicao", "aguardaDistribuicao",
  // UTM/click-id capturados no clique do anúncio (landingpage-vozup/src/lib/trafficSource.ts)
  // que não viram os campos padronizados de origem (esses ficam em describeLeadSource/STANDARD_PAYLOAD_KEYS).
  "utm_medium", "utmMedium",
  "utm_content", "utmContent",
  "utm_term", "utmTerm",
  "gclid", "fbclid",
]);

export function addableLeadFields(): LeadFieldDef[] {
  return LEAD_FIELD_CATALOG.filter((f) => f.addable !== false);
}

/** Chaves conhecidas de "nome do formulário" usadas por diferentes origens (landing pages, Facebook/Google Lead Ads). */
export const FORM_NAME_KEYS = [
  "form_name",
  "formName",
  "lead_form_name",
  "leadFormName",
  "facebook_form_name",
  "google_form_name",
  "nome_formulario",
  "nomeFormulario",
];

/** Chaves conhecidas de "página/URL de origem" usadas por diferentes origens. */
export const LANDING_PAGE_KEYS = [
  "landing_page",
  "landingPage",
  "landing",
  "page_url",
  "pageUrl",
  "form_url",
  "formUrl",
  "referrer",
  "referer",
  "url",
];

function firstString(payload: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export interface LeadSourceInfo {
  /** Origem que vale para a tela. Com mais de um vínculo, é a de maior
   * prioridade (Meta > Google Ads > Landing Page > formulário de produto) —
   * ver lib/leadOriginPriority.ts. */
  origem: string | null;
  /** Formulário que a pessoa preencheu neste cadastro. Só difere de `origem`
   * quando a prioridade de canal trocou a origem. */
  origemFormulario: string | null;
  /** A prioridade de canal trocou a origem deste lead. */
  origemPorPrioridade: boolean;
  fonte: string | null;
  campanha: string | null;
  indicador: string | null;
  /** Página/URL real de origem, quando o formulário enviou alguma (nem toda origem tem). */
  paginaOrigem: string | null;
  /** Nome do formulário de origem, quando disponível (ex.: Facebook/Google Lead Ads). */
  formName: string | null;
  comoConheceu: string | null;
  /** Origens acumuladas de leads mesclados por telefone (dashboard_origens_adicionais). */
  extras: string[];
}

/**
 * Resume "de onde o lead veio" a partir dos campos já capturados no payload — sem coletar dado novo.
 * A "data/hora de conversão" não vem daqui: use `criadoEm` do registro (já confiável e sempre presente).
 */
export function describeLeadSource(payload: Record<string, unknown> | null | undefined): LeadSourceInfo {
  const p = payload ?? {};
  const extrasRaw = p.dashboard_origens_adicionais;
  const extras = Array.isArray(extrasRaw)
    ? extrasRaw.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    : [];

  const efetiva = effectiveLeadOrigin(p);

  return {
    origem: efetiva.origem ?? firstString(p, "origem", "lead_origem"),
    origemFormulario: efetiva.formOrigem ?? firstString(p, "origem", "lead_origem"),
    origemPorPrioridade: efetiva.overridden,
    fonte: firstString(p, "campaign_source", "campaignSource", "utm_source", "utmSource"),
    campanha: firstString(p, "campaign_name", "campaignName", "utm_campaign", "utmCampaign"),
    indicador: firstString(p, "traffic_source", "indicador", "codigo_indicador"),
    paginaOrigem: firstString(p, ...LANDING_PAGE_KEYS),
    formName: firstString(p, ...FORM_NAME_KEYS),
    comoConheceu: firstString(p, "como_conheceu"),
    extras,
  };
}

/**
 * Um lead é de tráfego pago Meta/Google quando a origem casa com a mesma
 * regra usada para classificar as pastas "Meta" e "Google Ads" em
 * `vozupFolders.ts` (ORIGEM_NORM = 'facebook lead ads' OR LIKE 'meta%'/'%google ads%').
 * Mantida em sincronia manualmente por não ser viável compartilhar SQL com TS aqui.
 */
export function isMetaOuGoogleAdsOrigem(origem: string | null | undefined): boolean {
  const normalized = (origem ?? "").trim().toLowerCase();
  if (!normalized) return false;
  return normalized === "facebook lead ads" || normalized.startsWith("meta") || normalized.includes("google ads");
}

/**
 * Todas as chaves de payload já exibidas nos blocos fixos da ficha do lead
 * (Informações Padrão, Origem do Lead, Treinamento, Indicador/rede) — usado
 * para que "Respostas do Formulário" nunca repita um campo que já apareceu
 * em outro lugar. Fonte única: se um alias novo for adicionado em
 * `parsePayload.ts`/`describeLeadSource`, ele deve entrar aqui também.
 */
export const STANDARD_PAYLOAD_KEYS = new Set<string>([
  // Informações Padrão do Lead
  "nome", "name",
  "email", "e_mail",
  "telefone", "phone", "celular", "whatsapp",
  ...UP_DAY_FIELD_KEYS.dataNascimento,
  "cidade", "city",
  "estado", "state",
  "empresa", "company",
  "cargo", "job_title", "position",
  "profissao", "occupation", "job", "profissao_area", "profissaoArea",
  // Origem do Lead
  "origem", "lead_origem", "source", "origem_lead",
  "campaign_source", "campaignSource", "utm_source", "utmSource",
  "campaign_name", "campaignName", "utm_campaign", "utmCampaign",
  "traffic_source", "trafficSource", "indicador", "codigo_indicador",
  "como_conheceu",
  ...FORM_NAME_KEYS,
  ...LANDING_PAGE_KEYS,
  // Treinamento (já mostrado na seção "Treinamento")
  ...TRAINING_FIELD_KEYS,
  "treinamento",
  // Indicador/rede (já mostrado na seção "Treinamento"/Cluster)
  "codigoRecrutador", "codigo_recrutador", "tipo", "type",
  "parentId", "sponsorId", "indicadorId", "recrutadorId",
  "nivel", "level", "hierarchy_level", "isRecruiter",
]);
