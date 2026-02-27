"use client";

import { useCallback, useEffect, useMemo, useState, useTransition, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { InscricaoItem, InscricaoStatus, OrderDirection, OrderableField } from "@/types/inscricao";
import type { TrainingOption } from "@/types/training";
import { buildAutoTrainingLabel, formatTrainingDateLabel } from "@/lib/trainings";
import { humanizeName } from "@/lib/utils";

/* ───────── Types ───────── */

interface RecruiterOption {
  code: string;
  name: string;
}

interface Filters {
  nome: string;
  telefone: string;
  indicacao: string;
  treinamento: string;
  status?: string;
  stars?: string;
}

interface LeadsClientProps {
  inscricoes: InscricaoItem[];
  total: number;
  page: number;
  pageSize: number;
  orderBy: OrderableField;
  orderDirection: OrderDirection;
  trainingOptions: TrainingOption[];
  recruiterOptions: RecruiterOption[];
  filters: Filters;
}

/* ───────── Pipeline stages ───────── */

const PIPELINE: { key: string; label: string; color: string; bg: string; icon: string }[] = [
  { key: "aguardando", label: "Novo", color: "text-slate-700", bg: "bg-slate-100", icon: "📥" },
  { key: "aprovado", label: "Qualificado", color: "text-emerald-700", bg: "bg-emerald-100", icon: "✅" },
  { key: "rejeitado", label: "Descartado", color: "text-rose-700", bg: "bg-rose-100", icon: "🚫" },
];

function pipelineFor(status?: InscricaoStatus) {
  return PIPELINE.find((p) => p.key === status) ?? PIPELINE[0];
}

/* ───────── Timeline helpers ───────── */

interface TimelineEvent {
  id: string;
  type: "note" | "status" | "whatsapp" | "system";
  content: string;
  date: string;
  icon: string;
  color: string;
}

function buildTimeline(inscricao: InscricaoItem): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  // Notes
  for (const note of inscricao.notes ?? []) {
    if (note.viaWhatsapp) {
      events.push({
        id: `whatsapp-${note.id}`,
        type: "whatsapp",
        content: note.content,
        date: note.createdAt,
        icon: "💬",
        color: "border-emerald-300 bg-emerald-50",
      });
    } else {
      events.push({
        id: `note-${note.id}`,
        type: "note",
        content: note.content,
        date: note.createdAt,
        icon: "📝",
        color: "border-blue-300 bg-blue-50",
      });
    }
  }

  // Status change
  if (inscricao.statusUpdatedAt) {
    const pipe = pipelineFor(inscricao.status);
    events.push({
      id: "status-change",
      type: "status",
      content: `Status alterado para ${pipe.label}`,
      date: inscricao.statusUpdatedAt,
      icon: pipe.icon,
      color: `border-neutral-300 bg-neutral-50`,
    });
  }

  // WhatsApp contacted
  if (inscricao.statusWhatsappContacted && inscricao.statusUpdatedAt) {
    events.push({
      id: "whatsapp-contacted",
      type: "whatsapp",
      content: "Contato realizado via WhatsApp",
      date: inscricao.statusUpdatedAt,
      icon: "📱",
      color: "border-green-300 bg-green-50",
    });
  }

  // Creation
  events.push({
    id: "created",
    type: "system",
    content: "Lead cadastrado no sistema",
    date: inscricao.criadoEm,
    icon: "🆕",
    color: "border-neutral-200 bg-neutral-50",
  });

  // Sort newest first
  events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return events;
}

/* ───────── Formatters ───────── */

