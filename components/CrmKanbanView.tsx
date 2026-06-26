"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { CommercialStage, InscricaoItem } from "@/types/inscricao";
import { humanizeName } from "@/lib/utils";
import { formatTrainingDateLabel } from "@/lib/trainings";

/* ── Stage config ───────────────────────────────────────── */

interface StageConfig {
  label: string;
  color: string;
  headerBg: string;
  dot: string;
}

const STAGE_CONFIG: Record<CommercialStage, StageConfig> = {
  novo:            { label: "Novo",            color: "text-slate-700",   headerBg: "bg-slate-50",   dot: "bg-slate-400" },
  primeiro_contato:{ label: "1º Contato",      color: "text-cyan-700",    headerBg: "bg-cyan-50",    dot: "bg-cyan-500" },
  em_atendimento:  { label: "Em atendimento",  color: "text-blue-700",    headerBg: "bg-blue-50",    dot: "bg-blue-500" },
  agendado:        { label: "Agendado",         color: "text-violet-700",  headerBg: "bg-violet-50",  dot: "bg-violet-500" },
  fechamento:      { label: "Fechamento",       color: "text-amber-700",   headerBg: "bg-amber-50",   dot: "bg-amber-500" },
  no_show:         { label: "No-show",          color: "text-orange-700",  headerBg: "bg-orange-50",  dot: "bg-orange-400" },
  ganho:           { label: "Ganho",            color: "text-emerald-700", headerBg: "bg-emerald-50", dot: "bg-emerald-500" },
  perdido:         { label: "Perdido",          color: "text-rose-700",    headerBg: "bg-rose-50",    dot: "bg-rose-400" },
};

const STAGE_ORDER: CommercialStage[] = [
  "novo", "primeiro_contato", "em_atendimento", "agendado", "fechamento", "no_show", "ganho", "perdido",
];

/* ── Types ──────────────────────────────────────────────── */

interface KanbanStage {
  leads: InscricaoItem[];
  total: number;
}

interface KanbanData {
  stages: Record<CommercialStage, KanbanStage>;
}

interface CrmKanbanViewProps {
  selectedId: number | null;
  onSelectLead: (id: number | null) => void;
  produto?: string | null;
  assignedSellerEmail?: string;
  isSupervisor: boolean;
}

/* ── Helpers ─────────────────────────────────────────────── */

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function trainingLabel(lead: InscricaoItem): string | null {
  if (lead.treinamentoNome) return lead.treinamentoNome;
  if (lead.treinamentoId) return formatTrainingDateLabel(lead.treinamentoId) ?? lead.treinamentoId;
  return null;
}

/* ── Card ────────────────────────────────────────────────── */

