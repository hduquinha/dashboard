"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  CalendarDays,
  Download,
  Filter,
  ListTree,
  Loader2,
  Search,
  Users,
  X,
} from "lucide-react";
import LeadAuditDetailModal from "@/components/LeadAuditDetailModal";
import { describeCommercialEvent, eventTypeLabel } from "@/lib/commercialEventDisplay";
import type { AuditFilterOptions, AuditLogEvent, AuditSummary } from "@/lib/auditLog";

interface AuditoriaClientProps {
  options: AuditFilterOptions;
}

type PeriodPreset = "hoje" | "7d" | "30d" | "90d" | "tudo" | "custom";
type ViewMode = "feed" | "byUser" | "byType";

const PERIOD_OPTIONS: Array<{ key: PeriodPreset; label: string }> = [
  { key: "hoje", label: "Hoje" },
  { key: "7d", label: "7 dias" },
  { key: "30d", label: "30 dias" },
  { key: "90d", label: "90 dias" },
  { key: "tudo", label: "Tudo" },
  { key: "custom", label: "Personalizado" },
];

const VIEW_OPTIONS: Array<{ key: ViewMode; label: string; icon: typeof ListTree }> = [
  { key: "feed", label: "Linha do tempo", icon: ListTree },
  { key: "byUser", label: "Por usuário", icon: Users },
  { key: "byType", label: "Por tipo", icon: Activity },
];

const PAGE_SIZE = 50;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Resolve o preset de período em from/to (YYYY-MM-DD). "Tudo" = sem limites. */
function resolvePeriod(preset: PeriodPreset, customFrom: string, customTo: string): { from: string | null; to: string | null } {
  if (preset === "tudo") return { from: null, to: null };
  if (preset === "custom") return { from: customFrom || null, to: customTo || null };
  const today = new Date();
  const to = isoDate(today);
  if (preset === "hoje") return { from: to, to };
  const days = preset === "7d" ? 6 : preset === "30d" ? 29 : 89;
  const from = new Date(today);
  from.setDate(from.getDate() - days);
  return { from: isoDate(from), to };
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "agora mesmo";
  if (minutes < 60) return `há ${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `há ${days}d`;
  return new Date(iso).toLocaleDateString("pt-BR");
}

function fullDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function csvCell(value: string | number | null): string {
  const text = String(value ?? "");
  return /[",\n;]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function EventRow({ event, onOpenLead }: { event: AuditLogEvent; onOpenLead: () => void }) {
  const info = describeCommercialEvent(event);
  const Icon = info.icon;
  return (
    <li className="flex gap-3 px-3 py-3">
      <span className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${info.iconClass}`}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <p className="text-sm font-semibold text-[rgb(var(--slate-12))]">{info.title}</p>
          <span className="rounded-full bg-[rgb(var(--slate-3))] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[rgb(var(--slate-9))]">
            {eventTypeLabel(event.type)}
          </span>
        </div>
        {info.detail ? (
          <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-[rgb(var(--slate-10))]">{info.detail}</p>
        ) : null}
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[rgb(var(--slate-9))]">
          <button
            type="button"
            onClick={onOpenLead}
            className="max-w-[16rem] truncate font-medium text-[rgb(var(--blue-11))] hover:underline"
            title="Ver histórico completo deste lead"
          >
            {event.leadName?.trim() || `Lead #${event.leadId}`}
          </button>
          <span aria-hidden>·</span>
          <span title={fullDateTime(event.createdAt)}>{timeAgo(event.createdAt)}</span>
          <span aria-hidden>·</span>
          <span>por {event.actorName || event.actorEmail || "sistema"}</span>
        </div>
      </div>
    </li>
  );
}

