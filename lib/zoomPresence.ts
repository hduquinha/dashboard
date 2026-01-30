/**
 * Biblioteca para processamento de relatórios de presença do Zoom
 */

import type {
  ZoomParticipantRaw,
  ZoomParticipantConsolidated,
  PresenceAnalysis,
  PresenceConfig,
  PresenceAssociation,
  PresenceValidationResult,
  AssociationStatus,
} from "@/types/presence";
import type { InscricaoItem } from "@/types/inscricao";

/**
 * Normaliza nome para comparação
 */
export function normalizeNameForMatch(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove acentos
    .replace(/[^a-z0-9\s]/g, "") // Remove caracteres especiais
    .replace(/\s+/g, " ") // Normaliza espaços
    .trim();
}

/**
 * Extrai primeiro e último nome
 */
export function extractNameParts(name: string): { first: string; last: string; full: string } {
  const normalized = normalizeNameForMatch(name);
  const parts = normalized.split(" ").filter(Boolean);
  return {
    first: parts[0] || "",
    last: parts[parts.length - 1] || "",
    full: normalized,
  };
}

/**
 * Parse da data/hora do formato do Zoom brasileiro
 * Formato: "07/01/2026 06:16:46 PM"
 */
export function parseZoomDateTime(dateStr: string): Date | null {
  if (!dateStr || typeof dateStr !== "string") {
    return null;
  }

  const trimmed = dateStr.trim();
  
  // Formato: DD/MM/YYYY HH:MM:SS AM/PM
  const regex = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s+(AM|PM)$/i;
  const match = trimmed.match(regex);
  
  if (!match) {
    // Tenta parse direto
    const direct = new Date(trimmed);
    return isNaN(direct.getTime()) ? null : direct;
  }

  const [, day, month, year, hourStr, minute, second, period] = match;
  let hour = parseInt(hourStr, 10);
  
  // Converte para 24h
  if (period.toUpperCase() === "PM" && hour !== 12) {
    hour += 12;
  } else if (period.toUpperCase() === "AM" && hour === 12) {
    hour = 0;
  }

  const date = new Date(
    parseInt(year, 10),
    parseInt(month, 10) - 1,
    parseInt(day, 10),
    hour,
    parseInt(minute, 10),
    parseInt(second, 10)
  );

  return isNaN(date.getTime()) ? null : date;
}

/**
 * Parse do valor booleano do CSV do Zoom
 */
function parseZoomBoolean(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "sim" || normalized === "yes" || normalized === "true" || normalized === "1";
}

/**
 * Headers possíveis do CSV do Zoom (PT-BR e EN)
 */
const HEADER_MAPPINGS: Record<string, string> = {
  // Português
  "nome (nome original)": "nome",
  "nome": "nome",
  "e-mail": "email",
  "email": "email",
  "ingressar na hora": "entradaHora",
  "hora de saída": "saidaHora",
  "duração (minutos)": "duracaoMinutos",
  "convidado": "convidado",
  "na sala de espera": "salaEspera",
  // Inglês
  "name (original name)": "nome",
  "user email": "email",
  "join time": "entradaHora",
  "leave time": "saidaHora",
  "duration (minutes)": "duracaoMinutos",
  "guest": "convidado",
  "in waiting room": "salaEspera",
};

/**
 * Faz parse do CSV do Zoom
 */
