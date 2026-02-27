export interface InscricaoPayload {
  nome?: string;
  telefone?: string;
  cidade?: string;
  estado?: string;
  email?: string;
  origem?: string;
  timestamp?: string;
  traffic_source?: string;
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

export type InscricaoTipo = "lead" | "recrutador";

export type InscricaoStatus = "aguardando" | "aprovado" | "rejeitado";

export interface InscricaoNote {
  id: string;
  content: string;
  createdAt: string;
  author?: string | null;
  viaWhatsapp?: boolean | null;
}

export interface InscricaoItem {
  id: number;
  criadoEm: string;
  payload: Record<string, unknown>;
  parsedPayload: InscricaoPayload;
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
  // Campos de presença
  presencaValidada?: boolean;
  presencaAprovada?: boolean;
  presencaParticipanteNome?: string | null;
  presencaTempoTotalMinutos?: number | null;
  presencaTempoDinamicaMinutos?: number | null;
  presencaPercentualDinamica?: number | null;
  presencaValidadaEm?: string | null;
  // Star rating (1-5 lead temperature)
  stars?: number | null;
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
  | "criado_em";

export type OrderDirection = "asc" | "desc";

export type DuplicateReason = "telefone" | "email" | "nome-dia" | "payload";

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
