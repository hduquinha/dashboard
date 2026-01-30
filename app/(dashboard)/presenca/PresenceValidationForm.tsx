"use client";

import React, { useState, useTransition, useEffect, useMemo, useCallback } from "react";
import type { 
  PresenceConfig, 
  AssociationStatus, 
  InscricaoSimplificada,
  ZoomParticipantConsolidated,
  PresenceAnalysis
} from "@/types/presence";
import { formatDuration, analyzePresence, calculatePresenceInInterval } from "@/lib/zoomPresence";

// ============================================================================
// TIPOS LOCAIS
// ============================================================================

interface TrainingOption {
  id: string;
  label: string;
}

type Step = "upload" | "review" | "associate" | "confirm";

interface ParticipantWithAnalysis {
  participante: ZoomParticipantConsolidated;
  analise: PresenceAnalysis;
  removed: boolean;
}

interface AssociationData {
  inscricaoId: number | null;
  inscricaoNome: string | null;
  inscricaoTelefone: string | null;
  inscricaoRecrutadorCodigo: string | null;
  status: AssociationStatus;
  matchScore: number;
  matchReason: string | null;
  // Para status "doubt" - segunda inscrição candidata
  inscricaoId2?: number | null;
  inscricaoNome2?: string | null;
  inscricaoTelefone2?: string | null;
  inscricaoRecrutadorCodigo2?: string | null;
}

interface ParsedCSVState {
  participants: ParticipantWithAnalysis[];
  config: PresenceConfig | null;
  inscricoesDisponiveis: InscricaoSimplificada[];
  filename: string;
}

// ============================================================================
// COMPONENTE PRINCIPAL
// ============================================================================