function KanbanCard({
  lead,
  isSelected,
  onSelect,
  onStageChange,
  currentStage,
}: {
  lead: InscricaoItem;
  isSelected: boolean;
  onSelect: () => void;
  onStageChange: (stage: CommercialStage) => void;
  currentStage: CommercialStage;
}) {
  const [showStageMenu, setShowStageMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const training = trainingLabel(lead);

  useEffect(() => {
    if (!showStageMenu) return;
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowStageMenu(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showStageMenu]);

  return (
    <div
      className={`group relative cursor-pointer rounded-xl border bg-white p-3 shadow-sm transition hover:shadow-md ${
        isSelected ? "border-cyan-400 ring-2 ring-cyan-100" : "border-neutral-200 hover:border-neutral-300"
      }`}
      onClick={onSelect}
    >
      {/* Avatar + name */}
      <div className="flex items-start gap-2.5">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xs font-bold text-neutral-600">
          {(humanizeName(lead.nome) ?? "?")[0].toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-neutral-900">
            {humanizeName(lead.nome) ?? "Sem nome"}
          </p>
          {lead.cidade && (
            <p className="truncate text-[10px] text-neutral-400">{lead.cidade}</p>
          )}
        </div>

        {/* Move stage button */}
        <div ref={menuRef} className="relative" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => setShowStageMenu((v) => !v)}
            className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-300 opacity-0 transition group-hover:opacity-100 hover:bg-neutral-100 hover:text-neutral-600"
            title="Mover etapa"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v.01M12 12v.01M12 19v.01" />
            </svg>
          </button>
          {showStageMenu && (
            <div className="absolute right-0 top-7 z-50 w-40 rounded-xl border border-neutral-200 bg-white py-1 shadow-lg">
              {STAGE_ORDER.filter((s) => s !== currentStage).map((s) => {
                const cfg = STAGE_CONFIG[s];
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => { onStageChange(s); setShowStageMenu(false); }}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-[11px] font-medium hover:bg-neutral-50 ${cfg.color}`}
                  >
                    <span className={`h-2 w-2 rounded-full ${cfg.dot}`} />
                    {cfg.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Training + date */}
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {training && (
          <span className="rounded-md bg-neutral-900 px-1.5 py-0.5 text-[9px] font-semibold text-white">
            {training}
          </span>
        )}
        <span className="text-[9px] text-neutral-400">{fmtDate(lead.criadoEm)}</span>
      </div>

      {/* Seller */}
      {lead.commercial?.assignedSellerName && (
        <p className="mt-1.5 truncate text-[9px] text-neutral-400">
          → {lead.commercial.assignedSellerName}
        </p>
      )}

      {/* Stars */}
      {(lead.stars ?? 0) > 0 && (
        <div className="mt-1 flex">
          {Array.from({ length: lead.stars ?? 0 }).map((_, i) => (
            <span key={i} className="text-[10px] text-amber-400">★</span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Column ──────────────────────────────────────────────── */

function KanbanColumn({
  stage,
  leads,
  total,
  selectedId,
  onSelectLead,
  onStageChange,
}: {
  stage: CommercialStage;
  leads: InscricaoItem[];
  total: number;
  selectedId: number | null;
  onSelectLead: (id: number | null) => void;
  onStageChange: (leadId: number, stage: CommercialStage) => void;
}) {
  const cfg = STAGE_CONFIG[stage];
  return (
    <div className="flex w-64 flex-shrink-0 flex-col rounded-xl border border-neutral-200 bg-neutral-50">
      {/* Column header */}
      <div className={`flex items-center gap-2 rounded-t-xl px-3 py-2.5 ${cfg.headerBg}`}>
        <span className={`h-2.5 w-2.5 rounded-full ${cfg.dot}`} />
        <span className={`flex-1 text-[11px] font-bold uppercase tracking-wider ${cfg.color}`}>
          {cfg.label}
        </span>
        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-neutral-500 shadow-sm">
          {total}
        </span>
      </div>

      {/* Cards */}
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2" style={{ maxHeight: "calc(100vh - 16rem)" }}>
        {leads.length === 0 ? (
          <p className="py-6 text-center text-[10px] text-neutral-300">Sem leads</p>
        ) : (
          leads.map((lead) => (
            <KanbanCard
              key={lead.id}
              lead={lead}
              isSelected={selectedId === lead.id}
              onSelect={() => onSelectLead(selectedId === lead.id ? null : lead.id)}
              onStageChange={(s) => onStageChange(lead.id, s)}
              currentStage={stage}
            />
          ))
        )}
        {total > leads.length && (
          <p className="pb-1 text-center text-[10px] text-neutral-400">
            +{total - leads.length} leads não exibidos
          </p>
        )}
      </div>
    </div>
  );
}

/* ── Main component ──────────────────────────────────────── */

export function CrmKanbanView({
  selectedId,
  onSelectLead,
  produto,
  assignedSellerEmail,
  isSupervisor,
}: CrmKanbanViewProps) {
  const [data, setData] = useState<KanbanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (produto) params.set("produto", produto);
    if (isSupervisor && assignedSellerEmail) params.set("assignedSellerEmail", assignedSellerEmail);
    try {
      const res = await fetch(`/api/commercial/kanban?${params}`);
      const json = await res.json();
      if (json.success) setData(json);
      else setError(json.error ?? "Erro ao carregar kanban");
    } catch {
      setError("Erro de conexão");
    } finally {
      setLoading(false);
    }
  }, [produto, assignedSellerEmail, isSupervisor]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleStageChange = useCallback(async (leadId: number, stage: CommercialStage) => {
    await fetch(`/api/commercial/leads/${leadId}/stage`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage }),
    });
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-200 border-t-neutral-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <p className="text-sm text-red-500">{error}</p>
        <button
          type="button"
          onClick={fetchData}
          className="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-neutral-50"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  if (!data) return null;

  const totalLeads = STAGE_ORDER.reduce((sum, s) => sum + (data.stages[s]?.total ?? 0), 0);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-shrink-0 items-center justify-between border-b border-neutral-100 bg-white px-4 py-2">
        <p className="text-[11px] text-neutral-400">{totalLeads.toLocaleString("pt-BR")} leads no pipeline</p>
        <button
          type="button"
          onClick={fetchData}
          className="flex items-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-[11px] font-medium text-neutral-500 hover:bg-neutral-50"
        >
          <RefreshCw className="h-3 w-3" />
          Atualizar
        </button>
      </div>

      {/* Board */}
      <div className="flex flex-1 gap-3 overflow-x-auto p-3">
        {STAGE_ORDER.map((stage) => {
          const stageData = data.stages[stage];
          if (!stageData) return null;
          return (
            <KanbanColumn
              key={stage}
              stage={stage}
              leads={stageData.leads}
              total={stageData.total}
              selectedId={selectedId}
              onSelectLead={onSelectLead}
              onStageChange={handleStageChange}
            />
          );
        })}
      </div>
    </div>
  );
}
