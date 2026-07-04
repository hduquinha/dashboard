"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CommercialStage, InscricaoItem } from "@/types/inscricao";
import { humanizeName } from "@/lib/utils";
import { formatTrainingDateLabel } from "@/lib/trainings";
import { computeDropPosition } from "@/lib/leadPosition";

/* ── Stage config ───────────────────────────────────────── */

interface StageConfig {
  label: string;
  headerBg: string;   // column header background
  headerText: string; // column header text
  badgeBg: string;    // count badge bg
  badgeText: string;
  cardBorder: string; // left accent on card
  dotColor: string;   // dot in stage menu
}

const STAGE_CONFIG: Record<CommercialStage, StageConfig> = {
  novo: {
    label: "Novo",
    headerBg: "bg-slate-600",
    headerText: "text-white",
    badgeBg: "bg-slate-500",
    badgeText: "text-white",
    cardBorder: "border-l-slate-400",
    dotColor: "bg-slate-400",
  },
  primeiro_contato: {
    label: "1º Contato",
    headerBg: "bg-cyan-600",
    headerText: "text-white",
    badgeBg: "bg-cyan-500",
    badgeText: "text-white",
    cardBorder: "border-l-cyan-500",
    dotColor: "bg-cyan-500",
  },
  em_atendimento: {
    label: "Em Atendimento",
    headerBg: "bg-blue-600",
    headerText: "text-white",
    badgeBg: "bg-blue-500",
    badgeText: "text-white",
    cardBorder: "border-l-blue-500",
    dotColor: "bg-blue-500",
  },
  agendado: {
    label: "Agendado",
    headerBg: "bg-violet-600",
    headerText: "text-white",
    badgeBg: "bg-violet-500",
    badgeText: "text-white",
    cardBorder: "border-l-violet-500",
    dotColor: "bg-violet-500",
  },
  fechamento: {
    label: "Fechamento",
    headerBg: "bg-amber-500",
    headerText: "text-white",
    badgeBg: "bg-amber-400",
    badgeText: "text-amber-900",
    cardBorder: "border-l-amber-400",
    dotColor: "bg-amber-400",
  },
  no_show: {
    label: "No-show",
    headerBg: "bg-orange-500",
    headerText: "text-white",
    badgeBg: "bg-orange-400",
    badgeText: "text-white",
    cardBorder: "border-l-orange-400",
    dotColor: "bg-orange-400",
  },
  ganho: {
    label: "Ganho",
    headerBg: "bg-emerald-600",
    headerText: "text-white",
    badgeBg: "bg-emerald-500",
    badgeText: "text-white",
    cardBorder: "border-l-emerald-500",
    dotColor: "bg-emerald-500",
  },
  perdido: {
    label: "Perdido",
    headerBg: "bg-rose-600",
    headerText: "text-white",
    badgeBg: "bg-rose-500",
    badgeText: "text-white",
    cardBorder: "border-l-rose-400",
    dotColor: "bg-rose-400",
  },
};

const STAGE_ORDER: CommercialStage[] = [
  "novo",
  "primeiro_contato",
  "em_atendimento",
  "agendado",
  "fechamento",
  "no_show",
  "ganho",
  "perdido",
];

const COLUMN_DROPPABLE_PREFIX = "column:";

/* ── Types ──────────────────────────────────────────────── */

interface KanbanStage {
  leads: InscricaoItem[];
  total: number;
}

type KanbanBoard = Record<CommercialStage, KanbanStage>;

