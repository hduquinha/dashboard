"use client";

import { useState, useEffect, useMemo } from "react";
import {
  CheckCircle,
  XCircle,
  Clock,
  Search,
  Filter,
  Users,
  Calendar,
  Download,
  ChevronDown,
  UserCheck,
  UserX,
  Trash2,
  Loader2,
  AlertTriangle,
  HelpCircle,
  Link as LinkIcon,
  UserPlus,
  ArrowLeft,
} from "lucide-react";
import Link from "next/link";

interface PresenceRecord {
  inscricaoId: number;
  nome: string;
  telefone: string | null;
  cidade: string | null;
  email: string | null;
  treinamentoId: string;
  recrutadorCodigo: string | null;
  recrutadorNome: string | null;
  participanteNomeZoom: string | null;
  tempoTotalMinutos: number;
  tempoDinamicaMinutos: number;
  percentualDinamica: number;
  aprovado: boolean;
  validadoEm: string | null;
  // Multi-day fields
  totalDias: number;
  diaProcessado: number;
  dia1Aprovado: boolean | null;
  dia2Aprovado: boolean | null;
  dia1Tempo: number | null;
  dia2Tempo: number | null;
}

interface PendingRecord {
  id: number;
  participanteNome: string;
  treinamentoId: string;
  aprovado: boolean;
  tempoTotalMinutos: number;
  tempoDinamicaMinutos: number;
  percentualDinamica: number;
  status: "not-found" | "doubt";
  inscricaoId1: number | null;
  inscricaoNome1: string | null;
  inscricaoId2: number | null;
  inscricaoNome2: string | null;
  criadoEm: string;
}

interface InscricaoSearchResult {
  id: number;
  nome: string;
  telefone: string | null;
  cidade: string | null;
  treinamento: string | null;
  recrutadorCodigo: string | null;
}