export default function PresenceValidationForm() {
  // Estado de navegação
  const [currentStep, setCurrentStep] = useState<Step>("upload");
  
  // Estado dos dados
  const [trainings, setTrainings] = useState<TrainingOption[]>([]);
  const [parsedData, setParsedData] = useState<ParsedCSVState | null>(null);
  const [associations, setAssociations] = useState<Map<string, AssociationData>>(new Map());
  
  // Estado de UI
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  
  // Modal de busca
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [searchModalParticipante, setSearchModalParticipante] = useState<string | null>(null);
  const [searchModalQuery, setSearchModalQuery] = useState("");

  // Modal de dúvida (selecionar duas inscrições)
  const [doubtModalOpen, setDoubtModalOpen] = useState(false);
  const [doubtModalParticipante, setDoubtModalParticipante] = useState<string | null>(null);
  const [doubtModalQuery, setDoubtModalQuery] = useState("");
  const [doubtSelectedInscricoes, setDoubtSelectedInscricoes] = useState<InscricaoSimplificada[]>([]);

  // Confirmação
  const [isConfirming, startConfirm] = useTransition();

  // Merge de participantes
  const [mergeMode, setMergeMode] = useState(false);
  const [selectedForMerge, setSelectedForMerge] = useState<Set<string>>(new Set());
  const [confirmResult, setConfirmResult] = useState<{ success: boolean; message: string } | null>(null);

  // ============================================================================
  // DADOS COMPUTADOS
  // ============================================================================

  // Participantes ativos (não removidos) - ordenados alfabeticamente
  const activeParticipants = useMemo((): ParticipantWithAnalysis[] => {
    if (!parsedData) return [];
    return parsedData.participants
      .filter((p: ParticipantWithAnalysis) => !p.removed)
      .sort((a, b) => a.participante.nomeOriginal.localeCompare(b.participante.nomeOriginal, 'pt-BR'));
  }, [parsedData]);

  // Participantes removidos - ordenados alfabeticamente
  const removedParticipants = useMemo((): ParticipantWithAnalysis[] => {
    if (!parsedData) return [];
    return parsedData.participants
      .filter((p: ParticipantWithAnalysis) => p.removed)
      .sort((a, b) => a.participante.nomeOriginal.localeCompare(b.participante.nomeOriginal, 'pt-BR'));
  }, [parsedData]);

  // Estatísticas de associação
  const associationStats = useMemo(() => {
    let confirmed = 0;
    let pending = 0;
    let autoMatched = 0;
    let notFound = 0;
    let doubt = 0;

    activeParticipants.forEach((p: ParticipantWithAnalysis) => {
      const assoc = associations.get(p.participante.nomeOriginal);
      if (!assoc || assoc.status === "manual-pending") {
        pending++;
      } else if (assoc.status === "confirmed") {
        confirmed++;
      } else if (assoc.status === "auto-matched") {
        autoMatched++;
      } else if (assoc.status === "not-found") {
        notFound++;
      } else if (assoc.status === "doubt") {
        doubt++;
      } else {
        pending++;
      }
    });

    return { confirmed, pending, autoMatched, notFound, doubt, total: activeParticipants.length };
  }, [activeParticipants, associations]);

  // IDs de inscrições já usadas
  const usedInscricaoIds = useMemo(() => {
    const used = new Set<number>();
    associations.forEach((value: AssociationData) => {
      if (value.inscricaoId && (value.status === "confirmed" || value.status === "auto-matched")) {
        used.add(value.inscricaoId);
      }
    });
    return used;
  }, [associations]);

  // Verifica se pode avançar para próxima etapa
  const canProceedToAssociate = activeParticipants.length > 0;
  // Agora também aceita not-found e doubt como "resolvidos"
  const canProceedToConfirm = associationStats.pending === 0 && associationStats.autoMatched === 0 && associationStats.total > 0;

  // ============================================================================
  // CARREGA TREINAMENTOS
  // ============================================================================

  useEffect(() => {
    fetch("/api/trainings")
      .then((res) => res.json())
      .then((data) => setTrainings(data.trainings || []))
      .catch(() => setTrainings([]));
  }, []);

  // ============================================================================
  // HANDLERS
  // ============================================================================

  // Upload e parse do CSV
  const handleUpload = async (formData: FormData) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/presence/parse", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Erro ao processar arquivo");
      }

      // Converte datas do config de string para Date (JSON não preserva Date)
      const config: PresenceConfig = {
        treinamentoId: data.config.treinamentoId,
        inicioLive: new Date(data.config.inicioLive),
        fimLive: new Date(data.config.fimLive),
        inicioDinamica: new Date(data.config.inicioDinamica),
        fimDinamica: new Date(data.config.fimDinamica),
        tempoMinimoMinutos: data.config.tempoMinimoMinutos,
        percentualMinimoDinamica: data.config.percentualMinimoDinamica,
      };

      // Inicializa estado dos participantes (também converte datas das entradas)
      const participants: ParticipantWithAnalysis[] = data.participants.map((p: {
        participante: ZoomParticipantConsolidated;
        analise: PresenceAnalysis;
      }) => ({
        participante: {
          ...p.participante,
          primeiraEntrada: new Date(p.participante.primeiraEntrada),
          ultimaSaida: new Date(p.participante.ultimaSaida),
          entradas: p.participante.entradas.map((e: { entrada: string | Date; saida: string | Date; duracaoMinutos: number }) => ({
            entrada: new Date(e.entrada),
            saida: new Date(e.saida),
            duracaoMinutos: e.duracaoMinutos,
          })),
        },
        analise: p.analise,
        removed: false,
      }));

      setParsedData({
        participants,
        config,
        inscricoesDisponiveis: data.inscricoesDisponiveis,
        filename: data.filename,
      });

      // Inicializa associações com auto-match
      const newAssociations = new Map<string, AssociationData>();
      for (const match of data.autoMatches || []) {
        newAssociations.set(match.participanteNome, {
          inscricaoId: match.inscricaoId,
          inscricaoNome: match.inscricaoNome,
          inscricaoTelefone: match.inscricaoTelefone,
          inscricaoRecrutadorCodigo: match.inscricaoRecrutadorCodigo ?? null,
          status: match.status,
          matchScore: match.matchScore,
          matchReason: match.matchReason,
        });
      }
      setAssociations(newAssociations);

      setCurrentStep("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setIsLoading(false);
    }
  };

  // Remove participante da lista
  const removeParticipant = useCallback((nomeOriginal: string) => {
    setParsedData((prev: ParsedCSVState | null) => {
      if (!prev) return prev;
      return {
        ...prev,
        participants: prev.participants.map((p: ParticipantWithAnalysis) => 
          p.participante.nomeOriginal === nomeOriginal
            ? { ...p, removed: true }
            : p
        ),
      };
    });
    // Remove associação se existia
    setAssociations((prev: Map<string, AssociationData>) => {
      const next = new Map(prev);
      next.delete(nomeOriginal);
      return next;
    });
  }, []);

  // Restaura participante removido
  const restoreParticipant = useCallback((nomeOriginal: string) => {
    setParsedData((prev: ParsedCSVState | null) => {
      if (!prev) return prev;
      return {
        ...prev,
        participants: prev.participants.map((p: ParticipantWithAnalysis) => 
          p.participante.nomeOriginal === nomeOriginal
            ? { ...p, removed: false }
            : p
        ),
      };
    });
  }, []);

  // Toggle seleção para merge
  const toggleMergeSelection = useCallback((nomeOriginal: string) => {
    setSelectedForMerge((prev: Set<string>) => {
      const next = new Set(prev);
      if (next.has(nomeOriginal)) {
        next.delete(nomeOriginal);
      } else {
        next.add(nomeOriginal);
      }
      return next;
    });
  }, []);

  // Executa o merge dos participantes selecionados
  const executeMerge = useCallback(() => {
    if (selectedForMerge.size < 2 || !parsedData) return;

    const selectedNames = Array.from(selectedForMerge);
    const selectedParticipants = parsedData.participants.filter(
      (p: ParticipantWithAnalysis) => selectedNames.includes(p.participante.nomeOriginal) && !p.removed
    );

    if (selectedParticipants.length < 2) return;

    // Ordena por tempo total para escolher o "principal" (maior tempo)
    selectedParticipants.sort(
      (a: ParticipantWithAnalysis, b: ParticipantWithAnalysis) => b.participante.duracaoTotalMinutos - a.participante.duracaoTotalMinutos
    );

    const principal = selectedParticipants[0];
    const toMerge = selectedParticipants.slice(1);

    // Consolida as entradas
    const mergedEntradas = [...principal.participante.entradas];
    let mergedDuracao = principal.participante.duracaoTotalMinutos;
    let mergedPrimeiraEntrada = principal.participante.primeiraEntrada;
    let mergedUltimaSaida = principal.participante.ultimaSaida;
    let mergedEmail = principal.participante.email;

    for (const p of toMerge) {
      mergedEntradas.push(...p.participante.entradas);
      mergedDuracao += p.participante.duracaoTotalMinutos;
      if (p.participante.primeiraEntrada < mergedPrimeiraEntrada) {
        mergedPrimeiraEntrada = p.participante.primeiraEntrada;
      }
      if (p.participante.ultimaSaida > mergedUltimaSaida) {
        mergedUltimaSaida = p.participante.ultimaSaida;
      }
      if (!mergedEmail && p.participante.email) {
        mergedEmail = p.participante.email;
      }
    }

    // Cria o nome combinado mostrando todos os aliases
    const allNames = selectedParticipants.map((p: ParticipantWithAnalysis) => p.participante.nomeOriginal);
    const combinedDisplayName = allNames.join(" + ");

    // Atualiza o participante principal com os dados consolidados
    setParsedData((prev: ParsedCSVState | null) => {
      if (!prev) return prev;
      if (!prev.config) return prev;

      const toMergeNames = new Set(toMerge.map((p: ParticipantWithAnalysis) => p.participante.nomeOriginal));

      return {
        ...prev,
        participants: prev.participants.map((p: ParticipantWithAnalysis) => {
          // Remove os participantes que foram mergeados (marca como removed)
          if (toMergeNames.has(p.participante.nomeOriginal)) {
            return { ...p, removed: true };
          }
          // Atualiza o participante principal com dados consolidados
          if (p.participante.nomeOriginal === principal.participante.nomeOriginal) {
            const updatedParticipante: ZoomParticipantConsolidated = {
              ...p.participante,
              nomeOriginal: combinedDisplayName,
              entradas: mergedEntradas,
              duracaoTotalMinutos: mergedDuracao,
              primeiraEntrada: mergedPrimeiraEntrada,
              ultimaSaida: mergedUltimaSaida,
              email: mergedEmail,
            };
            // Recalcula a análise COMPLETA com as entradas consolidadas
            const updatedAnalise = analyzePresence(updatedParticipante, prev.config!);
            return {
              ...p,
              participante: updatedParticipante,
              analise: updatedAnalise,
            };
          }
          return p;
        }),
      };
    });

    // Remove associações dos participantes mergeados
    setAssociations((prev: Map<string, AssociationData>) => {
      const next = new Map(prev);
      for (const p of toMerge) {
        next.delete(p.participante.nomeOriginal);
      }
      return next;
    });

    // Limpa seleção e desativa modo merge
    setSelectedForMerge(new Set());
    setMergeMode(false);
  }, [selectedForMerge, parsedData]);

  // Cancela o modo merge
  const cancelMerge = useCallback(() => {
    setSelectedForMerge(new Set());
    setMergeMode(false);
  }, []);

  // Aprovar manualmente participante que não cumpriu objetivos
  const forceApprove = useCallback((participanteNome: string) => {
    setParsedData((prev: ParsedCSVState | null) => {
      if (!prev) return prev;
      
      return {
        ...prev,
        participants: prev.participants.map((p: ParticipantWithAnalysis) => {
          if (p.participante.nomeOriginal === participanteNome) {
            return {
              ...p,
              analise: {
                ...p.analise,
                aprovado: true,
                // Marca como aprovação manual
              },
            };
          }
          return p;
        }),
      };
    });
  }, []);

  // Atualiza associação
  const updateAssociation = useCallback((
    participanteNome: string, 
    inscricao: InscricaoSimplificada | null, 
    status: AssociationStatus
  ) => {
    setAssociations((prev: Map<string, AssociationData>) => {
      const next = new Map(prev);
      next.set(participanteNome, {
        inscricaoId: inscricao?.id ?? null,
        inscricaoNome: inscricao?.nome ?? null,
        inscricaoTelefone: inscricao?.telefone ?? null,
        inscricaoRecrutadorCodigo: inscricao?.recrutadorCodigo ?? null,
        status,
        matchScore: 100,
        matchReason: "manual",
      });
      return next;
    });
  }, []);

  // Marca como "Não foi possível encontrar"
  const markAsNotFound = useCallback((participanteNome: string) => {
    setAssociations((prev: Map<string, AssociationData>) => {
      const next = new Map(prev);
      next.set(participanteNome, {
        inscricaoId: null,
        inscricaoNome: null,
        inscricaoTelefone: null,
        inscricaoRecrutadorCodigo: null,
        status: "not-found",
        matchScore: 0,
        matchReason: "not-found",
      });
      return next;
    });
  }, []);

  // Abre modal de dúvida
  const openDoubtModal = useCallback((participanteNome: string) => {
    const firstName = participanteNome.split(" ")[0];
    setDoubtModalParticipante(participanteNome);
    setDoubtModalQuery(firstName);
    setDoubtSelectedInscricoes([]);
    setDoubtModalOpen(true);
  }, []);

  // Toggle seleção no modal de dúvida
  const toggleDoubtSelection = useCallback((inscricao: InscricaoSimplificada) => {
    setDoubtSelectedInscricoes((prev) => {
      const exists = prev.find((i) => i.id === inscricao.id);
      if (exists) {
        return prev.filter((i) => i.id !== inscricao.id);
      } else if (prev.length < 2) {
        return [...prev, inscricao];
      }
      // Se já tem 2, substitui o segundo
      return [prev[0], inscricao];
    });
  }, []);

  // Confirma dúvida com duas inscrições
  const confirmDoubt = useCallback(() => {
    if (!doubtModalParticipante || doubtSelectedInscricoes.length !== 2) return;
    
    setAssociations((prev: Map<string, AssociationData>) => {
      const next = new Map(prev);
      next.set(doubtModalParticipante, {
        inscricaoId: doubtSelectedInscricoes[0].id,
        inscricaoNome: doubtSelectedInscricoes[0].nome,
        inscricaoTelefone: doubtSelectedInscricoes[0].telefone,
        inscricaoRecrutadorCodigo: doubtSelectedInscricoes[0].recrutadorCodigo,
        status: "doubt",
        matchScore: 0,
        matchReason: "doubt",
        inscricaoId2: doubtSelectedInscricoes[1].id,
        inscricaoNome2: doubtSelectedInscricoes[1].nome,
        inscricaoTelefone2: doubtSelectedInscricoes[1].telefone,
        inscricaoRecrutadorCodigo2: doubtSelectedInscricoes[1].recrutadorCodigo,
      });
      return next;
    });

    setDoubtModalOpen(false);
    setDoubtModalParticipante(null);
    setDoubtModalQuery("");
    setDoubtSelectedInscricoes([]);
  }, [doubtModalParticipante, doubtSelectedInscricoes]);

  // Confirma associação (transforma auto-matched em confirmed)
  const confirmAssociation = useCallback((participanteNome: string) => {
    setAssociations((prev: Map<string, AssociationData>) => {
      const next = new Map(prev);
      const current = next.get(participanteNome);
      if (current) {
        next.set(participanteNome, { ...current, status: "confirmed" });
      }
      return next;
    });
  }, []);

  // Abre modal de busca
  const openSearchModal = useCallback((participanteNome: string) => {
    const firstName = participanteNome.split(" ")[0];
    setSearchModalParticipante(participanteNome);
    setSearchModalQuery(firstName);
    setSearchModalOpen(true);
  }, []);

  // Seleciona inscrição no modal
  const selectFromModal = useCallback((inscricao: InscricaoSimplificada) => {
    if (searchModalParticipante) {
      updateAssociation(searchModalParticipante, inscricao, "confirmed");
    }
    setSearchModalOpen(false);
    setSearchModalParticipante(null);
    setSearchModalQuery("");
  }, [searchModalParticipante, updateAssociation]);

  // Confirma e salva tudo
  const handleConfirmAll = async () => {
    if (!parsedData?.config) return;

    const toSave = activeParticipants
      .filter((p: ParticipantWithAnalysis) => {
        const assoc = associations.get(p.participante.nomeOriginal);
        return assoc?.inscricaoId && assoc.status === "confirmed";
      })
      .map((p: ParticipantWithAnalysis) => {
        const assoc = associations.get(p.participante.nomeOriginal)!;
        return {
          inscricaoId: assoc.inscricaoId!,
          participanteNome: p.participante.nomeOriginal,
          aprovado: p.analise.aprovado,
          tempoTotal: p.analise.tempoTotalMinutos,
          tempoDinamica: p.analise.tempoDinamicaMinutos,
          percentualDinamica: p.analise.percentualDinamica,
        };
      });

    startConfirm(async () => {
      try {
        const response = await fetch("/api/presence/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            associations: toSave,
            treinamentoId: parsedData.config!.treinamentoId,
          }),
        });

        const result = await response.json();
        setConfirmResult({
          success: response.ok,
          message: result.message || (response.ok ? "Salvo com sucesso!" : "Erro ao salvar"),
        });
      } catch {
        setConfirmResult({ success: false, message: "Erro de conexão" });
      }
    });
  };

  // Volta ao início
  const resetForm = () => {
    setCurrentStep("upload");
    setParsedData(null);
    setAssociations(new Map());
    setError(null);
    setSuccessMessage(null);
    setConfirmResult(null);
  };

  // ============================================================================
  // INSCRIÇÕES FILTRADAS PARA MODAL
  // ============================================================================

  type FilteredInscricao = InscricaoSimplificada & { matchesQuery: boolean; relevance: number; isUsed: boolean };
  
  const modalFilteredInscricoes = useMemo((): FilteredInscricao[] => {
    if (!parsedData?.inscricoesDisponiveis) return [];
    
    const query = searchModalQuery.toLowerCase().trim();
    
    return parsedData.inscricoesDisponiveis
      .map((insc: InscricaoSimplificada): FilteredInscricao => {
        const firstName = insc.nome.split(" ")[0].toLowerCase();
        const matchesQuery: boolean = !query || 
          insc.nome.toLowerCase().includes(query) ||
          (insc.telefone?.includes(query) ?? false) ||
          (insc.cidade?.toLowerCase().includes(query) ?? false);
        
        const relevance: number = query && insc.nome.toLowerCase().startsWith(query) ? 2 :
                         query && firstName === query ? 1 : 0;
        
        const isUsed: boolean = usedInscricaoIds.has(insc.id) === true;
        return {
          id: insc.id,
          nome: insc.nome,
          telefone: insc.telefone,
          cidade: insc.cidade,
          recrutadorCodigo: insc.recrutadorCodigo,
          matchesQuery,
          relevance,
          isUsed,
        };
      })
      .filter((insc: FilteredInscricao) => insc.matchesQuery)
      .sort((a: FilteredInscricao, b: FilteredInscricao) => {
        if (a.isUsed !== b.isUsed) return a.isUsed ? 1 : -1;
        if (a.relevance !== b.relevance) return b.relevance - a.relevance;
        return a.nome.localeCompare(b.nome);
      });
  }, [parsedData?.inscricoesDisponiveis, searchModalQuery, usedInscricaoIds]);

  // Inscrições filtradas para modal de dúvida
  const doubtFilteredInscricoes = useMemo((): FilteredInscricao[] => {
    if (!parsedData?.inscricoesDisponiveis) return [];
    
    const query = doubtModalQuery.toLowerCase().trim();
    
    return parsedData.inscricoesDisponiveis
      .map((insc: InscricaoSimplificada): FilteredInscricao => {
        const firstName = insc.nome.split(" ")[0].toLowerCase();
        const matchesQuery: boolean = !query || 
          insc.nome.toLowerCase().includes(query) ||
          (insc.telefone?.includes(query) ?? false) ||
          (insc.cidade?.toLowerCase().includes(query) ?? false);
        
        const relevance: number = query && insc.nome.toLowerCase().startsWith(query) ? 2 :
                         query && firstName === query ? 1 : 0;
        
        const isUsed: boolean = usedInscricaoIds.has(insc.id) === true;
        return {
          id: insc.id,
          nome: insc.nome,
          telefone: insc.telefone,
          cidade: insc.cidade,
          recrutadorCodigo: insc.recrutadorCodigo,
          matchesQuery,
          relevance,
          isUsed,
        };
      })
      .filter((insc: FilteredInscricao) => insc.matchesQuery)
      .sort((a: FilteredInscricao, b: FilteredInscricao) => {
        if (a.isUsed !== b.isUsed) return a.isUsed ? 1 : -1;
        if (a.relevance !== b.relevance) return b.relevance - a.relevance;
        return a.nome.localeCompare(b.nome);
      });
  }, [parsedData?.inscricoesDisponiveis, doubtModalQuery, usedInscricaoIds]);

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className="space-y-6">
      {/* Indicador de Etapas */}
      <StepIndicator currentStep={currentStep} />

      {/* Mensagem de erro */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Mensagem de sucesso */}
      {successMessage && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {successMessage}
        </div>
      )}

      {/* ETAPA 1: Upload do CSV */}
      {currentStep === "upload" && (
        <UploadStep 
          trainings={trainings}
          isLoading={isLoading}
          onSubmit={handleUpload}
        />
      )}

      {/* ETAPA 2: Revisão - Remover participantes */}
      {currentStep === "review" && parsedData && (
        <ReviewStep
          activeParticipants={activeParticipants}
          removedParticipants={removedParticipants}
          config={parsedData.config}
          onRemove={removeParticipant}
          onRestore={restoreParticipant}
          onForceApprove={forceApprove}
          onBack={resetForm}
          onNext={() => setCurrentStep("associate")}
          canProceed={canProceedToAssociate}
          mergeMode={mergeMode}
          selectedForMerge={selectedForMerge}
          onToggleMergeMode={() => setMergeMode(!mergeMode)}
          onToggleMergeSelection={toggleMergeSelection}
          onExecuteMerge={executeMerge}
          onCancelMerge={cancelMerge}
        />
      )}

      {/* ETAPA 3: Associar participantes a inscrições */}
      {currentStep === "associate" && parsedData && (
        <AssociateStep
          participants={activeParticipants}
          associations={associations}
          stats={associationStats}
          onConfirmAssociation={confirmAssociation}
          onOpenSearch={openSearchModal}
          onUpdateAssociation={updateAssociation}
          onMarkNotFound={markAsNotFound}
          onOpenDoubtModal={openDoubtModal}
          onBack={() => setCurrentStep("review")}
          onNext={() => setCurrentStep("confirm")}
          canProceed={canProceedToConfirm}
        />
      )}

      {/* ETAPA 4: Confirmação Final */}
      {currentStep === "confirm" && parsedData && (
        <ConfirmStep
          participants={activeParticipants}
          associations={associations}
          inscricoesDisponiveis={parsedData.inscricoesDisponiveis}
          treinamentoId={parsedData.config?.treinamentoId ?? ""}
          isConfirming={isConfirming}
          confirmResult={confirmResult}
          onBack={() => setCurrentStep("associate")}
          onConfirm={handleConfirmAll}
          onReset={resetForm}
        />
      )}

      {/* Modal de Busca */}
      {searchModalOpen && parsedData && (
        <SearchModal
          participanteNome={searchModalParticipante}
          query={searchModalQuery}
          onQueryChange={setSearchModalQuery}
          filteredInscricoes={modalFilteredInscricoes}
          usedCount={usedInscricaoIds.size}
          onSelect={selectFromModal}
          onClose={() => {
            setSearchModalOpen(false);
            setSearchModalParticipante(null);
            setSearchModalQuery("");
          }}
        />
      )}

      {/* Modal de Dúvida */}
      {doubtModalOpen && parsedData && (
        <DoubtModal
          participanteNome={doubtModalParticipante}
          query={doubtModalQuery}
          onQueryChange={setDoubtModalQuery}
          filteredInscricoes={doubtFilteredInscricoes}
          selectedInscricoes={doubtSelectedInscricoes}
          onToggleSelection={toggleDoubtSelection}
          onConfirm={confirmDoubt}
          onClose={() => {
            setDoubtModalOpen(false);
            setDoubtModalParticipante(null);
            setDoubtModalQuery("");
            setDoubtSelectedInscricoes([]);
          }}
        />
      )}
    </div>
  );
}

