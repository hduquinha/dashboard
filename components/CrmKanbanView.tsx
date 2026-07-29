"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckSquare, RefreshCw, Users } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
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
import type { FunnelStage } from "@/types/funnel";
import type { CommercialSeller } from "@/types/commercial";
import { STAGE_COLOR_CLASSES } from "@/lib/stageColors";
import { buildWhatsAppWebUrl, humanizeName, openWhatsAppOnMobile } from "@/lib/utils";
import { CopyPhoneButton } from "@/components/CopyPhoneButton";
import { CloseLeadModal } from "@/components/CloseLeadModal";
import { formatTrainingDateLabel } from "@/lib/trainings";
import { computeDropPosition } from "@/lib/leadPosition";
import { describeLeadSource } from "@/lib/leadFields";

/* ── Stage config ───────────────────────────────────────── */
// As colunas do board vêm de fora (etapas do funil selecionado) — cada
// coluna carrega seu próprio label/cor, resolvidos aqui pra classes Tailwind.

function stageConfig(stage: FunnelStage | undefined) {
  const classes = STAGE_COLOR_CLASSES[stage?.color ?? "slate"];
  return { label: stage?.label ?? stage?.key ?? "?", ...classes };
}

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
  /** Colunas exibidas no board — etapas do funil selecionado, na ordem em que devem aparecer. */
  stages: FunnelStage[];
  /** Id do funil selecionado; impede que etapas com o mesmo nome se misturem. */
  funnelId: number | null;
  /** So leads com responsavel — os sem responsavel ficam na Chegada de Leads. */
  assignedOnly?: boolean;
  /** Filtro salvo (dashboard.kanban_filters) aplicado no servidor. */
  filterId?: number | null;
  /** Incrementar forca um refetch (ex.: apos editar um lead no modal). */
  refreshToken?: number;
  /** Mostra "Fechar lead" no menu do card (fechou curso / sem continuidade). */
  allowCloseLead?: boolean;
  /** Vendedores disponíveis para o repasse em massa (supervisores). */
  sellers?: CommercialSeller[];
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

function findStageOfLead(board: KanbanBoard, stageKeys: string[], leadId: number): CommercialStage | null {
  for (const stage of stageKeys) {
    if (board[stage]?.leads.some((lead) => lead.id === leadId)) {
      return stage;
    }
  }
  return null;
}

function parseColumnDroppableId(id: string | number, stageKeys: string[]): CommercialStage | null {
  if (typeof id !== "string" || !id.startsWith(COLUMN_DROPPABLE_PREFIX)) return null;
  const stage = id.slice(COLUMN_DROPPABLE_PREFIX.length);
  return stageKeys.includes(stage) ? stage : null;
}

function findLeadById(board: KanbanBoard, stageKeys: string[], leadId: number): InscricaoItem | null {
  for (const stage of stageKeys) {
    const found = board[stage]?.leads.find((lead) => lead.id === leadId);
    if (found) return found;
  }
  return null;
}

/* ── Card ────────────────────────────────────────────────── */

interface KanbanCardVisualProps {
  lead: InscricaoItem;
  isSelected: boolean;
  onSelect: () => void;
  onStageChange: (stage: CommercialStage) => void;
  onAttemptsChange: (delta: 1 | -1) => void;
  onSellerChange?: (sellerId: number) => void;
  currentStage: CommercialStage;
  isOverlay?: boolean;
  isBulkSelected?: boolean;
  onToggleBulkSelection?: () => void;
}