interface CrmKanbanViewProps {
  selectedId: number | null;
  onSelectLead: (id: number | null) => void;
  produto?: string | null;
  assignedSellerEmail?: string;
  isSupervisor: boolean;
  /** Chamado depois de qualquer movimentacao persistida (troca de etapa ou drag-and-drop). */
  onLeadMoved?: () => void;
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

// Mesma convencao de fallback do servidor (lib/db.ts ORDERABLE_COLUMNS
// .commercial_position): sem posicao explicita, usa -id (unico por lead)
// em vez de 0 — senao todo lead nunca arrastado empataria e o drag entre
// eles nao teria efeito nenhum apos o proximo fetch.
function leadPosition(lead: InscricaoItem): number {
  return lead.commercial?.position ?? -lead.id;
}

function findStageOfLead(board: KanbanBoard, leadId: number): CommercialStage | null {
  for (const stage of STAGE_ORDER) {
    if (board[stage]?.leads.some((lead) => lead.id === leadId)) {
      return stage;
    }
  }
  return null;
}

function parseColumnDroppableId(id: string | number): CommercialStage | null {
  if (typeof id !== "string" || !id.startsWith(COLUMN_DROPPABLE_PREFIX)) return null;
  const stage = id.slice(COLUMN_DROPPABLE_PREFIX.length);
  return STAGE_ORDER.includes(stage as CommercialStage) ? (stage as CommercialStage) : null;
}

/* ── Card ────────────────────────────────────────────────── */

interface KanbanCardVisualProps {
  lead: InscricaoItem;
  isSelected: boolean;
  onSelect: () => void;
  onStageChange: (stage: CommercialStage) => void;
  currentStage: CommercialStage;
  isOverlay?: boolean;
}

/** Corpo visual do card — sem hook de drag, reutilizado pelo card normal e pelo DragOverlay. */
function KanbanCardBody({
  lead,
  isSelected,
  onStageChange,
  currentStage,
  isOverlay,
}: Omit<KanbanCardVisualProps, "onSelect">) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const cfg = STAGE_CONFIG[currentStage];
  const training = trainingLabel(lead);

  useEffect(() => {
    if (!showMenu) return;
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showMenu]);