export default function AuditoriaClient({ options }: AuditoriaClientProps) {
  const [preset, setPreset] = useState<PeriodPreset>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [types, setTypes] = useState<string[]>([]);
  const [actor, setActor] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<ViewMode>("feed");

  const [events, setEvents] = useState<AuditLogEvent[]>([]);
  const [summary, setSummary] = useState<AuditSummary | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [selectedLead, setSelectedLead] = useState<AuditLogEvent | null>(null);

  const requestIdRef = useRef(0);

  const buildParams = useCallback(
    (offset: number, withSummary: boolean, limit = PAGE_SIZE) => {
      const { from, to } = resolvePeriod(preset, customFrom, customTo);
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (types.length > 0) params.set("types", types.join(","));
      if (actor) params.set("actor", actor);
      if (search) params.set("q", search);
      params.set("limit", String(limit));
      params.set("offset", String(offset));
      if (withSummary) params.set("summary", "1");
      return params;
    },
    [preset, customFrom, customTo, types, actor, search]
  );

  const loadFirstPage = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/vozup/auditoria?${buildParams(0, true).toString()}`);
      const data = await res.json();
      if (requestId !== requestIdRef.current) return;
      if (data.error) {
        setError(data.error);
        return;
      }
      setEvents(data.events ?? []);
      setSummary(data.summary ?? null);
      setHasMore(Boolean(data.hasMore));
    } catch {
      if (requestId === requestIdRef.current) setError("Falha ao carregar o registro de auditoria.");
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [buildParams]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/vozup/auditoria?${buildParams(events.length, false).toString()}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        return;
      }
      setEvents((current) => [...current, ...(data.events ?? [])]);
      setHasMore(Boolean(data.hasMore));
    } catch {
      setError("Falha ao carregar mais eventos.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const res = await fetch(`/api/vozup/auditoria?${buildParams(0, false, 5000).toString()}`);
      const data = await res.json();
      const rows: AuditLogEvent[] = data.events ?? [];
      const header = ["Data/Hora", "Tipo", "Descrição", "Lead", "#Lead", "Usuário", "Vendedor", "Detalhe"];
      const lines = rows.map((ev) => {
        const info = describeCommercialEvent(ev);
        return [
          fullDateTime(ev.createdAt),
          eventTypeLabel(ev.type),
          info.title,
          ev.leadName?.trim() || "",
          ev.leadId,
          ev.actorName || ev.actorEmail || "",
          ev.sellerName || "",
          (info.detail || "").replace(/\n/g, " | "),
        ]
          .map(csvCell)
          .join(",");
      });
      const csv = [header.map(csvCell).join(","), ...lines].join("\n");
      const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `auditoria-${isoDate(new Date())}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Falha ao exportar.");
    } finally {
      setExporting(false);
    }
  }

  function toggleType(type: string) {
    setTypes((current) => (current.includes(type) ? current.filter((t) => t !== type) : [...current, type]));
  }

  function clearFilters() {
    setPreset("30d");
    setTypes([]);
    setActor("");
    setSearch("");
    setSearchInput("");
  }

  const activeFilterCount =
    (types.length > 0 ? 1 : 0) + (actor ? 1 : 0) + (search ? 1 : 0) + (preset !== "30d" ? 1 : 0);

  const maxTypeCount = useMemo(() => Math.max(1, ...(summary?.byType ?? []).map((t) => t.count)), [summary]);
  const maxActorCount = useMemo(() => Math.max(1, ...(summary?.byActor ?? []).map((a) => a.count)), [summary]);

  const kpis = [
    { label: "Eventos no período", value: summary?.totalEvents ?? 0, icon: Activity },
    { label: "Leads afetados", value: summary?.leadsAffected ?? 0, icon: ListTree },
    { label: "Usuários ativos", value: summary?.activeActors ?? 0, icon: Users },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-[rgb(var(--slate-12))]">Registro de Auditoria</h1>
        <p className="text-sm text-[rgb(var(--slate-10))]">
          Todo o histórico de mudanças em qualquer lead — quem alterou, o que mudou e quando. Clique num lead para ver a linha do
          tempo completa dele.
        </p>
      </div>

      {/* Filtros */}
      <div className="space-y-3 rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-[rgb(var(--slate-9))]">
            <CalendarDays className="h-4 w-4" /> Período
          </div>
          <div className="flex flex-wrap gap-1 rounded-md bg-[rgb(var(--slate-3))] p-1">
            {PERIOD_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                aria-pressed={preset === option.key}
                onClick={() => setPreset(option.key)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                  preset === option.key
                    ? "bg-[rgb(var(--surface-1))] text-[rgb(var(--slate-12))] shadow-sm"
                    : "text-[rgb(var(--slate-10))] hover:text-[rgb(var(--slate-12))]"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          {preset === "custom" ? (
            <div className="flex items-center gap-2">
              <input
                type="date"
                aria-label="Data inicial"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="rounded-md border border-[rgb(var(--border-weak))] px-2 py-1 text-xs"
              />
              <span className="text-xs text-[rgb(var(--slate-9))]">até</span>
              <input
                type="date"
                aria-label="Data final"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="rounded-md border border-[rgb(var(--border-weak))] px-2 py-1 text-xs"
              />
            </div>
          ) : null}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(searchInput.trim());
            }}
            className="ml-auto flex items-center gap-2"
          >
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[rgb(var(--slate-8))]" />
              <input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Buscar lead: nome, telefone ou #id"
                className="w-56 rounded-md border border-[rgb(var(--border-weak))] py-1.5 pl-7 pr-2.5 text-xs"
              />
            </div>
            <button
              type="submit"
              className="rounded-md border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] px-3 py-1.5 text-xs font-semibold text-[rgb(var(--slate-12))] hover:bg-[rgb(var(--slate-2))]"
            >
              Buscar
            </button>
          </form>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-[rgb(var(--slate-9))]">
            <Users className="h-4 w-4" /> Usuário
          </div>
          <select
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            className="rounded-md border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] px-2 py-1.5 text-xs text-[rgb(var(--slate-12))]"
          >
            <option value="">Todos os usuários</option>
            {options.actors.map((a) => (
              <option key={a.email} value={a.email}>
                {(a.name || a.email) + ` (${a.count})`}
              </option>
            ))}
          </select>

          {activeFilterCount > 0 ? (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[rgb(var(--slate-10))] hover:bg-[rgb(var(--slate-2))]"
            >
              <X className="h-3.5 w-3.5" /> Limpar filtros ({activeFilterCount})
            </button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <div className="mr-1 flex items-center gap-1.5 text-xs font-medium text-[rgb(var(--slate-9))]">
            <Filter className="h-4 w-4" /> Tipo
          </div>
          {options.types.map((t) => {
            const active = types.includes(t.type);
            return (
              <button
                key={t.type}
                type="button"
                aria-pressed={active}
                onClick={() => toggleType(t.type)}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                  active
                    ? "border-[rgb(var(--blue-9))] bg-[rgb(var(--blue-3))] text-[rgb(var(--blue-11))]"
                    : "border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] text-[rgb(var(--slate-10))] hover:bg-[rgb(var(--slate-2))]"
                }`}
              >
                {eventTypeLabel(t.type)} ({t.count})
              </button>
            );
          })}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-[rgb(var(--slate-10))]">
              <kpi.icon className="h-4 w-4 text-[rgb(var(--blue-9))]" /> {kpi.label}
            </div>
            <p className="mt-1 text-2xl font-semibold text-[rgb(var(--slate-12))]">
              {loading ? "—" : kpi.value.toLocaleString("pt-BR")}
            </p>
          </div>
        ))}
      </div>

      {/* Modo de visualização + exportar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-md bg-[rgb(var(--slate-3))] p-1" role="tablist" aria-label="Modo de visualização">
          {VIEW_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              role="tab"
              aria-selected={view === option.key}
              onClick={() => setView(option.key)}
              className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold transition ${
                view === option.key
                  ? "bg-[rgb(var(--surface-1))] text-[rgb(var(--slate-12))] shadow-sm"
                  : "text-[rgb(var(--slate-10))] hover:text-[rgb(var(--slate-12))]"
              }`}
            >
              <option.icon className="h-3.5 w-3.5" /> {option.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting || loading}
          className="inline-flex items-center gap-1.5 rounded-md border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] px-3 py-1.5 text-xs font-semibold text-[rgb(var(--slate-12))] hover:bg-[rgb(var(--slate-2))] disabled:opacity-50"
        >
          {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Exportar CSV
        </button>
      </div>

      {error ? (
        <div className="rounded-lg border border-[rgb(var(--ruby-6))] bg-[rgb(var(--ruby-2))] px-3 py-2 text-sm text-[rgb(var(--ruby-11))]">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-10 text-sm text-[rgb(var(--slate-9))]">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </div>
      ) : view === "feed" ? (
        events.length > 0 ? (
          <div className="overflow-hidden rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))]">
            <ul className="divide-y divide-[rgb(var(--border-weak))]">
              {events.map((event) => (
                <EventRow key={event.id} event={event} onOpenLead={() => setSelectedLead(event)} />
              ))}
            </ul>
            {hasMore ? (
              <div className="border-t border-[rgb(var(--border-weak))] p-3 text-center">
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="inline-flex items-center gap-2 rounded-md border border-[rgb(var(--border-weak))] px-4 py-2 text-sm font-semibold text-[rgb(var(--slate-12))] hover:bg-[rgb(var(--slate-2))] disabled:opacity-50"
                >
                  {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Carregar mais
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-10 text-center text-sm text-[rgb(var(--slate-10))]">
            Nenhum evento para esse recorte.
          </div>
        )
      ) : view === "byUser" ? (
        <GroupedBars
          empty="Nenhuma atividade de usuário no período."
          rows={(summary?.byActor ?? []).map((a) => ({
            key: a.actorEmail ?? "sistema",
            label: a.actorName || a.actorEmail || "sistema",
            count: a.count,
            active: actor === a.actorEmail,
            onClick: a.actorEmail ? () => setActor(actor === a.actorEmail ? "" : a.actorEmail!) : undefined,
          }))}
          max={maxActorCount}
        />
      ) : (
        <GroupedBars
          empty="Nenhum evento no período."
          rows={(summary?.byType ?? []).map((t) => ({
            key: t.type,
            label: eventTypeLabel(t.type),
            count: t.count,
            active: types.includes(t.type),
            onClick: () => toggleType(t.type),
          }))}
          max={maxTypeCount}
        />
      )}

      {selectedLead ? (
        <LeadAuditDetailModal
          leadId={selectedLead.leadId}
          leadName={selectedLead.leadName}
          leadPhone={selectedLead.leadPhone}
          sellerName={selectedLead.sellerName}
          onClose={() => setSelectedLead(null)}
        />
      ) : null}
    </div>
  );
}

/** Lista de barras horizontais clicáveis — usada pelos modos "Por usuário" e
 * "Por tipo"; clicar aplica aquele recorte ao filtro e volta pra linha do tempo. */
function GroupedBars({
  rows,
  max,
  empty,
}: {
  rows: Array<{ key: string; label: string; count: number; active: boolean; onClick?: () => void }>;
  max: number;
  empty: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-10 text-center text-sm text-[rgb(var(--slate-10))]">
        {empty}
      </div>
    );
  }
  return (
    <ul className="space-y-2 rounded-xl border border-[rgb(var(--border-weak))] bg-[rgb(var(--surface-1))] p-3">
      {rows.map((row) => (
        <li key={row.key}>
          <button
            type="button"
            onClick={row.onClick}
            disabled={!row.onClick}
            className={`flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition ${
              row.onClick ? "hover:bg-[rgb(var(--slate-2))]" : "cursor-default"
            } ${row.active ? "ring-1 ring-[rgb(var(--blue-8))]" : ""}`}
          >
            <span className="w-40 flex-shrink-0 truncate text-sm font-medium text-[rgb(var(--slate-12))]">{row.label}</span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-[rgb(var(--slate-3))]">
              <span
                className="block h-full rounded-full bg-[rgb(var(--blue-9))]"
                style={{ width: `${Math.max(4, (row.count / max) * 100)}%` }}
              />
            </span>
            <span className="w-12 flex-shrink-0 text-right text-sm font-semibold tabular-nums text-[rgb(var(--slate-12))]">
              {row.count.toLocaleString("pt-BR")}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