export function parseZoomCSV(csvContent: string): ZoomParticipantRaw[] {
  const lines = csvContent.split(/\r?\n/).filter((line) => line.trim().length > 0);
  
  if (lines.length < 2) {
    throw new Error("CSV vazio ou sem dados");
  }

  // Parse do header
  const headerLine = lines[0];
  const headers = parseCSVLine(headerLine).map((h) => {
    const normalized = h.toLowerCase().trim();
    return HEADER_MAPPINGS[normalized] || normalized;
  });

  const findIndex = (key: string): number => headers.indexOf(key);

  const nomeIdx = findIndex("nome");
  const emailIdx = findIndex("email");
  const entradaIdx = findIndex("entradaHora");
  const saidaIdx = findIndex("saidaHora");
  const duracaoIdx = findIndex("duracaoMinutos");
  const convidadoIdx = findIndex("convidado");
  const salaEsperaIdx = findIndex("salaEspera");

  if (nomeIdx === -1) {
    throw new Error("Coluna de nome não encontrada no CSV");
  }

  const participants: ZoomParticipantRaw[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    
    const nome = values[nomeIdx]?.trim();
    if (!nome) continue;

    const entradaStr = entradaIdx >= 0 ? values[entradaIdx] : undefined;
    const saidaStr = saidaIdx >= 0 ? values[saidaIdx] : undefined;
    const duracaoStr = duracaoIdx >= 0 ? values[duracaoIdx] : undefined;

    const entrada = entradaStr ? parseZoomDateTime(entradaStr) : null;
    const saida = saidaStr ? parseZoomDateTime(saidaStr) : null;
    const duracao = duracaoStr ? parseInt(duracaoStr, 10) : 0;

    if (!entrada || !saida) {
      console.warn(`Linha ${i + 1}: Não foi possível parsear datas para ${nome}`);
      continue;
    }

    participants.push({
      nome,
      email: emailIdx >= 0 ? values[emailIdx]?.trim() || null : null,
      entradaHora: entrada,
      saidaHora: saida,
      duracaoMinutos: isNaN(duracao) ? 0 : duracao,
      convidado: convidadoIdx >= 0 ? parseZoomBoolean(values[convidadoIdx]) : false,
      salaEspera: salaEsperaIdx >= 0 ? parseZoomBoolean(values[salaEsperaIdx]) : false,
    });
  }

  return participants;
}

/**
 * Parse de uma linha CSV respeitando aspas
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  
  result.push(current.trim());
  return result;
}

/**
 * Verifica se um nome deve ser excluído (equipe, hosts, etc.)
 */
function shouldExcludeName(normalized: string, excludeList: string[]): boolean {
  for (const exclude of excludeList) {
    const excludeNormalized = normalizeNameForMatch(exclude);
    if (!excludeNormalized) continue;
    
    // Match exato ou se o nome começa com o termo de exclusão
    if (normalized === excludeNormalized || normalized.startsWith(excludeNormalized + " ")) {
      return true;
    }
    
    // Match parcial (contém o termo)
    if (normalized.includes(excludeNormalized)) {
      return true;
    }
  }
  return false;
}

/**
 * Consolida participantes com mesmo nome EXATO (múltiplas entradas/saídas)
 * - Agrupa apenas nomes IDÊNTICOS (case-sensitive)
 * - NÃO ignora nomes "genéricos" como iPhone - todos aparecem
 * - Permite exclusão opcional de nomes específicos (equipe)
 */
export function consolidateParticipants(
  participants: ZoomParticipantRaw[],
  excludeNames: string[] = []
): ZoomParticipantConsolidated[] {
  const byName = new Map<string, ZoomParticipantConsolidated>();

  for (const p of participants) {
    const normalized = normalizeNameForMatch(p.nome);
    // Usamos o nome original exato como chave para agrupar
    const originalNameKey = p.nome.trim();
    
    // Ignora apenas nomes na lista de exclusão (equipe) - não ignora mais nomes genéricos
    if (excludeNames.length > 0 && shouldExcludeName(normalized, excludeNames)) {
      continue;
    }

    const existing = byName.get(originalNameKey);

    if (existing) {
      existing.entradas.push({
        entrada: p.entradaHora,
        saida: p.saidaHora,
        duracaoMinutos: p.duracaoMinutos,
      });
      existing.duracaoTotalMinutos += p.duracaoMinutos;
      
      if (p.entradaHora < existing.primeiraEntrada) {
        existing.primeiraEntrada = p.entradaHora;
      }
      if (p.saidaHora > existing.ultimaSaida) {
        existing.ultimaSaida = p.saidaHora;
      }
      
      // Atualiza email se não tinha
      if (!existing.email && p.email) {
        existing.email = p.email;
      }
    } else {
      byName.set(originalNameKey, {
        nomeOriginal: p.nome,
        nomeNormalizado: normalized,
        email: p.email,
        entradas: [{
          entrada: p.entradaHora,
          saida: p.saidaHora,
          duracaoMinutos: p.duracaoMinutos,
        }],
        duracaoTotalMinutos: p.duracaoMinutos,
        primeiraEntrada: p.entradaHora,
        ultimaSaida: p.saidaHora,
      });
    }
  }

  return Array.from(byName.values());
}

