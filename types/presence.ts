/**
 * Tipos para validação de presença em encontros do Zoom
 */

/**
 * Registro bruto do CSV do Zoom
 */
export interface ZoomParticipantRaw {
  nome: string;
  email: string | null;
  entradaHora: Date;
  saidaHora: Date;
  duracaoMinutos: number;
  convidado: boolean;
  salaEspera: boolean;
}

/**
 * Participante consolidado (múltiplas entradas agrupadas)
 */
export interface ZoomParticipantConsolidated {
  nomeOriginal: string;
  nomeNormalizado: string;
  email: string | null;
  entradas: Array<{
    entrada: Date;
    saida: Date;
    duracaoMinutos: number;
  }>;
  duracaoTotalMinutos: number;
  primeiraEntrada: Date;
  ultimaSaida: Date;
}

/**
 * Resultado da análise de presença de um participante
 */
export interface PresenceAnalysis {
  participante: ZoomParticipantConsolidated;
  tempoTotalMinutos: number;
  tempoDinamicaMinutos: number;
  percentualDinamica: number;
  cumpriuTempoMinimo: boolean;
  cumpriuDinamica: boolean;
  aprovado: boolean;
}

/**
 * Configuração para análise de presença
 */
export interface PresenceConfig {
  treinamentoId: string;
  inicioLive: Date;
  fimLive: Date;
  inicioDinamica: Date;
  fimDinamica: Date;
  tempoMinimoMinutos: number;
  percentualMinimoDinamica: number;
}

/**
 * Status de associação com inscrição
 */
export type AssociationStatus = 
  | "auto-matched"      // Match automático com alta confiança
  | "suggested"         // Sugestão de match (precisa confirmação)
  | "manual-pending"    // Sem match, aguardando associação manual
  | "confirmed"         // Confirmado por humano
  | "rejected"          // Rejeitado por humano
  | "not-found"         // Não foi possível encontrar a inscrição
  | "doubt";            // Dúvida de inscrição (pode ter 2 candidatas)

/**
 * Associação entre participante e inscrição
 */
export interface PresenceAssociation {
  participanteNome: string;
  participanteEmail: string | null;
  analise: PresenceAnalysis;
  inscricaoId: number | null;
  inscricaoNome: string | null;
  inscricaoTelefone: string | null;
  status: AssociationStatus;
  matchScore: number; // 0-100, confiança do match
  matchReason: string | null;
}

/**
 * Inscrição simplificada para seleção manual
 */
export interface InscricaoSimplificada {
  id: number;
  nome: string;
  telefone: string | null;
  cidade: string | null;
  recrutadorCodigo: string | null;
}

/**
 * Resultado completo da validação de presença
 */
export interface PresenceValidationResult {
  config: PresenceConfig;
  totalParticipantesCSV: number;
  totalConsolidados: number;
  aprovados: PresenceAssociation[];
  reprovados: PresenceAssociation[];
  inscricoesDisponiveis: InscricaoSimplificada[];
  resumo: {
    totalAprovados: number;
    totalReprovados: number;
    autoMatched: number;
    sugeridos: number;
    pendentesManual: number;
  };
}

/**
 * Estado do formulário de validação
 */
export interface PresenceFormState {
  status: "idle" | "processing" | "success" | "error";
  message: string | null;
  result: PresenceValidationResult | null;
  filename: string | null;
}
