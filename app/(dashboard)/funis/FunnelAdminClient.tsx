"use client";

import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  GitBranch,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import type { Funnel } from "@/types/funnel";
import type { CommercialSeller } from "@/types/commercial";
import type { CommercialStageKind } from "@/types/inscricao";
import { STAGE_COLOR_CLASSES, STAGE_COLOR_TOKENS, stageColorTokenForIndex } from "@/lib/stageColors";
import { cn } from "@/lib/utils";

const KIND_LABELS: Record<CommercialStageKind, string> = {
  entry: "Entrada",
  normal: "Normal",
  won: "Ganho",
  lost: "Perdido",
};

interface StageDraft {
  id: number | null;
  label: string;
  kind: CommercialStageKind;
  color: string;
}

interface FunnelDraft {
  id: number | null;
  name: string;
  stages: StageDraft[];
  sellerIds: number[];
}

function emptyDraft(): FunnelDraft {
  return {
    id: null,
    name: "",
    sellerIds: [],
    stages: [
      { id: null, label: "Novo", kind: "entry", color: "slate" },
      { id: null, label: "Em atendimento", kind: "normal", color: "blue" },
      { id: null, label: "Ganho", kind: "won", color: "emerald" },
      { id: null, label: "Perdido", kind: "lost", color: "rose" },
    ],
  };
}

function draftFromFunnel(funnel: Funnel): FunnelDraft {
  return {
    id: funnel.id,
    name: funnel.name,
    sellerIds: funnel.sellerIds,
    stages: funnel.stages.map((stage) => ({
      id: stage.id,
      label: stage.label,
      kind: stage.kind,
      color: stage.color,
    })),
  };
}

const inputClass =
  "h-9 w-full rounded-lg border border-neutral-200 bg-white px-2.5 text-sm text-neutral-900 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100";
const labelClass = "grid gap-1 text-[11px] font-semibold text-neutral-500";