/**
 * Verifica se é um nome genérico que deve ser ignorado
 */
function isGenericName(normalized: string): boolean {
  const genericNames = [
    "iphone",
    "admin",
    "usuario do zoom",
    "zoom user",
    "guest",
    "convidado",
    "samsung",
    "moto",
    "motorola",
    "xiaomi",
    "huawei",
    "oppo",
    "vivo",
    "realme",
  ];

  // Checa se começa com nome genérico ou é exatamente igual
  for (const generic of genericNames) {
    if (normalized === generic || normalized.startsWith(generic + " ")) {
      return true;
    }
  }

  // Checa padrões de dispositivo
  if (/^(samsung|moto|iphone|sm-|gt-|lg-)/i.test(normalized)) {
    return true;
  }

  return false;
}

/**
 * Calcula tempo de presença durante um intervalo específico
 */
export function calculatePresenceInInterval(
  entradas: Array<{ entrada: Date; saida: Date }>,
  inicioIntervalo: Date,
  fimIntervalo: Date
): number {
  let totalMinutos = 0;

  for (const { entrada, saida } of entradas) {
    // Calcula overlap com o intervalo
    const inicioEfetivo = new Date(Math.max(entrada.getTime(), inicioIntervalo.getTime()));
    const fimEfetivo = new Date(Math.min(saida.getTime(), fimIntervalo.getTime()));

    if (inicioEfetivo < fimEfetivo) {
      const minutos = (fimEfetivo.getTime() - inicioEfetivo.getTime()) / (1000 * 60);
      totalMinutos += minutos;
    }
  }

  return Math.round(totalMinutos);
}

/**
 * Analisa presença de um participante com base na configuração
 */
export function analyzePresence(
  participante: ZoomParticipantConsolidated,
  config: PresenceConfig
): PresenceAnalysis {
  // Tempo durante a dinâmica
  const tempoDinamica = calculatePresenceInInterval(
    participante.entradas,
    config.inicioDinamica,
    config.fimDinamica
  );

  // Duração total da dinâmica
  const duracaoDinamica = Math.round(
    (config.fimDinamica.getTime() - config.inicioDinamica.getTime()) / (1000 * 60)
  );

  // Percentual de presença na dinâmica
  const percentualDinamica = duracaoDinamica > 0 
    ? Math.round((tempoDinamica / duracaoDinamica) * 100) 
    : 0;

  // Verificações
  const cumpriuTempoMinimo = participante.duracaoTotalMinutos >= config.tempoMinimoMinutos;
  const cumpriuDinamica = percentualDinamica >= config.percentualMinimoDinamica;
  const aprovado = cumpriuTempoMinimo && cumpriuDinamica;

  return {
    participante,
    tempoTotalMinutos: participante.duracaoTotalMinutos,
    tempoDinamicaMinutos: tempoDinamica,
    percentualDinamica,
    cumpriuTempoMinimo,
    cumpriuDinamica,
    aprovado,
  };
}

/**
 * Calcula score de similaridade entre dois nomes
 */
export function calculateNameSimilarity(name1: string, name2: string): number {
  const n1 = normalizeNameForMatch(name1);
  const n2 = normalizeNameForMatch(name2);

  if (n1 === n2) return 100;

  const parts1 = extractNameParts(name1);
  const parts2 = extractNameParts(name2);

  // Match exato de primeiro e último nome
  if (parts1.first === parts2.first && parts1.last === parts2.last) {
    return 95;
  }

  // Match de primeiro nome + inicial do último
  if (parts1.first === parts2.first && parts1.last[0] === parts2.last[0]) {
    return 85;
  }

  // Match apenas do primeiro nome
  if (parts1.first === parts2.first && parts1.first.length >= 3) {
    return 70;
  }

  // Levenshtein distance para nomes parecidos
  const distance = levenshteinDistance(n1, n2);
  const maxLen = Math.max(n1.length, n2.length);
  const similarity = Math.round((1 - distance / maxLen) * 100);

  return Math.max(0, similarity);
}

