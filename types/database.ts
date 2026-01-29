/**
 * Tipos para a estrutura normalizada do banco de dados
 * 
 * PRINCÍPIO: Uma pessoa existe UMA vez. Todas as outras
 * tabelas referenciam ela por ID.
 */

// ============================================
// PESSOA - Entidade principal
// ============================================
export interface Pessoa {
  id: number;
  nome: string;
  telefone: string | null;
  email: string | null;
  cidade: string | null;
  estado: string | null;
  profissao: string | null;
  origem: string | null;
  telefoneNormalizado: string | null;
  emailNormalizado: string | null;
  criadoEm: string;
  atualizadoEm: string;
}

/**
 * Pessoa com todos os dados relacionados
 * (usado na view pessoa_completa)
 */
export interface PessoaCompleta extends Pessoa {
  // Status de recrutador
  isRecrutador: boolean;
  recrutadorCodigo: string | null;
  recrutadorNivel: number | null;
  
  // Contadores
  totalInscricoes: number;
  totalPresencasAprovadas: number;
  
  // Último treinamento
  ultimoTreinamento: string | null;
  
  // Quem indicou
  indicadoPor: string | null;
}

// ============================================
// TREINAMENTO
// ============================================
export interface Treinamento {
  id: number;
  codigo: string;
  nome: string;
  descricao: string | null;
  dataInicio: string | null;
  dataFim: string | null;
  ativo: boolean;
  criadoEm: string;
  atualizadoEm: string;
}

export interface TreinamentoComEstatisticas extends Treinamento {
  totalInscritos: number;
  totalLeads: number;
  totalRecrutadores: number;
  totalPresencasAprovadas: number;
  ultimasInscricoes24h: number;
}

// ============================================
// RECRUTADOR
// ============================================
export interface Recrutador {
  id: number;
  pessoaId: number;
  codigo: string;
  recrutadorPaiId: number | null;
  nivel: number;
  ativo: boolean;
  criadoEm: string;
  atualizadoEm: string;
}

/**
 * Recrutador com dados da pessoa
 */
export interface RecrutadorCompleto extends Recrutador {
  pessoa: Pessoa;
  recrutadorPai: Recrutador | null;
  totalIndicados: number;
}

// ============================================
// INSCRIÇÃO
// ============================================
export type InscricaoStatusV2 = "aguardando" | "aprovado" | "rejeitado" | "cancelado";

export interface InscricaoNota {
  id: string;
  content: string;
  createdAt: string;
  author?: string | null;
  viaWhatsapp?: boolean | null;
}

export interface InscricaoV2 {
  id: number;
  pessoaId: number;
  treinamentoId: number;
  recrutadorId: number | null;
  status: InscricaoStatusV2;
  statusAtualizadoEm: string | null;
  statusWhatsappContatado: boolean;
  notas: InscricaoNota[];
  dadosExtras: Record<string, unknown>;
  criadoEm: string;
  atualizadoEm: string;
}

/**
 * Inscrição com dados relacionados
 */
export interface InscricaoCompletaV2 extends InscricaoV2 {
  pessoa: Pessoa;
  treinamento: Treinamento;
  recrutador: RecrutadorCompleto | null;
  presenca: PresencaV2 | null;
}

// ============================================
// PRESENÇA
// ============================================
export type AssociacaoStatusV2 = 
  | "auto-matched"
  | "suggested"
  | "manual-pending"
  | "confirmed"
  | "rejected";

export interface PresencaV2 {
  id: number;
  pessoaId: number;
  treinamentoId: number;
  nomeZoom: string | null;
  emailZoom: string | null;
  tempoTotalMinutos: number;
  tempoDinamicaMinutos: number;
  percentualDinamica: number;
  aprovado: boolean;
  cumpriuTempoMinimo: boolean;
  cumpriuDinamica: boolean;
  tempoMinimoExigido: number | null;
  percentualMinimoExigido: number | null;
  associacaoStatus: AssociacaoStatusV2;
  associacaoScore: number;
  validadoEm: string;
  validadoPor: string | null;
  criadoEm: string;
}

/**
 * Presença com dados relacionados
 */
export interface PresencaCompletaV2 extends PresencaV2 {
  pessoa: Pessoa;
  treinamento: Treinamento;
}

// ============================================
// ANAMNESE
// ============================================
export interface Anamnese {
  id: number;
  pessoaId: number;
  treinamentoId: number | null;
  respostas: Record<string, unknown>;
  linkHash: string | null;
  respondidoEm: string | null;
  criadoEm: string;
  atualizadoEm: string;
}

export interface AnamneseCompleta extends Anamnese {
  pessoa: Pessoa;
  treinamento: Treinamento | null;
}

// ============================================
// FILTROS E LISTAGEM
// ============================================
export interface FiltrosPessoas {
  nome?: string;
  telefone?: string;
  email?: string;
  cidade?: string;
  isRecrutador?: boolean;
  treinamentoId?: number;
  comPresencaAprovada?: boolean;
}

export interface FiltrosInscricoes {
  treinamentoId?: number;
  pessoaId?: number;
  recrutadorId?: number;
  status?: InscricaoStatusV2;
}

export interface FiltrosPresencas {
  treinamentoId?: number;
  pessoaId?: number;
  aprovado?: boolean;
  associacaoStatus?: AssociacaoStatusV2;
}

export interface PaginacaoOpcoes {
  page?: number;
  pageSize?: number;
  orderBy?: string;
  orderDirection?: "asc" | "desc";
}

export interface ResultadoPaginado<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