function fmtDate(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtRelative(value: string): string {
  const now = Date.now();
  const then = new Date(value).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "agora";
  if (mins < 60) return `${mins}min atrás`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h atrás`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d atrás`;
  return fmtDate(value);
}

function cleanPhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

/* ───────── Component ───────── */

export default function CrmClient({
  inscricoes,
  total,
  page,
  pageSize,
  orderBy,
  orderDirection,
  trainingOptions,
  recruiterOptions,
  filters,
}: LeadsClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [records, setRecords] = useState(inscricoes);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [noteText, setNoteText] = useState("");
  const [noteType, setNoteType] = useState<"note" | "whatsapp" | "call" | "email">("note");
  const [savingNote, setSavingNote] = useState(false);
  const [savingStatus, setSavingStatus] = useState<string | null>(null);
  const [savingStars, setSavingStars] = useState(false);
  const [starsHover, setStarsHover] = useState(0);
  const [searchText, setSearchText] = useState(filters.nome);

  useEffect(() => { setRecords(inscricoes); }, [inscricoes]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const selected = useMemo(() => records.find((r) => r.id === selectedId) ?? null, [records, selectedId]);
  const timeline = useMemo(() => selected ? buildTimeline(selected) : [], [selected]);

  const trainingById = useMemo(() => {
    const map: Record<string, TrainingOption> = {};
    for (const t of trainingOptions) map[t.id] = t;
    return map;
  }, [trainingOptions]);

  /* ─── URL helpers ─── */

  const updateQuery = useCallback((updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === "") params.delete(k);
      else params.set(k, v);
    }
    const q = params.toString();
    startTransition(() => router.push(q ? `${pathname}?${q}` : pathname));
  }, [searchParams, pathname, router, startTransition]);

  function goToPage(p: number) {
    updateQuery({ page: String(Math.min(Math.max(1, p), totalPages)) });
  }

  function handleSort(field: OrderableField) {
    const dir: OrderDirection = orderBy === field && orderDirection === "asc" ? "desc" : "asc";
    updateQuery({ orderBy: field, orderDirection: dir, page: "1" });
  }

  function syncRecord(updated: InscricaoItem) {
    setRecords((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
  }

  /* ─── Actions ─── */

  async function handleStatusChange(id: number, nextStatus: InscricaoStatus) {
    setSavingStatus(nextStatus);
    try {
      const res = await fetch(`/api/inscricoes/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.inscricao) syncRecord(data.inscricao);
      }
    } catch (e) { console.error(e); }
    finally { setSavingStatus(null); }
  }

  async function handleNoteSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selected || !noteText.trim()) return;
    setSavingNote(true);
    try {
      const res = await fetch(`/api/inscricoes/${selected.id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: `[${noteType === "whatsapp" ? "WhatsApp" : noteType === "call" ? "Ligação" : noteType === "email" ? "E-mail" : "Nota"}] ${noteText}`,
          viaWhatsapp: noteType === "whatsapp",
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.inscricao) syncRecord(data.inscricao);
        setNoteText("");
      }
    } catch (e) { console.error(e); }
    finally { setSavingNote(false); }
  }

  async function handleStarClick(value: number) {
    if (!selected || savingStars) return;
    const next = selected.stars === value ? 0 : value;
    setSavingStars(true);
    try {
      const res = await fetch(`/api/inscricoes/${selected.id}/stars`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stars: next }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.inscricao) syncRecord(data.inscricao);
      }
    } catch (e) { console.error(e); }
    finally { setSavingStars(false); }
  }

  function getTrainingDisplay(inscricao: InscricaoItem) {
    const tid = inscricao.treinamentoId;
    if (!tid) return null;
    const match = trainingById[tid];
    const raw = inscricao.treinamentoData ?? match?.startsAt ?? null;
    const formatted = raw ? formatTrainingDateLabel(raw) : formatTrainingDateLabel(tid);
    return formatted ?? inscricao.treinamentoNome ?? match?.label ?? tid;
  }

  /* ─── Render ─── */

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      {/* Top bar */}
      <header className="flex flex-shrink-0 items-center justify-between border-b border-neutral-200 bg-white px-6 py-4">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">CRM</h1>
          <p className="text-xs text-neutral-500">{total.toLocaleString()} registros • Página {page}/{totalPages}</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Search */}
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => { e.preventDefault(); updateQuery({ nome: searchText, page: "1" }); }}
          >
            <div className="relative">
              <svg className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Buscar lead..."
                className="w-56 rounded-lg border border-neutral-200 bg-neutral-50 py-2 pl-9 pr-3 text-sm focus:border-cyan-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-cyan-100"
              />
            </div>
            <button type="submit" className="rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800">Buscar</button>
          </form>
          {/* Pipeline filter chips */}
          <div className="hidden items-center gap-1.5 md:flex">
            {PIPELINE.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => updateQuery({ status: filters.status === p.key ? null : p.key, page: "1" })}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  filters.status === p.key
                    ? `${p.bg} ${p.color} ring-2 ring-offset-1 ring-current`
                    : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
                }`}
              >
                {p.icon} {p.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {isPending && (
        <div className="flex-shrink-0 bg-cyan-500 py-0.5 text-center text-[10px] font-semibold text-white">Carregando...</div>
      )}

      {/* Main: Table + Detail */}
      <div className="flex min-h-0 flex-1">
        {/* Table */}
        <div className={`flex flex-col overflow-hidden border-r border-neutral-200 transition-all ${selected ? "w-1/2 xl:w-3/5" : "w-full"}`}>
          <div className="flex-1 overflow-auto">
            <table className="min-w-full divide-y divide-neutral-100">
              <thead className="sticky top-0 z-10 bg-neutral-50">
                <tr>
                  {[
                    { key: "nome" as OrderableField, label: "Lead" },
                    { key: "criado_em" as OrderableField, label: "Data" },
                    { key: "treinamento" as OrderableField, label: "Treinamento" },
                    { key: "recrutador" as OrderableField, label: "Indicador" },
                  ].map((col) => (
                    <th
                      key={col.key}
                      className="cursor-pointer px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500 hover:text-neutral-800"
                      onClick={() => handleSort(col.key)}
                    >
                      <span className="inline-flex items-center gap-1">
                        {col.label}
                        {orderBy === col.key && (
                          <span className="text-cyan-500">{orderDirection === "asc" ? "↑" : "↓"}</span>
                        )}
                      </span>
                    </th>
                  ))}
                  <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-neutral-500">Status</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-neutral-500">Temp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-50">
                {records.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-16 text-center text-sm text-neutral-400">
                      Nenhum lead encontrado.
                    </td>
                  </tr>
                ) : records.map((lead) => {
                  const pipe = pipelineFor(lead.status);
                  const isSelected = selectedId === lead.id;
                  return (
                    <tr
                      key={lead.id}
                      onClick={() => setSelectedId(isSelected ? null : lead.id)}
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? "bg-cyan-50 ring-1 ring-inset ring-cyan-200"
                          : "hover:bg-neutral-50"
                      }`}
                    >
                      {/* Lead info */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {/* Avatar */}
                          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-neutral-200 to-neutral-300 text-sm font-bold text-neutral-600">
                          {(humanizeName(lead.nome) ?? "?")[0].toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-neutral-900">{humanizeName(lead.nome) ?? "Sem nome"}</p>
                            {lead.telefone && (
                              <p className="truncate text-xs text-neutral-500">{lead.telefone}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      {/* Date */}
                      <td className="px-4 py-3 text-xs text-neutral-500">{fmtRelative(lead.criadoEm)}</td>
                      {/* Training */}
                      <td className="px-4 py-3">
                        {getTrainingDisplay(lead) ? (
                          <span className="inline-flex max-w-[150px] truncate rounded-md bg-neutral-900 px-2 py-0.5 text-[10px] font-semibold text-white">
                            {getTrainingDisplay(lead)}
                          </span>
                        ) : (
                          <span className="text-xs text-neutral-400">—</span>
                        )}
                      </td>
                      {/* Indicador */}
                      <td className="px-4 py-3 text-xs text-neutral-600">{humanizeName(lead.recrutadorNome) || "—"}</td>
                      {/* Status */}
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold ${pipe.bg} ${pipe.color}`}>
                          {pipe.icon} {pipe.label}
                        </span>
                      </td>
                      {/* Stars */}
                      <td className="px-4 py-3 text-center">
                        {lead.stars ? (
                          <span className="text-amber-400 text-xs">{"★".repeat(lead.stars)}{"☆".repeat(5 - lead.stars)}</span>
                        ) : (
                          <span className="text-neutral-300 text-xs">☆☆☆☆☆</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex flex-shrink-0 items-center justify-between border-t border-neutral-200 bg-white px-4 py-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => goToPage(page - 1)}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-40"
              >← Anterior</button>
              <span className="text-xs text-neutral-500">Página {page} de {totalPages}</span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => goToPage(page + 1)}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-40"
              >Próxima →</button>
            </div>
          )}
        </div>

        {/* Detail Panel */}
        {selected && (
          <div className="flex w-1/2 flex-col overflow-hidden bg-white xl:w-2/5">
            {/* Panel header */}
            <div className="flex flex-shrink-0 items-start justify-between border-b border-neutral-200 bg-gradient-to-r from-[#0f172a] to-[#1e293b] px-5 py-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-lg font-bold text-white">
                    {(humanizeName(selected.nome) ?? "?")[0].toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-bold text-white">{humanizeName(selected.nome) ?? "Sem nome"}</h2>
                    <p className="text-xs text-cyan-300">#{selected.id} • {fmtDate(selected.criadoEm)}</p>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="ml-3 rounded-lg p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {/* Panel scrollable content */}
            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              {/* Contact quick actions */}
              <div className="flex flex-wrap gap-2">
                {selected.telefone && (
                  <>
                    <a
                      href={`https://wa.me/55${cleanPhone(selected.telefone)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-600"
                    >
                      <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                      WhatsApp
                    </a>
                    <a
                      href={`tel:+55${cleanPhone(selected.telefone)}`}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-blue-500 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-600"
                    >
                      📞 Ligar
                    </a>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => {
                    const text = `Nome: ${humanizeName(selected.nome) ?? selected.nome}\nTelefone: ${selected.telefone}\nCidade: ${selected.cidade ?? "-"}\nTreinamento: ${getTrainingDisplay(selected) ?? "-"}`;
                    navigator.clipboard.writeText(text);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-100 px-3 py-2 text-xs font-semibold text-neutral-700 transition hover:bg-neutral-200"
                >
                  📋 Copiar dados
                </button>
              </div>

              {/* Info cards */}
              <div className="grid grid-cols-2 gap-2">
                <InfoCard label="Telefone" value={selected.telefone ?? "-"} />
                <InfoCard label="Cidade" value={selected.cidade ?? "-"} />
                <InfoCard label="Treinamento" value={getTrainingDisplay(selected) ?? "-"} />
                <InfoCard label="Indicador" value={humanizeName(selected.recrutadorNome) || "-"} sub={selected.recrutadorCodigo ?? undefined} />
              </div>

              {/* Pipeline with click-to-change */}
              <div className="space-y-2">
                <h3 className="text-xs font-bold uppercase tracking-wide text-neutral-400">Pipeline</h3>
                <div className="flex gap-1.5">
                  {PIPELINE.map((p) => {
                    const active = selected.status === p.key || (!selected.status && p.key === "aguardando");
                    return (
                      <button
                        key={p.key}
                        type="button"
                        disabled={savingStatus !== null}
                        onClick={() => handleStatusChange(selected.id, p.key as InscricaoStatus)}
                        className={`flex-1 rounded-lg py-2 text-center text-xs font-bold transition ${
                          active
                            ? `${p.bg} ${p.color} ring-2 ring-offset-1 ring-current`
                            : "bg-neutral-50 text-neutral-400 hover:bg-neutral-100"
                        } ${savingStatus === p.key ? "animate-pulse" : ""}`}
                      >
                        {p.icon} {p.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Star rating */}
              <div className="space-y-2">
                <h3 className="text-xs font-bold uppercase tracking-wide text-neutral-400">Temperatura do Lead</h3>
                <div className="flex items-center gap-2" onMouseLeave={() => setStarsHover(0)}>
                  {[1, 2, 3, 4, 5].map((star) => {
                    const currentStars = selected.stars ?? 0;
                    const filled = starsHover > 0 ? star <= starsHover : star <= currentStars;
                    return (
                      <button
                        key={star}
                        type="button"
                        disabled={savingStars}
                        onMouseEnter={() => setStarsHover(star)}
                        onClick={() => handleStarClick(star)}
                        className={`text-2xl transition-transform hover:scale-110 disabled:opacity-50 ${filled ? "text-amber-400" : "text-neutral-300"}`}
                      >★</button>
                    );
                  })}
                  <span className="ml-2 text-xs text-neutral-500">{selected.stars ? `${selected.stars}/5` : "Sem avaliação"}</span>
                </div>
              </div>

              {/* New activity input */}
              <div className="space-y-2">
                <h3 className="text-xs font-bold uppercase tracking-wide text-neutral-400">Registrar Atividade</h3>
                <form onSubmit={handleNoteSubmit} className="space-y-2">
                  {/* Activity type selector */}
                  <div className="flex gap-1">
                    {([
                      { key: "note", label: "Nota", icon: "📝" },
                      { key: "whatsapp", label: "WhatsApp", icon: "💬" },
                      { key: "call", label: "Ligação", icon: "📞" },
                      { key: "email", label: "E-mail", icon: "📧" },
                    ] as const).map((t) => (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => setNoteType(t.key)}
                        className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition ${
                          noteType === t.key
                            ? "bg-neutral-900 text-white"
                            : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
                        }`}
                      >
                        {t.icon} {t.label}
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder={`Descreva a ${noteType === "whatsapp" ? "conversa no WhatsApp" : noteType === "call" ? "ligação" : noteType === "email" ? "interação por e-mail" : "observação"}...`}
                    rows={2}
                    className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm placeholder:text-neutral-400 focus:border-cyan-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-cyan-100"
                    disabled={savingNote}
                    required
                  />
                  <button
                    type="submit"
                    disabled={savingNote || !noteText.trim()}
                    className="w-full rounded-lg bg-neutral-900 py-2 text-xs font-bold text-white transition hover:bg-neutral-800 disabled:opacity-40"
                  >
                    {savingNote ? "Salvando..." : "Registrar atividade"}
                  </button>
                </form>
              </div>

              {/* Timeline */}
              <div className="space-y-2">
                <h3 className="text-xs font-bold uppercase tracking-wide text-neutral-400">Histórico de Atividades</h3>
                {timeline.length === 0 ? (
                  <p className="py-4 text-center text-xs text-neutral-400">Nenhuma atividade registrada.</p>
                ) : (
                  <div className="relative space-y-0">
                    {/* Vertical line */}
                    <div className="absolute bottom-0 left-4 top-0 w-px bg-neutral-200" />
                    {timeline.map((event, i) => (
                      <div key={event.id} className="relative flex gap-3 py-2">
                        {/* Dot */}
                        <div className="relative z-10 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white text-sm shadow-sm ring-2 ring-neutral-200">
                          {event.icon}
                        </div>
                        {/* Content */}
                        <div className={`min-w-0 flex-1 rounded-lg border p-3 ${event.color}`}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                              {event.type === "whatsapp" ? "WhatsApp" : event.type === "note" ? "Nota" : event.type === "status" ? "Status" : "Sistema"}
                            </span>
                            <span className="whitespace-nowrap text-[10px] text-neutral-400" title={fmtDateTime(event.date)}>
                              {fmtRelative(event.date)}
                            </span>
                          </div>
                          <p className="mt-1 text-sm text-neutral-800">{event.content}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Presence info (compact) */}
              {selected.presencaValidada && (
                <div className="space-y-2">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-neutral-400">Presença</h3>
                  <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3">
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${selected.presencaAprovada ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                        {selected.presencaAprovada ? "✓ Presente" : "⚠ Insuficiente"}
                      </span>
                      {selected.presencaParticipanteNome && (
                        <span className="text-xs text-cyan-700">como {selected.presencaParticipanteNome}</span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Small components ─── */

function InfoCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">{label}</p>
      <p className="mt-0.5 truncate text-sm font-medium text-neutral-800">{value}</p>
      {sub && <p className="text-[10px] text-neutral-500">{sub}</p>}
    </div>
  );
}