// ============================================================================
// COMPONENTES DE ETAPAS
// ============================================================================

function StepIndicator({ currentStep }: { currentStep: Step }) {
  const steps: { key: Step; label: string; number: number }[] = [
    { key: "upload", label: "Importar CSV", number: 1 },
    { key: "review", label: "Revisar Participantes", number: 2 },
    { key: "associate", label: "Associar Inscrições", number: 3 },
    { key: "confirm", label: "Confirmar", number: 4 },
  ];

  const currentIndex = steps.findIndex(s => s.key === currentStep);

  return (
    <div className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white p-4">
      {steps.map((step, index) => {
        const isActive = step.key === currentStep;
        const isCompleted = index < currentIndex;
        
        return (
          <div key={step.key} className="flex items-center">
            <div className="flex items-center gap-2">
              <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${
                isActive 
                  ? "bg-neutral-900 text-white" 
                  : isCompleted 
                    ? "bg-emerald-500 text-white"
                    : "bg-neutral-100 text-neutral-500"
              }`}>
                {isCompleted ? "✓" : step.number}
              </div>
              <span className={`text-sm font-medium ${
                isActive ? "text-neutral-900" : "text-neutral-500"
              }`}>
                {step.label}
              </span>
            </div>
            {index < steps.length - 1 && (
              <div className={`mx-4 h-px w-12 ${
                isCompleted ? "bg-emerald-500" : "bg-neutral-200"
              }`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// ETAPA 1: UPLOAD
// ============================================================================

function UploadStep({ 
  trainings, 
  isLoading, 
  onSubmit 
}: { 
  trainings: TrainingOption[];
  isLoading: boolean;
  onSubmit: (formData: FormData) => void;
}) {
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    onSubmit(formData);
  };

  return (
    <form
      className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm"
      onSubmit={handleSubmit}
    >
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-neutral-900">
          Passo 1: Importar Relatório do Zoom
        </h2>
        <p className="text-sm text-neutral-600">
          Faça upload do CSV exportado do Zoom e configure os horários do encontro.
        </p>
        
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Treinamento */}
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-neutral-700">
              Treinamento
              <select
                name="treinamentoId"
                required
                className="mt-1 block w-full rounded-lg border border-neutral-300 px-4 py-2.5 text-sm focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-200"
              >
                <option value="">Selecione o treinamento...</option>
                {trainings.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            </label>
          </div>

          {/* Arquivo CSV */}
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-neutral-700">
              Arquivo CSV do Zoom
              <input
                type="file"
                name="csvFile"
                accept=".csv"
                required
                className="mt-1 block w-full rounded-lg border border-neutral-300 px-4 py-2.5 text-sm file:mr-4 file:rounded file:border-0 file:bg-neutral-100 file:px-4 file:py-1 file:text-sm file:font-medium focus:border-neutral-500 focus:outline-none"
              />
            </label>
            <p className="mt-1 text-xs text-neutral-500">
              Exportado em: Zoom → Relatórios → Uso → Participantes
            </p>
          </div>

          {/* Horário de início da live */}
          <div>
            <label className="block text-sm font-medium text-neutral-700">
              Início da Live
              <input
                type="datetime-local"
                name="inicioLive"
                required
                className="mt-1 block w-full rounded-lg border border-neutral-300 px-4 py-2.5 text-sm focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-200"
              />
            </label>
          </div>

          {/* Horário de início da dinâmica */}
          <div>
            <label className="block text-sm font-medium text-neutral-700">
              Início da Dinâmica
              <input
                type="datetime-local"
                name="inicioDinamica"
                required
                className="mt-1 block w-full rounded-lg border border-neutral-300 px-4 py-2.5 text-sm focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-200"
              />
            </label>
          </div>

          {/* Horário de fim da dinâmica */}
          <div>
            <label className="block text-sm font-medium text-neutral-700">
              Término da Dinâmica
              <input
                type="datetime-local"
                name="fimDinamica"
                required
                className="mt-1 block w-full rounded-lg border border-neutral-300 px-4 py-2.5 text-sm focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-200"
              />
            </label>
          </div>

          {/* Tempo mínimo */}
          <div>
            <label className="block text-sm font-medium text-neutral-700">
              Tempo mínimo total (minutos)
              <input
                type="number"
                name="tempoMinimo"
                defaultValue={60}
                min={1}
                max={300}
                className="mt-1 block w-full rounded-lg border border-neutral-300 px-4 py-2.5 text-sm focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-200"
              />
            </label>
          </div>

          {/* Percentual mínimo dinâmica */}
          <div>
            <label className="block text-sm font-medium text-neutral-700">
              % mínimo na Dinâmica
              <input
                type="number"
                name="percentualMinimo"
                defaultValue={90}
                min={1}
                max={100}
                className="mt-1 block w-full rounded-lg border border-neutral-300 px-4 py-2.5 text-sm focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-200"
              />
            </label>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={isLoading}
            className="rounded-xl bg-neutral-900 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral-800 disabled:opacity-50"
          >
            {isLoading ? "Processando..." : "Importar e Continuar →"}
          </button>
        </div>
      </div>
    </form>
  );
}

// ============================================================================
// ETAPA 2: REVISÃO
// ============================================================================

function ReviewStep({
  activeParticipants,
  removedParticipants,
  config,
  onRemove,
  onRestore,
  onForceApprove,
  onBack,
  onNext,
  canProceed,
  mergeMode,
  selectedForMerge,
  onToggleMergeMode,
  onToggleMergeSelection,
  onExecuteMerge,
  onCancelMerge,
}: {
  activeParticipants: ParticipantWithAnalysis[];
  removedParticipants: ParticipantWithAnalysis[];
  config: PresenceConfig | null;
  onRemove: (nome: string) => void;
  onRestore: (nome: string) => void;
  onForceApprove: (nome: string) => void;
  onBack: () => void;
  onNext: () => void;
  canProceed: boolean;
  mergeMode: boolean;
  selectedForMerge: Set<string>;
  onToggleMergeMode: () => void;
  onToggleMergeSelection: (nome: string) => void;
  onExecuteMerge: () => void;
  onCancelMerge: () => void;
}) {
  const aprovados = activeParticipants.filter(p => p.analise.aprovado);
  const reprovados = activeParticipants.filter(p => !p.analise.aprovado);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-neutral-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-neutral-900">
          Passo 2: Revisar Participantes
        </h2>
        <p className="mt-1 text-sm text-neutral-600">
          Revise a lista e <strong>remova</strong> quem não deve participar (equipe, hosts, etc.). 
          Todos que restarem precisarão ser associados a uma inscrição no próximo passo.
        </p>
      </div>

      {/* Resumo */}
      <div className="grid gap-3 sm:grid-cols-4">
        <SummaryCard label="Total Ativos" value={activeParticipants.length} color="sky" />
        <SummaryCard label="Aprovados" value={aprovados.length} color="emerald" />
        <SummaryCard label="Reprovados" value={reprovados.length} color="red" />
        <SummaryCard label="Removidos" value={removedParticipants.length} color="neutral" />
      </div>

      {/* Config usada */}
      {config && (
        <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm">
          <h3 className="font-medium text-neutral-700">Configuração:</h3>
          <div className="mt-2 flex flex-wrap gap-4 text-neutral-600">
            <span>Tempo mínimo: <strong>{config.tempoMinimoMinutos}min</strong></span>
            <span>% dinâmica: <strong>{config.percentualMinimoDinamica}%</strong></span>
          </div>
        </div>
      )}

      {/* Tabela de participantes ativos */}
      <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
        <div className="border-b border-neutral-100 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-semibold text-neutral-900">
                Participantes Ativos ({activeParticipants.length})
              </h3>
              <p className="text-sm text-neutral-500">
                {mergeMode 
                  ? "Selecione 2 ou mais participantes para juntar (ex: &quot;Adriana&quot; + &quot;iPhone da Adriana&quot;)"
                  : "Clique em \"Remover\" para excluir ou use \"Juntar Participantes\" para combinar entradas"
                }
              </p>
            </div>
            <div className="flex gap-2">
              {mergeMode ? (
                <>
                  <button
                    onClick={onCancelMerge}
                    className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={onExecuteMerge}
                    disabled={selectedForMerge.size < 2}
                    className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Juntar Selecionados ({selectedForMerge.size})
                  </button>
                </>
              ) : (
                <button
                  onClick={onToggleMergeMode}
                  className="rounded-lg border border-sky-300 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-700 hover:bg-sky-100"
                >
                  🔗 Juntar Participantes
                </button>
              )}
            </div>
          </div>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
              <tr>
                {mergeMode && (
                  <th className="px-4 py-3 font-medium w-12">
                    <span className="sr-only">Selecionar</span>
                  </th>
                )}
                <th className="px-4 py-3 font-medium">Nome</th>
                <th className="px-4 py-3 font-medium">Tempo Total</th>
                <th className="px-4 py-3 font-medium">Na Dinâmica</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {activeParticipants.map((p) => {
                const isSelected = selectedForMerge.has(p.participante.nomeOriginal);
                return (
                <tr 
                  key={p.participante.nomeOriginal} 
                  className={`hover:bg-neutral-50 ${mergeMode && isSelected ? 'bg-sky-50' : ''}`}
                  onClick={mergeMode ? () => onToggleMergeSelection(p.participante.nomeOriginal) : undefined}
                  style={mergeMode ? { cursor: 'pointer' } : undefined}
                >
                  {mergeMode && (
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleMergeSelection(p.participante.nomeOriginal)}
                        onClick={(e) => e.stopPropagation()}
                        className="h-4 w-4 rounded border-neutral-300 text-sky-600 focus:ring-sky-500"
                      />
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <p className="font-medium text-neutral-900">{p.participante.nomeOriginal}</p>
                    {p.participante.email && (
                      <p className="text-xs text-neutral-500">{p.participante.email}</p>
                    )}
                    {p.participante.entradas.length > 1 && (
                      <p className="text-xs text-sky-600">
                        {p.participante.entradas.length} entradas
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={p.analise.cumpriuTempoMinimo ? "text-emerald-600" : "text-red-600"}>
                      {formatDuration(p.analise.tempoTotalMinutos)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={p.analise.cumpriuDinamica ? "text-emerald-600" : "text-red-600"}>
                      {p.analise.percentualDinamica}%
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {p.analise.aprovado ? (
                      <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        Aprovado
                      </span>
                    ) : (
                      <span className="inline-block rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                        Reprovado
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {!mergeMode && (
                      <div className="flex gap-1">
                        {!p.analise.aprovado && (
                          <button
                            onClick={() => onForceApprove(p.participante.nomeOriginal)}
                            className="rounded bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-200"
                            title="Aprovar manualmente mesmo sem cumprir objetivos"
                          >
                            Aprovar
                          </button>
                        )}
                        <button
                          onClick={() => onRemove(p.participante.nomeOriginal)}
                          className="rounded bg-red-100 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-200"
                        >
                          Remover
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              )})}
            </tbody>
          </table>
        </div>
      </div>

      {/* Participantes removidos */}
      {removedParticipants.length > 0 && (
        <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
          <div className="border-b border-neutral-100 bg-neutral-50 p-4">
            <h3 className="font-semibold text-neutral-700">
              Removidos ({removedParticipants.length})
            </h3>
            <p className="text-sm text-neutral-500">
              Clique em &quot;Restaurar&quot; para trazer de volta
            </p>
          </div>
          
          <div className="divide-y divide-neutral-100">
            {removedParticipants.map((p) => (
              <div key={p.participante.nomeOriginal} className="flex items-center justify-between p-3">
                <span className="text-neutral-500 line-through">{p.participante.nomeOriginal}</span>
                <button
                  onClick={() => onRestore(p.participante.nomeOriginal)}
                  className="rounded bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-200"
                >
                  Restaurar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Navegação */}
      <div className="flex items-center justify-between border-t border-neutral-200 pt-4">
        <button
          onClick={onBack}
          className="rounded-xl border border-neutral-300 px-6 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
        >
          ← Voltar
        </button>
        <button
          onClick={onNext}
          disabled={!canProceed}
          className="rounded-xl bg-neutral-900 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral-800 disabled:opacity-50"
        >
          Continuar para Associação →
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// ETAPA 3: ASSOCIAÇÃO
// ============================================================================

function AssociateStep({
  participants,
  associations,
  stats,
  onConfirmAssociation,
  onOpenSearch,
  onUpdateAssociation,
  onMarkNotFound,
  onOpenDoubtModal,
  onBack,
  onNext,
  canProceed,
}: {
  participants: ParticipantWithAnalysis[];
  associations: Map<string, AssociationData>;
  stats: { confirmed: number; pending: number; autoMatched: number; notFound: number; doubt: number; total: number };
  onConfirmAssociation: (nome: string) => void;
  onOpenSearch: (nome: string) => void;
  onUpdateAssociation: (nome: string, inscricao: InscricaoSimplificada | null, status: AssociationStatus) => void;
  onMarkNotFound: (nome: string) => void;
  onOpenDoubtModal: (nome: string) => void;
  onBack: () => void;
  onNext: () => void;
  canProceed: boolean;
}) {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-neutral-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-neutral-900">
          Passo 3: Associar a Inscrições
        </h2>
        <p className="mt-1 text-sm text-neutral-600">
          Cada participante precisa ser associado a uma inscrição. 
          Algumas associações foram feitas automaticamente - <strong>confirme ou corrija</strong> cada uma.
        </p>
      </div>

      {/* Progresso */}
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <SummaryCard label="Total" value={stats.total} color="neutral" />
        <SummaryCard label="Confirmados" value={stats.confirmed} color="emerald" />
        <SummaryCard label="Auto (pendente)" value={stats.autoMatched} color="violet" />
        <SummaryCard label="Sem Associação" value={stats.pending} color="amber" />
        <SummaryCard label="Não Encontrado" value={stats.notFound} color="red" />
        <SummaryCard label="Em Dúvida" value={stats.doubt} color="sky" />
      </div>

      {!canProceed && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          ⚠️ Você precisa confirmar todas as associações antes de continuar. 
          {stats.pending > 0 && ` Ainda há ${stats.pending} participante(s) sem associação.`}
          {stats.autoMatched > 0 && ` Ainda há ${stats.autoMatched} associação(ões) automática(s) para confirmar.`}
        </div>
      )}

      {/* Tabela de associações */}
      <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
              <tr>
                <th className="px-4 py-3 font-medium">Participante (Zoom)</th>
                <th className="px-4 py-3 font-medium">Tempo</th>
                <th className="px-4 py-3 font-medium">Inscrição Associada</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {participants.map((p) => {
                const assoc = associations.get(p.participante.nomeOriginal);
                const hasAssociation = assoc?.inscricaoId != null;
                const isConfirmed = assoc?.status === "confirmed";
                const isAuto = assoc?.status === "auto-matched";
                const isNotFound = assoc?.status === "not-found";
                const isDoubt = assoc?.status === "doubt";

                return (
                  <tr key={p.participante.nomeOriginal} className={`hover:bg-neutral-50 ${
                    !hasAssociation && !isNotFound && !isDoubt ? "bg-amber-50/50" : ""
                  }`}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-neutral-900">{p.participante.nomeOriginal}</p>
                      {p.participante.email && (
                        <p className="text-xs text-neutral-500">{p.participante.email}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={p.analise.aprovado ? "text-emerald-600" : "text-red-600"}>
                        {formatDuration(p.analise.tempoTotalMinutos)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {isNotFound ? (
                        <span className="italic text-red-600">Não foi possível encontrar</span>
                      ) : isDoubt ? (
                        <div>
                          <p className="font-medium text-sky-700">Em dúvida entre:</p>
                          <p className="text-xs text-neutral-600">1. {assoc?.inscricaoNome}</p>
                          <p className="text-xs text-neutral-600">2. {assoc?.inscricaoNome2}</p>
                        </div>
                      ) : hasAssociation ? (
                        <div>
                          <p className="font-medium text-neutral-900">{assoc?.inscricaoNome}</p>
                          {assoc?.inscricaoTelefone && (
                            <p className="text-xs text-neutral-500">{assoc.inscricaoTelefone}</p>
                          )}
                          {isAuto && assoc?.matchScore && (
                            <p className="text-xs text-violet-600">
                              Auto: {assoc.matchScore}% {assoc.matchReason && `(${assoc.matchReason})`}
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="italic text-amber-600">Sem associação</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isConfirmed ? (
                        <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                          ✓ Confirmado
                        </span>
                      ) : isAuto ? (
                        <span className="inline-block rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">
                          Auto-match
                        </span>
                      ) : isNotFound ? (
                        <span className="inline-block rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                          ✗ Não encontrado
                        </span>
                      ) : isDoubt ? (
                        <span className="inline-block rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700">
                          ⚠ Em dúvida
                        </span>
                      ) : (
                        <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                          Pendente
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {isAuto && (
                          <button
                            onClick={() => onConfirmAssociation(p.participante.nomeOriginal)}
                            className="rounded bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-200"
                          >
                            Confirmar
                          </button>
                        )}
                        {!isNotFound && !isDoubt && (
                          <button
                            onClick={() => onOpenSearch(p.participante.nomeOriginal)}
                            className="rounded bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-200"
                          >
                            {hasAssociation ? "Alterar" : "Buscar"}
                          </button>
                        )}
                        {!isNotFound && !isDoubt && !isConfirmed && (
                          <button
                            onClick={() => onMarkNotFound(p.participante.nomeOriginal)}
                            className="rounded bg-red-100 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-200"
                            title="Não foi possível encontrar a inscrição"
                          >
                            Não encontrado
                          </button>
                        )}
                        {!isNotFound && !isDoubt && !isConfirmed && (
                          <button
                            onClick={() => onOpenDoubtModal(p.participante.nomeOriginal)}
                            className="rounded bg-sky-100 px-2 py-1 text-xs font-medium text-sky-700 hover:bg-sky-200"
                            title="Dúvida entre duas inscrições"
                          >
                            Dúvida
                          </button>
                        )}
                        {(isNotFound || isDoubt) && (
                          <button
                            onClick={() => onUpdateAssociation(p.participante.nomeOriginal, null, "manual-pending")}
                            className="rounded bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-200"
                          >
                            Refazer
                          </button>
                        )}
                        {hasAssociation && !isConfirmed && !isNotFound && !isDoubt && (
                          <button
                            onClick={() => onUpdateAssociation(p.participante.nomeOriginal, null, "manual-pending")}
                            className="rounded bg-red-100 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-200"
                          >
                            Limpar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Navegação */}
      <div className="flex items-center justify-between border-t border-neutral-200 pt-4">
        <button
          onClick={onBack}
          className="rounded-xl border border-neutral-300 px-6 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
        >
          ← Voltar
        </button>
        <button
          onClick={onNext}
          disabled={!canProceed}
          className="rounded-xl bg-neutral-900 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral-800 disabled:opacity-50"
        >
          Revisar e Confirmar →
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// ETAPA 4: CONFIRMAÇÃO
// ============================================================================

interface ClusterData {
  code: string;
  name: string;
  presentes: Array<{
    participanteNome: string;
    inscricaoNome: string;
    inscricaoTelefone: string | null;
    aprovado: boolean;
    tempoTotal: number;
  }>;
  totalPresentes: number;
  totalAprovados: number;
}

function ConfirmStep({
  participants,
  associations,
  inscricoesDisponiveis,
  treinamentoId,
  isConfirming,
  confirmResult,
  onBack,
  onConfirm,
  onReset,
}: {
  participants: ParticipantWithAnalysis[];
  associations: Map<string, AssociationData>;
  inscricoesDisponiveis: InscricaoSimplificada[];
  treinamentoId: string;
  isConfirming: boolean;
  confirmResult: { success: boolean; message: string } | null;
  onBack: () => void;
  onConfirm: () => void;
  onReset: () => void;
}) {
  const aprovados = participants.filter(p => p.analise.aprovado);
  const reprovados = participants.filter(p => !p.analise.aprovado);
  
  // Separar por status
  const confirmedParticipants = participants.filter(p => {
    const assoc = associations.get(p.participante.nomeOriginal);
    return assoc?.status === "confirmed";
  });
  const notFoundParticipants = participants.filter(p => {
    const assoc = associations.get(p.participante.nomeOriginal);
    return assoc?.status === "not-found";
  });
  const doubtParticipants = participants.filter(p => {
    const assoc = associations.get(p.participante.nomeOriginal);
    return assoc?.status === "doubt";
  });

  // Gerar relatório para download
  const generateReport = () => {
    // Agrupar por Cluster (recrutador)
    const clusterMap = new Map<string, ClusterData>();
    
    // Inicializar clusters
    const recruiters = [
      { code: "01", name: "Rodrigo" },
      { code: "02", name: "Vanessa" },
      { code: "03", name: "Jane" },
      { code: "04", name: "Jhonatha" },
      { code: "05", name: "Agatha" },
      { code: "06", name: "Valda" },
      { code: "07", name: "Cely" },
      { code: "08", name: "Lourenço" },
      { code: "09", name: "Bárbara" },
      { code: "10", name: "Sandra" },
      { code: "11", name: "Karina" },
      { code: "12", name: "Paula Porto" },
      { code: "13", name: "Regina Gondim" },
      { code: "14", name: "Salete" },
      { code: "15", name: "Marcos" },
      { code: "16", name: "Ivaneide" },
      { code: "17", name: "Karen" },
      { code: "18", name: "Claudia Talib" },
      { code: "19", name: "Anselmo" },
      { code: "20", name: "Alessandra" },
      { code: "21", name: "Cleidiane" },
      { code: "22", name: "Renata Vergílio" },
      { code: "23", name: "Alice" },
      { code: "24", name: "Eliane/Márcio" },
      { code: "25", name: "Adriana Davies" },
      { code: "26", name: "Maria Léo" },
      { code: "27", name: "Marcelo" },
      { code: "28", name: "Adryelly" },
      { code: "29", name: "Aline Nobile" },
      { code: "30", name: "Kleidiane" },
      { code: "31", name: "Gilsemara" },
      { code: "32", name: "Josefa" },
      { code: "33", name: "Mara" },
      { code: "34", name: "Thais/Jorge" },
      { code: "35", name: "Recrutador 35" },
      { code: "36", name: "Recrutador 36" },
      { code: "37", name: "André Rufino" },
      { code: "38", name: "Recrutador 38" },
      { code: "39", name: "Recrutador 39" },
      { code: "40", name: "Recrutador 40" },
      { code: "41", name: "Recrutador 41" },
      { code: "42", name: "Recrutador 42" },
      { code: "43", name: "Recrutador 43" },
      { code: "44", name: "Recrutador 44" },
      { code: "45", name: "Recrutador 45" },
      { code: "46", name: "Lucas" },
      { code: "47", name: "Recrutador 47" },
      { code: "48", name: "Recrutador 48" },
      { code: "49", name: "Recrutador 49" },
      { code: "50", name: "Recrutador 50" },
      { code: "51", name: "Recrutador 51" },
      { code: "52", name: "Recrutador 52" },
      { code: "53", name: "Recrutador 53" },
      { code: "54", name: "Recrutador 54" },
      { code: "55", name: "Recrutador 55" },
      { code: "56", name: "Recrutador 56" },
      { code: "57", name: "Recrutador 57" },
      { code: "58", name: "Recrutador 58" },
      { code: "59", name: "Recrutador 59" },
      { code: "60", name: "Recrutador 60" },
      { code: "61", name: "Recrutador 61" },
      { code: "62", name: "Recrutador 62" },
      { code: "63", name: "Recrutador 63" },
      { code: "64", name: "Recrutador 64" },
      { code: "65", name: "Recrutador 65" },
      { code: "66", name: "Recrutador 66" },
      { code: "67", name: "Recrutador 67" },
      { code: "68", name: "Recrutador 68" },
      { code: "69", name: "Recrutador 69" },
      { code: "70", name: "Recrutador 70" },
    ];

    // Função para obter nome do recrutador pelo código
    const getRecruiterName = (code: string | null): string => {
      if (!code) return "Sem Cluster";
      const recruiter = recruiters.find(r => r.code === code);
      return recruiter ? recruiter.name : `Cluster ${code}`;
    };

    // Para confirmados, agrupar por cluster
    confirmedParticipants.forEach(p => {
      const assoc = associations.get(p.participante.nomeOriginal);
      if (!assoc || !assoc.inscricaoId) return;
      
      // Usar código do recrutador da associação
      const recruiterCode = assoc.inscricaoRecrutadorCodigo ?? "00";
      const recruiterName = getRecruiterName(recruiterCode);
      
      if (!clusterMap.has(recruiterCode)) {
        clusterMap.set(recruiterCode, {
          code: recruiterCode,
          name: recruiterName,
          presentes: [],
          totalPresentes: 0,
          totalAprovados: 0,
        });
      }
      
      const cluster = clusterMap.get(recruiterCode)!;
      cluster.presentes.push({
        participanteNome: p.participante.nomeOriginal,
        inscricaoNome: assoc.inscricaoNome ?? "",
        inscricaoTelefone: assoc.inscricaoTelefone,
        aprovado: p.analise.aprovado,
        tempoTotal: p.analise.tempoTotalMinutos,
      });
      cluster.totalPresentes++;
      if (p.analise.aprovado) {
        cluster.totalAprovados++;
      }
    });

    // Ordenar clusters por quantidade de APROVADOS (ranking)
    const sortedClusters = Array.from(clusterMap.values()).sort(
      (a, b) => b.totalAprovados - a.totalAprovados || b.totalPresentes - a.totalPresentes
    );

    // Top 5 para ranking
    const top5Clusters = sortedClusters.slice(0, 5);

    // Gerar texto do relatório
    let report = "";
    report += "═══════════════════════════════════════════════════════════════\n";
    report += "                 RELATÓRIO DE PRESENÇA NO ENCONTRO\n";
    report += "═══════════════════════════════════════════════════════════════\n";
    report += `Treinamento: ${treinamentoId}\n`;
    report += `Data do Relatório: ${new Date().toLocaleDateString("pt-BR")} ${new Date().toLocaleTimeString("pt-BR")}\n`;
    report += "\n";
    
    // Resumo geral
    report += "───────────────────────────────────────────────────────────────\n";
    report += "                         RESUMO GERAL\n";
    report += "───────────────────────────────────────────────────────────────\n";
    report += `Total de Participantes: ${participants.length}\n`;
    report += `Confirmados com Inscrição: ${confirmedParticipants.length}\n`;
    report += `Não Encontrados: ${notFoundParticipants.length}\n`;
    report += `Em Dúvida: ${doubtParticipants.length}\n`;
    report += `Aprovados (presença OK): ${aprovados.length}\n`;
    report += `Reprovados (faltou presença): ${reprovados.length}\n`;
    report += "\n";

    // Ranking Top 5 Clusters (ordenado por aprovados)
    report += "═══════════════════════════════════════════════════════════════\n";
    report += "           🏆 RANKING TOP 5 CLUSTERS\n";
    report += "═══════════════════════════════════════════════════════════════\n\n";
    
    top5Clusters.forEach((cluster, index) => {
      const medal = index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : "  ";
      report += `${medal} ${index + 1}º Lugar: ${cluster.name} - ${cluster.totalPresentes} presente(s)\n`;
    });
    report += "\n";

    // Presentes por Cluster
    report += "═══════════════════════════════════════════════════════════════\n";
    report += "                    PRESENTES POR CLUSTER\n";
    report += "═══════════════════════════════════════════════════════════════\n\n";

    sortedClusters.forEach(cluster => {
      report += `\n┌─────────────────────────────────────────────────────────────┐\n`;
      report += `│ CLUSTER: ${cluster.name.padEnd(47)} │\n`;
      report += `│ Presentes: ${(cluster.totalPresentes.toString()).padEnd(43)} │\n`;
      report += `└─────────────────────────────────────────────────────────────┘\n`;
      
      cluster.presentes.forEach((p, idx) => {
        const status = p.aprovado ? "✓ Aprovado" : "✗ Reprovado";
        report += `  ${(idx + 1).toString().padStart(2)}. ${p.inscricaoNome}\n`;
        report += `      Zoom: ${p.participanteNome}\n`;
        if (p.inscricaoTelefone) {
          report += `      Tel: ${p.inscricaoTelefone}\n`;
        }
        report += `      ${status} | Tempo: ${formatDuration(p.tempoTotal)}\n`;
      });
    });

    // Não Encontrados
    if (notFoundParticipants.length > 0) {
      report += "\n═══════════════════════════════════════════════════════════════\n";
      report += "              ❌ NÃO FOI POSSÍVEL ENCONTRAR INSCRIÇÃO\n";
      report += "═══════════════════════════════════════════════════════════════\n\n";
      
      notFoundParticipants.forEach((p, idx) => {
        const status = p.analise.aprovado ? "Aprovado (tempo OK)" : "Reprovado (tempo insuficiente)";
        report += `  ${(idx + 1).toString().padStart(2)}. ${p.participante.nomeOriginal}\n`;
        if (p.participante.email) {
          report += `      Email: ${p.participante.email}\n`;
        }
        report += `      ${status} | Tempo: ${formatDuration(p.analise.tempoTotalMinutos)}\n`;
      });
    }

    // Em Dúvida
    if (doubtParticipants.length > 0) {
      report += "\n═══════════════════════════════════════════════════════════════\n";
      report += "                    ⚠️ EM DÚVIDA DE INSCRIÇÃO\n";
      report += "═══════════════════════════════════════════════════════════════\n\n";
      
      doubtParticipants.forEach((p, idx) => {
        const assoc = associations.get(p.participante.nomeOriginal);
        const status = p.analise.aprovado ? "Aprovado (tempo OK)" : "Reprovado (tempo insuficiente)";
        report += `  ${(idx + 1).toString().padStart(2)}. ${p.participante.nomeOriginal}\n`;
        if (p.participante.email) {
          report += `      Email: ${p.participante.email}\n`;
        }
        report += `      ${status} | Tempo: ${formatDuration(p.analise.tempoTotalMinutos)}\n`;
        report += `      Candidata 1: ${assoc?.inscricaoNome ?? "N/A"}\n`;
        report += `      Candidata 2: ${assoc?.inscricaoNome2 ?? "N/A"}\n`;
      });
    }

    report += "\n═══════════════════════════════════════════════════════════════\n";
    report += "                      FIM DO RELATÓRIO\n";
    report += "═══════════════════════════════════════════════════════════════\n";

    // Download do arquivo
    const blob = new Blob([report], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `relatorio-presenca-${treinamentoId || "encontro"}-${new Date().toISOString().split("T")[0]}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-neutral-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-neutral-900">
          Passo 4: Confirmar e Salvar
        </h2>
        <p className="mt-1 text-sm text-neutral-600">
          Revise o resumo final e clique em &quot;Salvar&quot; para registrar as presenças.
        </p>
      </div>

      {/* Resumo */}
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <SummaryCard label="Total" value={participants.length} color="neutral" />
        <SummaryCard label="Confirmados" value={confirmedParticipants.length} color="emerald" />
        <SummaryCard label="Não Encontrados" value={notFoundParticipants.length} color="red" />
        <SummaryCard label="Em Dúvida" value={doubtParticipants.length} color="sky" />
        <SummaryCard label="Aprovados" value={aprovados.length} color="violet" />
      </div>

      {/* Botão de Relatório */}
      <div className="rounded-xl border border-neutral-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-neutral-900">Relatório de Presença</h3>
            <p className="text-sm text-neutral-500">
              Baixe o relatório com todos os Clusters, presenças, não encontrados e ranking
            </p>
          </div>
          <button
            onClick={generateReport}
            className="flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-500"
          >
            📥 Baixar Relatório
          </button>
        </div>
      </div>

      {/* Lista resumida - Confirmados */}
      <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
        <div className="border-b border-neutral-100 p-4 bg-emerald-50">
          <h3 className="font-semibold text-emerald-900">
            ✓ Associações Confirmadas ({confirmedParticipants.length})
          </h3>
        </div>
        <div className="max-h-64 overflow-y-auto divide-y divide-neutral-100">
          {confirmedParticipants.map((p) => {
            const assoc = associations.get(p.participante.nomeOriginal);
            return (
              <div key={p.participante.nomeOriginal} className="flex items-center justify-between p-3">
                <div className="flex items-center gap-3">
                  <span className={`inline-block h-2 w-2 rounded-full ${
                    p.analise.aprovado ? "bg-emerald-500" : "bg-red-500"
                  }`} />
                  <div>
                    <p className="font-medium text-neutral-900">{p.participante.nomeOriginal}</p>
                    <p className="text-xs text-neutral-500">→ {assoc?.inscricaoNome}</p>
                  </div>
                </div>
                <span className="text-sm text-neutral-500">
                  {formatDuration(p.analise.tempoTotalMinutos)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Lista - Não Encontrados */}
      {notFoundParticipants.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-white overflow-hidden">
          <div className="border-b border-red-100 p-4 bg-red-50">
            <h3 className="font-semibold text-red-900">
              ✗ Não Foi Possível Encontrar ({notFoundParticipants.length})
            </h3>
          </div>
          <div className="max-h-48 overflow-y-auto divide-y divide-neutral-100">
            {notFoundParticipants.map((p) => (
              <div key={p.participante.nomeOriginal} className="flex items-center justify-between p-3">
                <div className="flex items-center gap-3">
                  <span className={`inline-block h-2 w-2 rounded-full ${
                    p.analise.aprovado ? "bg-emerald-500" : "bg-red-500"
                  }`} />
                  <div>
                    <p className="font-medium text-neutral-900">{p.participante.nomeOriginal}</p>
                    {p.participante.email && (
                      <p className="text-xs text-neutral-500">{p.participante.email}</p>
                    )}
                  </div>
                </div>
                <span className="text-sm text-neutral-500">
                  {formatDuration(p.analise.tempoTotalMinutos)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Lista - Em Dúvida */}
      {doubtParticipants.length > 0 && (
        <div className="rounded-xl border border-sky-200 bg-white overflow-hidden">
          <div className="border-b border-sky-100 p-4 bg-sky-50">
            <h3 className="font-semibold text-sky-900">
              ⚠ Em Dúvida ({doubtParticipants.length})
            </h3>
          </div>
          <div className="max-h-48 overflow-y-auto divide-y divide-neutral-100">
            {doubtParticipants.map((p) => {
              const assoc = associations.get(p.participante.nomeOriginal);
              return (
                <div key={p.participante.nomeOriginal} className="p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`inline-block h-2 w-2 rounded-full ${
                        p.analise.aprovado ? "bg-emerald-500" : "bg-red-500"
                      }`} />
                      <p className="font-medium text-neutral-900">{p.participante.nomeOriginal}</p>
                    </div>
                    <span className="text-sm text-neutral-500">
                      {formatDuration(p.analise.tempoTotalMinutos)}
                    </span>
                  </div>
                  <div className="mt-1 ml-5 text-xs text-sky-600">
                    <p>Candidata 1: {assoc?.inscricaoNome}</p>
                    <p>Candidata 2: {assoc?.inscricaoNome2}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Resultado da confirmação */}
      {confirmResult && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${
          confirmResult.success
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-red-200 bg-red-50 text-red-700"
        }`}>
          {confirmResult.message}
        </div>
      )}

      {/* Navegação */}
      <div className="flex items-center justify-between border-t border-neutral-200 pt-4">
        {!confirmResult?.success ? (
          <>
            <button
              onClick={onBack}
              className="rounded-xl border border-neutral-300 px-6 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
            >
              ← Voltar
            </button>
            <button
              onClick={onConfirm}
              disabled={isConfirming}
              className="rounded-xl bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
            >
              {isConfirming ? "Salvando..." : "✓ Salvar Presenças"}
            </button>
          </>
        ) : (
          <button
            onClick={onReset}
            className="ml-auto rounded-xl bg-neutral-900 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral-800"
          >
            Importar Novo Arquivo
          </button>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// COMPONENTES AUXILIARES
// ============================================================================

function SummaryCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: "neutral" | "sky" | "emerald" | "red" | "violet" | "amber";
}) {
  const colorClasses = {
    neutral: "border-neutral-200 bg-neutral-50 text-neutral-900",
    sky: "border-sky-200 bg-sky-50 text-sky-900",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-900",
    red: "border-red-200 bg-red-50 text-red-900",
    violet: "border-violet-200 bg-violet-50 text-violet-900",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
  };

  return (
    <div className={`rounded-xl border p-4 ${colorClasses[color]}`}>
      <p className="text-xs uppercase tracking-wide opacity-70">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
    </div>
  );
}

function SearchModal({
  participanteNome,
  query,
  onQueryChange,
  filteredInscricoes,
  usedCount,
  onSelect,
  onClose,
}: {
  participanteNome: string | null;
  query: string;
  onQueryChange: (q: string) => void;
  filteredInscricoes: Array<InscricaoSimplificada & { isUsed: boolean; relevance: number }>;
  usedCount: number;
  onSelect: (inscricao: InscricaoSimplificada) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 p-4">
          <div>
            <h3 className="text-lg font-semibold text-neutral-900">Buscar Inscrição</h3>
            <p className="text-sm text-neutral-500">
              Associar a: <strong>{participanteNome}</strong>
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 hover:bg-neutral-100">
            ✕
          </button>
        </div>

        {/* Search */}
        <div className="border-b border-neutral-100 p-4">
          <input
            type="text"
            placeholder="Buscar por nome, telefone ou cidade..."
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            autoFocus
            className="w-full rounded-lg border border-neutral-300 px-4 py-2 text-sm focus:border-neutral-500 focus:outline-none"
          />
          <p className="mt-2 text-xs text-neutral-500">
            {filteredInscricoes.length} resultados • {usedCount} já associadas
          </p>
        </div>

        {/* Lista */}
        <div className="max-h-96 overflow-y-auto p-2">
          {filteredInscricoes.length === 0 ? (
            <p className="py-8 text-center text-neutral-500">Nenhuma inscrição encontrada</p>
          ) : (
            <div className="space-y-1">
              {filteredInscricoes.map((insc) => (
                <button
                  key={insc.id}
                  onClick={() => !insc.isUsed && onSelect(insc)}
                  disabled={insc.isUsed}
                  className={`w-full rounded-lg p-3 text-left transition ${
                    insc.isUsed
                      ? "cursor-not-allowed bg-neutral-50 opacity-50"
                      : "hover:bg-neutral-100"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-neutral-900">{insc.nome}</p>
                      <p className="text-sm text-neutral-500">
                        {insc.telefone || "Sem telefone"}
                        {insc.cidade && ` • ${insc.cidade}`}
                      </p>
                    </div>
                    {insc.isUsed ? (
                      <span className="text-xs text-neutral-400">Já associada</span>
                    ) : (
                      <span className="text-xs text-emerald-600">Selecionar →</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-neutral-200 p-4">
          <button
            onClick={onClose}
            className="w-full rounded-lg border border-neutral-300 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

function DoubtModal({
  participanteNome,
  query,
  onQueryChange,
  filteredInscricoes,
  selectedInscricoes,
  onToggleSelection,
  onConfirm,
  onClose,
}: {
  participanteNome: string | null;
  query: string;
  onQueryChange: (q: string) => void;
  filteredInscricoes: Array<InscricaoSimplificada & { isUsed: boolean; relevance: number }>;
  selectedInscricoes: InscricaoSimplificada[];
  onToggleSelection: (inscricao: InscricaoSimplificada) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const selectedIds = new Set(selectedInscricoes.map((i) => i.id));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 p-4">
          <div>
            <h3 className="text-lg font-semibold text-neutral-900">Dúvida de Inscrição</h3>
            <p className="text-sm text-neutral-500">
              Participante: <strong>{participanteNome}</strong>
            </p>
            <p className="text-xs text-sky-600 mt-1">
              Selecione exatamente 2 inscrições candidatas
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 hover:bg-neutral-100">
            ✕
          </button>
        </div>

        {/* Selecionadas */}
        {selectedInscricoes.length > 0 && (
          <div className="border-b border-neutral-100 bg-sky-50 p-4">
            <p className="text-xs font-medium text-sky-700 mb-2">
              Selecionadas ({selectedInscricoes.length}/2):
            </p>
            <div className="flex flex-wrap gap-2">
              {selectedInscricoes.map((insc, idx) => (
                <span
                  key={insc.id}
                  className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-3 py-1 text-sm text-sky-800"
                >
                  {idx + 1}. {insc.nome}
                  <button
                    onClick={() => onToggleSelection(insc)}
                    className="ml-1 text-sky-600 hover:text-sky-800"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Search */}
        <div className="border-b border-neutral-100 p-4">
          <input
            type="text"
            placeholder="Buscar por nome, telefone ou cidade..."
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            autoFocus
            className="w-full rounded-lg border border-neutral-300 px-4 py-2 text-sm focus:border-neutral-500 focus:outline-none"
          />
          <p className="mt-2 text-xs text-neutral-500">
            {filteredInscricoes.length} resultados
          </p>
        </div>

        {/* Lista */}
        <div className="max-h-72 overflow-y-auto p-2">
          {filteredInscricoes.length === 0 ? (
            <p className="py-8 text-center text-neutral-500">Nenhuma inscrição encontrada</p>
          ) : (
            <div className="space-y-1">
              {filteredInscricoes.map((insc) => {
                const isSelected = selectedIds.has(insc.id);
                const canSelect = !insc.isUsed && (isSelected || selectedInscricoes.length < 2);
                
                return (
                  <button
                    key={insc.id}
                    onClick={() => canSelect && onToggleSelection(insc)}
                    disabled={insc.isUsed || (!isSelected && selectedInscricoes.length >= 2)}
                    className={`w-full rounded-lg p-3 text-left transition ${
                      isSelected
                        ? "bg-sky-100 border-2 border-sky-400"
                        : insc.isUsed
                        ? "cursor-not-allowed bg-neutral-50 opacity-50"
                        : selectedInscricoes.length >= 2
                        ? "cursor-not-allowed opacity-50"
                        : "hover:bg-neutral-100"
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium text-neutral-900">{insc.nome}</p>
                        <p className="text-sm text-neutral-500">
                          {insc.telefone || "Sem telefone"}
                          {insc.cidade && ` • ${insc.cidade}`}
                        </p>
                      </div>
                      {isSelected ? (
                        <span className="text-xs text-sky-600 font-medium">✓ Selecionada</span>
                      ) : insc.isUsed ? (
                        <span className="text-xs text-neutral-400">Já associada</span>
                      ) : selectedInscricoes.length >= 2 ? (
                        <span className="text-xs text-neutral-400">Máximo atingido</span>
                      ) : (
                        <span className="text-xs text-sky-600">Selecionar</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 border-t border-neutral-200 p-4">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-neutral-300 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={selectedInscricoes.length !== 2}
            className="flex-1 rounded-lg bg-sky-600 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Confirmar Dúvida ({selectedInscricoes.length}/2)
          </button>
        </div>
      </div>
    </div>
  );
}
