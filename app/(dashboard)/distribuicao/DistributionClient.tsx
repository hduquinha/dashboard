"use client";

import { useMemo, useState } from "react";
import {
  CheckSquare,
  Filter,
  RefreshCw,
  Send,
  Square,
  UserRoundCheck,
  UsersRound,
  X,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import type {
  ManualDistributionCandidate,
  ManualDistributionFilters,
  ManualDistributionResult,
  ManualDistributionStrategy,
} from "@/lib/manualDistribution";
import type { CommercialSeller } from "@/types/commercial";
import type { TrainingOption } from "@/types/training";

interface DistributionClientProps {
  candidates: ManualDistributionCandidate[];
  total: number;
  limit: number;
  filters: ManualDistributionFilters;
  sellers: CommercialSeller[];
  trainingOptions: TrainingOption[];
  isSupervisor: boolean;
}

interface LeadGroup {
  key: string;
  title: string;
  businessUnit: string;
  entryChannel: string;
  path: string[];
  signals: string[];
  count: number;
  unassignedCount: number;
  presentCount: number;
  latestCreatedAt: string | null;
  leadIds: number[];
}

interface LeadGroupDraft extends LeadGroup {
  signalSet: Set<string>;
  latestTime: number;
}

function dateLabel(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function sellerStatusLabel(seller: CommercialSeller): string {
  return seller.isSupervisor ? "admin" : "usuario";
}

function resultMessage(result: ManualDistributionResult): string {
  const parts = [`${result.assigned.length} distribuido(s)`];
  if (result.skipped.length > 0) parts.push(`${result.skipped.length} ignorado(s)`);
  if (result.failed.length > 0) parts.push(`${result.failed.length} falha(s)`);
  return parts.join(" — ");
}

function uniqueSellerIds(sellers: CommercialSeller[]): number[] {
  return sellers
    .filter((seller) => seller.active)
    .map((seller) => seller.chatwootUserId);
}

function isUnassigned(row: ManualDistributionCandidate): boolean {
  return !row.assignedSellerName && !row.assignedSellerEmail;
}

function signalLabel(group: LeadGroup): string {
  if (group.signals.length === 0) return "Sem sinal";
  if (group.signals.length === 1) return group.signals[0];
  return `${group.signals.length} sinais de entrada`;
}

function buildGroups(rows: ManualDistributionCandidate[]): LeadGroup[] {
  const drafts = new Map<string, LeadGroupDraft>();

  for (const row of rows) {
    const latestTime = new Date(row.createdAt).getTime();
    const draft = drafts.get(row.sourceGroupKey);

    if (!draft) {
      drafts.set(row.sourceGroupKey, {
        key: row.sourceGroupKey,
        title: row.sourceGroupTitle,
        businessUnit: row.businessUnit,
        entryChannel: row.entryChannel,
        path: row.leadPath,
        signals: [],
        signalSet: new Set([row.entrySignal]),
        count: 1,
        unassignedCount: isUnassigned(row) ? 1 : 0,
        presentCount: row.presenceLabel === "Presente" ? 1 : 0,
        latestCreatedAt: row.createdAt,
        latestTime: Number.isNaN(latestTime) ? 0 : latestTime,
        leadIds: [row.id],
      });
      continue;
    }

    draft.count += 1;
    draft.leadIds.push(row.id);
    draft.signalSet.add(row.entrySignal);
    if (isUnassigned(row)) draft.unassignedCount += 1;
    if (row.presenceLabel === "Presente") draft.presentCount += 1;
    if (!Number.isNaN(latestTime) && latestTime > draft.latestTime) {
      draft.latestTime = latestTime;
      draft.latestCreatedAt = row.createdAt;
      draft.path = row.leadPath;
    }
  }

  return Array.from(drafts.values())
    .map(({ signalSet, latestTime, ...group }) => ({
      ...group,
      signals: Array.from(signalSet).sort((left, right) => left.localeCompare(right, "pt-BR")),
    }))
    .sort((left, right) => {
      const rightTime = new Date(right.latestCreatedAt ?? "").getTime() || 0;
      const leftTime = new Date(left.latestCreatedAt ?? "").getTime() || 0;
      if (rightTime !== leftTime) return rightTime - leftTime;
      return right.count - left.count;
    });
}

const ALL_GROUPS_KEY = "__all__";

export default function DistributionClient({
  candidates,
  total,
  limit,
  filters,
  sellers,
  trainingOptions,
  isSupervisor,
}: DistributionClientProps) {
  const [rows, setRows] = useState(candidates);
  const [activeGroupKey, setActiveGroupKey] = useState(ALL_GROUPS_KEY);
  const [clientSearch, setClientSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [strategy, setStrategy] = useState<ManualDistributionStrategy>("single");
  const [singleSellerId, setSingleSellerId] = useState(() => String(sellers[0]?.chatwootUserId ?? ""));
  const [roundRobinSellerIds, setRoundRobinSellerIds] = useState<number[]>(() => uniqueSellerIds(sellers));
  const [overwriteAssigned, setOverwriteAssigned] = useState(false);
  const [busyScope, setBusyScope] = useState<"selected" | "group" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const groups = useMemo(() => buildGroups(rows), [rows]);

  // Rows visíveis: todos os grupos ou grupo específico, depois filtro client-side
  const baseRows = useMemo(
    () => activeGroupKey === ALL_GROUPS_KEY
      ? rows
      : rows.filter((row) => row.sourceGroupKey === activeGroupKey),
    [activeGroupKey, rows]
  );
  const activeRows = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    if (!q) return baseRows;
    return baseRows.filter((row) =>
      (row.name ?? "").toLowerCase().includes(q) ||
      (row.phone ?? "").replace(/\D/g, "").includes(q.replace(/\D/g, "")) ||
      (row.campaignSource ?? "").toLowerCase().includes(q) ||
      (row.campaignName ?? "").toLowerCase().includes(q) ||
      (row.assignedSellerName ?? "").toLowerCase().includes(q) ||
      (row.trainingLabel ?? "").toLowerCase().includes(q)
    );
  }, [baseRows, clientSearch]);

  const currentGroup = activeGroupKey === ALL_GROUPS_KEY
    ? null
    : groups.find((g) => g.key === activeGroupKey) ?? null;

  const selectedLeadIds = useMemo(
    () => activeRows.filter((row) => selectedIds.has(row.id)).map((row) => row.id),
    [activeRows, selectedIds]
  );
  const selectedCount = selectedLeadIds.length;
  const allVisibleSelected = activeRows.length > 0 && activeRows.every((row) => selectedIds.has(row.id));
  const chosenSellerIds = useMemo(() => {
    if (strategy === "single") {
      const parsed = Number.parseInt(singleSellerId, 10);
      return Number.isFinite(parsed) && parsed > 0 ? [parsed] : [];
    }
    return roundRobinSellerIds;
  }, [roundRobinSellerIds, singleSellerId, strategy]);

  if (!isSupervisor) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center">
        <section className="w-full max-w-lg rounded-lg border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-6 text-center shadow-[0_1px_2px_rgba(28,32,36,0.04)]">
          <UserRoundCheck className="mx-auto h-8 w-8 text-[rgb(var(--slate-10))]" />
          <h1 className="mt-3 text-lg font-semibold text-[rgb(var(--slate-12))]">Acesso restrito</h1>
          <p className="mt-1 text-sm text-[rgb(var(--slate-10))]">
            Apenas usuarios master podem distribuir leads.
          </p>
        </section>
      </main>
    );
  }

  function chooseGroup(key: string) {
    setActiveGroupKey(key);
    setClientSearch("");
    setSelectedIds(new Set());
    setMessage(null);
  }

  function toggleRow(id: number) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleVisibleRows() {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) {
        for (const row of activeRows) next.delete(row.id);
      } else {
        for (const row of activeRows) next.add(row.id);
      }
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function toggleRoundRobinSeller(id: number) {
    setRoundRobinSellerIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    );
  }

  async function distributeLeadIds(leadIds: number[], scope: "selected" | "group") {
    if (!isSupervisor) {
      setMessage("Apenas usuarios master podem distribuir leads.");
      return;
    }

    if (chosenSellerIds.length === 0) {
      setMessage("Selecione pelo menos um usuario de destino.");
      return;
    }

    if (leadIds.length === 0) {
      setMessage("Selecione um grupo com leads.");
      return;
    }

    setBusyScope(scope);
    setMessage(null);

    try {
      const response = await fetch("/api/distribuicao/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "selected",
          leadIds,
          filters,
          sellerIds: chosenSellerIds,
          strategy,
          overwriteAssigned,
          limit,
        }),
      });
      const data = (await response.json()) as { result?: ManualDistributionResult; error?: string };
      if (!response.ok || !data.result) {
        throw new Error(data.error ?? "Falha ao distribuir leads.");
      }

      const result = data.result;
      const assignedById = new Map(result.assigned.map((item) => [item.inscricaoId, item]));
      setRows((current) =>
        filters.unassignedOnly && !overwriteAssigned
          ? current.filter((row) => !assignedById.has(row.id))
          : current.map((row) => {
              const assigned = assignedById.get(row.id);
              return assigned
                ? {
                    ...row,
                    assignedSellerName: assigned.sellerName,
                    assignedSellerEmail: assigned.sellerEmail,
                  }
                : row;
            })
      );
      setSelectedIds((current) => {
        const next = new Set(current);
        for (const item of result.assigned) next.delete(item.inscricaoId);
        return next;
      });
      setMessage(resultMessage(result));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao distribuir leads.");
    } finally {
      setBusyScope(null);
    }
  }

  const assignedSeller = sellers.find((s) => String(s.chatwootUserId) === singleSellerId);

  return (
    <main className="space-y-0">

      {/* ── Cabeçalho ─────────────────────────────────────────── */}
      <div className="mb-5 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-1.5 inline-flex items-center gap-1.5 rounded-full border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] px-2.5 py-0.5 text-[11px] font-semibold text-[rgb(var(--slate-11))]">
            <Send className="h-3 w-3 text-[rgb(var(--blue-9))]" />
            CRM
          </div>
          <h1 className="text-2xl font-bold text-[rgb(var(--slate-12))]">Central de distribuição</h1>
          <p className="mt-0.5 text-sm text-[rgb(var(--slate-10))]">
            {rows.length.toLocaleString("pt-BR")} lead(s) em {groups.length} grupo(s)
            {total > rows.length ? ` · ${total.toLocaleString("pt-BR")} no recorte` : ""}
          </p>
        </div>
      </div>

      {/* ── Painel principal ───────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] shadow-[0_1px_3px_rgba(28,32,36,0.06)]">

        {/* Tabs de grupos */}
        <div className="flex items-center gap-0 overflow-x-auto border-b border-[rgb(var(--border-weak))] px-4">
          {/* Tab "Todos" */}
          <button
            type="button"
            onClick={() => chooseGroup(ALL_GROUPS_KEY)}
            className={`relative flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${
              activeGroupKey === ALL_GROUPS_KEY
                ? "border-[rgb(var(--blue-9))] text-[rgb(var(--blue-11))]"
                : "border-transparent text-[rgb(var(--slate-10))] hover:text-[rgb(var(--slate-12))]"
            }`}
          >
            <span>Todos</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
              activeGroupKey === ALL_GROUPS_KEY
                ? "bg-[rgb(var(--blue-3))] text-[rgb(var(--blue-11))]"
                : "bg-[rgb(var(--slate-2))] text-[rgb(var(--slate-10))]"
            }`}>
              {rows.length}
            </span>
          </button>

          {/* Tabs de grupos individuais */}
          {groups.map((group) => {
            const active = group.key === activeGroupKey;
            return (
              <button
                key={group.key}
                type="button"
                onClick={() => chooseGroup(group.key)}
                className={`relative flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${
                  active
                    ? "border-[rgb(var(--blue-9))] text-[rgb(var(--blue-11))]"
                    : "border-transparent text-[rgb(var(--slate-10))] hover:text-[rgb(var(--slate-12))]"
                }`}
              >
                <span className="truncate max-w-[180px]">{group.title}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                  active
                    ? "bg-[rgb(var(--blue-3))] text-[rgb(var(--blue-11))]"
                    : "bg-[rgb(var(--slate-2))] text-[rgb(var(--slate-10))]"
                }`}>
                  {group.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* KPI cards — grupo específico */}
        {currentGroup && (
          <div className="grid grid-cols-2 gap-3 border-b border-[rgb(var(--border-weak))] bg-[rgb(var(--slate-1))] px-4 py-3 sm:grid-cols-4">
            <div className="rounded-xl border border-[rgb(var(--border-weak))] bg-white px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[rgb(var(--slate-10))]">Total</p>
              <p className="mt-1 text-2xl font-bold text-[rgb(var(--slate-12))]">{currentGroup.count}</p>
              <p className="mt-0.5 text-xs text-[rgb(var(--slate-10))]">leads no grupo</p>
            </div>
            <div className="rounded-xl border border-[rgb(var(--border-weak))] bg-white px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[rgb(var(--slate-10))]">Sem responsável</p>
              <p className="mt-1 text-2xl font-bold text-orange-600">{currentGroup.unassignedCount}</p>
              <p className="mt-0.5 text-xs text-[rgb(var(--slate-10))]">aguardando atribuição</p>
            </div>
            <div className="rounded-xl border border-[rgb(var(--border-weak))] bg-white px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[rgb(var(--slate-10))]">Presentes</p>
              <p className="mt-1 text-2xl font-bold text-green-700">{currentGroup.presentCount}</p>
              <p className="mt-0.5 text-xs text-[rgb(var(--slate-10))]">confirmados</p>
            </div>
            <div className="rounded-xl border border-[rgb(var(--border-weak))] bg-white px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[rgb(var(--slate-10))]">Último lead</p>
              <p className="mt-1 text-lg font-bold text-[rgb(var(--slate-12))]">{dateLabel(currentGroup.latestCreatedAt)}</p>
              <p className="mt-0.5 text-xs text-[rgb(var(--slate-10))]">{signalLabel(currentGroup)}</p>
            </div>
          </div>
        )}

        {/* KPI cards — visão "Todos" */}
        {activeGroupKey === ALL_GROUPS_KEY && (
          <div className="grid grid-cols-2 gap-3 border-b border-[rgb(var(--border-weak))] bg-[rgb(var(--slate-1))] px-4 py-3 sm:grid-cols-4">
            <div className="rounded-xl border border-[rgb(var(--border-weak))] bg-white px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[rgb(var(--slate-10))]">Total</p>
              <p className="mt-1 text-2xl font-bold text-[rgb(var(--slate-12))]">{rows.length}</p>
              <p className="mt-0.5 text-xs text-[rgb(var(--slate-10))]">leads carregados</p>
            </div>
            <div className="rounded-xl border border-[rgb(var(--border-weak))] bg-white px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[rgb(var(--slate-10))]">Sem responsável</p>
              <p className="mt-1 text-2xl font-bold text-orange-600">
                {rows.filter((r) => !r.assignedSellerName && !r.assignedSellerEmail).length}
              </p>
              <p className="mt-0.5 text-xs text-[rgb(var(--slate-10))]">aguardando atribuição</p>
            </div>
            <div className="rounded-xl border border-[rgb(var(--border-weak))] bg-white px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[rgb(var(--slate-10))]">Presentes</p>
              <p className="mt-1 text-2xl font-bold text-green-700">
                {rows.filter((r) => r.presenceLabel === "Presente").length}
              </p>
              <p className="mt-0.5 text-xs text-[rgb(var(--slate-10))]">confirmados</p>
            </div>
            <div className="rounded-xl border border-[rgb(var(--border-weak))] bg-white px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[rgb(var(--slate-10))]">Grupos</p>
              <p className="mt-1 text-2xl font-bold text-[rgb(var(--slate-12))]">{groups.length}</p>
              <p className="mt-0.5 text-xs text-[rgb(var(--slate-10))]">fontes de entrada</p>
            </div>
          </div>
        )}

        {/* Barra de distribuição */}
        <div className="border-b border-[rgb(var(--border-weak))] bg-[rgb(var(--slate-1))] px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[rgb(var(--slate-10))]">
              <UsersRound className="h-3.5 w-3.5 text-[rgb(var(--blue-9))]" />
              Destino
            </div>

            {/* Único / Rodízio */}
            <div className="flex rounded-lg border border-[rgb(var(--border-strong))] bg-white overflow-hidden">
              <button
                type="button"
                onClick={() => setStrategy("single")}
                className={`px-3 py-1.5 text-xs font-semibold transition ${
                  strategy === "single"
                    ? "bg-[rgb(var(--blue-9))] text-white"
                    : "text-[rgb(var(--slate-11))] hover:bg-[rgb(var(--slate-2))]"
                }`}
              >
                Único
              </button>
              <button
                type="button"
                onClick={() => setStrategy("round_robin")}
                className={`border-l border-[rgb(var(--border-strong))] px-3 py-1.5 text-xs font-semibold transition ${
                  strategy === "round_robin"
                    ? "bg-[rgb(var(--blue-9))] text-white"
                    : "text-[rgb(var(--slate-11))] hover:bg-[rgb(var(--slate-2))]"
                }`}
              >
                Rodízio
              </button>
            </div>

            {/* Seletor de vendedor */}
            {strategy === "single" ? (
              <select
                value={singleSellerId}
                onChange={(event) => setSingleSellerId(event.target.value)}
                className="h-8 rounded-lg border border-[rgb(var(--border-strong))] bg-white px-3 text-xs text-[rgb(var(--slate-12))] min-w-[200px]"
              >
                {sellers.map((seller) => (
                  <option key={seller.chatwootUserId} value={seller.chatwootUserId}>
                    {seller.name}{seller.isSupervisor ? " (master)" : ""} · {seller.email}
                  </option>
                ))}
              </select>
            ) : (
              <div className="relative">
                <details className="group">
                  <summary className="flex h-8 cursor-pointer list-none items-center gap-2 rounded-lg border border-[rgb(var(--border-strong))] bg-white px-3 text-xs font-semibold text-[rgb(var(--slate-12))]">
                    {roundRobinSellerIds.length} vendedor(es) selecionado(s)
                    <ChevronDown className="h-3.5 w-3.5 text-[rgb(var(--slate-10))] group-open:hidden" />
                    <ChevronUp className="h-3.5 w-3.5 text-[rgb(var(--slate-10))] hidden group-open:block" />
                  </summary>
                  <div className="absolute left-0 top-full z-10 mt-1 w-72 overflow-hidden rounded-lg border border-[rgb(var(--border-weak))] bg-white shadow-lg">
                    <div className="max-h-52 overflow-y-auto">
                      {sellers.map((seller) => (
                        <label
                          key={seller.chatwootUserId}
                          className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-[rgb(var(--border-weak))] px-3 py-2 last:border-b-0 hover:bg-[rgb(var(--slate-1))]"
                        >
                          <input
                            type="checkbox"
                            checked={roundRobinSellerIds.includes(seller.chatwootUserId)}
                            onChange={() => toggleRoundRobinSeller(seller.chatwootUserId)}
                            className="h-4 w-4 rounded border-[rgb(var(--border-strong))]"
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-[rgb(var(--slate-12))]">{seller.name}</span>
                            <span className="block truncate text-xs text-[rgb(var(--slate-10))]">{seller.email}</span>
                          </span>
                          <span className="rounded-md bg-[rgb(var(--slate-2))] px-2 py-0.5 text-[10px] font-semibold text-[rgb(var(--slate-10))]">
                            {sellerStatusLabel(seller)}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                </details>
              </div>
            )}

            {/* Sobrescrever */}
            <label className="flex items-center gap-1.5 text-xs font-semibold text-[rgb(var(--slate-11))] cursor-pointer">
              <input
                type="checkbox"
                checked={overwriteAssigned}
                onChange={(event) => setOverwriteAssigned(event.target.checked)}
                className="h-3.5 w-3.5 rounded border-[rgb(var(--border-strong))]"
              />
              Sobrescrever
            </label>

            <div className="ml-auto flex items-center gap-2">
              {/* Filtros */}
              <button
                type="button"
                onClick={() => setShowFilters((v) => !v)}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition ${
                  showFilters
                    ? "border-[rgb(var(--blue-7))] bg-[rgb(var(--blue-2))] text-[rgb(var(--blue-11))]"
                    : "border-[rgb(var(--border-strong))] bg-white text-[rgb(var(--slate-11))] hover:bg-[rgb(var(--slate-2))]"
                }`}
              >
                <Filter className="h-3.5 w-3.5" />
                Filtros
              </button>

              {/* Distribuir visíveis */}
              <button
                type="button"
                onClick={() => distributeLeadIds(activeRows.map((row) => row.id), "group")}
                disabled={busyScope !== null || activeRows.length === 0}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[rgb(var(--blue-9))] px-3 text-xs font-semibold text-white transition hover:bg-[rgb(var(--blue-10))] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busyScope === "group" ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <UserRoundCheck className="h-3.5 w-3.5" />}
                {activeGroupKey === ALL_GROUPS_KEY ? `Distribuir todos (${activeRows.length})` : `Distribuir grupo (${activeRows.length})`}
              </button>
            </div>
          </div>

          {/* Resultado inline */}
          {message && (
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-[rgb(var(--border-weak))] bg-white px-3 py-2 text-xs font-semibold text-[rgb(var(--slate-11))]">
              <span className="flex-1">{message}</span>
              <a
                href="/crm?view=kanban"
                className="shrink-0 rounded-lg bg-neutral-900 px-3 py-1 text-[11px] font-semibold text-white hover:bg-neutral-700"
              >
                Ver Pipeline →
              </a>
              <button type="button" onClick={() => setMessage(null)} className="shrink-0 text-[rgb(var(--slate-10))] hover:text-[rgb(var(--slate-12))]">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Painel de filtros (colapsável) */}
        {showFilters && (
          <form action="/distribuicao" className="flex flex-wrap items-end gap-3 border-b border-[rgb(var(--border-weak))] bg-[rgb(var(--slate-1))] px-4 py-3">
            <label className="grid gap-1 text-[11px] font-semibold text-[rgb(var(--slate-10))]">
              Produto
              <select
                name="produto"
                defaultValue={filters.produto ?? ""}
                className="h-8 rounded-lg border border-[rgb(var(--border-strong))] bg-white px-2 text-xs text-[rgb(var(--slate-12))]"
              >
                <option value="">Todos</option>
                <option value="instituto">Instituto UP</option>
                <option value="vozup">Voz UP</option>
              </select>
            </label>

            <label className="grid gap-1 text-[11px] font-semibold text-[rgb(var(--slate-10))]">
              Busca geral
              <input
                type="text"
                name="caracteristica"
                defaultValue={filters.caracteristica ?? ""}
                placeholder="Nome, telefone, etiqueta..."
                className="h-8 min-w-40 rounded-lg border border-[rgb(var(--border-strong))] bg-white px-2 text-xs text-[rgb(var(--slate-12))]"
              />
            </label>

            <label className="grid gap-1 text-[11px] font-semibold text-[rgb(var(--slate-10))]">
              Presença
              <select
                name="presenca"
                defaultValue={filters.presenca ?? ""}
                className="h-8 rounded-lg border border-[rgb(var(--border-strong))] bg-white px-2 text-xs text-[rgb(var(--slate-12))]"
              >
                <option value="">Todas</option>
                <option value="aprovada">Presentes</option>
                <option value="validada">Validadas</option>
                <option value="reprovada">Parciais</option>
                <option value="nao-validada">Não validadas</option>
              </select>
            </label>

            <label className="grid gap-1 text-[11px] font-semibold text-[rgb(var(--slate-10))]">
              Status
              <select
                name="status"
                defaultValue={filters.status ?? "todos"}
                className="h-8 rounded-lg border border-[rgb(var(--border-strong))] bg-white px-2 text-xs text-[rgb(var(--slate-12))]"
              >
                <option value="todos">Todos</option>
                <option value="aguardando">Novos</option>
                <option value="aprovado">Qualificados</option>
                <option value="rejeitado">Descartados</option>
              </select>
            </label>

            <label className="flex items-center gap-1.5 text-xs font-semibold text-[rgb(var(--slate-11))] cursor-pointer">
              <input type="hidden" name="unassignedOnly" value="false" />
              <input
                type="checkbox"
                name="unassignedOnly"
                value="true"
                defaultChecked={filters.unassignedOnly}
                className="h-3.5 w-3.5 rounded border-[rgb(var(--border-strong))]"
              />
              Sem responsável
            </label>

            <label className="grid gap-1 text-[11px] font-semibold text-[rgb(var(--slate-10))]">
              Limite
              <input
                type="number"
                min={1}
                max={500}
                name="limit"
                defaultValue={limit}
                className="h-8 w-20 rounded-lg border border-[rgb(var(--border-strong))] bg-white px-2 text-xs text-[rgb(var(--slate-12))]"
              />
            </label>

            <button
              type="submit"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[rgb(var(--slate-12))] px-3 text-xs font-semibold text-white transition hover:bg-[rgb(var(--slate-11))]"
            >
              <Filter className="h-3.5 w-3.5" />
              Aplicar
            </button>
          </form>
        )}

        {/* Toolbar da tabela */}
        <div className="flex items-center gap-3 border-b border-[rgb(var(--border-weak))] px-4 py-2.5">
          <button
            type="button"
            onClick={toggleVisibleRows}
            disabled={activeRows.length === 0}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[rgb(var(--slate-10))] hover:bg-[rgba(var(--alpha-2))] hover:text-[rgb(var(--slate-12))] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {allVisibleSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
          </button>
          <input
            type="text"
            value={clientSearch}
            onChange={(e) => setClientSearch(e.target.value)}
            placeholder="Buscar por nome, telefone, campanha…"
            className="h-7 min-w-48 flex-1 rounded-lg border border-[rgb(var(--border-strong))] bg-white px-3 text-xs text-[rgb(var(--slate-12))] placeholder:text-[rgb(var(--slate-9))] focus:border-[rgb(var(--blue-7))] focus:outline-none sm:max-w-xs"
          />
          <span className="ml-auto text-xs text-[rgb(var(--slate-10))]">
            {activeRows.length.toLocaleString("pt-BR")} lead(s) exibido(s)
            {clientSearch.trim() && ` de ${baseRows.length}`}
          </span>
        </div>

        {/* Tabela */}
        {activeRows.length === 0 ? (
          <div className="px-4 py-20 text-center text-sm text-[rgb(var(--slate-10))]">
            Nenhum lead encontrado para este grupo.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[800px] w-full border-collapse text-sm">
              <thead className="bg-[rgb(var(--slate-1))] text-[11px] font-semibold uppercase tracking-wide text-[rgb(var(--slate-10))]">
                <tr>
                  <th className="w-10 px-4 py-3 text-left" />
                  <th className="px-4 py-3 text-left">Lead</th>
                  {activeGroupKey === ALL_GROUPS_KEY && <th className="px-4 py-3 text-left">Grupo</th>}
                  <th className="px-4 py-3 text-left">Caminho</th>
                  <th className="px-4 py-3 text-left">Presença</th>
                  <th className="px-4 py-3 text-left">Responsável</th>
                  <th className="px-4 py-3 text-left">Entrada</th>
                </tr>
              </thead>
              <tbody>
                {activeRows.map((row) => {
                  const selected = selectedIds.has(row.id);
                  return (
                    <tr
                      key={row.id}
                      onClick={() => toggleRow(row.id)}
                      className={`cursor-pointer border-t border-[rgb(var(--border-weak))] transition-colors ${
                        selected
                          ? "bg-[rgb(var(--blue-2))] hover:bg-[rgb(var(--blue-3))]"
                          : "hover:bg-[rgb(var(--slate-1))]"
                      }`}
                    >
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleRow(row.id)}
                          className="h-4 w-4 rounded border-[rgb(var(--border-strong))]"
                          aria-label={`Selecionar lead ${row.name ?? row.id}`}
                        />
                      </td>
                      <td className="max-w-56 px-4 py-3">
                        <p className="truncate font-semibold text-[rgb(var(--slate-12))]">{row.name ?? `Lead #${row.id}`}</p>
                        <p className="truncate text-xs text-[rgb(var(--slate-10))]">{row.phone ?? "Sem telefone"} · {row.city ?? "Sem cidade"}</p>
                      </td>
                      {activeGroupKey === ALL_GROUPS_KEY && (
                        <td className="max-w-40 px-4 py-3">
                          <p className="truncate text-xs font-semibold text-[rgb(var(--slate-11))]">{row.sourceGroupTitle}</p>
                        </td>
                      )}
                      <td className="max-w-[20rem] px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {row.leadPath.map((part) => (
                            <span
                              key={`${row.id}-${part}`}
                              className="max-w-[9rem] truncate rounded-md bg-[rgb(var(--slate-2))] px-2 py-0.5 text-[11px] font-semibold text-[rgb(var(--slate-11))]"
                            >
                              {part}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                          row.presenceLabel === "Presente"
                            ? "bg-[rgb(var(--green-3,var(--slate-2)))] text-[rgb(var(--green-11,var(--slate-11)))]"
                            : "bg-[rgb(var(--slate-2))] text-[rgb(var(--slate-10))]"
                        }`}>
                          {row.presenceLabel}
                        </span>
                      </td>
                      <td className="max-w-44 px-4 py-3">
                        {row.assignedSellerName ? (
                          <>
                            <p className="truncate font-semibold text-[rgb(var(--slate-12))]">{row.assignedSellerName}</p>
                            {row.assignedSellerEmail && (
                              <p className="truncate text-xs text-[rgb(var(--slate-10))]">{row.assignedSellerEmail}</p>
                            )}
                          </>
                        ) : (
                          <span className="text-[rgb(var(--slate-10))]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-[rgb(var(--slate-10))]">{dateLabel(row.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Barra flutuante de seleção ─────────────────────────── */}
      {selectedCount > 0 && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
          <div className="flex items-center gap-3 rounded-full border border-[rgba(255,255,255,0.12)] bg-[rgb(var(--slate-12))] px-5 py-3 shadow-[0_8px_24px_rgba(0,0,0,0.3)]">
            <span className="text-sm font-semibold text-white">
              {selectedCount.toLocaleString("pt-BR")} selecionado(s)
            </span>
            <div className="h-4 w-px bg-[rgba(255,255,255,0.2)]" />
            <button
              type="button"
              onClick={() => distributeLeadIds(selectedLeadIds, "selected")}
              disabled={busyScope !== null}
              className="inline-flex items-center gap-1.5 rounded-full bg-[rgb(var(--blue-9))] px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-[rgb(var(--blue-10))] disabled:opacity-50"
            >
              {busyScope === "selected" ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Distribuir para {strategy === "single" && assignedSeller ? assignedSeller.name.split(" ")[0] : `${roundRobinSellerIds.length} vendedor(es)`}
            </button>
            <button
              type="button"
              onClick={clearSelection}
              className="flex h-7 w-7 items-center justify-center rounded-full text-[rgba(255,255,255,0.6)] transition hover:bg-[rgba(255,255,255,0.1)] hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

    </main>
  );
}