  return (
    <div
      className={`group relative rounded-lg border border-l-4 bg-white p-3 shadow-sm transition ${
        isOverlay ? "shadow-xl ring-2 ring-cyan-400" : "cursor-grab hover:shadow-md active:cursor-grabbing"
      } ${cfg.cardBorder} ${isSelected ? "ring-2 ring-cyan-400 ring-offset-1" : "hover:border-neutral-300"}`}
    >
      {/* Name row */}
      <div className="flex items-start justify-between gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-neutral-100 text-[11px] font-bold text-neutral-600">
            {(humanizeName(lead.nome) ?? "?")[0].toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate text-[12px] font-semibold text-neutral-900">
              {humanizeName(lead.nome) ?? "Sem nome"}
            </p>
            {lead.cidade && (
              <p className="truncate text-[10px] text-neutral-400">{lead.cidade}</p>
            )}
          </div>
        </div>

        {/* Stage move menu — alternativa ao drag-and-drop (teclado/acessibilidade) */}
        {!isOverlay && (
          <div ref={menuRef} className="relative flex-shrink-0" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setShowMenu((v) => !v)}
              title="Mover etapa"
              className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-300 opacity-0 transition group-hover:opacity-100 hover:bg-neutral-100 hover:text-neutral-600"
            >
              <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
              </svg>
            </button>
            {showMenu && (
              <div className="absolute right-0 top-7 z-50 w-44 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl">
                <p className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest text-neutral-400">
                  Mover para
                </p>
                {STAGE_ORDER.filter((s) => s !== currentStage).map((s) => {
                  const c = STAGE_CONFIG[s];
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => { onStageChange(s); setShowMenu(false); }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-[11px] font-medium text-neutral-700 hover:bg-neutral-50"
                    >
                      <span className={`h-2.5 w-2.5 rounded-full ${c.dotColor}`} />
                      {c.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
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
        <p className="mt-1.5 truncate text-[9px] font-medium text-neutral-400">
          ↳ {lead.commercial.assignedSellerName}
        </p>
      )}

      {/* Stars */}
      {(lead.stars ?? 0) > 0 && (
        <div className="mt-1 flex gap-0.5">
          {Array.from({ length: lead.stars ?? 0 }).map((_, i) => (
            <span key={i} className="text-[10px] leading-none text-amber-400">★</span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Card real, dentro de uma coluna — arrastavel via dnd-kit. */
function KanbanCard({ lead, isSelected, onSelect, onStageChange, currentStage }: KanbanCardVisualProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: lead.id,
    data: { stage: currentStage },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} onClick={onSelect}>
      <KanbanCardBody
        lead={lead}
        isSelected={isSelected}
        onStageChange={onStageChange}
        currentStage={currentStage}
      />
    </div>
  );
}

/** Preview estatico usado no DragOverlay — sem registrar um segundo draggable com o mesmo id. */
function KanbanCardOverlay({ lead, currentStage }: { lead: InscricaoItem; currentStage: CommercialStage }) {
  return (
    <KanbanCardBody
      lead={lead}
      isSelected={false}
      onStageChange={() => {}}
      currentStage={currentStage}
      isOverlay
    />
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
  const { setNodeRef, isOver } = useDroppable({ id: `${COLUMN_DROPPABLE_PREFIX}${stage}` });

  return (
    <div className="flex w-64 flex-shrink-0 flex-col rounded-xl border border-neutral-200 bg-neutral-50 shadow-sm">
      {/* Header */}
      <div className={`flex items-center gap-2 rounded-t-xl px-4 py-3 ${cfg.headerBg}`}>
        <span className={`flex-1 truncate text-[13px] font-bold leading-tight tracking-normal ${cfg.headerText}`}>
          {cfg.label}
        </span>
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${cfg.badgeBg} ${cfg.badgeText}`}>
          {total}
        </span>
      </div>

      {/* Cards */}
      <div
        ref={setNodeRef}
        className={`flex flex-1 flex-col gap-2 overflow-y-auto p-2 transition-colors ${isOver ? "bg-cyan-50" : ""}`}
        style={{ maxHeight: "calc(100vh - 14rem)" }}
      >
        <SortableContext items={leads.map((lead) => lead.id)} strategy={verticalListSortingStrategy}>
          {leads.length === 0 ? (
            <p className="py-8 text-center text-[10px] text-neutral-300">Sem leads</p>
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
        </SortableContext>
        {total > leads.length && (
          <p className="pb-1 text-center text-[10px] text-neutral-400">
            +{total - leads.length} não exibidos
          </p>
        )}
      </div>
    </div>
  );
}

/* ── Main ────────────────────────────────────────────────── */

export function CrmKanbanView({
  selectedId,
  onSelectLead,
  produto,
  assignedSellerEmail,
  isSupervisor,
  onLeadMoved,
}: CrmKanbanViewProps) {
  const [data, setData] = useState<KanbanBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (produto) params.set("produto", produto);
    // Supervisors: pass sellerEmail only if explicitly filtering by one seller
    if (isSupervisor && assignedSellerEmail) {
      params.set("assignedSellerEmail", assignedSellerEmail);
    }
    try {
      const res = await fetch(`/api/commercial/kanban?${params}`);
      const json = await res.json();
      if (json.success) setData(json.stages);
      else setError(json.error ?? "Erro ao carregar kanban");
    } catch {
      setError("Erro de conexão");
    } finally {
      setLoading(false);
    }
  }, [produto, assignedSellerEmail, isSupervisor]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const persistMove = useCallback(
    async (leadId: number, stage: CommercialStage, position: number) => {
      try {
        const res = await fetch(`/api/commercial/leads/${leadId}/stage`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stage, position }),
        });
        if (!res.ok) throw new Error("Falha ao salvar movimentação");
        onLeadMoved?.();
      } catch {
        // Estado local pode ter divergido do banco — recarrega para nao mentir pro usuario.
        setError("Não foi possível salvar a movimentação. Recarregando...");
        await fetchData();
      }
    },
    [fetchData, onLeadMoved]
  );

  const handleStageChange = useCallback(async (leadId: number, stage: CommercialStage) => {
    setData((current) => {
      if (!current) return current;
      const fromStage = findStageOfLead(current, leadId);
      if (!fromStage || fromStage === stage) return current;
      const lead = current[fromStage].leads.find((l) => l.id === leadId);
      if (!lead) return current;
      const targetLeads = current[stage].leads;
      const maxPos = targetLeads.length > 0 ? Math.max(...targetLeads.map(leadPosition)) : null;
      const position = computeDropPosition(maxPos, null);
      const movedLead: InscricaoItem = {
        ...lead,
        commercial: lead.commercial ? { ...lead.commercial, stage, position } : lead.commercial,
      };
      void persistMove(leadId, stage, position);
      return {
        ...current,
        [fromStage]: {
          leads: current[fromStage].leads.filter((l) => l.id !== leadId),
          total: Math.max(0, current[fromStage].total - 1),
        },
        [stage]: {
          leads: [...targetLeads, movedLead],
          total: current[stage].total + 1,
        },
      };
    });
  }, [persistMove]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(Number(event.active.id));
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;
    const activeId = Number(active.id);

    setData((current) => {
      if (!current) return current;
      const fromStage = findStageOfLead(current, activeId);
      if (!fromStage) return current;

      const overColumn = parseColumnDroppableId(over.id);
      const overLeadId = overColumn ? null : Number(over.id);
      const toStage = overColumn ?? (overLeadId !== null ? findStageOfLead(current, overLeadId) : null);
      if (!toStage || toStage === fromStage) return current;

      const lead = current[fromStage].leads.find((l) => l.id === activeId);
      if (!lead) return current;

      const destLeads = current[toStage].leads;
      const overIndex = overLeadId !== null ? destLeads.findIndex((l) => l.id === overLeadId) : destLeads.length;
      const insertIndex = overIndex === -1 ? destLeads.length : overIndex;
      const nextDest = [...destLeads.slice(0, insertIndex), lead, ...destLeads.slice(insertIndex)];

      return {
        ...current,
        [fromStage]: {
          leads: current[fromStage].leads.filter((l) => l.id !== activeId),
          total: Math.max(0, current[fromStage].total - 1),
        },
        [toStage]: {
          leads: nextDest,
          total: current[toStage].total + 1,
        },
      };
    });
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;
    const leadId = Number(active.id);

    setData((current) => {
      if (!current) return current;
      const stage = findStageOfLead(current, leadId);
      if (!stage) return current;

      const leads = current[stage].leads;
      const index = leads.findIndex((l) => l.id === leadId);
      if (index === -1) return current;

      // Reordena dentro da coluna se o "over" for outro card da mesma coluna.
      const overColumn = parseColumnDroppableId(over.id);
      const overLeadId = overColumn ? null : Number(over.id);
      let nextLeads = leads;
      if (overLeadId !== null && overLeadId !== leadId) {
        const overIndex = leads.findIndex((l) => l.id === overLeadId);
        if (overIndex !== -1 && overIndex !== index) {
          nextLeads = [...leads];
          const [moved] = nextLeads.splice(index, 1);
          nextLeads.splice(overIndex, 0, moved);
        }
      }

      const finalIndex = nextLeads.findIndex((l) => l.id === leadId);
      const before = finalIndex > 0 ? leadPosition(nextLeads[finalIndex - 1]) : null;
      const after = finalIndex < nextLeads.length - 1 ? leadPosition(nextLeads[finalIndex + 1]) : null;
      const position = computeDropPosition(before, after);

      const movedLead = nextLeads[finalIndex];
      const finalLeads = [...nextLeads];
      finalLeads[finalIndex] = {
        ...movedLead,
        commercial: movedLead.commercial ? { ...movedLead.commercial, position } : movedLead.commercial,
      };

      void persistMove(leadId, stage, position);

      return {
        ...current,
        [stage]: { leads: finalLeads, total: current[stage].total },
      };
    });
  }, [persistMove]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-200 border-t-neutral-600" />
      </div>
    );
  }

  if (error && !data) {
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

  const totalLeads = STAGE_ORDER.reduce((sum, s) => sum + (data[s]?.total ?? 0), 0);
  const activeLead = activeId !== null ? findLeadById(data, activeId) : null;
  const activeStage = activeId !== null ? findStageOfLead(data, activeId) : null;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-shrink-0 items-center justify-between border-b border-neutral-100 bg-white px-4 py-2">
        <div className="flex items-center gap-3">
          <p className="text-[11px] text-neutral-400">
            {totalLeads.toLocaleString("pt-BR")} leads no pipeline
          </p>
          {isSupervisor && !assignedSellerEmail && (
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
              Visão master · todos os vendedores
            </span>
          )}
          {isSupervisor && assignedSellerEmail && (
            <span className="rounded-full bg-cyan-100 px-2 py-0.5 text-[10px] font-semibold text-cyan-700">
              Filtrado: {assignedSellerEmail}
            </span>
          )}
          {error && <span className="text-[11px] text-amber-600">{error}</span>}
        </div>
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
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex flex-1 gap-3 overflow-x-auto p-3">
          {STAGE_ORDER.map((stage) => {
            const stageData = data[stage];
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
        <DragOverlay>
          {activeLead && activeStage ? (
            <KanbanCardOverlay lead={activeLead} currentStage={activeStage} />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

function findLeadById(board: KanbanBoard, leadId: number): InscricaoItem | null {
  for (const stage of STAGE_ORDER) {
    const found = board[stage]?.leads.find((lead) => lead.id === leadId);
    if (found) return found;
  }
  return null;
}