/** Corpo visual do card — sem hook de drag, reutilizado pelo card normal e pelo DragOverlay. */
function KanbanCardBody({
  lead,
  isSelected,
  onStageChange,
  onAttemptsChange,
  currentStage,
  isOverlay,
  stages,
  onRequestClose,
  isBulkSelected,
  onToggleBulkSelection,
  onSellerChange,
  sellers,
}: Omit<KanbanCardVisualProps, "onSelect"> & {
  stages: FunnelStage[];
  onRequestClose?: (lead: InscricaoItem) => void;
  sellers?: CommercialSeller[];
}) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const cfg = stageConfig(stages.find((s) => s.key === currentStage));
  const training = trainingLabel(lead);
  const origem = describeLeadSource(lead.payload).origem;
  const attempts = lead.commercial?.contactAttempts ?? 0;

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
          {!isOverlay && onToggleBulkSelection && (
            <button
              type="button"
              aria-label={isBulkSelected ? "Remover da seleção" : "Selecionar card"}
              title={isBulkSelected ? "Remover da seleção" : "Selecionar card"}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => { event.stopPropagation(); onToggleBulkSelection(); }}
              className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition ${
                isBulkSelected
                  ? "border-cyan-600 bg-cyan-600 text-white"
                  : "border-neutral-300 bg-white text-transparent hover:border-cyan-500"
              }`}
            >
              <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="m3 8 3 3 7-7" />
              </svg>
            </button>
          )}
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
              className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-300 transition hover:bg-neutral-100 hover:text-neutral-600 md:opacity-0 md:group-hover:opacity-100"
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
                {stages.filter((s) => s.key !== currentStage).map((s) => {
                  const c = stageConfig(s);
                  return (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => { onStageChange(s.key); setShowMenu(false); }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-[11px] font-medium text-neutral-700 hover:bg-neutral-50"
                    >
                      <span className={`h-2.5 w-2.5 rounded-full ${c.dotColor}`} />
                      {c.label}
                    </button>
                  );
                })}
                {onSellerChange && sellers && sellers.length > 0 && (
                  <>
                    <div className="my-1 border-t border-neutral-100" />
                    <p className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest text-neutral-400">
                      Repassar para
                    </p>
                    <div className="max-h-36 overflow-y-auto">
                      {sellers.map((seller) => (
                        <button
                          key={seller.chatwootUserId}
                          type="button"
                          onClick={() => { onSellerChange(seller.chatwootUserId); setShowMenu(false); }}
                          className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[11px] font-medium hover:bg-neutral-50 ${
                            seller.chatwootUserId === lead.commercial?.assignedSellerId ? "bg-violet-50 text-violet-700" : "text-neutral-700"
                          }`}
                        >
                          <Users className="h-3 w-3" />
                          {seller.name}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {onRequestClose && (
                  <>
                    <div className="my-1 border-t border-neutral-100" />
                    <button
                      type="button"
                      onClick={() => { onRequestClose(lead); setShowMenu(false); }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-[11px] font-semibold text-rose-600 hover:bg-rose-50"
                    >
                      <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
                      Fechar lead…
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Telefone / WhatsApp — quase do tamanho do nome, pro vendedor
          identificar o lead de bate-pronto, com abrir conversa + copiar. */}
      {lead.telefone && (
        <div
          className="mt-1.5 flex items-center gap-1.5"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <a
            href={buildWhatsAppWebUrl(lead.telefone)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => { e.stopPropagation(); openWhatsAppOnMobile(e, lead.telefone); }}
            title="Abrir conversa no WhatsApp"
            aria-label="Abrir conversa no WhatsApp"
            className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md bg-[#25D366]/15 text-[#128C4B] transition hover:bg-[#25D366]/30"
          >
            <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
            </svg>
          </a>
          <span className="min-w-0 truncate text-[12px] font-semibold text-neutral-700">
            {lead.telefone}
          </span>
          <CopyPhoneButton phone={lead.telefone} size={13} className="h-5 w-5 flex-shrink-0 justify-center" />
        </div>
      )}

      {/* Origem */}
      {origem && (
        <p className="mt-1 truncate text-[9px] text-neutral-400" title={origem}>
          Origem: {origem}
        </p>
      )}

      {/* Training + date */}
      <div className="mt-1 flex flex-wrap items-center gap-1">
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

      {/* Tentativas de contato — contador 0-10, editavel direto no card */}
      <div
        className="mt-1.5 flex items-center gap-1.5"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-[9px] font-semibold uppercase tracking-wide text-neutral-400">Tentativas</span>
        <button
          type="button"
          onClick={() => onAttemptsChange(-1)}
          disabled={attempts <= 0 || isOverlay}
          aria-label="Diminuir tentativas"
          className="flex h-4 w-4 items-center justify-center rounded bg-neutral-100 text-[11px] font-bold leading-none text-neutral-500 hover:bg-neutral-200 disabled:opacity-30"
        >
          −
        </button>
        <span className="w-4 text-center text-[11px] font-bold text-neutral-700">{attempts}</span>
        <button
          type="button"
          onClick={() => onAttemptsChange(1)}
          disabled={attempts >= 10 || isOverlay}
          aria-label="Aumentar tentativas"
          className="flex h-4 w-4 items-center justify-center rounded bg-neutral-100 text-[11px] font-bold leading-none text-neutral-500 hover:bg-neutral-200 disabled:opacity-30"
        >
          +
        </button>
      </div>
    </div>
  );
}

/** Card real, dentro de uma coluna — arrastavel via dnd-kit. */
function KanbanCard({
  lead,
  isSelected,
  onSelect,
  onStageChange,
  onAttemptsChange,
  currentStage,
  stages,
  onRequestClose,
  isBulkSelected,
  onToggleBulkSelection,
  onSellerChange,
  sellers,
}: KanbanCardVisualProps & {
  stages: FunnelStage[];
  onRequestClose?: (lead: InscricaoItem) => void;
  sellers?: CommercialSeller[];
}) {
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
        onAttemptsChange={onAttemptsChange}
        currentStage={currentStage}
        stages={stages}
        onRequestClose={onRequestClose}
        isBulkSelected={isBulkSelected}
        onToggleBulkSelection={onToggleBulkSelection}
        onSellerChange={onSellerChange}
        sellers={sellers}
      />
    </div>
  );
}