interface ApiResponse {
  success: boolean;
  total: number;
  totalAprovados: number;
  totalReprovados: number;
  totalParciais: number;
  presences: PresenceRecord[];
  pending?: PendingRecord[];
  totalPending?: number;
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}min` : `${hours}h`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface ConfirmedPresencesClientProps {
  initialTraining?: string;
}

export default function ConfirmedPresencesClient({ initialTraining }: ConfirmedPresencesClientProps) {
  const [presences, setPresences] = useState<PresenceRecord[]>([]);
  const [pendingRecords, setPendingRecords] = useState<PendingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTraining, setSelectedTraining] = useState<string>(initialTraining ?? "all");
  const [showApproved, setShowApproved] = useState(true);
  const [showRejected, setShowRejected] = useState(true);
  const [showPartial, setShowPartial] = useState(true);
  const [activeTab, setActiveTab] = useState<"confirmed" | "pending">("confirmed");

  // Stats
  const [totalAprovados, setTotalAprovados] = useState(0);
  const [totalReprovados, setTotalReprovados] = useState(0);
  const [totalParciais, setTotalParciais] = useState(0);

  // Seleção em massa
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isRemovingBulk, setIsRemovingBulk] = useState(false);

  // Remoção de presença
  const [removingId, setRemovingId] = useState<number | null>(null);

  // Modal de reassociação
  const [resolveModalOpen, setResolveModalOpen] = useState(false);
  const [resolvingPending, setResolvingPending] = useState<PendingRecord | null>(null);
  const [resolveSearchQuery, setResolveSearchQuery] = useState("");
  const [resolveSearchResults, setResolveSearchResults] = useState<InscricaoSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isResolving, setIsResolving] = useState(false);

  // Toggle seleção de um item
  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Selecionar/deselecionar todos os filtrados
  const toggleSelectAll = () => {
    const filteredIds = filteredPresences.map((p) => p.inscricaoId);
    const allSelected = filteredIds.every((id) => selectedIds.has(id));
    
    if (allSelected) {
      // Deseleciona todos
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      // Seleciona todos
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredIds.forEach((id) => next.add(id));
        return next;
      });
    }
  };

  // Remover presenças selecionadas em massa
  const handleBulkRemove = async () => {
    if (selectedIds.size === 0) return;
    
    const count = selectedIds.size;
    if (!confirm(`Tem certeza que deseja desassociar ${count} presença(s)?\n\nIsso irá remover a validação de presença e descontabilizar do ranking.`)) {
      return;
    }

    setIsRemovingBulk(true);

    try {
      const response = await fetch("/api/presence/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inscricaoIds: Array.from(selectedIds) }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error ?? "Erro ao remover presenças");
      }

      // Atualiza contadores antes de remover
      const removedItems = presences.filter((p) => selectedIds.has(p.inscricaoId));
      const removedAprovados = removedItems.filter((p) => p.aprovado).length;
      const removedParciais = removedItems.filter((p) => getPresenceStatus(p) === "partial").length;
      const removedReprovados = removedItems.filter((p) => getPresenceStatus(p) === "rejected").length;

      // Remove da lista local
      setPresences((prev) => prev.filter((p) => !selectedIds.has(p.inscricaoId)));
      
      // Atualiza contadores
      setTotalAprovados((prev) => prev - removedAprovados);
      setTotalReprovados((prev) => prev - removedReprovados);
      setTotalParciais((prev) => prev - removedParciais);

      // Limpa seleção
      setSelectedIds(new Set());

      alert(data.message);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao remover presenças");
    } finally {
      setIsRemovingBulk(false);
    }
  };

  // Função para remover presença
  const handleRemovePresence = async (inscricaoId: number, nome: string) => {
    if (!confirm(`Tem certeza que deseja desassociar a presença de "${nome}"?\n\nIsso irá remover a validação de presença e descontabilizar do ranking.`)) {
      return;
    }

    setRemovingId(inscricaoId);

    try {
      const response = await fetch("/api/presence/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inscricaoId }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error ?? "Erro ao remover presença");
      }

      // Remove da lista local
      setPresences((prev) => prev.filter((p) => p.inscricaoId !== inscricaoId));
      
      // Atualiza contadores
      const removed = presences.find((p) => p.inscricaoId === inscricaoId);
      if (removed) {
        const status = getPresenceStatus(removed);
        if (status === "approved") {
          setTotalAprovados((prev) => prev - 1);
        } else if (status === "rejected") {
          setTotalReprovados((prev) => prev - 1);
        } else {
          setTotalParciais((prev) => prev - 1);
        }
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao remover presença");
    } finally {
      setRemovingId(null);
    }
  };

  // Carregar dados
  useEffect(() => {
    async function fetchPresences() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/presence/list?aprovados=false");
        if (!response.ok) {
          throw new Error("Falha ao carregar presenças");
        }
        const data: ApiResponse = await response.json();
        setPresences(data.presences);
        setPendingRecords(data.pending ?? []);
        setTotalAprovados(data.totalAprovados);
        setTotalReprovados(data.totalReprovados);
        setTotalParciais(data.totalParciais ?? 0);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro desconhecido");
      } finally {
        setLoading(false);
      }
    }

    fetchPresences();
  }, []);

  // Buscar inscrições para resolução
  useEffect(() => {
    if (!resolveSearchQuery || resolveSearchQuery.length < 2) {
      setResolveSearchResults([]);
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(async () => {
      setIsSearching(true);
      try {
        const response = await fetch(
          `/api/presence/resolve?q=${encodeURIComponent(resolveSearchQuery)}`,
          { signal: controller.signal }
        );
        if (response.ok) {
          const data = await response.json();
          setResolveSearchResults(data.inscricoes ?? []);
        }
      } catch {
        // Ignorar erros de abort
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [resolveSearchQuery]);

  // Abrir modal de resolução
  const openResolveModal = (pending: PendingRecord) => {
    setResolvingPending(pending);
    setResolveSearchQuery(pending.participanteNome.split(" ")[0]);
    setResolveSearchResults([]);
    setResolveModalOpen(true);
  };

  // Resolver pendente (associar a uma inscrição)
  const handleResolve = async (inscricaoId: number) => {
    if (!resolvingPending) return;

    setIsResolving(true);
    try {
      const response = await fetch("/api/presence/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pendingId: resolvingPending.id,
          inscricaoId,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error ?? "Erro ao resolver");
      }

      // Remove da lista de pendentes
      setPendingRecords((prev) => prev.filter((p) => p.id !== resolvingPending.id));

      // Fecha o modal
      setResolveModalOpen(false);
      setResolvingPending(null);
      setResolveSearchQuery("");

      // Recarrega as presenças confirmadas
      const presencesResponse = await fetch("/api/presence/list?aprovados=false");
      if (presencesResponse.ok) {
        const presencesData: ApiResponse = await presencesResponse.json();
        setPresences(presencesData.presences);
        setTotalAprovados(presencesData.totalAprovados);
        setTotalReprovados(presencesData.totalReprovados);
        setTotalParciais(presencesData.totalParciais ?? 0);
      }

      alert("Presença associada com sucesso!");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao resolver");
    } finally {
      setIsResolving(false);
    }
  };

  // Lista de treinamentos únicos
  const trainings = useMemo(() => {
    const unique = new Set(presences.map((p) => p.treinamentoId));
    return Array.from(unique).sort();
  }, [presences]);

  // Helper to determine presence status
  const getPresenceStatus = (p: PresenceRecord): "approved" | "rejected" | "partial" => {
    if (p.aprovado) return "approved";
    if (p.totalDias === 2 && p.diaProcessado < 2) return "partial";
    return "rejected";
  };

  // Filtrar presenças
  const filteredPresences = useMemo(() => {
    return presences.filter((p) => {
      // Filtro de busca
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesName = p.nome.toLowerCase().includes(query);
        const matchesZoom = p.participanteNomeZoom?.toLowerCase().includes(query);
        const matchesPhone = p.telefone?.includes(query);
        const matchesCity = p.cidade?.toLowerCase().includes(query);
        const matchesRecruiter = p.recrutadorNome?.toLowerCase().includes(query);
        if (!matchesName && !matchesZoom && !matchesPhone && !matchesCity && !matchesRecruiter) {
          return false;
        }
      }

      // Filtro de treinamento
      if (selectedTraining !== "all" && p.treinamentoId !== selectedTraining) {
        return false;
      }

      // Filtro de status
      const status = getPresenceStatus(p);
      if (status === "approved" && !showApproved) return false;
      if (status === "rejected" && !showRejected) return false;
      if (status === "partial" && !showPartial) return false;

      return true;
    });
  }, [presences, searchQuery, selectedTraining, showApproved, showRejected, showPartial]);

  // Filtrar pendentes
  const filteredPending = useMemo(() => {
    return pendingRecords.filter((p) => {
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesName = p.participanteNome.toLowerCase().includes(query);
        if (!matchesName) return false;
      }
      if (selectedTraining !== "all" && p.treinamentoId !== selectedTraining) {
        return false;
      }
      return true;
    });
  }, [pendingRecords, searchQuery, selectedTraining]);

  const getRecruiterName = (code: string | null): string => {
    if (!code) return "Sem Cluster";
    return `Cluster ${code}`;
  };

  // Gerar relatório com ranking de clusters
  const handleGenerateReport = () => {
    const dataToExport = selectedTraining === "all" 
      ? filteredPresences 
      : filteredPresences.filter(p => p.treinamentoId === selectedTraining);

    // Agrupar por cluster
    const clusterMap = new Map<string, {
      code: string;
      name: string;
      presentes: PresenceRecord[];
      totalPresentes: number;
      totalAprovados: number;
      totalParciais: number;
    }>();

    dataToExport.forEach(p => {
      const code = p.recrutadorCodigo ?? "00";
      const name = getRecruiterName(code);
      
      if (!clusterMap.has(code)) {
        clusterMap.set(code, {
          code,
          name,
          presentes: [],
          totalPresentes: 0,
          totalAprovados: 0,
          totalParciais: 0,
        });
      }
      
      const cluster = clusterMap.get(code)!;
      cluster.presentes.push(p);
      cluster.totalPresentes++;
      if (p.aprovado) {
        cluster.totalAprovados++;
      }
      if (getPresenceStatus(p) === "partial") {
        cluster.totalParciais++;
      }
    });

    // Ranking: ordenar por aprovados (ambos os dias)
    const sortedClusters = Array.from(clusterMap.values()).sort(
      (a, b) => b.totalAprovados - a.totalAprovados || b.totalPresentes - a.totalPresentes
    );

    const top5Clusters = sortedClusters.slice(0, 5);

    // Stats
    const totalAprovadosReport = dataToExport.filter(p => p.aprovado).length;
    const totalParciaisReport = dataToExport.filter(p => getPresenceStatus(p) === "partial").length;
    const totalReprovadosReport = dataToExport.filter(p => getPresenceStatus(p) === "rejected").length;

    // Gerar relatório
    let report = "";
    report += "═══════════════════════════════════════════════════════════════\n";
    report += "                 RELATÓRIO DE PRESENÇA NO ENCONTRO\n";
    report += "═══════════════════════════════════════════════════════════════\n";
    report += `Treinamento: ${selectedTraining === "all" ? "Todos" : selectedTraining}\n`;
    report += `Data do Relatório: ${new Date().toLocaleDateString("pt-BR")} ${new Date().toLocaleTimeString("pt-BR")}\n`;
    report += "\n";
    
    // Resumo
    report += "───────────────────────────────────────────────────────────────\n";
    report += "                         RESUMO GERAL\n";
    report += "───────────────────────────────────────────────────────────────\n";
    report += `Total de Participantes: ${dataToExport.length}\n`;
    report += `Aprovados (presença completa): ${totalAprovadosReport}\n`;
    if (totalParciaisReport > 0) {
      report += `Parciais (aguardando Dia 2): ${totalParciaisReport}\n`;
    }
    report += `Reprovados (faltou presença): ${totalReprovadosReport}\n`;
    report += "\n";

    // Ranking — apenas aprovados contam
    report += "═══════════════════════════════════════════════════════════════\n";
    report += "           🏆 RANKING TOP 5 CLUSTERS (APROVADOS)\n";
    report += "═══════════════════════════════════════════════════════════════\n\n";
    
    top5Clusters.forEach((cluster, index) => {
      const medal = index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : "  ";
      report += `${medal} ${index + 1}º Lugar: ${cluster.name} - ${cluster.totalAprovados} aprovado(s) de ${cluster.totalPresentes} presente(s)\n`;
    });
    report += "\n";

    // Presentes por Cluster
    report += "═══════════════════════════════════════════════════════════════\n";
    report += "                    PRESENTES POR CLUSTER\n";
    report += "═══════════════════════════════════════════════════════════════\n";

    sortedClusters.forEach(cluster => {
      report += `\n┌─────────────────────────────────────────────────────────────┐\n`;
      report += `│ CLUSTER: ${cluster.name.padEnd(47)} │\n`;
      report += `│ Presentes: ${(cluster.totalPresentes.toString()).padEnd(10)} Aprovados: ${(cluster.totalAprovados.toString()).padEnd(10)} ${cluster.totalParciais > 0 ? `Parciais: ${cluster.totalParciais}` : ""}`.padEnd(62) + `│\n`;
      report += `└─────────────────────────────────────────────────────────────┘\n`;
      
      cluster.presentes.forEach((p, idx) => {
        const status = getPresenceStatus(p);
        const statusLabel = status === "approved" ? "✓ Aprovado" : status === "partial" ? "⏳ Parcial (Dia 1)" : "✗ Reprovado";
        report += `  ${(idx + 1).toString().padStart(2)}. ${p.nome}\n`;
        if (p.participanteNomeZoom) {
          report += `      Zoom: ${p.participanteNomeZoom}\n`;
        }
        if (p.telefone) {
          report += `      Tel: ${p.telefone}\n`;
        }
        report += `      ${statusLabel} | Tempo: ${formatMinutes(p.tempoTotalMinutos)}`;
        if (p.totalDias === 2) {
          report += ` (D1: ${p.dia1Tempo != null ? formatMinutes(p.dia1Tempo) : "—"}`;
          report += ` · D2: ${p.dia2Tempo != null ? formatMinutes(p.dia2Tempo) : "—"})`;
        }
        report += "\n";
      });
    });

    report += "\n═══════════════════════════════════════════════════════════════\n";
    report += "                      FIM DO RELATÓRIO\n";
    report += "═══════════════════════════════════════════════════════════════\n";

    // Download
    const blob = new Blob([report], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `relatorio-presenca-${selectedTraining === "all" ? "todos" : selectedTraining}-${new Date().toISOString().split("T")[0]}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Gerar PDF com gráfico
  const [generatingPdf, setGeneratingPdf] = useState(false);
  
  const handleGeneratePDF = async () => {
    const dataToExport = selectedTraining === "all" 
      ? filteredPresences 
      : filteredPresences.filter(p => p.treinamentoId === selectedTraining);

    // Agrupar por cluster
    const clusterMap = new Map<string, {
      code: string;
      name: string;
      presentes: Array<{
        nome: string;
        participanteNomeZoom: string | null;
        telefone: string | null;
        aprovado: boolean;
        tempoTotalMinutos: number;
        status: "approved" | "rejected" | "partial";
      }>;
      totalPresentes: number;
      totalAprovados: number;
    }>();

    dataToExport.forEach(p => {
      const code = p.recrutadorCodigo ?? "00";
      const name = getRecruiterName(code);
      
      if (!clusterMap.has(code)) {
        clusterMap.set(code, {
          code,
          name,
          presentes: [],
          totalPresentes: 0,
          totalAprovados: 0,
        });
      }
      
      const cluster = clusterMap.get(code)!;
      cluster.presentes.push({
        nome: p.nome,
        participanteNomeZoom: p.participanteNomeZoom,
        telefone: p.telefone,
        aprovado: p.aprovado,
        tempoTotalMinutos: p.tempoTotalMinutos,
        status: getPresenceStatus(p),
      });
      cluster.totalPresentes++;
      if (p.aprovado) {
        cluster.totalAprovados++;
      }
    });

    const clusters = Array.from(clusterMap.values());
    const totalAprovadosPdf = dataToExport.filter(p => p.aprovado).length;
    const totalParciaisPdf = dataToExport.filter(p => getPresenceStatus(p) === "partial").length;
    const totalReprovadosPdf = dataToExport.filter(p => getPresenceStatus(p) === "rejected").length;

    setGeneratingPdf(true);
    try {
      const response = await fetch("/api/presence/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          treinamentoId: selectedTraining === "all" ? "Todos os Treinamentos" : selectedTraining,
          clusters,
          totalParticipantes: dataToExport.length,
          totalAprovados: totalAprovadosPdf,
          totalParciais: totalParciaisPdf,
          totalReprovados: totalReprovadosPdf,
        }),
      });

      if (!response.ok) {
        throw new Error("Erro ao gerar PDF");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `relatorio-presenca-${selectedTraining === "all" ? "todos" : selectedTraining}-${new Date().toISOString().split("T")[0]}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao gerar PDF");
    } finally {
      setGeneratingPdf(false);
    }
  };

  // Exportar CSV
  const handleExport = () => {
    const headers = [
      "Nome",
      "Telefone",
      "Email",
      "Cidade",
      "Treinamento",
      "Recrutador",
      "Nome Zoom",
      "Tempo Total (min)",
      "Tempo Dia 1 (min)",
      "Tempo Dia 2 (min)",
      "Total Dias",
      "Dia Processado",
      "Status",
      "Validado Em",
    ];

    const rows = filteredPresences.map((p) => [
      p.nome,
      p.telefone ?? "",
      p.email ?? "",
      p.cidade ?? "",
      p.treinamentoId,
      p.recrutadorNome ?? p.recrutadorCodigo ?? "",
      p.participanteNomeZoom ?? "",
      p.tempoTotalMinutos.toString(),
      p.dia1Tempo != null ? p.dia1Tempo.toString() : "",
      p.dia2Tempo != null ? p.dia2Tempo.toString() : "",
      p.totalDias.toString(),
      p.diaProcessado.toString(),
      getPresenceStatus(p) === "approved" ? "Aprovado" : getPresenceStatus(p) === "partial" ? "Parcial (Dia 1)" : "Reprovado",
      p.validadoEm ?? "",
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map((row) =>
        row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `presencas_confirmadas_${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <main className="space-y-6">
        <header>
          <h1 className="text-2xl font-bold text-neutral-900">Presenças Confirmadas</h1>
          <p className="text-sm text-neutral-500">Carregando...</p>
        </header>
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-neutral-200 border-t-cyan-500" />
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="space-y-6">
        <header>
          <h1 className="text-2xl font-bold text-neutral-900">Presenças Confirmadas</h1>
        </header>
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
          <XCircle className="mx-auto h-12 w-12 text-red-400" />
          <p className="mt-4 text-red-700">{error}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="space-y-6">
      {/* Header */}
      <header className="flex flex-col gap-4">
        <Link
          href="/presenca"
          className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900 transition-colors w-fit"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar para Presença
        </Link>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-neutral-900">Presenças Confirmadas</h1>
            <p className="text-sm text-neutral-500">
              Participantes com presença validada nos treinamentos
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleGenerateReport}
              disabled={filteredPresences.length === 0}
              className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              📊 Relatório TXT
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={filteredPresences.length === 0}
              className="inline-flex items-center gap-2 rounded-xl bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              CSV
            </button>
          </div>
        </div>
      </header>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
        <div className="flex items-center gap-4 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#2DBDC2]/10">
            <Users className="h-6 w-6 text-[#2DBDC2]" />
          </div>
          <div>
            <p className="text-sm font-medium text-neutral-500">Total Validados</p>
            <p className="text-2xl font-bold text-neutral-900">{presences.length}</p>
          </div>
        </div>

        <div className="flex items-center gap-4 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50">
            <UserCheck className="h-6 w-6 text-emerald-500" />
          </div>
          <div>
            <p className="text-sm font-medium text-neutral-500">Aprovados</p>
            <p className="text-2xl font-bold text-emerald-600">{totalAprovados}</p>
          </div>
        </div>

        <div className="flex items-center gap-4 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-sky-50">
            <Clock className="h-6 w-6 text-sky-500" />
          </div>
          <div>
            <p className="text-sm font-medium text-neutral-500">Parciais (Dia 1)</p>
            <p className="text-2xl font-bold text-sky-600">{totalParciais}</p>
          </div>
        </div>

        <div className="flex items-center gap-4 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-50">
            <UserX className="h-6 w-6 text-red-500" />
          </div>
          <div>
            <p className="text-sm font-medium text-neutral-500">Reprovados</p>
            <p className="text-2xl font-bold text-red-600">{totalReprovados}</p>
          </div>
        </div>

        <div className="flex items-center gap-4 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-50">
            <Calendar className="h-6 w-6 text-purple-500" />
          </div>
          <div>
            <p className="text-sm font-medium text-neutral-500">Treinamentos</p>
            <p className="text-2xl font-bold text-purple-600">{trainings.length}</p>
          </div>
        </div>

        <div className="flex items-center gap-4 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50">
            <AlertTriangle className="h-6 w-6 text-amber-500" />
          </div>
          <div>
            <p className="text-sm font-medium text-neutral-500">Pendentes</p>
            <p className="text-2xl font-bold text-amber-600">{pendingRecords.length}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-neutral-200">
        <button
          type="button"
          onClick={() => setActiveTab("confirmed")}
          className={`px-4 py-2 text-sm font-medium transition ${
            activeTab === "confirmed"
              ? "border-b-2 border-[#2DBDC2] text-[#2DBDC2]"
              : "text-neutral-500 hover:text-neutral-700"
          }`}
        >
          ✓ Confirmados ({presences.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("pending")}
          className={`px-4 py-2 text-sm font-medium transition ${
            activeTab === "pending"
              ? "border-b-2 border-amber-500 text-amber-600"
              : "text-neutral-500 hover:text-neutral-700"
          }`}
        >
          ⚠ Pendentes ({pendingRecords.length})
        </button>
      </div>

      {/* Conteúdo baseado na aba ativa */}
      {activeTab === "confirmed" ? (
        <>
          {/* Filters */}
          <div className="flex flex-col gap-4 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm md:flex-row md:items-center">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
              <input
                type="text"
                placeholder="Buscar por nome, telefone, cidade ou recrutador..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-xl border border-neutral-200 bg-neutral-50 py-2.5 pl-10 pr-4 text-sm transition focus:border-cyan-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-cyan-400/20"
              />
            </div>

            {/* Training Filter */}
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
              <select
                value={selectedTraining}
                onChange={(e) => setSelectedTraining(e.target.value)}
                className="appearance-none rounded-xl border border-neutral-200 bg-neutral-50 py-2.5 pl-10 pr-10 text-sm transition focus:border-cyan-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-cyan-400/20"
              >
                <option value="all">Todos os treinamentos</option>
                {trainings.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            </div>

            {/* Status Toggles */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowApproved(!showApproved)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  showApproved
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-neutral-100 text-neutral-400"
                }`}
              >
                <CheckCircle className="h-4 w-4" />
                Aprovados
              </button>
              <button
                type="button"
                onClick={() => setShowPartial(!showPartial)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  showPartial
                    ? "bg-sky-100 text-sky-700"
                    : "bg-neutral-100 text-neutral-400"
                }`}
              >
                <Clock className="h-4 w-4" />
                Parciais
              </button>
              <button
                type="button"
                onClick={() => setShowRejected(!showRejected)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  showRejected
                    ? "bg-red-100 text-red-700"
                    : "bg-neutral-100 text-neutral-400"
                }`}
              >
                <XCircle className="h-4 w-4" />
                Reprovados
              </button>
            </div>

            {/* Botão de desassociar em massa */}
            {selectedIds.size > 0 && (
              <button
                type="button"
                onClick={handleBulkRemove}
                disabled={isRemovingBulk}
                className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isRemovingBulk ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                Desassociar ({selectedIds.size})
              </button>
            )}
          </div>

          {/* Results */}
          <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm">
            <div className="border-b border-neutral-100 px-6 py-4">
              <p className="text-sm text-neutral-500">
                Exibindo <span className="font-medium text-neutral-900">{filteredPresences.length}</span> de{" "}
                <span className="font-medium text-neutral-900">{presences.length}</span> registros
              </p>
            </div>

            {filteredPresences.length === 0 ? (
              <div className="py-16 text-center">
                <Users className="mx-auto h-12 w-12 text-neutral-300" />
                <h3 className="mt-4 text-lg font-medium text-neutral-900">Nenhum registro encontrado</h3>
                <p className="mt-2 text-sm text-neutral-500">
                  Ajuste os filtros ou aguarde a validação de presenças.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-neutral-50 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
                    <tr>
                      <th className="px-4 py-3 w-12">
                        <input
                          type="checkbox"
                          checked={filteredPresences.length > 0 && filteredPresences.every((p) => selectedIds.has(p.inscricaoId))}
                          onChange={toggleSelectAll}
                          className="h-4 w-4 rounded border-neutral-300 text-cyan-600 focus:ring-cyan-500"
                        />
                      </th>
                      <th className="px-6 py-3">Participante</th>
                      <th className="px-6 py-3">Contato</th>
                      <th className="px-6 py-3">Treinamento</th>
                      <th className="px-6 py-3">Recrutador</th>
                      <th className="px-6 py-3">Tempo</th>
                      <th className="px-6 py-3">Dias</th>
                      <th className="px-6 py-3">Status</th>
                      <th className="px-6 py-3">Validado</th>
                      <th className="px-6 py-3">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {filteredPresences.map((p) => (
                      <tr key={p.inscricaoId} className={`hover:bg-neutral-50 ${selectedIds.has(p.inscricaoId) ? 'bg-cyan-50' : ''}`}>
                        <td className="px-4 py-4">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(p.inscricaoId)}
                            onChange={() => toggleSelect(p.inscricaoId)}
                            className="h-4 w-4 rounded border-neutral-300 text-cyan-600 focus:ring-cyan-500"
                          />
                        </td>
                        <td className="px-6 py-4">
                          <div>
                            <p className="font-medium text-neutral-900">{p.nome}</p>
                            {p.participanteNomeZoom && p.participanteNomeZoom !== p.nome && (
                              <p className="text-xs text-neutral-500">
                                Zoom: {p.participanteNomeZoom}
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm">
                            {p.telefone && <p className="text-neutral-700">{p.telefone}</p>}
                            {p.cidade && <p className="text-neutral-500">{p.cidade}</p>}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="inline-flex items-center rounded-lg bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-700">
                            {p.treinamentoId}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm text-neutral-600">
                            {p.recrutadorNome ?? p.recrutadorCodigo ?? "-"}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-1.5 text-sm text-neutral-600">
                            <Clock className="h-4 w-4" />
                            {formatMinutes(p.tempoTotalMinutos)}
                          </div>
                          {p.totalDias === 2 && (
                            <div className="mt-1 text-xs text-neutral-400">
                              {p.dia1Tempo != null && <span>D1: {formatMinutes(p.dia1Tempo)}</span>}
                              {p.dia1Tempo != null && p.dia2Tempo != null && <span> · </span>}
                              {p.dia2Tempo != null && <span>D2: {formatMinutes(p.dia2Tempo)}</span>}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          {p.totalDias === 2 ? (
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-1">
                                <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                  p.dia1Aprovado === true ? "bg-emerald-100 text-emerald-700" : p.dia1Aprovado === false ? "bg-red-100 text-red-700" : "bg-neutral-100 text-neutral-500"
                                }`}>
                                  D1 {p.dia1Aprovado === true ? "✓" : p.dia1Aprovado === false ? "✗" : "—"}
                                </span>
                                <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                  p.dia2Aprovado === true ? "bg-emerald-100 text-emerald-700" : p.dia2Aprovado === false ? "bg-red-100 text-red-700" : "bg-neutral-100 text-neutral-500"
                                }`}>
                                  D2 {p.dia2Aprovado === true ? "✓" : p.dia2Aprovado === false ? "✗" : "—"}
                                </span>
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-neutral-400">1 dia</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          {(() => {
                            const status = getPresenceStatus(p);
                            if (status === "approved") return (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">
                                <CheckCircle className="h-3 w-3" />
                                Aprovado
                              </span>
                            );
                            if (status === "partial") return (
                              <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2.5 py-1 text-xs font-medium text-sky-700">
                                <Clock className="h-3 w-3" />
                                Dia 1 ✓
                              </span>
                            );
                            return (
                              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700">
                                <XCircle className="h-3 w-3" />
                                Reprovado
                              </span>
                            );
                          })()}
                        </td>
                        <td className="px-6 py-4 text-xs text-neutral-500">
                          {formatDate(p.validadoEm)}
                        </td>
                        <td className="px-6 py-4">
                          <button
                            type="button"
                            onClick={() => handleRemovePresence(p.inscricaoId, p.nome)}
                            disabled={removingId === p.inscricaoId}
                            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                            title="Desassociar presença"
                          >
                            {removingId === p.inscricaoId ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                            Desassociar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          {/* Pending Records Section */}
          <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm">
            <div className="border-b border-neutral-100 px-6 py-4">
              <p className="text-sm text-neutral-500">
                <span className="font-medium text-neutral-900">{filteredPending.length}</span> participantes pendentes de associação
              </p>
            </div>

            {filteredPending.length === 0 ? (
              <div className="py-16 text-center">
                <CheckCircle className="mx-auto h-12 w-12 text-emerald-300" />
                <h3 className="mt-4 text-lg font-medium text-neutral-900">Nenhum pendente</h3>
                <p className="mt-2 text-sm text-neutral-500">
                  Todos os participantes foram associados corretamente.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-neutral-50 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
                    <tr>
                      <th className="px-6 py-3">Participante (Zoom)</th>
                      <th className="px-6 py-3">Treinamento</th>
                      <th className="px-6 py-3">Status</th>
                      <th className="px-6 py-3">Tempo</th>
                      <th className="px-6 py-3">Dinâmica</th>
                      <th className="px-6 py-3">Criado em</th>
                      <th className="px-6 py-3">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {filteredPending.map((p) => (
                      <tr key={p.id} className="hover:bg-neutral-50">
                        <td className="px-6 py-4">
                          <p className="font-medium text-neutral-900">{p.participanteNome}</p>
                        </td>
                        <td className="px-6 py-4">
                          <span className="inline-flex items-center rounded-lg bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-700">
                            {p.treinamentoId}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          {p.status === "not-found" ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">
                              <Search className="h-3 w-3" />
                              Não encontrado
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2.5 py-1 text-xs font-medium text-purple-700">
                              <AlertTriangle className="h-3 w-3" />
                              Dúvida
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-1.5 text-sm text-neutral-600">
                            <Clock className="h-4 w-4" />
                            {formatMinutes(p.tempoTotalMinutos)}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-16 overflow-hidden rounded-full bg-neutral-200">
                              <div
                                className={`h-full rounded-full ${
                                  p.percentualDinamica >= 100
                                    ? "bg-emerald-500"
                                    : p.percentualDinamica >= 50
                                      ? "bg-amber-500"
                                      : "bg-red-500"
                                }`}
                                style={{ width: `${Math.min(p.percentualDinamica, 100)}%` }}
                              />
                            </div>
                            <span className="text-xs text-neutral-500">{p.percentualDinamica}%</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-xs text-neutral-500">
                          {formatDate(p.criadoEm)}
                        </td>
                        <td className="px-6 py-4">
                          <button
                            type="button"
                            onClick={() => openResolveModal(p)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-[#2DBDC2] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[#25a5a9]"
                          >
                            <UserPlus className="h-4 w-4" />
                            Associar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Resolve Modal */}
      {resolveModalOpen && resolvingPending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-neutral-900">
                Associar Participante
              </h3>
              <button
                type="button"
                onClick={() => {
                  setResolveModalOpen(false);
                  setResolvingPending(null);
                  setResolveSearchQuery("");
                  setResolveSearchResults([]);
                }}
                className="rounded-lg p-1 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-600"
              >
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            <div className="mb-4 rounded-lg bg-amber-50 p-3">
              <p className="text-sm text-amber-800">
                <strong>Nome no Zoom:</strong> {resolvingPending.participanteNome}
              </p>
              <p className="text-sm text-amber-700">
                Treinamento: {resolvingPending.treinamentoId} | Tempo: {formatMinutes(resolvingPending.tempoTotalMinutos)} | Dinâmica: {resolvingPending.percentualDinamica}%
              </p>
            </div>

            <div className="mb-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                <input
                  type="text"
                  placeholder="Buscar inscrição por nome ou telefone..."
                  value={resolveSearchQuery}
                  onChange={(e) => setResolveSearchQuery(e.target.value)}
                  className="w-full rounded-xl border border-neutral-200 bg-neutral-50 py-2.5 pl-10 pr-4 text-sm transition focus:border-cyan-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-cyan-400/20"
                />
              </div>
            </div>

            <div className="max-h-64 overflow-y-auto">
              {resolveSearchResults.length === 0 ? (
                <p className="py-8 text-center text-sm text-neutral-500">
                  {resolveSearchQuery.length >= 2
                    ? "Nenhuma inscrição encontrada"
                    : "Digite pelo menos 2 caracteres para buscar"}
                </p>
              ) : (
                <div className="space-y-2">
                  {resolveSearchResults.map((insc) => (
                    <div
                      key={insc.id}
                      className="flex items-center justify-between rounded-lg border border-neutral-200 p-3 transition hover:bg-neutral-50"
                    >
                      <div>
                        <p className="font-medium text-neutral-900">{insc.nome}</p>
                        <p className="text-xs text-neutral-500">
                          {insc.telefone} | {insc.recrutadorCodigo ?? "Sem recrutador"}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleResolve(insc.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-700"
                      >
                        <CheckCircle className="h-4 w-4" />
                        Selecionar
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
