"use client";

import { useMemo, useState } from "react";
import { Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";
import type { KanbanFilter, KanbanFilterCriteria } from "@/lib/kanbanFilters";
import type { CommercialSeller } from "@/types/commercial";
import type { TrainingOption } from "@/types/training";

interface KanbanFiltersModalProps {
  filters: KanbanFilter[];
  sellers: CommercialSeller[];
  trainingOptions: TrainingOption[];
  onFiltersChange: (filters: KanbanFilter[]) => void;
  onClose: () => void;
}

interface FilterDraft {
  id: number | null;
  name: string;
  produto: "" | "vozup" | "instituto";
  treinamentoIds: string[];
  campaignName: string;
  campaignSource: string;
  caracteristica: string;
  sellerEmails: string[];
}

function emptyDraft(): FilterDraft {
  return {
    id: null,
    name: "",
    produto: "",
    treinamentoIds: [],
    campaignName: "",
    campaignSource: "",
    caracteristica: "",
    sellerEmails: [],
  };
}

function draftFromFilter(filter: KanbanFilter): FilterDraft {
  return {
    id: filter.id,
    name: filter.name,
    produto: filter.criteria.produto ?? "",
    treinamentoIds: filter.criteria.treinamentoIds ?? [],
    campaignName: filter.criteria.campaignName ?? "",
    campaignSource: filter.criteria.campaignSource ?? "",
    caracteristica: filter.criteria.caracteristica ?? "",
    sellerEmails: filter.sellerEmails,
  };
}

function criteriaFromDraft(draft: FilterDraft): KanbanFilterCriteria {
  return {
    produto: draft.produto || undefined,
    treinamentoIds: draft.treinamentoIds.length > 0 ? draft.treinamentoIds : undefined,
    campaignName: draft.campaignName.trim() || undefined,
    campaignSource: draft.campaignSource.trim() || undefined,
    caracteristica: draft.caracteristica.trim() || undefined,
  };
}

function describeCriteria(filter: KanbanFilter, trainingOptions: TrainingOption[]): string {
  const parts: string[] = [];
  if (filter.criteria.produto) {
    parts.push(filter.criteria.produto === "vozup" ? "Voz UP" : "Instituto UP");
  }
  if (filter.criteria.treinamentoIds?.length) {
    const labels = filter.criteria.treinamentoIds.map(
      (id) => trainingOptions.find((option) => option.id === id)?.label ?? id
    );
    parts.push(labels.slice(0, 2).join(", ") + (labels.length > 2 ? ` +${labels.length - 2}` : ""));
  }
  if (filter.criteria.campaignName) parts.push(`Campanha: ${filter.criteria.campaignName}`);
  if (filter.criteria.campaignSource) parts.push(`Origem: ${filter.criteria.campaignSource}`);
  if (filter.criteria.caracteristica) parts.push(`Busca: ${filter.criteria.caracteristica}`);
  return parts.length > 0 ? parts.join(" · ") : "Sem restrição (todos os leads)";
}

const inputClass =
  "h-9 w-full rounded-lg border border-[rgb(var(--border-strong))] bg-white px-2.5 text-sm text-[rgb(var(--slate-12))] focus:border-[rgb(var(--blue-7))] focus:outline-none";
const labelClass = "grid gap-1 text-[11px] font-semibold text-[rgb(var(--slate-10))]";

export function KanbanFiltersModal({
  filters,
  sellers,
  trainingOptions,
  onFiltersChange,
  onClose,
}: KanbanFiltersModalProps) {
  const [draft, setDraft] = useState<FilterDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sortedSellers = useMemo(
    () => [...sellers].sort((left, right) => left.name.localeCompare(right.name, "pt-BR")),
    [sellers]
  );

  function toggleDraftList(key: "treinamentoIds" | "sellerEmails", value: string) {
    setDraft((current) => {
      if (!current) return current;
      const list = current[key];
      return {
        ...current,
        [key]: list.includes(value) ? list.filter((item) => item !== value) : [...list, value],
      };
    });
  }

  async function saveDraft() {
    if (!draft) return;
    if (!draft.name.trim()) {
      setError("Informe um nome para o filtro.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: draft.name.trim(),
        criteria: criteriaFromDraft(draft),
        sellerEmails: draft.sellerEmails,
      };
      const response = await fetch(
        draft.id ? `/api/commercial/kanban-filters/${draft.id}` : "/api/commercial/kanban-filters",
        {
          method: draft.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = (await response.json()) as { filter?: KanbanFilter; error?: string };
      if (!response.ok || !data.filter) {
        throw new Error(data.error ?? "Falha ao salvar filtro.");
      }
      const saved = data.filter;
      onFiltersChange(
        draft.id
          ? filters.map((filter) => (filter.id === saved.id ? saved : filter))
          : [...filters, saved]
      );
      setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar filtro.");
    } finally {
      setSaving(false);
    }
  }

  async function removeFilter(id: number) {
    setDeletingId(id);
    setError(null);
    try {
      const response = await fetch(`/api/commercial/kanban-filters/${id}`, { method: "DELETE" });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Falha ao excluir filtro.");
      }
      onFiltersChange(filters.filter((filter) => filter.id !== id));
      if (draft?.id === id) setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao excluir filtro.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-neutral-100 px-6 py-4">
          <div>
            <p className="text-sm font-bold text-neutral-900">Filtros do Kanban</p>
            <p className="text-xs text-neutral-400">
              Crie filtros e atribua aos vendedores — cada um vê o Kanban só com os leads do seu filtro.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}

          {!draft ? (
            <>
              <button
                type="button"
                onClick={() => setDraft(emptyDraft())}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-[rgb(var(--blue-9))] px-3 text-xs font-semibold text-white transition hover:bg-[rgb(var(--blue-10))]"
              >
                <Plus className="h-3.5 w-3.5" />
                Novo filtro
              </button>

              {filters.length === 0 ? (
                <p className="rounded-lg border border-dashed border-[rgb(var(--border-strong))] px-4 py-8 text-center text-sm text-[rgb(var(--slate-10))]">
                  Nenhum filtro criado ainda.
                </p>
              ) : (
                <div className="overflow-hidden rounded-lg border border-[rgb(var(--border-weak))]">
                  {filters.map((filter) => (
                    <div
                      key={filter.id}
                      className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-[rgb(var(--border-weak))] px-4 py-3 last:border-b-0"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[rgb(var(--slate-12))]">{filter.name}</p>
                        <p className="truncate text-xs text-[rgb(var(--slate-10))]">
                          {describeCriteria(filter, trainingOptions)}
                        </p>
                        <p className="truncate text-xs text-[rgb(var(--slate-10))]">
                          {filter.sellerEmails.length > 0
                            ? `Vendedores: ${filter.sellerEmails.join(", ")}`
                            : "Nenhum vendedor atribuído"}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setDraft(draftFromFilter(filter))}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-[rgb(var(--slate-10))] hover:bg-[rgb(var(--slate-2))] hover:text-[rgb(var(--slate-12))]"
                          title="Editar filtro"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeFilter(filter.id)}
                          disabled={deletingId !== null}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-rose-500 hover:bg-rose-50 disabled:opacity-50"
                          title="Excluir filtro"
                        >
                          {deletingId === filter.id ? (
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="space-y-4">
              <label className={labelClass}>
                Nome do filtro *
                <input
                  type="text"
                  autoFocus
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  placeholder="Ex.: Voz UP · Campanha Julho"
                  className={inputClass}
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className={labelClass}>
                  Produto
                  <select
                    value={draft.produto}
                    onChange={(event) =>
                      setDraft({ ...draft, produto: event.target.value as FilterDraft["produto"] })
                    }
                    className={inputClass}
                  >
                    <option value="">Todos</option>
                    <option value="instituto">Instituto UP</option>
                    <option value="vozup">Voz UP</option>
                  </select>
                </label>
                <label className={labelClass}>
                  Campanha
                  <input
                    type="text"
                    value={draft.campaignName}
                    onChange={(event) => setDraft({ ...draft, campaignName: event.target.value })}
                    placeholder="Nome da campanha"
                    className={inputClass}
                  />
                </label>
                <label className={labelClass}>
                  Origem / fonte
                  <input
                    type="text"
                    value={draft.campaignSource}
                    onChange={(event) => setDraft({ ...draft, campaignSource: event.target.value })}
                    placeholder="Ex.: facebook, google"
                    className={inputClass}
                  />
                </label>
                <label className={labelClass}>
                  Busca livre
                  <input
                    type="text"
                    value={draft.caracteristica}
                    onChange={(event) => setDraft({ ...draft, caracteristica: event.target.value })}
                    placeholder="Nome, telefone, etiqueta…"
                    className={inputClass}
                  />
                </label>
              </div>

              <div className={labelClass}>
                Treinamentos (opcional)
                <div className="max-h-40 overflow-y-auto rounded-lg border border-[rgb(var(--border-weak))]">
                  {trainingOptions.length === 0 ? (
                    <p className="px-3 py-4 text-center text-xs text-[rgb(var(--slate-10))]">
                      Nenhum treinamento disponível.
                    </p>
                  ) : (
                    trainingOptions.map((option) => (
                      <label
                        key={option.id}
                        className="flex cursor-pointer items-center gap-2 border-b border-[rgb(var(--border-weak))] px-3 py-2 text-xs font-medium text-[rgb(var(--slate-12))] last:border-b-0 hover:bg-[rgb(var(--slate-1))]"
                      >
                        <input
                          type="checkbox"
                          checked={draft.treinamentoIds.includes(option.id)}
                          onChange={() => toggleDraftList("treinamentoIds", option.id)}
                          className="h-3.5 w-3.5 rounded border-[rgb(var(--border-strong))]"
                        />
                        <span className="truncate">{option.label}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>

              <div className={labelClass}>
                Vendedores com este filtro
                <div className="max-h-44 overflow-y-auto rounded-lg border border-[rgb(var(--border-weak))]">
                  {sortedSellers.length === 0 ? (
                    <p className="px-3 py-4 text-center text-xs text-[rgb(var(--slate-10))]">
                      Nenhum vendedor cadastrado.
                    </p>
                  ) : (
                    sortedSellers.map((seller) => {
                      const email = (seller.email ?? "").trim().toLowerCase();
                      if (!email) return null;
                      return (
                        <label
                          key={seller.chatwootUserId}
                          className="flex cursor-pointer items-center gap-2 border-b border-[rgb(var(--border-weak))] px-3 py-2 last:border-b-0 hover:bg-[rgb(var(--slate-1))]"
                        >
                          <input
                            type="checkbox"
                            checked={draft.sellerEmails.includes(email)}
                            onChange={() => toggleDraftList("sellerEmails", email)}
                            className="h-3.5 w-3.5 rounded border-[rgb(var(--border-strong))]"
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-semibold text-[rgb(var(--slate-12))]">
                              {seller.name}
                            </span>
                            <span className="block truncate text-[11px] text-[rgb(var(--slate-10))]">{email}</span>
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-shrink-0 justify-end gap-2 border-t border-neutral-100 px-6 py-4">
          {draft ? (
            <>
              <button
                type="button"
                onClick={() => setDraft(null)}
                disabled={saving}
                className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={saveDraft}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-[rgb(var(--blue-9))] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[rgb(var(--blue-10))] disabled:opacity-50"
              >
                {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null}
                {draft.id ? "Salvar filtro" : "Criar filtro"}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
            >
              Fechar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