/**
 * Calcula distância de Levenshtein entre duas strings
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Encontra a melhor inscrição para um participante
 */
export function findBestMatch(
  participante: ZoomParticipantConsolidated,
  inscricoes: InscricaoItem[]
): { inscricao: InscricaoItem | null; score: number; reason: string | null } {
  let bestMatch: InscricaoItem | null = null;
  let bestScore = 0;
  let bestReason: string | null = null;

  for (const inscricao of inscricoes) {
    const inscricaoNome = inscricao.nome || "";
    
    // Match por email (mais confiável)
    if (participante.email && inscricao.parsedPayload.email) {
      const email1 = participante.email.toLowerCase().trim();
      const email2 = inscricao.parsedPayload.email.toLowerCase().trim();
      
      if (email1 === email2) {
        return { inscricao, score: 100, reason: "Email idêntico" };
      }
    }

    // Match por nome
    const similarity = calculateNameSimilarity(participante.nomeOriginal, inscricaoNome);
    
    if (similarity > bestScore) {
      bestScore = similarity;
      bestMatch = inscricao;
      
      if (similarity >= 95) {
        bestReason = "Nome idêntico";
      } else if (similarity >= 85) {
        bestReason = "Nome muito similar";
      } else if (similarity >= 70) {
        bestReason = "Primeiro nome igual";
      } else {
        bestReason = "Nome parcialmente similar";
      }
    }
  }

  return { inscricao: bestMatch, score: bestScore, reason: bestReason };
}

/**
 * Determina o status da associação baseado no score
 */
export function determineAssociationStatus(score: number): AssociationStatus {
  if (score >= 90) return "auto-matched";
  if (score >= 60) return "suggested";
  return "manual-pending";
}

/**
 * Processa validação completa de presença
 */