function FunnelDialog({
  draft,
  sellers,
  onClose,
  onSaved,
}: {
  draft: FunnelDraft;
  sellers: CommercialSeller[];
  onClose: () => void;
  onSaved: (funnel: Funnel) => void;
}) {
  const [name, setName] = useState(draft.name);
  const [stages, setStages] = useState<StageDraft[]>(draft.stages);
  const [sellerIds, setSellerIds] = useState<number[]>(draft.sellerIds);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isCreate = draft.id === null;

  const sortedSellers = useMemo(
    () => [...sellers].sort((left, right) => left.name.localeCompare(right.name, "pt-BR")),
    [sellers]
  );

  function updateStage(index: number, patch: Partial<StageDraft>) {
    setStages((current) => current.map((stage, i) => (i === index ? { ...stage, ...patch } : stage)));
  }

  function addStage() {
    setStages((current) => [
      ...current,
      { id: null, label: "", kind: "normal", color: stageColorTokenForIndex(current.length) },
    ]);
  }

  function removeStage(index: number) {
    setStages((current) => current.filter((_, i) => i !== index));
  }

  function moveStage(index: number, direction: -1 | 1) {
    setStages((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function toggleSeller(sellerId: number) {
    setSellerIds((current) =>
      current.includes(sellerId) ? current.filter((id) => id !== sellerId) : [...current, sellerId]
    );
  }

  async function save() {
    if (!name.trim()) {
      setError("Informe um nome para o funil.");
      return;
    }
    if (stages.some((stage) => !stage.label.trim())) {
      setError("Toda etapa precisa de um nome.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch(isCreate ? "/api/funnels" : `/api/funnels/${draft.id}`, {
        method: isCreate ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), stages, sellerIds }),
      });
      const data = (await response.json().catch(() => ({}))) as { funnel?: Funnel; error?: string };
      if (!response.ok || !data.funnel) {
        throw new Error(data.error ?? "Falha ao salvar funil.");
      }
      onSaved(data.funnel);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar funil.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/55 px-4 py-6 backdrop-blur-sm">
      <section className="flex h-[min(860px,calc(100vh-48px))] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl ring-1 ring-neutral-200">
        <header className="flex items-center justify-between border-b border-neutral-200 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-neutral-400">Funis</p>
            <h2 className="mt-1 truncate text-xl font-black text-neutral-950">
              {isCreate ? "Novo funil" : draft.name}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-10 place-content-center rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
            aria-label="Fechar"
          >
            <X size={20} />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto p-5 lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-5">
          <div className="space-y-4">
            <label className={labelClass}>
              Nome do funil
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ex.: Funil Voz UP"
                className={inputClass}
              />
            </label>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-black uppercase tracking-wide text-neutral-500">Etapas</p>
                <button
                  type="button"
                  onClick={addStage}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-neutral-200 px-3 text-xs font-bold text-neutral-700 hover:bg-neutral-50"
                >
                  <Plus size={14} />
                  Adicionar etapa
                </button>
              </div>

              <div className="space-y-2">
                {stages.map((stage, index) => (
                  <div
                    key={index}
                    className="grid grid-cols-[auto_minmax(0,1fr)_120px_auto_auto] items-center gap-2 rounded-lg border border-neutral-200 bg-white p-2"
                  >
                    <div className="flex flex-col">
                      <button
                        type="button"
                        onClick={() => moveStage(index, -1)}
                        disabled={index === 0}
                        className="grid size-6 place-content-center rounded text-neutral-400 hover:bg-neutral-100 disabled:opacity-30"
                      >
                        <ArrowUp size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveStage(index, 1)}
                        disabled={index === stages.length - 1}
                        className="grid size-6 place-content-center rounded text-neutral-400 hover:bg-neutral-100 disabled:opacity-30"
                      >
                        <ArrowDown size={13} />
                      </button>
                    </div>

                    <input
                      value={stage.label}
                      onChange={(event) => updateStage(index, { label: event.target.value })}
                      placeholder="Nome da etapa"
                      className={inputClass}
                    />

                    <select
                      value={stage.kind}
                      onChange={(event) => updateStage(index, { kind: event.target.value as CommercialStageKind })}
                      className={inputClass}
                    >
                      {(Object.keys(KIND_LABELS) as CommercialStageKind[]).map((kind) => (
                        <option key={kind} value={kind}>
                          {KIND_LABELS[kind]}
                        </option>
                      ))}
                    </select>

                    <div className="flex items-center gap-1">
                      {STAGE_COLOR_TOKENS.map((token) => (
                        <button
                          key={token}
                          type="button"
                          title={token}
                          onClick={() => updateStage(index, { color: token })}
                          className={cn(
                            "size-5 rounded-full ring-offset-1",
                            STAGE_COLOR_CLASSES[token].dotColor,
                            stage.color === token ? "ring-2 ring-neutral-900" : ""
                          )}
                        />
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => removeStage(index)}
                      disabled={stages.length <= 1}
                      className="grid size-8 place-content-center rounded-lg text-rose-500 hover:bg-rose-50 disabled:opacity-30"
                      title="Remover etapa"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-neutral-400">
                Exatamente uma etapa de entrada; ao menos uma de ganho e uma de perdido.
              </p>
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-black uppercase tracking-wide text-neutral-500">
              Vendedores com este funil
            </p>
            <div className="max-h-[520px] overflow-y-auto rounded-lg border border-neutral-200">
              {sortedSellers.length === 0 ? (
                <p className="px-3 py-4 text-center text-xs text-neutral-400">Nenhum vendedor cadastrado.</p>
              ) : (
                sortedSellers.map((seller) => (
                  <label
                    key={seller.chatwootUserId}
                    className="flex cursor-pointer items-center gap-2 border-b border-neutral-100 px-3 py-2 last:border-b-0 hover:bg-neutral-50"
                  >
                    <input
                      type="checkbox"
                      checked={sellerIds.includes(seller.chatwootUserId)}
                      onChange={() => toggleSeller(seller.chatwootUserId)}
                      className="size-3.5 rounded border-neutral-300"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold text-neutral-900">{seller.name}</span>
                      <span className="block truncate text-[11px] text-neutral-400">{seller.email}</span>
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>
        </div>

        <footer className="flex flex-col gap-3 border-t border-neutral-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-h-5 text-sm font-semibold text-rose-600">{error}</div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              className="h-10 rounded-lg border border-neutral-200 px-4 text-sm font-bold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={save}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-neutral-950 px-4 text-sm font-bold text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              {saving ? <RefreshCw size={16} className="animate-spin" /> : null}
              {isCreate ? "Criar funil" : "Salvar funil"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

export default function FunnelAdminClient({
  initialFunnels,
  sellers,
}: {
  initialFunnels: Funnel[];
  sellers: CommercialSeller[];
}) {
  const [funnels, setFunnels] = useState(initialFunnels);
  const [draft, setDraft] = useState<FunnelDraft | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function upsertFunnel(funnel: Funnel) {
    setFunnels((current) => {
      const exists = current.some((item) => item.id === funnel.id);
      const next = exists ? current.map((item) => (item.id === funnel.id ? funnel : item)) : [...current, funnel];
      return next.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name, "pt-BR"));
    });
  }

  async function removeFunnel(id: number) {
    setDeletingId(id);
    setError(null);
    try {
      const response = await fetch(`/api/funnels/${id}`, { method: "DELETE" });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Falha ao excluir funil.");
      }
      setFunnels((current) => current.filter((funnel) => funnel.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao excluir funil.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <main className="min-h-screen bg-neutral-50 px-4 py-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-600">Comercial</p>
            <h1 className="mt-1 text-2xl font-black text-neutral-950">Funis</h1>
            <p className="mt-1 text-sm text-neutral-500">
              Cada funil é um Kanban com suas próprias etapas — crie, edite e atribua aos vendedores.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setDraft(emptyDraft())}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-neutral-950 px-4 text-sm font-bold text-white hover:bg-neutral-800"
          >
            <Plus size={16} />
            Novo funil
          </button>
        </header>

        {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {funnels.map((funnel) => (
            <div key={funnel.id} className="rounded-lg border border-neutral-200 bg-white p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <GitBranch size={16} className="text-cyan-600" />
                  <p className="font-black text-neutral-950">{funnel.name}</p>
                </div>
                {funnel.isDefault ? (
                  <span className="rounded-md bg-cyan-50 px-2 py-0.5 text-[10px] font-black text-cyan-700">
                    Padrão
                  </span>
                ) : null}
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {funnel.stages.map((stage) => (
                  <span
                    key={stage.id}
                    className={cn(
                      "rounded-md px-2 py-0.5 text-[10px] font-bold",
                      STAGE_COLOR_CLASSES[stage.color].pillBg,
                      STAGE_COLOR_CLASSES[stage.color].pillText
                    )}
                  >
                    {stage.label}
                  </span>
                ))}
              </div>

              <p className="mt-3 text-xs font-semibold text-neutral-500">
                {funnel.sellerIds.length > 0
                  ? `${funnel.sellerIds.length} vendedor(es) atribuído(s)`
                  : "Nenhum vendedor atribuído"}
              </p>

              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDraft(draftFromFunnel(funnel))}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-neutral-200 px-3 text-xs font-bold text-neutral-700 hover:bg-neutral-50"
                >
                  <Pencil size={13} />
                  Editar
                </button>
                {!funnel.isDefault && (
                  <button
                    type="button"
                    onClick={() => removeFunnel(funnel.id)}
                    disabled={deletingId !== null}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-neutral-200 px-3 text-xs font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                  >
                    {deletingId === funnel.id ? (
                      <RefreshCw size={13} className="animate-spin" />
                    ) : (
                      <Trash2 size={13} />
                    )}
                    Excluir
                  </button>
                )}
              </div>
            </div>
          ))}
        </section>
      </div>

      {draft ? (
        <FunnelDialog draft={draft} sellers={sellers} onClose={() => setDraft(null)} onSaved={upsertFunnel} />
      ) : null}
    </main>
  );
}
