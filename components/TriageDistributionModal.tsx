"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Search, Users, X } from "lucide-react";
import type { CommercialSeller } from "@/types/commercial";
import { humanizeName } from "@/lib/utils";

/**
 * Reparte a Triagem de Leads (lista fria importada) entre os vendedores.
 *
 * A triagem não passa pela Chegada de Leads — lá só entra captação Meta/Google
 * (regra da cartilha). Aqui o admin escolhe leads na lista ou pede "os N mais
 * antigos", e cada lead vai para a pasta Triagem do vendedor, ainda fora do CRM
 * geral, até ele aprovar.
 */

interface TriageCandidate {
  id: number;
  name: string | null;
  phone: string | null;
  city: string | null;
  createdAt: string;
  origem: string | null;
}

interface DistributionResponse {
  assigned?: Array<{ inscricaoId: number; sellerName: string }>;
  skipped?: Array<{ inscricaoId: number }>;
  failed?: Array<{ inscricaoId: number; reason: string }>;
  error?: string;
}

interface TriageDistributionModalProps {
  sellers: CommercialSeller[];
  /** Quantos leads de triagem cada vendedor já tem na mão — para não afogar sempre o mesmo. */
  sellerLoads?: Array<{ sellerId: number; total: number }>;
  onClose: () => void;
  /** Chamado depois de distribuir, para o quadro e os contadores recarregarem. */
  onDistributed: () => void;
}

type Mode = "selection" | "count";

const LIMIT = 200;

