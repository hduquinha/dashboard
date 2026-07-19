import type { FormFieldValue, UpDayFormData } from "@/lib/inscricaoForm";

export interface InscricaoPayload {
  nome?: string;
  telefone?: string;
  cidade?: string;
  estado?: string;
  email?: string;
  data_nascimento?: string;
  empresa?: string;
  cargo?: string;
  origem?: string;
  unidade_negocio?: string;
  lead_setor?: string;
  lead_origem?: string;
  lead_produto?: string;
  lead_entrada?: string;
  entrada_sinal?: string;
  produto_interesse?: string;
  origem_formulario?: string;
  origemFormulario?: string;
  campaign_source?: string;
  campaignSource?: string;
  campaign_name?: string;
  campaignName?: string;
  campaign_id?: string | number;
  campaignId?: string | number;
  campaign_medium?: string;
  campaignMedium?: string;
  campaign_term?: string;
  campaignTerm?: string;
  utm_source?: string;
  utmSource?: string;
  utm_campaign?: string;
  utmCampaign?: string;
  utm_id?: string;
  utmId?: string;
  utm_medium?: string;
  utmMedium?: string;
  utm_term?: string;
  utmTerm?: string;
  lead_source?: string;
  leadSource?: string;
  platform?: string;
  plataforma?: string;
  publisher_platform?: string;
  publisherPlatform?: string;
  channel?: string;
  canal?: string;
  form_id?: string | number;
  formId?: string | number;
  form_name?: string;
  formName?: string;
  adset_id?: string | number;
  adsetId?: string | number;
  adset_name?: string;
  adsetName?: string;
  ad_id?: string | number;
  adId?: string | number;
  ad_name?: string;
  adName?: string;
  gclid?: string;
  fbclid?: string;
  landing_page?: string;
  landingPage?: string;
  page_url?: string;
  pageUrl?: string;
  form_url?: string;
  formUrl?: string;
  referrer?: string;
  referer?: string;
  source?: string;
  timestamp?: string;
  traffic_source?: string;
  trafficSource?: string;
  profissao?: string;
  treinamento?: string;
  tipo?: string;
  codigoRecrutador?: string;
  recrutadorId?: string | number;
  parentId?: string | number;
  indicadorId?: string | number;
  sponsorId?: string | number;
  nivel?: string | number;
  isRecruiter?: string | boolean;
  [key: string]: unknown;
}

export interface PresencaDia {
  participanteNome?: string | null;
  aprovado?: boolean;
  tempoTotal?: number | null;
  tempoDinamica?: number | null;
  percentualDinamica?: number | null;
  temDinamica?: boolean;
}

export type InscricaoTipo = "lead" | "recrutador";

export type InscricaoStatus = "aguardando" | "aprovado" | "rejeitado";

/** Chave de etapa comercial: livre por funil (ver lib/funnels.ts), não é mais um union fixo. */
export type CommercialStage = string;

export type CommercialStageKind = "entry" | "normal" | "won" | "lost";

export interface CommercialLeadState {
  campaignSource: string | null;
  campaignName: string | null;
  campaignMedium: string | null;
  campaignTerm: string | null;
  landingPage: string | null;
  stage: CommercialStage;
  stageKind: CommercialStageKind;
  /** Tentativas de contato registradas pelo vendedor (0-10), editavel direto no card do Kanban. */
  contactAttempts: number;
  funnelId: number | null;
  position: number | null;
  assignedSellerId: number | null;
  assignedSellerEmail: string | null;
  assignedSellerName: string | null;
  assignedAt: string | null;
}

export interface InscricaoNote {
  id: string;
  content: string;
  createdAt: string;
  author?: string | null;
  viaWhatsapp?: boolean | null;
}

export interface EnrollmentSummary {
  id: number;
  treinamentoId: string | null;
  treinamentoNome: string | null;
  treinamentoData: string | null;
  presencaValidada: boolean;
  presencaAprovada: boolean;
  criadoEm: string;
  payload?: Record<string, unknown> | null;
}

export interface InscricaoItem {
  id: number;
  criadoEm: string;
  payload: Record<string, unknown>;
  parsedPayload: InscricaoPayload;
  upDay: UpDayFormData;
  isUpDayInscricao: boolean;
  previousFormFields: FormFieldValue[];
  nome: string | null;
  telefone: string | null;
  cidade: string | null;
  profissao: string | null;
  recrutadorCodigo: string | null;
  recrutadorNome: string | null;
  recrutadorUrl: string | null;
  treinamentoId: string | null;
  treinamentoNome: string | null;
  treinamentoData: string | null;
  tipo?: InscricaoTipo;
  codigoProprio?: string | null;
  parentInscricaoId?: number | null;
  nivel?: number | null;
  isVirtual?: boolean;
  status?: InscricaoStatus;
  statusUpdatedAt?: string | null;
  statusWhatsappContacted?: boolean | null;
  notes?: InscricaoNote[];
  // Campos de presença (agregado)
  presencaValidada?: boolean;
  presencaAprovada?: boolean;
  presencaParticipanteNome?: string | null;
  presencaTempoTotalMinutos?: number | null;
  presencaTempoDinamicaMinutos?: number | null;
  presencaPercentualDinamica?: number | null;
  presencaValidadaEm?: string | null;
  presencaTotalDias?: number | null;
  presencaDiaProcessado?: number | null;
  presencaDinamicaDias?: string | null;
  // Campos de presença por dia
  presencaDia1?: PresencaDia | null;
  presencaDia2?: PresencaDia | null;
  // Star rating (1-5 lead temperature)
  stars?: number | null;
  commercial?: CommercialLeadState;
  // Chave interna de identidade da pessoa (usada para agregar enrollments)
  personKey?: string | null;
  // Todos os eventos/treinamentos vinculados a esta pessoa
  allEnrollments?: EnrollmentSummary[] | null;
}

export interface ListInscricoesResult {
  data: InscricaoItem[];
  page: number;
  pageSize: number;
  total: number;
}

export type OrderableField =
  | "id"
  | "nome"
  | "telefone"
  | "cidade"
  | "profissao"
  | "treinamento"
  | "recrutador"
  | "criado_em"
  | "status_at"
  | "stars"
  | "commercial_stage"
  | "commercial_position";

export type OrderDirection = "asc" | "desc";

export type DuplicateReason =
  | "telefone"
  | "email"
  | "nome-dia"
  | "payload"
  | "fantasma"
  | "nome-suspeito"
  | "telefone-invalido"
  | "email-suspeito"
  | "dados-incompletos"
  | "payload-teste"
  | "treinamento-ausente";

export interface DuplicateReasonDetail {
  reason: DuplicateReason;
  matchValue: string;
  hint?: string | null;
}

export interface DuplicateGroup {
  id: string;
  entries: InscricaoItem[];
  reasons: DuplicateReasonDetail[];
  score: number;
  latestCreatedAt: string;
}

export interface DuplicateSummary {
  groups: DuplicateGroup[];
  totalGroups: number;
}