export function processPresenceValidation(
  participants: ZoomParticipantConsolidated[],
  inscricoes: InscricaoItem[],
  config: PresenceConfig
): PresenceValidationResult {
  const aprovados: PresenceAssociation[] = [];
  const reprovados: PresenceAssociation[] = [];

  let autoMatched = 0;
  let sugeridos = 0;
  let pendentesManual = 0;

  for (const participante of participants) {
    const analise = analyzePresence(participante, config);
    const { inscricao, score, reason } = findBestMatch(participante, inscricoes);
    const status = determineAssociationStatus(score);

    const association: PresenceAssociation = {
      participanteNome: participante.nomeOriginal,
      participanteEmail: participante.email,
      analise,
      inscricaoId: inscricao?.id ?? null,
      inscricaoNome: inscricao?.nome ?? null,
      inscricaoTelefone: inscricao?.telefone ?? null,
      status,
      matchScore: score,
      matchReason: reason,
    };

    if (analise.aprovado) {
      aprovados.push(association);
    } else {
      reprovados.push(association);
    }

    if (status === "auto-matched") autoMatched++;
    else if (status === "suggested") sugeridos++;
    else pendentesManual++;
  }

  // Ordena aprovados por score (maior primeiro)
  aprovados.sort((a, b) => b.matchScore - a.matchScore);
  reprovados.sort((a, b) => b.analise.tempoTotalMinutos - a.analise.tempoTotalMinutos);

  // Prepara lista de inscrições disponíveis ordenada alfabeticamente
  const inscricoesDisponiveis = inscricoes
    .map((i) => ({
      id: i.id,
      nome: i.nome || `Inscrição #${i.id}`,
      telefone: i.telefone,
      cidade: i.cidade,
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  return {
    config,
    totalParticipantesCSV: participants.length,
    totalConsolidados: participants.length,
    aprovados,
    reprovados,
    inscricoesDisponiveis,
    resumo: {
      totalAprovados: aprovados.length,
      totalReprovados: reprovados.length,
      autoMatched,
      sugeridos,
      pendentesManual,
    },
  };
}

/**
 * Detecta automaticamente o horário de término da live
 * baseado na última saída do CSV
 */
export function detectEndTime(participants: ZoomParticipantRaw[]): Date | null {
  if (participants.length === 0) return null;

  let latest = participants[0].saidaHora;
  
  for (const p of participants) {
    if (p.saidaHora > latest) {
      latest = p.saidaHora;
    }
  }

  return latest;
}

/**
 * Formata duração em minutos para exibição
 */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (hours === 0) {
    return `${mins}min`;
  }

  return `${hours}h ${mins}min`;
}

/**
 * Faz match automático de participantes com inscrições
 * Retorna array de matches com informações para exibição
 */
export function matchParticipantsToInscricoes(
  participants: ZoomParticipantConsolidated[],
  inscricoes: InscricaoItem[]
): Array<{
  participanteNome: string;
  inscricaoId: number | null;
  inscricaoNome: string | null;
  inscricaoTelefone: string | null;
  inscricaoRecrutadorCodigo: string | null;
  status: AssociationStatus;
  matchScore: number;
  matchReason: string | null;
}> {
  const usedInscricaoIds = new Set<number>();
  const matches: Array<{
    participanteNome: string;
    inscricaoId: number | null;
    inscricaoNome: string | null;
    inscricaoTelefone: string | null;
    inscricaoRecrutadorCodigo: string | null;
    status: AssociationStatus;
    matchScore: number;
    matchReason: string | null;
  }> = [];

  // Ordena participantes para processar os com melhores matches primeiro
  const participantesComScore = participants.map(p => {
    const { inscricao, score, reason } = findBestMatch(p, inscricoes);
    return { participante: p, inscricao, score, reason };
  }).sort((a, b) => b.score - a.score);

  for (const { participante, inscricao, score, reason } of participantesComScore) {
    // Se a inscrição já foi usada, tenta encontrar outra
    if (inscricao && usedInscricaoIds.has(inscricao.id)) {
      // Busca próxima melhor que não foi usada
      const remainingInscricoes = inscricoes.filter(i => !usedInscricaoIds.has(i.id));
      const { inscricao: altInscricao, score: altScore, reason: altReason } = 
        findBestMatch(participante, remainingInscricoes);
      
      if (altInscricao && altScore >= 60) {
        usedInscricaoIds.add(altInscricao.id);
        matches.push({
          participanteNome: participante.nomeOriginal,
          inscricaoId: altInscricao.id,
          inscricaoNome: altInscricao.nome,
          inscricaoTelefone: altInscricao.telefone,
          inscricaoRecrutadorCodigo: altInscricao.recrutadorCodigo,
          status: determineAssociationStatus(altScore),
          matchScore: altScore,
          matchReason: altReason,
        });
      } else {
        // Sem match alternativo
        matches.push({
          participanteNome: participante.nomeOriginal,
          inscricaoId: null,
          inscricaoNome: null,
          inscricaoTelefone: null,
          inscricaoRecrutadorCodigo: null,
          status: "manual-pending",
          matchScore: 0,
          matchReason: null,
        });
      }
    } else if (inscricao && score >= 60) {
      // Match válido
      usedInscricaoIds.add(inscricao.id);
      matches.push({
        participanteNome: participante.nomeOriginal,
        inscricaoId: inscricao.id,
        inscricaoNome: inscricao.nome,
        inscricaoTelefone: inscricao.telefone,
        inscricaoRecrutadorCodigo: inscricao.recrutadorCodigo,
        status: determineAssociationStatus(score),
        matchScore: score,
        matchReason: reason,
      });
    } else {
      // Sem match
      matches.push({
        participanteNome: participante.nomeOriginal,
        inscricaoId: null,
        inscricaoNome: null,
        inscricaoTelefone: null,
        inscricaoRecrutadorCodigo: null,
        status: "manual-pending",
        matchScore: 0,
        matchReason: null,
      });
    }
  }

  return matches;
}