export function TriageDistributionModal({
  sellers,
  sellerLoads = [],
  onClose,
  onDistributed,
}: TriageDistributionModalProps) {
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [candidates, setCandidates] = useState<TriageCandidate[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>("count");
  const [count, setCount] = useState("50");
  // Boa parte da lista fria é contato de agenda sem nome salvo (só o número).
  // Ligado por padrão: distribuir "11987856006" antes de quem tem nome é a pior
  // fila possível para o vendedor.
  const [onlyNamed, setOnlyNamed] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [sellerIds, setSellerIds] = useState<Set<number>>(() => new Set());

  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const loadPool = useCallback(async (term: string, named: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(LIMIT) });
      if (term) params.set("search", term);
      if (named) params.set("onlyNamed", "1");
      const res = await fetch(`/api/commercial/triage/pool?${params}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Não foi possível carregar a triagem.");
      setCandidates(json.candidates ?? []);
      setTotal(json.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar a triagem.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPool(appliedSearch, onlyNamed);
  }, [loadPool, appliedSearch, onlyNamed]);

  useEffect(() => {
    function handler(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const selectedSellers = useMemo(
    () => sellers.filter((seller) => sellerIds.has(seller.chatwootUserId)),
    [sellers, sellerIds]
  );

  const loadBySeller = useMemo(
    () => new Map(sellerLoads.map((load) => [load.sellerId, load.total])),
    [sellerLoads]
  );

  const parsedCount = Number.parseInt(count, 10);
  const amount =
    mode === "selection" ? selectedIds.size : Number.isFinite(parsedCount) ? Math.max(0, parsedCount) : 0;
  const canSubmit = amount > 0 && selectedSellers.length > 0 && !saving;

  function toggleLead(id: number) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSeller(id: number) {
    setSellerIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleDistribute() {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/commercial/triage/distribute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadIds: mode === "selection" ? [...selectedIds] : [],
          count: mode === "count" ? amount : undefined,
          onlyNamed,
          sellerIds: [...sellerIds],
          strategy: selectedSellers.length > 1 ? "round_robin" : "single",
        }),
      });
      const json: DistributionResponse = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Não foi possível distribuir os leads.");

      const assignedCount = json.assigned?.length ?? 0;
      const perSeller = new Map<string, number>();
      for (const entry of json.assigned ?? []) {
        perSeller.set(entry.sellerName, (perSeller.get(entry.sellerName) ?? 0) + 1);
      }
      const breakdown = [...perSeller.entries()].map(([name, qty]) => `${name}: ${qty}`).join(" · ");
      const failedCount = json.failed?.length ?? 0;
      const skippedCount = json.skipped?.length ?? 0;
      setResult(
        `${assignedCount} lead(s) distribuído(s)${breakdown ? ` — ${breakdown}` : ""}` +
          (skippedCount > 0 ? ` · ${skippedCount} já tinha(m) dono` : "") +
          (failedCount > 0 ? ` · ${failedCount} falhou/falharam` : "")
      );
      setSelectedIds(new Set());
      onDistributed();
      await loadPool(appliedSearch, onlyNamed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível distribuir os leads.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-3">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-neutral-200 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-neutral-900">Distribuir Triagem de Leads</h2>
            <p className="mt-0.5 text-[12px] text-neutral-500">
              {total.toLocaleString("pt-BR")} contato(s) sem responsável
              {appliedSearch ? " nesta busca" : ""}
              {onlyNamed ? " com nome" : " na triagem"}. Quem receber vê os leads na pasta
              Triagem do Kanban e só aprova o que prestar.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5 md:flex-row">
          {/* Quanto distribuir */}
          <div className="flex w-full flex-col gap-4 md:w-72 md:flex-shrink-0">
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-neutral-500">
                Quantos leads
              </p>
              <div className="space-y-2">
                <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-neutral-200 p-2.5 text-[12px] hover:bg-neutral-50">
                  <input
                    type="radio"
                    checked={mode === "count"}
                    onChange={() => setMode("count")}
                    className="mt-0.5"
                  />
                  <span className="flex-1">
                    <span className="font-semibold text-neutral-800">Os mais antigos</span>
                    <input
                      type="number"
                      min={1}
                      max={500}
                      value={count}
                      onChange={(event) => setCount(event.target.value)}
                      onFocus={() => setMode("count")}
                      className="mt-1.5 w-24 rounded-md border border-neutral-200 px-2 py-1 text-[12px]"
                    />
                    <span className="mt-1 block text-[11px] text-neutral-500">
                      {onlyNamed ? "Só os que têm nome. " : ""}Máximo de 500 por vez.
                    </span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-neutral-200 p-2.5 text-[12px] hover:bg-neutral-50">
                  <input
                    type="radio"
                    checked={mode === "selection"}
                    onChange={() => setMode("selection")}
                    className="mt-0.5"
                  />
                  <span className="flex-1">
                    <span className="font-semibold text-neutral-800">Os que eu marcar na lista</span>
                    <span className="mt-1 block text-[11px] text-neutral-500">
                      {selectedIds.size} marcado(s)
                    </span>
                  </span>
                </label>
              </div>
            </div>

            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-neutral-500">
                Para quem
              </p>
              <div className="max-h-52 space-y-1 overflow-y-auto rounded-lg border border-neutral-200 p-2">
                {sellers.length === 0 ? (
                  <p className="p-2 text-[12px] text-neutral-400">Nenhum vendedor cadastrado.</p>
                ) : (
                  sellers.map((seller) => {
                    const load = loadBySeller.get(seller.chatwootUserId) ?? 0;
                    return (
                      <label
                        key={seller.chatwootUserId}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-neutral-700 hover:bg-neutral-50"
                      >
                        <input
                          type="checkbox"
                          checked={sellerIds.has(seller.chatwootUserId)}
                          onChange={() => toggleSeller(seller.chatwootUserId)}
                        />
                        <Users className="h-3 w-3 text-neutral-400" />
                        <span className="min-w-0 flex-1 truncate">{seller.name}</span>
                        {load > 0 && (
                          <span
                            className="rounded-full bg-neutral-100 px-1.5 text-[10px] font-bold text-neutral-500"
                            title="Leads de triagem que já estão com esta pessoa"
                          >
                            {load}
                          </span>
                        )}
                      </label>
                    );
                  })
                )}
              </div>
              {selectedSellers.length > 1 && (
                <p className="mt-1.5 text-[11px] text-neutral-500">
                  Os leads são divididos igualmente entre os {selectedSellers.length} selecionados.
                </p>
              )}
            </div>

            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => void handleDistribute()}
              className="flex h-10 items-center justify-center gap-2 rounded-lg bg-neutral-900 px-4 text-[13px] font-semibold text-white transition hover:bg-neutral-800 disabled:opacity-40"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Distribuir {amount > 0 ? `${amount} lead(s)` : "leads"}
            </button>

            {result && (
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-[12px] font-medium text-emerald-800">
                {result}
              </p>
            )}
            {error && (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-[12px] font-medium text-rose-700">{error}</p>
            )}
          </div>

          {/* Lista do bolo */}
          <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-neutral-200">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setAppliedSearch(search.trim());
              }}
              className="flex items-center gap-2 border-b border-neutral-200 p-2"
            >
              <Search className="h-3.5 w-3.5 flex-shrink-0 text-neutral-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por nome, telefone, cidade…"
                className="min-w-0 flex-1 text-[12px] outline-none"
              />
              <button
                type="submit"
                className="rounded-md border border-neutral-200 px-2 py-1 text-[11px] font-semibold text-neutral-600 hover:bg-neutral-50"
              >
                Buscar
              </button>
            </form>

            <label className="flex cursor-pointer items-center gap-2 border-b border-neutral-100 bg-neutral-50 px-3 py-2 text-[12px] font-semibold text-neutral-700">
              <input
                type="checkbox"
                checked={onlyNamed}
                onChange={(event) => {
                  setOnlyNamed(event.target.checked);
                  // A lista muda embaixo do usuário; o que estava marcado pode
                  // nem aparecer mais.
                  setSelectedIds(new Set());
                }}
              />
              Só contatos com nome
              <span className="font-normal text-neutral-500">
                (deixa de fora quem entrou só com o telefone)
              </span>
            </label>

            <div className="flex items-center justify-between border-b border-neutral-100 px-3 py-1.5 text-[11px] text-neutral-500">
              <span>
                Mostrando {candidates.length} de {total.toLocaleString("pt-BR")}
              </span>
              {mode === "selection" && candidates.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    setSelectedIds((current) =>
                      current.size === candidates.length
                        ? new Set()
                        : new Set(candidates.map((candidate) => candidate.id))
                    )
                  }
                  className="font-semibold text-cyan-700 hover:underline"
                >
                  {selectedIds.size === candidates.length ? "Limpar seleção" : "Marcar todos da lista"}
                </button>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex h-32 items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-neutral-300" />
                </div>
              ) : candidates.length === 0 ? (
                <p className="p-6 text-center text-[12px] text-neutral-400">
                  Nenhum lead sem responsável na triagem.
                </p>
              ) : (
                <ul className="divide-y divide-neutral-100">
                  {candidates.map((candidate) => (
                    <li key={candidate.id}>
                      <label className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-neutral-50">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(candidate.id)}
                          onChange={() => {
                            setMode("selection");
                            toggleLead(candidate.id);
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12px] font-semibold text-neutral-800">
                            {humanizeName(candidate.name) ?? "Sem nome"}
                          </p>
                          <p className="truncate text-[11px] text-neutral-500">
                            {candidate.phone ?? "sem telefone"}
                            {candidate.city ? ` · ${candidate.city}` : ""}
                            {candidate.origem ? ` · ${candidate.origem}` : ""}
                          </p>
                        </div>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
