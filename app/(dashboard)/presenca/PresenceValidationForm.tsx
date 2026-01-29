"use client";

import { useState, useTransition, useEffect, useMemo } from "react";
import { useFormState } from "react-dom";
import { processPresenceAction, confirmPresenceAction } from "./actions";
import type { PresenceFormState, PresenceAssociation, AssociationStatus, InscricaoSimplificada } from "@/types/presence";
import { formatDuration } from "@/lib/zoomPresence";

const initialState: PresenceFormState = {
  status: "idle",
  message: null,
  result: null,
  filename: null,
};

interface TrainingOption {
  id: string;
  label: string;
}

export default function PresenceValidationForm() {
  const [state, formAction] = useFormState(processPresenceAction, initialState);
  const [trainings, setTrainings] = useState<TrainingOption[]>([]);
  const [isConfirming, startConfirm] = useTransition();
  const [confirmResult, setConfirmResult] = useState<{ success: boolean; message: string } | null>(null);
  
  // Estado para associações editáveis
  const [associations, setAssociations] = useState<Map<string, {
    inscricaoId: number | null;
    status: AssociationStatus;
  }>>(new Map());

  // Estado para modal de seleção de inscrição
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [searchModalParticipante, setSearchModalParticipante] = useState<string | null>(null);
  const [searchModalQuery, setSearchModalQuery] = useState("");

  // Calcula inscrições já usadas (confirmadas ou auto-matched)
  const usedInscricaoIds = useMemo(() => {
    const used = new Set<number>();
    associations.forEach((value) => {
      if (value.inscricaoId && (value.status === "confirmed" || value.status === "auto-matched")) {
        used.add(value.inscricaoId);
      }
    });
    return used;
  }, [associations]);

  // Conta nomes duplicados (primeiro nome)
  const nameDuplicates = useMemo(() => {
    if (!state.result?.inscricoesDisponiveis) return new Map<string, number>();
    
    const firstNames = new Map<string, number>();
    for (const insc of state.result.inscricoesDisponiveis) {
      const firstName = insc.nome.split(" ")[0].toLowerCase();
      firstNames.set(firstName, (firstNames.get(firstName) || 0) + 1);
    }
    return firstNames;
  }, [state.result?.inscricoesDisponiveis]);

  // Carrega treinamentos
  useEffect(() => {
    fetch("/api/trainings")
      .then((res) => res.json())
      .then((data) => setTrainings(data.trainings || []))
      .catch(() => setTrainings([]));
  }, []);

  // Inicializa associações quando resultado muda
  useEffect(() => {
    if (state.result) {
      const newAssociations = new Map<string, { inscricaoId: number | null; status: AssociationStatus }>();
      
      for (const assoc of [...state.result.aprovados, ...state.result.reprovados]) {
        newAssociations.set(assoc.participanteNome, {
          inscricaoId: assoc.inscricaoId,
          status: assoc.status,
        });
      }
      
      setAssociations(newAssociations);
      setConfirmResult(null);
    }
  }, [state.result]);

  const handleConfirm = () => {
    if (!state.result) return;

    const toSave = [...state.result.aprovados]
      .filter((a) => {
        const current = associations.get(a.participanteNome);
        return current?.inscricaoId && current.status !== "rejected";
      })
      .map((a) => {
        const current = associations.get(a.participanteNome);
        return {
          inscricaoId: current?.inscricaoId || a.inscricaoId!,
          participanteNome: a.participanteNome,
          aprovado: a.analise.aprovado,
          tempoTotal: a.analise.tempoTotalMinutos,
          tempoDinamica: a.analise.tempoDinamicaMinutos,
          percentualDinamica: a.analise.percentualDinamica,
        };
      });

    startConfirm(async () => {
      const result = await confirmPresenceAction(toSave, state.result!.config.treinamentoId);
      setConfirmResult(result);
    });
  };

  const updateAssociation = (participanteNome: string, inscricaoId: number | null, status: AssociationStatus) => {
    setAssociations((prev) => {
      const next = new Map(prev);
      next.set(participanteNome, { inscricaoId, status });
      return next;
    });
  };

  // Abre modal de busca para um participante
  const openSearchModal = (participanteNome: string) => {
    const firstName = participanteNome.split(" ")[0];
    setSearchModalParticipante(participanteNome);
    setSearchModalQuery(firstName); // Pré-preenche com primeiro nome
    setSearchModalOpen(true);
  };

  // Seleciona uma inscrição no modal
  const selectFromModal = (inscricaoId: number) => {
    if (searchModalParticipante) {
      updateAssociation(searchModalParticipante, inscricaoId, "confirmed");
    }
    setSearchModalOpen(false);
    setSearchModalParticipante(null);
    setSearchModalQuery("");
  };

  // Inscrições filtradas para o modal
  const modalFilteredInscricoes = useMemo(() => {
    if (!state.result?.inscricoesDisponiveis) return [];
    
    const query = searchModalQuery.toLowerCase().trim();
    
    return state.result.inscricoesDisponiveis
      .map((insc) => {
        const firstName = insc.nome.split(" ")[0].toLowerCase();
        const matchesQuery = !query || 
          insc.nome.toLowerCase().includes(query) ||
          insc.telefone?.includes(query) ||
          insc.cidade?.toLowerCase().includes(query);
        
        // Calcula relevância para ordenação
        const relevance = query && insc.nome.toLowerCase().startsWith(query) ? 2 :
                         query && firstName === query ? 1 : 0;
        
        return { ...insc, matchesQuery, relevance, isUsed: usedInscricaoIds.has(insc.id) };
      })
      .filter((insc) => insc.matchesQuery)
      .sort((a, b) => {
        // Não usadas primeiro
        if (a.isUsed !== b.isUsed) return a.isUsed ? 1 : -1;
        // Maior relevância primeiro
        if (a.relevance !== b.relevance) return b.relevance - a.relevance;
        // Alfabético
        return a.nome.localeCompare(b.nome);
      });
  }, [state.result?.inscricoesDisponiveis, searchModalQuery, usedInscricaoIds]);

  const hasResult = state.status === "success" && state.result;

  return (
    <div className="space-y-6">
      {/* Formulário de Configuração */}
      <form
        className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm"
        action={formAction}
      >
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-neutral-900">Configuração do Encontro</h2>
          
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
              <p className="mt-1 text-xs text-neutral-500">Momento mais importante do encontro</p>
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
              <p className="mt-1 text-xs text-neutral-500">Padrão: 60 minutos (1 hora)</p>
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
              <p className="mt-1 text-xs text-neutral-500">Padrão: 90% de presença na dinâmica</p>
            </div>

            {/* Excluir nomes (equipe) */}
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-neutral-700">
                Excluir da análise (equipe)
                <textarea
                  name="excluirNomes"
                  rows={2}
                  placeholder="Rodrigo Damaceno, Admin, Leonardo Augusto..."
                  className="mt-1 block w-full rounded-lg border border-neutral-300 px-4 py-2.5 text-sm focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-200"
                />
              </label>
              <p className="mt-1 text-xs text-neutral-500">
                Nomes separados por vírgula ou um por linha. Hosts, coordenadores, etc.
              </p>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              className="rounded-xl bg-neutral-900 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral-800"
            >
              Processar Presença
            </button>
          </div>
        </div>
      </form>

      {/* Mensagem de status */}
      {state.message && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            state.status === "error"
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-emerald-200 bg-emerald-50 text-emerald-700"
          }`}
        >
          {state.message}
        </div>
      )}

      {/* Resultados */}
      {hasResult && (
        <div className="space-y-6">
          {/* Resumo */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <SummaryCard
              label="Total no CSV"
              value={state.result!.totalParticipantesCSV}
              color="neutral"
            />
            <SummaryCard
              label="Consolidados"
              value={state.result!.totalConsolidados}
              color="sky"
            />
            <SummaryCard
              label="Aprovados"
              value={state.result!.resumo.totalAprovados}
              color="emerald"
            />
            <SummaryCard
              label="Reprovados"
              value={state.result!.resumo.totalReprovados}
              color="red"
            />
            <SummaryCard
              label="Match automático"
              value={state.result!.resumo.autoMatched}
              color="violet"
            />
          </div>

          {/* Configuração usada */}
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm">
            <h3 className="font-medium text-neutral-700">Configuração aplicada:</h3>
            <div className="mt-2 flex flex-wrap gap-4 text-neutral-600">
              <span>Tempo mínimo: <strong>{state.result!.config.tempoMinimoMinutos}min</strong></span>
              <span>% dinâmica: <strong>{state.result!.config.percentualMinimoDinamica}%</strong></span>
              <span>Fim da live: <strong>{state.result!.config.fimLive.toLocaleTimeString("pt-BR")}</strong></span>
            </div>
          </div>

          {/* Tabela de Aprovados */}
          <PresenceTable
            title="✅ Participantes Aprovados"
            description="Cumpriram tempo mínimo e presença na dinâmica. Confirme as associações."
            data={state.result!.aprovados}
            associations={associations}
            onUpdateAssociation={updateAssociation}
            onOpenSearch={openSearchModal}
            showActions
          />

          {/* Tabela de Reprovados */}
          <PresenceTable
            title="❌ Participantes Reprovados"
            description="Não cumpriram os requisitos mínimos de presença."
            data={state.result!.reprovados}
            associations={associations}
            onUpdateAssociation={updateAssociation}
            onOpenSearch={openSearchModal}
          />

          {/* Botão de Confirmar */}
          <div className="flex items-center justify-between border-t border-neutral-200 pt-4">
            <p className="text-sm text-neutral-500">
              As associações confirmadas serão salvas no perfil de cada inscrição.
            </p>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isConfirming || confirmResult?.success}
              className="rounded-xl bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {confirmResult?.success
                ? "✓ Salvo com sucesso"
                : isConfirming
                ? "Salvando..."
                : "Confirmar e Salvar"}
            </button>
          </div>

          {confirmResult && (
            <div
              className={`rounded-xl border px-4 py-3 text-sm ${
                confirmResult.success
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-red-200 bg-red-50 text-red-700"
              }`}
            >
              {confirmResult.message}
            </div>
          )}
        </div>
      )}

      {/* Modal de Busca de Inscrição */}
      {searchModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-neutral-200 p-4">
              <div>
                <h3 className="text-lg font-semibold text-neutral-900">Buscar Inscrição</h3>
                <p className="text-sm text-neutral-500">
                  Associar a: <strong>{searchModalParticipante}</strong>
                </p>
              </div>
              <button
                onClick={() => {
                  setSearchModalOpen(false);
                  setSearchModalParticipante(null);
                  setSearchModalQuery("");
                }}
                className="rounded-lg p-2 hover:bg-neutral-100"
              >
                ✕
              </button>
            </div>

            {/* Search */}
            <div className="border-b border-neutral-100 p-4">
              <input
                type="text"
                placeholder="Buscar por nome, telefone ou cidade..."
                value={searchModalQuery}
                onChange={(e) => setSearchModalQuery(e.target.value)}
                autoFocus
                className="w-full rounded-lg border border-neutral-300 px-4 py-2 text-sm focus:border-neutral-500 focus:outline-none"
              />
              <p className="mt-2 text-xs text-neutral-500">
                {modalFilteredInscricoes.length} resultados • 
                {usedInscricaoIds.size} já associadas
              </p>
            </div>

            {/* Lista */}
            <div className="max-h-96 overflow-y-auto p-2">
              {modalFilteredInscricoes.length === 0 ? (
                <p className="py-8 text-center text-neutral-500">Nenhuma inscrição encontrada</p>
              ) : (
                <div className="space-y-1">
                  {modalFilteredInscricoes.map((insc) => {
                    const firstName = insc.nome.split(" ")[0].toLowerCase();
                    const duplicateCount = nameDuplicates.get(firstName) || 0;
                    
                    return (
                      <button
                        key={insc.id}
                        onClick={() => !insc.isUsed && selectFromModal(insc.id)}
                        disabled={insc.isUsed}
                        className={`w-full rounded-lg p-3 text-left transition ${
                          insc.isUsed
                            ? "cursor-not-allowed bg-neutral-50 opacity-50"
                            : "hover:bg-neutral-100"
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="font-medium text-neutral-900">
                              {insc.nome}
                              {duplicateCount > 1 && (
                                <span className="ml-2 text-xs font-normal text-amber-600">
                                  ⚠ {duplicateCount} pessoas com nome &quot;{firstName}&quot;
                                </span>
                              )}
                            </p>
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
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="border-t border-neutral-200 p-4">
              <button
                onClick={() => {
                  setSearchModalOpen(false);
                  setSearchModalParticipante(null);
                  setSearchModalQuery("");
                }}
                className="w-full rounded-lg border border-neutral-300 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Componente de card de resumo
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

// Componente de tabela de presença
function PresenceTable({
  title,
  description,
  data,
  associations,
  onUpdateAssociation,
  onOpenSearch,
  showActions = false,
}: {
  title: string;
  description: string;
  data: PresenceAssociation[];
  associations: Map<string, { inscricaoId: number | null; status: AssociationStatus }>;
  onUpdateAssociation: (nome: string, inscricaoId: number | null, status: AssociationStatus) => void;
  onOpenSearch?: (participanteNome: string) => void;
  showActions?: boolean;
}) {
  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-6">
        <h3 className="font-semibold text-neutral-900">{title}</h3>
        <p className="mt-1 text-sm text-neutral-500">Nenhum participante nesta categoria.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
      <div className="border-b border-neutral-100 p-4">
        <h3 className="font-semibold text-neutral-900">{title}</h3>
        <p className="text-sm text-neutral-500">{description}</p>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-4 py-3 font-medium">Participante</th>
              <th className="px-4 py-3 font-medium">Tempo Total</th>
              <th className="px-4 py-3 font-medium">Na Dinâmica</th>
              <th className="px-4 py-3 font-medium">% Dinâmica</th>
              <th className="px-4 py-3 font-medium">Inscrição Associada</th>
              <th className="px-4 py-3 font-medium">Status</th>
              {showActions && <th className="px-4 py-3 font-medium">Ações</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {data.map((item) => {
              const currentAssoc = associations.get(item.participanteNome);
              const status = currentAssoc?.status || item.status;
              
              return (
                <tr key={item.participanteNome} className="hover:bg-neutral-50">
                  <td className="px-4 py-3">
                    <div>
                      <p className="font-medium text-neutral-900">{item.participanteNome}</p>
                      {item.participanteEmail && (
                        <p className="text-xs text-neutral-500">{item.participanteEmail}</p>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={item.analise.cumpriuTempoMinimo ? "text-emerald-600" : "text-red-600"}>
                      {formatDuration(item.analise.tempoTotalMinutos)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {formatDuration(item.analise.tempoDinamicaMinutos)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={item.analise.cumpriuDinamica ? "text-emerald-600" : "text-red-600"}>
                      {item.analise.percentualDinamica}%
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="space-y-1">
                      {item.inscricaoNome ? (
                        <div>
                          <p className="text-neutral-900">{item.inscricaoNome}</p>
                          {item.inscricaoTelefone && (
                            <p className="text-xs text-neutral-500">{item.inscricaoTelefone}</p>
                          )}
                          {item.matchScore && (
                            <p className="text-xs text-neutral-400">
                              Score: {item.matchScore}% {item.matchReason && `(${item.matchReason})`}
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="text-amber-600 italic">Sem correspondência</span>
                      )}
                      
                      {/* Botão para abrir modal de busca */}
                      {onOpenSearch && (
                        <button
                          type="button"
                          onClick={() => onOpenSearch(item.participanteNome)}
                          className="mt-1 rounded border border-neutral-200 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50"
                        >
                          🔍 Buscar inscrição
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={status} />
                  </td>
                  {showActions && (
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {status !== "confirmed" && item.inscricaoId && (
                          <button
                            type="button"
                            onClick={() => onUpdateAssociation(item.participanteNome, item.inscricaoId, "confirmed")}
                            className="rounded bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-200"
                          >
                            Confirmar
                          </button>
                        )}
                        {status !== "rejected" && (
                          <button
                            type="button"
                            onClick={() => onUpdateAssociation(item.participanteNome, null, "rejected")}
                            className="rounded bg-red-100 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-200"
                          >
                            Rejeitar
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Badge de status
function StatusBadge({ status }: { status: AssociationStatus }) {
  const configs: Record<AssociationStatus, { label: string; className: string }> = {
    "auto-matched": { label: "Auto", className: "bg-violet-100 text-violet-700" },
    "suggested": { label: "Sugerido", className: "bg-amber-100 text-amber-700" },
    "manual-pending": { label: "Pendente", className: "bg-neutral-100 text-neutral-700" },
    "confirmed": { label: "Confirmado", className: "bg-emerald-100 text-emerald-700" },
    "rejected": { label: "Rejeitado", className: "bg-red-100 text-red-700" },
  };

  const config = configs[status];

  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${config.className}`}>
      {config.label}
    </span>
  );
}