/** Preview estatico usado no DragOverlay — sem registrar um segundo draggable com o mesmo id. */
function KanbanCardOverlay({
  lead,
  currentStage,
  stages,
}: {
  lead: InscricaoItem;
  currentStage: CommercialStage;
  stages: FunnelStage[];
}) {
  return (
    <KanbanCardBody
      lead={lead}
      isSelected={false}
      onAttemptsChange={() => {}}
      onStageChange={() => {}}
      currentStage={currentStage}
      stages={stages}
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
  onAttemptsChange,
  stages,
  onRequestClose,
  bulkSelectedIds,
  onToggleBulkSelection,
  onSellerChange,
  sellers,
}: {
  stage: FunnelStage;
  leads: InscricaoItem[];
  total: number;
  selectedId: number | null;
  onSelectLead: (id: number | null) => void;
  onStageChange: (leadId: number, stage: CommercialStage) => void;
  onAttemptsChange: (leadId: number, delta: 1 | -1) => void;
  stages: FunnelStage[];
  onRequestClose?: (lead: InscricaoItem) => void;
  bulkSelectedIds: Set<number>;
  onToggleBulkSelection: (leadId: number) => void;
  onSellerChange?: (leadId: number, sellerId: number) => void;
  sellers?: CommercialSeller[];
}) {
  const cfg = stageConfig(stage);
  const { setNodeRef, isOver } = useDroppable({ id: `${COLUMN_DROPPABLE_PREFIX}${stage.key}` });

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
                onAttemptsChange={(delta) => onAttemptsChange(lead.id, delta)}
                currentStage={stage.key}
                stages={stages}
                onRequestClose={onRequestClose}
                isBulkSelected={bulkSelectedIds.has(lead.id)}
                onToggleBulkSelection={() => onToggleBulkSelection(lead.id)}
                onSellerChange={onSellerChange ? (sellerId) => onSellerChange(lead.id, sellerId) : undefined}
                sellers={sellers}
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
  stages,
  funnelId,
  assignedOnly,
  filterId,
  refreshToken,
  allowCloseLead,
  sellers = [],
}: CrmKanbanViewProps) {
  const [data, setData] = useState<KanbanBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [closingLead, setClosingLead] = useState<InscricaoItem | null>(null);
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<number>>(() => new Set());
  const [bulkStage, setBulkStage] = useState("");
  const [bulkSellerId, setBulkSellerId] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);

  const stageKeys = stages.map((stage) => stage.key);
  const stagesKey = stageKeys.join(",");

  // Mouse e toque separados: no celular o drag só começa com pressão longa
  // (250ms), senão qualquer tentativa de rolar o board arrastaria um card.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 12 } })
  );

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (produto) params.set("produto", produto);
    if (funnelId) params.set("funnelId", String(funnelId));
    if (stagesKey) params.set("stages", stagesKey);
    if (assignedOnly) params.set("assignedOnly", "1");
    if (filterId) params.set("filterId", String(filterId));
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
  }, [produto, assignedSellerEmail, isSupervisor, stagesKey, funnelId, filterId, assignedOnly]);

  useEffect(() => { fetchData(); }, [fetchData, refreshToken]);

  const toggleBulkSelection = useCallback((leadId: number) => {
    setBulkSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(leadId)) next.delete(leadId);
      else next.add(leadId);
      return next;
    });
  }, []);

  const applyBulkChange = useCallback(async (action: "stage" | "seller") => {
    const ids = [...bulkSelectedIds];
    const value = action === "stage" ? bulkStage : bulkSellerId;
    if (ids.length === 0 || !value) return;
    setBulkSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/commercial/leads/batch", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "stage"
          ? { ids, stage: value }
          : { ids, sellerId: Number(value) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Não foi possível atualizar os leads.");
      setBulkSelectedIds(new Set());
      setBulkStage("");
      setBulkSellerId("");
      onLeadMoved?.();
      await fetchData();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Não foi possível atualizar os leads.");
    } finally {
      setBulkSaving(false);
    }
  }, [bulkSelectedIds, bulkStage, bulkSellerId, fetchData, onLeadMoved]);

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
      const fromStage = findStageOfLead(current, stageKeys, leadId);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistMove, stagesKey]);

  const persistAttempts = useCallback(
    async (leadId: number, delta: 1 | -1) => {
      try {
        const res = await fetch(`/api/commercial/leads/${leadId}/attempts`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ delta }),
        });
        if (!res.ok) throw new Error("Falha ao salvar tentativas");
      } catch {
        setError("Não foi possível salvar as tentativas. Recarregando...");
        await fetchData();
      }
    },
    [fetchData]
  );

  const handleSellerChange = useCallback(async (leadId: number, sellerId: number) => {
    try {
      const res = await fetch(`/api/commercial/leads/${leadId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sellerId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Não foi possível trocar o vendedor.");
      onLeadMoved?.();
      await fetchData();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Não foi possível trocar o vendedor.");
    }
  }, [fetchData, onLeadMoved]);

  const handleAttemptsChange = useCallback(
    (leadId: number, delta: 1 | -1) => {
      setData((current) => {
        if (!current) return current;
        const stage = findStageOfLead(current, stageKeys, leadId);
        if (!stage) return current;
        const lead = current[stage].leads.find((l) => l.id === leadId);
        if (!lead?.commercial) return current;
        const nextAttempts = Math.min(10, Math.max(0, lead.commercial.contactAttempts + delta));
        if (nextAttempts === lead.commercial.contactAttempts) return current;
        void persistAttempts(leadId, delta);
        return {
          ...current,
          [stage]: {
            ...current[stage],
            leads: current[stage].leads.map((l) =>
              l.id === leadId
                ? { ...l, commercial: { ...l.commercial!, contactAttempts: nextAttempts } }
                : l
            ),
          },
        };
      });
    },
    [persistAttempts, stageKeys]
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(Number(event.active.id));
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;
    const activeId = Number(active.id);

    setData((current) => {
      if (!current) return current;
      const fromStage = findStageOfLead(current, stageKeys, activeId);
      if (!fromStage) return current;

      const overColumn = parseColumnDroppableId(over.id, stageKeys);
      const overLeadId = overColumn ? null : Number(over.id);
      const toStage = overColumn ?? (overLeadId !== null ? findStageOfLead(current, stageKeys, overLeadId) : null);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stagesKey]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;
    const leadId = Number(active.id);

    setData((current) => {
      if (!current) return current;
      const stage = findStageOfLead(current, stageKeys, leadId);
      if (!stage) return current;

      const leads = current[stage].leads;
      const index = leads.findIndex((l) => l.id === leadId);
      if (index === -1) return current;

      // Reordena dentro da coluna se o "over" for outro card da mesma coluna.
      const overColumn = parseColumnDroppableId(over.id, stageKeys);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistMove, stagesKey]);

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

  const totalLeads = stageKeys.reduce((sum, key) => sum + (data[key]?.total ?? 0), 0);
  const bulkCount = bulkSelectedIds.size;
  const activeLead = activeId !== null ? findLeadById(data, stageKeys, activeId) : null;
  const activeStage = activeId !== null ? findStageOfLead(data, stageKeys, activeId) : null;

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
        <div className="flex items-center gap-2">
          {bulkCount > 0 && (
            <>
              <span className="flex items-center gap-1 rounded-lg bg-cyan-100 px-2 py-1.5 text-[11px] font-bold text-cyan-800">
                <CheckSquare className="h-3.5 w-3.5" /> {bulkCount} selecionado{bulkCount > 1 ? "s" : ""}
              </span>
              <select
                value={bulkStage}
                onChange={(event) => setBulkStage(event.target.value)}
                disabled={bulkSaving}
                className="rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-[11px] text-neutral-700"
                aria-label="Mover selecionados de categoria"
              >
                <option value="">Mover de categoria…</option>
                {stages.map((stage) => <option key={stage.key} value={stage.key}>{stage.label}</option>)}
              </select>
              <button type="button" disabled={!bulkStage || bulkSaving} onClick={() => void applyBulkChange("stage")} className="rounded-lg bg-cyan-600 px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40">
                Mover
              </button>
              {isSupervisor && sellers.length > 0 && (
                <>
                  <select
                    value={bulkSellerId}
                    onChange={(event) => setBulkSellerId(event.target.value)}
                    disabled={bulkSaving}
                    className="rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-[11px] text-neutral-700"
                    aria-label="Repassar selecionados para vendedor"
                  >
                    <option value="">Repassar para vendedor…</option>
                    {sellers.map((seller) => <option key={seller.chatwootUserId} value={seller.chatwootUserId}>{seller.name}</option>)}
                  </select>
                  <button type="button" disabled={!bulkSellerId || bulkSaving} onClick={() => void applyBulkChange("seller")} className="flex items-center gap-1 rounded-lg bg-violet-600 px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40">
                    <Users className="h-3 w-3" /> Repassar
                  </button>
                </>
              )}
              <button type="button" disabled={bulkSaving} onClick={() => setBulkSelectedIds(new Set())} className="text-[11px] font-medium text-neutral-500 hover:text-neutral-800">Limpar</button>
            </>
          )}
          <button
            type="button"
            onClick={fetchData}
            className="flex items-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-[11px] font-medium text-neutral-500 hover:bg-neutral-50"
          >
            <RefreshCw className="h-3 w-3" />
            Atualizar
          </button>
        </div>
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
          {stages.map((stage) => {
            const stageData = data[stage.key];
            if (!stageData) return null;
            return (
              <KanbanColumn
                key={stage.key}
                stage={stage}
                leads={stageData.leads}
                total={stageData.total}
                selectedId={selectedId}
                onSelectLead={onSelectLead}
                onStageChange={handleStageChange}
                onAttemptsChange={handleAttemptsChange}
                stages={stages}
                onRequestClose={allowCloseLead ? setClosingLead : undefined}
                bulkSelectedIds={bulkSelectedIds}
                onToggleBulkSelection={toggleBulkSelection}
                onSellerChange={isSupervisor ? handleSellerChange : undefined}
                sellers={isSupervisor ? sellers : undefined}
              />
            );
          })}
        </div>
        <DragOverlay>
          {activeLead && activeStage ? (
            <KanbanCardOverlay lead={activeLead} currentStage={activeStage} stages={stages} />
          ) : null}
        </DragOverlay>
      </DndContext>

      {closingLead && (
        <CloseLeadModal
          lead={{ id: closingLead.id, nome: closingLead.nome }}
          onClosed={(leadId) => {
            // Lead fechado sai do board na hora.
            setClosingLead(null);
            setData((current) => {
              if (!current) return current;
              const stage = findStageOfLead(current, stageKeys, leadId);
              if (!stage) return current;
              return {
                ...current,
                [stage]: {
                  leads: current[stage].leads.filter((l) => l.id !== leadId),
                  total: Math.max(0, current[stage].total - 1),
                },
              };
            });
            onLeadMoved?.();
          }}
          onCancel={() => setClosingLead(null)}
        />
      )}
    </div>
  );
}
