"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, RefreshCw, UserPlus, X } from "lucide-react";
import { TagBadge } from "@/components/TagBadge";
import { ExportMenu } from "@/components/ExportMenu";
import type { CommercialStage, InscricaoItem, InscricaoStatus, OrderDirection, OrderableField } from "@/types/inscricao";
import type {
  ChatwootChannelOption,
  ChatwootLeadSnapshot,
  ChatwootMessageSnapshot,
  ChatwootSnapshotMap,
} from "@/types/chatwoot";
import type { TrainingOption } from "@/types/training";
import type { CommercialWorkspace } from "@/types/commercial";
import { tagFromDashboardDisplay } from "@/lib/participantTags";
import { formatTrainingDateLabel } from "@/lib/trainings";
import { buildChatwootOpenChatUrl, humanizeName } from "@/lib/utils";
import { FormHistoryView } from "@/components/FormHistoryView";
import { EditLeadPanel } from "@/components/EditLeadPanel";
import { MergeLeadsModal } from "@/components/MergeLeadsModal";
import { CrmKanbanView } from "@/components/CrmKanbanView";

/* ───────── Types ───────── */

interface RecruiterOption {
  code: string;
  name: string;
}

interface Filters {
  q: string;
  nome: string;
  telefone: string;
  cidade: string;
  profissao: string;
  indicacao: string;
  /** Comma-separated training IDs for multi-select */
  treinamentos?: string;
  /** Quick filter: all trainings of this kind */
  kind?: string;
  presenca?: "aprovada" | "reprovada" | "validada" | "nao-validada";
  tag?: "recrutador" | "whatsapp" | "com-indicador" | "com-dinamica";
  status?: string;
  campaignSource: string;
  campaignName: string;
  commercialStage?: CommercialStage;
  assignedSellerEmail: string;
  unassignedOnly?: boolean;
  stars?: string;
  produto?: "vozup" | "instituto";
}

interface LeadsClientProps {
  inscricoes: InscricaoItem[];
  chatwootByInscricaoId: ChatwootSnapshotMap;
  chatwootChannels: ChatwootChannelOption[];
  commercial: CommercialWorkspace;
  total: number;
  page: number;
  pageSize: number;
  orderBy: OrderableField;
  orderDirection: OrderDirection;
  trainingOptions: TrainingOption[];
  recruiterOptions: RecruiterOption[];
  filters: Filters;
}

/* ───────── Sort options ───────── */

const SORT_OPTIONS: {
  field: OrderableField;
  dir: OrderDirection;
  icon: string;
  label: string;
  shortLabel: string;
  description?: string;
}[] = [
  { field: "criado_em", dir: "desc", icon: "🗓️", label: "Mais recente", shortLabel: "Mais recente", description: "Data de entrada, do mais novo ao mais antigo" },
  { field: "criado_em", dir: "asc",  icon: "🗓️", label: "Mais antigo",  shortLabel: "Mais antigo",  description: "Data de entrada, do mais antigo ao mais novo" },
  { field: "nome",      dir: "asc",  icon: "🔤", label: "Nome A → Z",   shortLabel: "Nome A→Z",     description: "Ordem alfabética crescente" },
  { field: "nome",      dir: "desc", icon: "🔤", label: "Nome Z → A",   shortLabel: "Nome Z→A",     description: "Ordem alfabética decrescente" },
  { field: "status_at", dir: "desc", icon: "🔄", label: "Última interação", shortLabel: "Interação", description: "Leads com atividade mais recente primeiro" },
  { field: "stars",     dir: "desc", icon: "⭐", label: "Temperatura ↓", shortLabel: "Temperatura ↓", description: "Mais quentes primeiro" },
  { field: "stars",     dir: "asc",  icon: "⭐", label: "Temperatura ↑", shortLabel: "Temperatura ↑", description: "Mais frios primeiro" },
  { field: "commercial_stage", dir: "asc",  icon: "📋", label: "Etapa comercial", shortLabel: "Etapa", description: "Agrupa por etapa do funil" },
  { field: "treinamento", dir: "asc", icon: "🎓", label: "Treinamento",  shortLabel: "Treinamento", description: "Agrupa por evento / treinamento" },
  { field: "cidade",    dir: "asc",  icon: "📍", label: "Cidade A → Z", shortLabel: "Cidade",       description: "Ordem alfabética por cidade" },
];

/* ───────── Pipeline stages ───────── */

const PIPELINE: { key: string; label: string; color: string; bg: string; icon: string }[] = [
  { key: "aguardando", label: "Novo", color: "text-slate-700", bg: "bg-slate-100", icon: "📥" },
  { key: "aprovado", label: "Qualificado", color: "text-emerald-700", bg: "bg-emerald-100", icon: "✅" },
  { key: "rejeitado", label: "Descartado", color: "text-rose-700", bg: "bg-rose-100", icon: "🚫" },
];

const COMMERCIAL_STAGE_STYLE: Record<CommercialStage, { label: string; className: string }> = {
  novo: { label: "Novo", className: "bg-slate-100 text-slate-700" },
  primeiro_contato: { label: "Primeiro contato", className: "bg-cyan-50 text-cyan-700" },
  em_atendimento: { label: "Em atendimento", className: "bg-blue-50 text-blue-700" },
  agendado: { label: "Agendado", className: "bg-violet-50 text-violet-700" },
  fechamento: { label: "Fechamento", className: "bg-amber-50 text-amber-700" },
  ganho: { label: "Ganho", className: "bg-emerald-50 text-emerald-700" },
  perdido: { label: "Perdido", className: "bg-rose-50 text-rose-700" },
  no_show: { label: "No-show", className: "bg-orange-50 text-orange-700" },
};

function pipelineFor(status?: InscricaoStatus) {
  return PIPELINE.find((p) => p.key === status) ?? PIPELINE[0];
}

/* ───────── Timeline helpers ───────── */

interface TimelineEvent {
  id: string;
  type: "note" | "status" | "whatsapp" | "chatwoot" | "system";
  content: string;
  date: string;
  icon: string;
  color: string;
  readStatus?: "sent" | "delivered" | "read" | "failed";
  isOutgoing?: boolean;
}

function buildTimeline(inscricao: InscricaoItem, chatwoot?: ChatwootLeadSnapshot | null): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const message of chatwoot?.recentMessages ?? []) {
    events.push({
      id: `chatwoot-${message.id}`,
      type: "chatwoot",
      content: message.content,
      date: message.createdAt,
      icon: message.direction === "incoming" ? "↙" : message.direction === "outgoing" ? "↗" : "•",
      color:
        message.direction === "incoming"
          ? "border-emerald-300 bg-emerald-50"
          : "border-sky-300 bg-sky-50",
      readStatus: message.readStatus,
      isOutgoing: message.direction === "outgoing",
    });
  }

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

function fmtChatwootStatus(value: ChatwootLeadSnapshot["conversationStatus"]): string {
  switch (value) {
    case "open":
      return "Aberta";
    case "pending":
      return "Pendente";
    case "resolved":
      return "Resolvida";
    case "snoozed":
      return "Pausada";
    default:
      return "Sem conversa";
  }
}

function fmtMessageDirection(value: ChatwootMessageSnapshot["direction"]): string {
  switch (value) {
    case "incoming":
      return "Lead";
    case "outgoing":
      return "Equipe";
    case "activity":
      return "Sistema";
    default:
      return "Outro";
  }
}

function cleanPhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

function fmtEvolutionStatus(channel?: ChatwootChannelOption | null): string {
  if (!channel || channel.evolutionStatus === "unknown") return "";
  if (channel.evolutionStatus === "open") return "online";
  if (channel.evolutionStatus === "connecting") return "conectando";
  return "offline";
}

const CHATWOOT_INBOX_STORAGE_KEY = "dashboard.chatwootInboxId";

/* ───────── Component ───────── */

export default function CrmClient({
  inscricoes,
  chatwootByInscricaoId,
  chatwootChannels,
  commercial,
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
  const [searchText, setSearchText] = useState(filters.q || filters.nome);
  const [syncingChatwoot, setSyncingChatwoot] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [chatwootSnapshots, setChatwootSnapshots] = useState(chatwootByInscricaoId);
  const [loadingChatwootSnapshots, setLoadingChatwootSnapshots] = useState(false);
  const [chatwootInboxId, setChatwootInboxId] = useState<string>("");
  const [loadingDetailId, setLoadingDetailId] = useState<number | null>(null);
  const [commercialSaving, setCommercialSaving] = useState(false);
  const [commercialMessage, setCommercialMessage] = useState<string | null>(null);
  const [activePopover, setActivePopover] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<"info" | "formularios">("info");
  const [editMode, setEditMode] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [deletingLead, setDeletingLead] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [view, setView] = useState<"list" | "kanban">(() =>
    searchParams.get("view") === "kanban" ? "kanban" : "list"
  );
  const filterBarRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setRecords(inscricoes); }, [inscricoes]);
  useEffect(() => { setSearchText(filters.q || filters.nome); }, [filters.q, filters.nome]);
  useEffect(() => { setDetailTab("info"); setEditMode(false); setShowMergeModal(false); setDeleteConfirmId(null); }, [selectedId]);
  useEffect(() => {
    if (!activePopover) return;
    function onMouseDown(e: MouseEvent) {
      if (filterBarRef.current && !filterBarRef.current.contains(e.target as Node)) {
        setActivePopover(null);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [activePopover]);
  useEffect(() => { setChatwootSnapshots(chatwootByInscricaoId); }, [chatwootByInscricaoId]);
  useEffect(() => {
    const storedInboxId = window.localStorage.getItem(CHATWOOT_INBOX_STORAGE_KEY) ?? "";
    if (storedInboxId) {
      setChatwootInboxId(storedInboxId);
    }
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const selected = useMemo(() => records.find((r) => r.id === selectedId) ?? null, [records, selectedId]);
  const recordIdsKey = useMemo(() => records.map((record) => record.id).join(","), [records]);
  const syncRecord = useCallback((updated: InscricaoItem) => {
    setRecords((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
  }, []);

  useEffect(() => {
    if (!selected || selected.payload !== undefined) {
      return;
    }

    let cancelled = false;
    setLoadingDetailId(selected.id);

    fetch(`/api/inscricoes/${selected.id}`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Falha ao carregar detalhes");
        }
        return response.json() as Promise<{ inscricao?: InscricaoItem }>;
      })
      .then((data) => {
        if (!cancelled && data.inscricao) {
          syncRecord(data.inscricao);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.error(error);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingDetailId(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selected, syncRecord]);

  useEffect(() => {
    const ids = recordIdsKey
      .split(",")
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0);

    if (ids.length === 0) {
      setChatwootSnapshots({});
      return;
    }

    let cancelled = false;
    setLoadingChatwootSnapshots(true);

    fetch("/api/chatwoot/lead-snapshots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Falha ao carregar Chatwoot");
        }
        return response.json() as Promise<{ snapshots?: ChatwootSnapshotMap }>;
      })
      .then((data) => {
        if (!cancelled) {
          setChatwootSnapshots(data.snapshots ?? {});
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.error(error);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingChatwootSnapshots(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [recordIdsKey]);

  const selectedChatwoot = selected ? chatwootSnapshots[selected.id] ?? null : null;
  const sharedFirstContactInboxId = commercial.sharedInboxId ? String(commercial.sharedInboxId) : "";
  useEffect(() => {
    if (sharedFirstContactInboxId) {
      setChatwootInboxId(sharedFirstContactInboxId);
      return;
    }

    const storedInboxId = window.localStorage.getItem(CHATWOOT_INBOX_STORAGE_KEY) ?? "";
    if (storedInboxId) {
      setChatwootInboxId(storedInboxId);
      return;
    }

    setChatwootInboxId(selectedChatwoot?.inboxId ? String(selectedChatwoot.inboxId) : "");
  }, [selected?.id, selectedChatwoot?.inboxId, sharedFirstContactInboxId]);
  const activeChatwootInboxId = useMemo(() => {
    if (sharedFirstContactInboxId) return sharedFirstContactInboxId;
    if (chatwootInboxId) return chatwootInboxId;
    if (selectedChatwoot?.inboxId) return String(selectedChatwoot.inboxId);
    return chatwootChannels[0]?.id ? String(chatwootChannels[0].id) : "";
  }, [chatwootChannels, chatwootInboxId, selectedChatwoot?.inboxId, sharedFirstContactInboxId]);
  const selectedChatwootOpenUrl = selected
    ? buildChatwootOpenChatUrl(selected.id, activeChatwootInboxId)
    : "#";
  const timeline = useMemo(
    () => selected ? buildTimeline(selected, selectedChatwoot) : [],
    [selected, selectedChatwoot]
  );

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

  function handleChatwootInboxChange(value: string) {
    setChatwootInboxId(value);
    if (value) {
      window.localStorage.setItem(CHATWOOT_INBOX_STORAGE_KEY, value);
    } else {
      window.localStorage.removeItem(CHATWOOT_INBOX_STORAGE_KEY);
    }
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

  async function handleChatwootSync() {
    if (syncingChatwoot) return;
    setSyncingChatwoot(true);
    setSyncMessage(null);
    try {
      const res = await fetch("/api/chatwoot/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 1000, createMissing: true }),
      });
      const data = await res.json().catch(() => null) as {
        ok?: boolean;
        sync?: {
          configured: boolean;
          processed: number;
          matched: number;
          created: number;
          updated: number;
          duplicateDashboardGroups: number;
          duplicateChatwootContacts: number;
          errors?: Array<{ id: number; message: string }>;
        };
        error?: string;
      } | null;

      if (!res.ok || !data?.sync?.configured) {
        throw new Error(data?.error ?? "Configure CHATWOOT_DATABASE_URL para habilitar a sincronização.");
      }

      const sync = data.sync;
      setSyncMessage(
        `${sync.processed} analisados • ${sync.matched} vinculados • ${sync.created} criados • ${sync.updated} atualizados`
      );
      router.refresh();
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : "Falha ao sincronizar Chatwoot.");
    } finally {
      setSyncingChatwoot(false);
    }
  }

  async function refreshSelectedLead(id: number) {
    const res = await fetch(`/api/inscricoes/${id}`);
    if (res.ok) {
      const data = await res.json() as { inscricao?: InscricaoItem };
      if (data.inscricao) syncRecord(data.inscricao);
    }
  }

  async function handleCommercialStageChange(stage: CommercialStage) {
    if (!selected || commercialSaving) return;
    setCommercialSaving(true);
    setCommercialMessage(null);
    try {
      const res = await fetch(`/api/commercial/leads/${selected.id}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage }),
      });
      const data = await res.json().catch(() => null) as { error?: string } | null;
      if (!res.ok) throw new Error(data?.error ?? "Falha ao atualizar etapa.");
      await refreshSelectedLead(selected.id);
      setCommercialMessage("Etapa comercial atualizada.");
    } catch (error) {
      setCommercialMessage(error instanceof Error ? error.message : "Falha ao atualizar etapa.");
    } finally {
      setCommercialSaving(false);
    }
  }

  async function handleCommercialAssign(sellerId: string) {
    if (!selected || !sellerId || commercialSaving) return;
    setCommercialSaving(true);
    setCommercialMessage(null);
    try {
      const res = await fetch(`/api/commercial/leads/${selected.id}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sellerId: Number(sellerId) }),
      });
      const data = await res.json().catch(() => null) as { error?: string } | null;
      if (!res.ok) throw new Error(data?.error ?? "Falha ao repassar lead.");
      await refreshSelectedLead(selected.id);
      setCommercialMessage("Lead repassado.");
    } catch (error) {
      setCommercialMessage(error instanceof Error ? error.message : "Falha ao repassar lead.");
    } finally {
      setCommercialSaving(false);
    }
  }

  async function handleOpenClosing(inboxId: string) {
    if (!selected || !inboxId || commercialSaving) return;
    setCommercialSaving(true);
    setCommercialMessage(null);
    try {
      const res = await fetch(`/api/commercial/leads/${selected.id}/closing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inboxId: Number(inboxId) }),
      });
      const data = await res.json().catch(() => null) as { conversationUrl?: string; error?: string } | null;
      if (!res.ok) throw new Error(data?.error ?? "Falha ao abrir fechamento.");
      await refreshSelectedLead(selected.id);
      setCommercialMessage("Conversa de fechamento pronta.");
      if (data?.conversationUrl) window.open(data.conversationUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      setCommercialMessage(error instanceof Error ? error.message : "Falha ao abrir fechamento.");
    } finally {
      setCommercialSaving(false);
    }
  }

  async function handleDeleteLead(id: number) {
    if (deleteConfirmId !== id) {
      setDeleteConfirmId(id);
      return;
    }
    setDeleteConfirmId(null);
    setDeletingLead(true);
    try {
      const res = await fetch(`/api/inscricoes/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Falha ao excluir");
      setRecords((prev) => prev.filter((r) => r.id !== id));
      setSelectedId(null);
    } catch (err) {
      console.error(err);
    } finally {
      setDeletingLead(false);
    }
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

  // Parse selected training IDs from comma-separated string
  const selectedTrainingIds = useMemo(
    () => new Set(filters.treinamentos ? filters.treinamentos.split(",").filter(Boolean) : []),
    [filters.treinamentos],
  );

  // Training options split by kind
  const onlineTrainings = useMemo(() => trainingOptions.filter((t) => t.kind === "online"), [trainingOptions]);
  const upDayTrainings = useMemo(() => trainingOptions.filter((t) => t.kind === "up-day-plus"), [trainingOptions]);

  // Export / print / distribuir URLs — reflect active filters
  const exportUrl = useMemo(() => {
    const p = new URLSearchParams();
    p.set("source", "crm");
    if (filters.q) p.set("q", filters.q);
    if (filters.status) p.set("status", filters.status);
    if (filters.treinamentos) p.set("treinamentos", filters.treinamentos);
    if (filters.kind && !filters.treinamentos) p.set("kind", filters.kind);
    if (filters.presenca) p.set("presenca", filters.presenca);
    if (filters.indicacao) p.set("indicacao", filters.indicacao);
    if (filters.stars) p.set("stars", filters.stars);
    if (filters.campaignSource) p.set("campaignSource", filters.campaignSource);
    if (filters.commercialStage) p.set("commercialStage", filters.commercialStage);
    return `/api/export?${p.toString()}`;
  }, [filters]);

  const printUrl = useMemo(() => {
    const p = new URLSearchParams();
    if (filters.q) p.set("q", filters.q);
    if (filters.status) p.set("status", filters.status);
    if (filters.treinamentos) p.set("treinamentos", filters.treinamentos);
    if (filters.presenca) p.set("presenca", filters.presenca);
    if (filters.indicacao) p.set("indicacao", filters.indicacao);
    return `/api/print?${p.toString()}`;
  }, [filters]);

  const distribuirUrl = useMemo(() => {
    const p = new URLSearchParams();
    // distribuicao page uses its own filter UI with these params
    if (filters.treinamentos) {
      const ids = filters.treinamentos.split(",").filter(Boolean);
      if (ids.length === 1) p.set("treinamento", ids[0]);
    } else if (filters.kind) {
      p.set("kind", filters.kind);
    }
    if (filters.status) p.set("status", filters.status);
    if (filters.presenca) p.set("presenca", filters.presenca);
    if (filters.q) p.set("q", filters.q);
    return `/distribuicao?${p.toString()}`;
  }, [filters]);

  // Presença filter is only relevant in online context
  const hasOnlineContext = useMemo(() => {
    if (filters.kind === "online") return true;
    if (selectedTrainingIds.size === 0) return false;
    return [...selectedTrainingIds].some((id) => trainingById[id]?.kind === "online");
  }, [filters.kind, selectedTrainingIds, trainingById]);

  function toggleTraining(id: string) {
    const next = new Set(selectedTrainingIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    const joined = [...next].join(",");
    updateQuery({ treinamentos: joined || null, kind: null, page: "1" });
  }

  const activeFiltersCount = [
    filters.treinamentos,
    filters.kind,
    filters.presenca,
    filters.tag,
    filters.indicacao,
    filters.campaignSource,
    filters.campaignName,
    filters.commercialStage,
    filters.assignedSellerEmail,
    filters.unassignedOnly,
    filters.stars,
    filters.produto,
  ].filter(Boolean).length;

  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] flex-col lg:h-[calc(100vh-4rem)] lg:min-h-0">

      {/* ── HEADER ─────────────────────────────────────────── */}
      <header className="flex-shrink-0 border-b border-neutral-200 bg-white">

        {/* Row 1: Title + sync */}
        <div className="flex items-center justify-between gap-4 px-5 py-3">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-semibold text-neutral-900">CRM</h1>
            <span className="text-xs text-neutral-400">
              {view === "list" ? `${total.toLocaleString()} registros · p. ${page}/${totalPages}` : "Kanban"}
            </span>
            {syncMessage && <span className="text-xs text-cyan-600">{syncMessage}</span>}
            {/* View toggle */}
            <div className="flex overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50">
              <button
                type="button"
                onClick={() => { setView("list"); updateQuery({ view: null }); }}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium transition ${view === "list" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700"}`}
                title="Vista em lista"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
                Lista
              </button>
              <button
                type="button"
                onClick={() => { setView("kanban"); updateQuery({ view: "kanban" }); }}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium transition ${view === "kanban" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700"}`}
                title="Vista em kanban"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
                </svg>
                Kanban
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ExportMenu
              exportUrl={exportUrl}
              printUrl={printUrl}
              distribuirUrl={distribuirUrl}
              total={total}
            />
            <button
              type="button"
              onClick={handleChatwootSync}
              disabled={syncingChatwoot}
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-500 transition hover:border-neutral-300 hover:text-neutral-700 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncingChatwoot ? "animate-spin" : ""}`} />
              Sincronizar
            </button>
          </div>
        </div>

        {/* Row 2: Search + status + filter chips — all inline */}
        <div ref={filterBarRef} className="relative flex flex-wrap items-center gap-1.5 border-t border-neutral-100 px-4 py-2">

          {/* Search */}
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => { e.preventDefault(); updateQuery({ q: searchText, nome: null, page: "1" }); setActivePopover(null); }}
          >
            <div className="relative">
              <svg className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Buscar nome, cidade..."
                className="h-8 w-52 rounded-lg border border-neutral-200 bg-neutral-50 pl-8 pr-3 text-xs focus:border-neutral-400 focus:bg-white focus:outline-none"
              />
            </div>
            <button type="submit" className="h-8 rounded-lg bg-neutral-900 px-3 text-xs font-medium text-white hover:bg-neutral-700">
              Buscar
            </button>
          </form>

          <div className="mx-1 h-5 w-px bg-neutral-200" />

          {/* Status chips */}
          {PIPELINE.map((p) => {
            const active = filters.status === p.key;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => updateQuery({ status: active ? null : p.key, page: "1" })}
                className={`h-8 rounded-lg px-3 text-xs font-medium transition ${
                  active ? `${p.bg} ${p.color} font-semibold` : "text-neutral-500 hover:bg-neutral-100"
                }`}
              >
                {p.label}
              </button>
            );
          })}

          <div className="mx-1 h-5 w-px bg-neutral-200" />

          {/* ── FILTER CHIPS ── */}

          {/* Produto */}
          <div className="flex rounded-lg border border-neutral-200 bg-white overflow-hidden">
            {[
              { value: "", label: "Todos" },
              { value: "instituto", label: "Instituto UP" },
              { value: "vozup", label: "Voz UP" },
            ].map((opt) => {
              const active = (filters.produto ?? "") === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => updateQuery({ produto: opt.value || null, page: "1" })}
                  className={`h-8 px-3 text-xs font-semibold transition border-r border-neutral-200 last:border-r-0 ${
                    active
                      ? opt.value === "vozup"
                        ? "bg-violet-600 text-white"
                        : opt.value === "instituto"
                          ? "bg-cyan-600 text-white"
                          : "bg-neutral-900 text-white"
                      : "text-neutral-500 hover:bg-neutral-50"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {/* Treinamento */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setActivePopover(activePopover === "treinamento" ? null : "treinamento")}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition ${
                filters.treinamentos || filters.kind
                  ? "border-neutral-800 bg-neutral-900 text-white"
                  : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50"
              }`}
            >
              <span>
                {filters.kind === "online" && !filters.treinamentos
                  ? "Todos Encontros Online"
                  : filters.kind === "up-day-plus" && !filters.treinamentos
                    ? "Todos UP Day Plus"
                    : selectedTrainingIds.size === 1
                      ? (trainingById[[...selectedTrainingIds][0]]?.label ?? "Treinamento")
                      : selectedTrainingIds.size > 1
                        ? `Treinamento · ${selectedTrainingIds.size}`
                        : "Treinamento"}
              </span>
              <ChevronDown className="h-3 w-3 opacity-60" />
            </button>

            {activePopover === "treinamento" && (
              <div className="absolute left-0 top-full z-50 mt-1.5 w-[480px] overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl">
                <div className="flex divide-x divide-neutral-100">

                  {/* Online column */}
                  <div className="flex-1 p-3">
                    <div className="mb-2.5 flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">Encontro Online</span>
                      <button
                        type="button"
                        onClick={() => { updateQuery({ kind: filters.kind === "online" && !filters.treinamentos ? null : "online", treinamentos: null, page: "1" }); setActivePopover(null); }}
                        className={`h-5 rounded-full px-2.5 text-[10px] font-semibold transition ${
                          filters.kind === "online" && !filters.treinamentos
                            ? "bg-cyan-600 text-white"
                            : "bg-neutral-100 text-neutral-500 hover:bg-cyan-100 hover:text-cyan-700"
                        }`}
                      >
                        Todos
                      </button>
                    </div>
                    <div className="flex flex-col gap-1">
                      {onlineTrainings.length === 0
                        ? <span className="text-xs text-neutral-400">Nenhum encontro</span>
                        : onlineTrainings.map((t) => {
                          const active = selectedTrainingIds.has(t.id);
                          return (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => toggleTraining(t.id)}
                              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
                                active
                                  ? "bg-cyan-50 font-semibold text-cyan-800"
                                  : "text-neutral-700 hover:bg-neutral-50"
                              }`}
                            >
                              <span className={`h-4 w-4 flex-shrink-0 rounded border text-center text-[10px] leading-4 ${active ? "border-cyan-500 bg-cyan-500 text-white" : "border-neutral-300"}`}>
                                {active ? "✓" : ""}
                              </span>
                              {t.label || formatTrainingDateLabel(t.id) || t.id}
                            </button>
                          );
                        })}
                    </div>
                  </div>

                  {/* UP Day column */}
                  <div className="flex-1 p-3">
                    <div className="mb-2.5 flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">UP Day Plus</span>
                      <button
                        type="button"
                        onClick={() => { updateQuery({ kind: filters.kind === "up-day-plus" && !filters.treinamentos ? null : "up-day-plus", treinamentos: null, page: "1" }); setActivePopover(null); }}
                        className={`h-5 rounded-full px-2.5 text-[10px] font-semibold transition ${
                          filters.kind === "up-day-plus" && !filters.treinamentos
                            ? "bg-violet-600 text-white"
                            : "bg-neutral-100 text-neutral-500 hover:bg-violet-100 hover:text-violet-700"
                        }`}
                      >
                        Todos
                      </button>
                    </div>
                    <div className="flex flex-col gap-1">
                      {upDayTrainings.length === 0
                        ? <span className="text-xs text-neutral-400">Nenhum UP Day</span>
                        : upDayTrainings.map((t) => {
                          const active = selectedTrainingIds.has(t.id);
                          return (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => toggleTraining(t.id)}
                              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
                                active
                                  ? "bg-violet-50 font-semibold text-violet-800"
                                  : "text-neutral-700 hover:bg-neutral-50"
                              }`}
                            >
                              <span className={`h-4 w-4 flex-shrink-0 rounded border text-center text-[10px] leading-4 ${active ? "border-violet-500 bg-violet-500 text-white" : "border-neutral-300"}`}>
                                {active ? "✓" : ""}
                              </span>
                              {t.label || formatTrainingDateLabel(t.id) || t.id}
                            </button>
                          );
                        })}
                    </div>
                  </div>
                </div>

                {(filters.treinamentos || filters.kind) && (
                  <div className="border-t border-neutral-100 px-3 py-2">
                    <button
                      type="button"
                      onClick={() => { updateQuery({ kind: null, treinamentos: null, page: "1" }); setActivePopover(null); }}
                      className="text-xs text-neutral-400 hover:text-rose-500"
                    >
                      Limpar seleção
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Etiqueta */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setActivePopover(activePopover === "etiqueta" ? null : "etiqueta")}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition ${
                filters.tag
                  ? "border-violet-400 bg-violet-50 font-semibold text-violet-800"
                  : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50"
              }`}
            >
              {filters.tag === "recrutador" ? "🧑‍💼 Recrutador"
                : filters.tag === "whatsapp" ? "💬 WhatsApp enviado"
                  : filters.tag === "com-indicador" ? "🔗 Com indicador"
                    : filters.tag === "com-dinamica" ? "🎯 Com dinâmica"
                      : "Etiqueta"}
              <ChevronDown className="h-3 w-3 opacity-60" />
            </button>

            {activePopover === "etiqueta" && (
              <div className="absolute left-0 top-full z-50 mt-1.5 w-52 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl">
                {[
                  { value: "", label: "Qualquer" },
                  { value: "recrutador", label: "🧑‍💼 Recrutador" },
                  { value: "whatsapp", label: "💬 WhatsApp enviado" },
                  { value: "com-indicador", label: "🔗 Com indicador" },
                  { value: "com-dinamica", label: "🎯 Com dinâmica" },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => { updateQuery({ tag: opt.value || null, page: "1" }); setActivePopover(null); }}
                    className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition hover:bg-neutral-50 ${
                      (filters.tag ?? "") === opt.value ? "bg-violet-50 font-semibold text-violet-800" : "text-neutral-700"
                    }`}
                  >
                    <span className={`h-4 w-4 flex-shrink-0 rounded-full border ${(filters.tag ?? "") === opt.value ? "border-violet-500 bg-violet-500" : "border-neutral-300"}`} />
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Presença */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setActivePopover(activePopover === "presenca" ? null : "presenca")}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition ${
                filters.presenca
                  ? "border-emerald-400 bg-emerald-50 font-semibold text-emerald-800"
                  : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50"
              }`}
            >
              {filters.presenca === "aprovada" ? "✓ Presentes"
                : filters.presenca === "reprovada" ? "~ Parcial"
                  : filters.presenca === "validada" ? "Com validação"
                    : filters.presenca === "nao-validada" ? "Sem validação"
                      : "Presença"}
              <ChevronDown className="h-3 w-3 opacity-60" />
            </button>

            {activePopover === "presenca" && (
              <div className="absolute left-0 top-full z-50 mt-1.5 w-52 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl">
                {[
                  { value: "", label: "Todas" },
                  { value: "aprovada", label: "✓ Presente" },
                  { value: "reprovada", label: "~ Parcial / reprovada" },
                  { value: "validada", label: "Com validação" },
                  { value: "nao-validada", label: "Sem validação" },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => { updateQuery({ presenca: opt.value || null, page: "1" }); setActivePopover(null); }}
                    className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition hover:bg-neutral-50 ${
                      (filters.presenca ?? "") === opt.value ? "bg-emerald-50 font-semibold text-emerald-800" : "text-neutral-700"
                    }`}
                  >
                    <span className={`h-4 w-4 flex-shrink-0 rounded-full border ${(filters.presenca ?? "") === opt.value ? "border-emerald-500 bg-emerald-500" : "border-neutral-300"}`} />
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Temperatura */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setActivePopover(activePopover === "stars" ? null : "stars")}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition ${
                filters.stars
                  ? "border-amber-400 bg-amber-50 font-semibold text-amber-800"
                  : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50"
              }`}
            >
              {filters.stars ? `${"★".repeat(Number(filters.stars))} ${filters.stars}★` : "Temperatura"}
              <ChevronDown className="h-3 w-3 opacity-60" />
            </button>

            {activePopover === "stars" && (
              <div className="absolute left-0 top-full z-50 mt-1.5 w-44 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl">
                {[
                  { value: "", label: "Qualquer", stars: 0 },
                  { value: "1", label: "Fria", stars: 1 },
                  { value: "2", label: "Morna", stars: 2 },
                  { value: "3", label: "Quente", stars: 3 },
                  { value: "4", label: "Muito quente", stars: 4 },
                  { value: "5", label: "Hot 🔥", stars: 5 },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => { updateQuery({ stars: opt.value || null, page: "1" }); setActivePopover(null); }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition hover:bg-neutral-50 ${
                      (filters.stars ?? "") === opt.value ? "bg-amber-50 font-semibold text-amber-800" : "text-neutral-700"
                    }`}
                  >
                    <span className="w-14 text-amber-400">{"★".repeat(opt.stars)}{"☆".repeat(5 - opt.stars)}</span>
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Indicador */}
          {recruiterOptions.length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setActivePopover(activePopover === "indicador" ? null : "indicador")}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition ${
                  filters.indicacao
                    ? "border-neutral-800 bg-neutral-900 text-white"
                    : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50"
                }`}
              >
                {filters.indicacao
                  ? (recruiterOptions.find((r) => r.code === filters.indicacao)?.name ?? "Indicador")
                  : "Indicador"}
                <ChevronDown className="h-3 w-3 opacity-60" />
              </button>

              {activePopover === "indicador" && (
                <div className="absolute left-0 top-full z-50 mt-1.5 max-h-64 w-56 overflow-y-auto rounded-xl border border-neutral-200 bg-white shadow-xl">
                  {[{ code: "", name: "Qualquer" }, ...recruiterOptions].map((r) => (
                    <button
                      key={r.code}
                      type="button"
                      onClick={() => { updateQuery({ indicacao: r.code || null, page: "1" }); setActivePopover(null); }}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition hover:bg-neutral-50 ${
                        (filters.indicacao ?? "") === r.code ? "bg-neutral-900 font-semibold text-white" : "text-neutral-700"
                      }`}
                    >
                      {r.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Etapa comercial */}
          {commercial.stages.length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setActivePopover(activePopover === "etapa" ? null : "etapa")}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition ${
                  filters.commercialStage
                    ? "border-neutral-800 bg-neutral-900 text-white"
                    : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50"
                }`}
              >
                {filters.commercialStage
                  ? (COMMERCIAL_STAGE_STYLE[filters.commercialStage]?.label ?? "Etapa")
                  : "Etapa"}
                <ChevronDown className="h-3 w-3 opacity-60" />
              </button>

              {activePopover === "etapa" && (
                <div className="absolute left-0 top-full z-50 mt-1.5 w-48 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl">
                  {[{ key: "", label: "Qualquer" }, ...commercial.stages].map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => { updateQuery({ commercialStage: s.key || null, page: "1" }); setActivePopover(null); }}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition hover:bg-neutral-50 ${
                        (filters.commercialStage ?? "") === s.key ? "bg-neutral-900 font-semibold text-white" : "text-neutral-700"
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Vendedor — supervisor only */}
          {commercial.isSupervisor && commercial.sellers.length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setActivePopover(activePopover === "vendedor" ? null : "vendedor")}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition ${
                  filters.assignedSellerEmail || filters.unassignedOnly
                    ? "border-neutral-800 bg-neutral-900 text-white"
                    : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50"
                }`}
              >
                {filters.unassignedOnly
                  ? "Sem vendedor"
                  : filters.assignedSellerEmail
                    ? (commercial.sellers.find((s) => s.email === filters.assignedSellerEmail)?.name ?? "Vendedor")
                    : "Vendedor"}
                <ChevronDown className="h-3 w-3 opacity-60" />
              </button>

              {activePopover === "vendedor" && (
                <div className="absolute left-0 top-full z-50 mt-1.5 max-h-64 w-56 overflow-y-auto rounded-xl border border-neutral-200 bg-white shadow-xl">
                  <button
                    type="button"
                    onClick={() => { updateQuery({ assignedSellerEmail: null, unassignedOnly: null, page: "1" }); setActivePopover(null); }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition hover:bg-neutral-50 ${!filters.assignedSellerEmail && !filters.unassignedOnly ? "bg-neutral-900 font-semibold text-white" : "text-neutral-700"}`}
                  >Todos</button>
                  <button
                    type="button"
                    onClick={() => { updateQuery({ unassignedOnly: "1", assignedSellerEmail: null, page: "1" }); setActivePopover(null); }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition hover:bg-neutral-50 ${filters.unassignedOnly ? "bg-neutral-900 font-semibold text-white" : "text-neutral-700"}`}
                  >
                    <UserPlus className="h-3.5 w-3.5" /> Sem vendedor
                  </button>
                  <div className="my-1 border-t border-neutral-100" />
                  {commercial.sellers.map((s) => (
                    <button
                      key={s.chatwootUserId}
                      type="button"
                      onClick={() => { updateQuery({ assignedSellerEmail: s.email, unassignedOnly: null, page: "1" }); setActivePopover(null); }}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition hover:bg-neutral-50 ${filters.assignedSellerEmail === s.email ? "bg-neutral-900 font-semibold text-white" : "text-neutral-700"}`}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Ordenar */}
          <div className="relative ml-auto">
            <button
              type="button"
              onClick={() => setActivePopover(activePopover === "ordenar" ? null : "ordenar")}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition ${
                orderBy !== "criado_em" || orderDirection !== "desc"
                  ? "border-neutral-800 bg-neutral-900 text-white"
                  : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50"
              }`}
            >
              {SORT_OPTIONS.find((o) => o.field === orderBy && o.dir === orderDirection)?.shortLabel ?? "Ordenar"}
              <ChevronDown className="h-3 w-3 opacity-60" />
            </button>

            {activePopover === "ordenar" && (
              <div className="absolute right-0 top-full z-50 mt-1.5 w-64 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl">
                {SORT_OPTIONS.map((opt) => {
                  const active = orderBy === opt.field && orderDirection === opt.dir;
                  return (
                    <button
                      key={`${opt.field}-${opt.dir}`}
                      type="button"
                      onClick={() => { updateQuery({ orderBy: opt.field, orderDirection: opt.dir, page: "1" }); setActivePopover(null); }}
                      className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-xs transition hover:bg-neutral-50 ${
                        active ? "bg-neutral-900 font-semibold text-white" : "text-neutral-700"
                      }`}
                    >
                      <span className="text-base leading-none">{opt.icon}</span>
                      <div className="min-w-0">
                        <p className="font-semibold">{opt.label}</p>
                        {opt.description && <p className={`text-[10px] ${active ? "text-neutral-300" : "text-neutral-400"}`}>{opt.description}</p>}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Clear all filters */}
          {activeFiltersCount > 0 && (
            <button
              type="button"
              onClick={() => updateQuery({ kind: null, treinamentos: null, presenca: null, tag: null, indicacao: null, campaignSource: null, campaignName: null, commercialStage: null, assignedSellerEmail: null, unassignedOnly: null, stars: null, produto: null, page: "1" })}
              className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-neutral-400 transition hover:bg-neutral-100 hover:text-rose-500"
            >
              <X className="h-3.5 w-3.5" />
              Limpar · {activeFiltersCount}
            </button>
          )}
        </div>
      </header>

      {isPending && (
        <div className="h-0.5 flex-shrink-0 bg-cyan-400" style={{ animation: "pulse 1s infinite" }} />
      )}

      {/* ── BANNER VozUP ───────────────────────────────────── */}
      {filters.produto === "vozup" && (
        <div className="flex-shrink-0 border-b border-violet-100 bg-gradient-to-r from-violet-50 to-purple-50 px-5 py-2.5">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-100 px-2.5 py-0.5 text-[11px] font-bold text-violet-700">
              🎤 Voz UP
            </span>
            <span className="text-xs text-violet-600">
              Leads captados pelo Workshop e Landing Page da Voz UP. Novos leads da landing page devem ser distribuídos.
            </span>
            <a
              href="/distribuicao?produto=vozup&unassignedOnly=true"
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-700"
            >
              Distribuir leads Voz UP →
            </a>
          </div>
        </div>
      )}

      {/* ── MAIN SPLIT ─────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">

        {/* ── KANBAN VIEW ────────────────────────────────── */}
        {view === "kanban" && (
          <CrmKanbanView
            selectedId={selectedId}
            onSelectLead={setSelectedId}
            produto={filters.produto ?? null}
            assignedSellerEmail={filters.assignedSellerEmail || undefined}
            isSupervisor={commercial.isSupervisor}
          />
        )}

        {/* ── TABLE PANE ─────────────────────────────────── */}
        <div className={`${view === "kanban" ? "hidden" : ""} flex flex-col border-r border-neutral-200 transition-all ${selected ? "hidden lg:flex lg:w-[55%]" : "w-full"}`}>

          {/* Mobile cards */}
          <div className="flex-1 overflow-y-auto p-3 md:hidden">
            {records.length === 0 ? (
              <div className="rounded-xl border border-dashed border-neutral-200 py-16 text-center text-sm text-neutral-400">
                Nenhum lead encontrado.
              </div>
            ) : records.map((lead) => {
              const pipe = pipelineFor(lead.status);
              const chatwoot = chatwootSnapshots[lead.id] ?? null;
              const isSelected = selectedId === lead.id;
              return (
                <button
                  key={lead.id}
                  type="button"
                  onClick={() => setSelectedId(isSelected ? null : lead.id)}
                  className={`mb-2.5 w-full rounded-xl border bg-white p-3.5 text-left shadow-sm transition ${
                    isSelected ? "border-cyan-300 ring-2 ring-cyan-100" : "border-neutral-200 hover:border-neutral-300"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-neutral-200 text-sm font-bold text-neutral-600">
                      {(humanizeName(lead.nome) ?? "?")[0].toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-semibold text-neutral-900">{humanizeName(lead.nome) ?? "Sem nome"}</p>
                        <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${pipe.bg} ${pipe.color}`}>{pipe.label}</span>
                      </div>
                      {lead.telefone && <p className="text-xs text-neutral-400">{lead.telefone}</p>}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {getTrainingDisplay(lead) && (
                          <span className="rounded-md bg-neutral-900 px-2 py-0.5 text-[10px] font-semibold text-white">{getTrainingDisplay(lead)}</span>
                        )}
                        <span className="rounded-md bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-neutral-500">{fmtRelative(lead.criadoEm)}</span>
                        {chatwoot && <span className="rounded-md bg-cyan-50 px-2 py-0.5 text-[10px] font-semibold text-cyan-700">{chatwoot.messageCount} msg</span>}
                      </div>
                      {chatwoot?.lastMessagePreview && (
                        <p className="mt-1.5 line-clamp-1 text-xs text-neutral-400">{chatwoot.lastMessagePreview}</p>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Desktop table */}
          <div className="hidden flex-1 overflow-auto md:block">
            <table className="min-w-full">
              <thead className="sticky top-0 z-10 border-b border-neutral-100 bg-white">
                <tr>
                  {([
                    { key: "nome" as OrderableField, label: "Lead" },
                    { key: "criado_em" as OrderableField, label: "Data" },
                    { key: "treinamento" as OrderableField, label: "Treinamento" },
                    { key: "recrutador" as OrderableField, label: "Campanha" },
                  ] as const).map((col) => (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col.key)}
                      className="cursor-pointer px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-neutral-400 hover:text-neutral-700"
                    >
                      {col.label}
                      {orderBy === col.key && <span className="ml-1 text-cyan-500">{orderDirection === "asc" ? "↑" : "↓"}</span>}
                    </th>
                  ))}
                  <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-neutral-400">Chatwoot</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-neutral-400">Etapa</th>
                  <th className="px-4 py-2.5 text-center text-[10px] font-bold uppercase tracking-widest text-neutral-400">Temp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-50">
                {records.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-20 text-center text-sm text-neutral-400">
                      Nenhum lead encontrado.
                    </td>
                  </tr>
                ) : records.map((lead) => {
                  const isSelected = selectedId === lead.id;
                  const chatwoot = chatwootSnapshots[lead.id] ?? null;
                  const pipe = pipelineFor(lead.status);
                  const avatarBg = pipe.key === "aprovado" ? "bg-emerald-100 text-emerald-700" : pipe.key === "rejeitado" ? "bg-rose-100 text-rose-600" : "bg-neutral-100 text-neutral-600";
                  return (
                    <tr
                      key={lead.id}
                      onClick={() => setSelectedId(isSelected ? null : lead.id)}
                      className={`cursor-pointer transition-colors ${
                        isSelected ? "bg-cyan-50 ring-1 ring-inset ring-cyan-200" : "hover:bg-neutral-50/70"
                      }`}
                    >
                      {/* Lead */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${avatarBg}`}>
                            {(humanizeName(lead.nome) ?? "?")[0].toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-neutral-900 max-w-[160px]">
                              {humanizeName(lead.nome) ?? "Sem nome"}
                            </p>
                            {lead.telefone && (
                              <p className="text-[11px] text-neutral-400">{lead.telefone}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      {/* Date */}
                      <td className="px-4 py-3 text-[11px] text-neutral-400 whitespace-nowrap">
                        {fmtRelative(lead.criadoEm)}
                      </td>
                      {/* Training */}
                      <td className="px-4 py-3">
                        {getTrainingDisplay(lead) ? (
                          <span className="inline-block max-w-[140px] truncate rounded-lg bg-neutral-900 px-2.5 py-1 text-[10px] font-bold text-white">
                            {getTrainingDisplay(lead)}
                          </span>
                        ) : (
                          <span className="text-xs text-neutral-300">—</span>
                        )}
                      </td>
                      {/* Campaign */}
                      <td className="px-4 py-3 max-w-[140px]">
                        <p className="truncate text-[11px] font-semibold text-neutral-700">
                          {lead.commercial?.campaignSource || humanizeName(lead.recrutadorNome) || "—"}
                        </p>
                        {lead.commercial?.campaignName && (
                          <p className="truncate text-[10px] text-neutral-400">{lead.commercial.campaignName}</p>
                        )}
                      </td>
                      {/* Chatwoot */}
                      <td className="px-4 py-3">
                        {chatwoot ? (
                          <div>
                            <span className="inline-flex items-center gap-1 rounded-md bg-cyan-50 px-2 py-0.5 text-[10px] font-bold text-cyan-700">
                              {chatwoot.messageCount} MSG
                            </span>
                            {chatwoot.lastMessagePreview && (
                              <p className="mt-0.5 max-w-[160px] truncate text-[10px] text-neutral-400">
                                {chatwoot.lastMessagePreview}
                              </p>
                            )}
                          </div>
                        ) : loadingChatwootSnapshots ? (
                          <span className="text-[10px] text-neutral-300">—</span>
                        ) : (
                          <span className="text-[10px] text-neutral-300">Sem conversa</span>
                        )}
                      </td>
                      {/* Stage */}
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-semibold ${COMMERCIAL_STAGE_STYLE[lead.commercial?.stage ?? "novo"].className}`}>
                          {COMMERCIAL_STAGE_STYLE[lead.commercial?.stage ?? "novo"].label}
                        </span>
                      </td>
                      {/* Stars */}
                      <td className="px-4 py-3 text-center">
                        <span className={`text-sm ${lead.stars ? "text-amber-400" : "text-neutral-200"}`}>
                          {"★".repeat(lead.stars ?? 0)}{"★".repeat(5 - (lead.stars ?? 0)).replace(/★/g, "☆")}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex flex-shrink-0 items-center justify-between border-t border-neutral-100 bg-white px-5 py-2.5">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => goToPage(page - 1)}
                className="h-8 rounded-lg px-3 text-xs font-medium text-neutral-600 hover:bg-neutral-100 disabled:opacity-40"
              >← Anterior</button>
              <span className="text-xs text-neutral-400">Página {page} de {totalPages}</span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => goToPage(page + 1)}
                className="h-8 rounded-lg px-3 text-xs font-medium text-neutral-600 hover:bg-neutral-100 disabled:opacity-40"
              >Próxima →</button>
            </div>
          )}
        </div>

        {/* ── DETAIL PANE ──────────────────────────────────── */}
        {selected && (
          <div className="flex w-full flex-1 flex-col overflow-hidden bg-white lg:w-[45%]">

            {/* Detail header */}
            <div className="flex-shrink-0 border-b border-neutral-100">
              <div className="flex items-center gap-3 px-5 py-3">
                <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                  selected.status === "aprovado" ? "bg-emerald-100 text-emerald-700"
                  : selected.status === "rejeitado" ? "bg-rose-100 text-rose-600"
                  : "bg-amber-100 text-amber-700"
                }`}>
                  {(humanizeName(selected.nome) ?? "?")[0].toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-neutral-900">{humanizeName(selected.nome) ?? "Sem nome"}</p>
                  <p className="text-[10px] text-neutral-400">#{selected.id} · {fmtDate(selected.criadoEm)}</p>
                </div>
                <button
                  type="button"
                  title="Editar lead"
                  onClick={() => { setEditMode((v) => !v); setDetailTab("info"); }}
                  className={`flex h-7 w-7 items-center justify-center rounded-lg transition ${editMode ? "bg-cyan-100 text-cyan-700" : "text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"}`}
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 012.828 2.828L11.828 15.828a2 2 0 01-1.414.586H7v-3.414a2 2 0 01.586-1.414z" /></svg>
                </button>
                <button
                  type="button"
                  title="Mesclar com outro lead"
                  onClick={() => setShowMergeModal(true)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral-400 hover:bg-violet-50 hover:text-violet-600"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                </button>
                <button
                  type="button"
                  title={deleteConfirmId === selected.id ? "Clique para confirmar a exclusão" : "Excluir lead"}
                  disabled={deletingLead}
                  onClick={() => void handleDeleteLead(selected.id)}
                  className={`flex h-7 items-center justify-center gap-1 rounded-lg px-2 text-[11px] font-semibold transition disabled:opacity-40 ${
                    deleteConfirmId === selected.id
                      ? "bg-rose-600 text-white hover:bg-rose-700"
                      : "text-neutral-400 hover:bg-rose-50 hover:text-rose-600"
                  }`}
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  {deleteConfirmId === selected.id && <span>Confirmar</span>}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              {/* Abas */}
              <div className="flex border-t border-neutral-100 px-5">
                {([
                  { key: "info", label: "Informações" },
                  { key: "formularios", label: `Formulários${selected.allEnrollments && selected.allEnrollments.length > 0 ? ` (${selected.allEnrollments.length})` : ""}` },
                ] as const).map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setDetailTab(tab.key)}
                    className={`border-b-2 px-4 py-2 text-xs font-semibold transition ${
                      detailTab === tab.key
                        ? "border-cyan-500 text-cyan-700"
                        : "border-transparent text-neutral-400 hover:text-neutral-700"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Scrollable detail content */}
            <div className="flex-1 overflow-y-auto">

              {loadingDetailId === selected.id && (
                <div className="px-5 pt-3">
                  <p className="rounded-lg bg-cyan-50 px-3 py-2 text-xs font-semibold text-cyan-700">Carregando detalhes...</p>
                </div>
              )}

              {/* ─ Edit mode ─ */}
              {editMode && (
                <EditLeadPanel
                  inscricao={selected}
                  onSaved={(updated) => {
                    setRecords((prev) => prev.map((r) => r.id === updated.id ? { ...r, ...updated } : r));
                    setEditMode(false);
                  }}
                  onCancel={() => setEditMode(false)}
                />
              )}

              {/* ─ Aba Formulários ─ */}
              {!editMode && detailTab === "formularios" && (
                <div className="px-5 py-4">
                  <FormHistoryView inscricao={selected} />
                </div>
              )}

              {!editMode && detailTab === "info" && (
              <>

              {/* ─ WhatsApp + actions ─ */}
              <div className="border-b border-neutral-100 px-5 py-4">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-neutral-400">Contato</p>
                {selected.telefone ? (
                  <div className="space-y-2">
                    {chatwootChannels.length > 0 && (
                      <select
                        value={activeChatwootInboxId}
                        onChange={(e) => handleChatwootInboxChange(e.target.value)}
                        disabled={Boolean(sharedFirstContactInboxId)}
                        className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-xs text-neutral-700 focus:border-cyan-400 focus:outline-none"
                      >
                        {chatwootChannels.map((ch) => (
                          <option key={ch.id} value={ch.id}>
                            {ch.name}{fmtEvolutionStatus(ch) ? ` · ${fmtEvolutionStatus(ch)}` : ""}
                          </option>
                        ))}
                      </select>
                    )}
                    <div className="flex gap-2">
                      <a
                        href={selectedChatwootOpenUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#25D366] py-2 text-xs font-bold text-white transition hover:bg-[#1ebe5c]"
                      >
                        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                        {selected.telefone}
                      </a>
                      <a
                        href={`tel:+55${cleanPhone(selected.telefone)}`}
                        className="flex items-center gap-1.5 rounded-lg bg-neutral-100 px-3 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-200"
                      >
                        📞 Ligar
                      </a>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-neutral-400">Sem telefone</p>
                )}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <InfoCard label="Cidade" value={selected.cidade ?? "—"} />
                  <InfoCard label="Indicador" value={humanizeName(selected.recrutadorNome) ?? "—"} sub={selected.recrutadorCodigo ?? undefined} />
                </div>
              </div>

              {/* ─ Pipeline + Stars ─ */}
              <div className="flex items-center gap-4 border-b border-neutral-100 px-5 py-3">
                <div className="flex gap-1">
                  {PIPELINE.map((p) => {
                    const active = selected.status === p.key || (!selected.status && p.key === "aguardando");
                    return (
                      <button
                        key={p.key}
                        type="button"
                        disabled={savingStatus !== null}
                        onClick={() => handleStatusChange(selected.id, p.key as InscricaoStatus)}
                        className={`h-7 rounded-lg px-2.5 text-[11px] font-semibold transition ${
                          active ? `${p.bg} ${p.color} ring-2 ring-inset ring-current/30` : "bg-neutral-100 text-neutral-400 hover:bg-neutral-200"
                        } ${savingStatus === p.key ? "animate-pulse" : ""} disabled:opacity-50`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
                <div className="ml-auto flex gap-0.5" onMouseLeave={() => setStarsHover(0)}>
                  {[1, 2, 3, 4, 5].map((star) => {
                    const filled = starsHover > 0 ? star <= starsHover : star <= (selected.stars ?? 0);
                    return (
                      <button
                        key={star}
                        type="button"
                        disabled={savingStars}
                        onMouseEnter={() => setStarsHover(star)}
                        onClick={() => handleStarClick(star)}
                        className={`text-lg leading-none transition-transform hover:scale-110 disabled:opacity-40 ${filled ? "text-amber-400" : "text-neutral-200"}`}
                      >★</button>
                    );
                  })}
                </div>
              </div>

              {/* ─ Comercial ─ */}
              <div className="border-b border-neutral-100 px-5 py-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">Comercial</p>
                  <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${COMMERCIAL_STAGE_STYLE[selected.commercial?.stage ?? "novo"].className}`}>
                    {COMMERCIAL_STAGE_STYLE[selected.commercial?.stage ?? "novo"].label}
                  </span>
                </div>
                {commercialMessage && (
                  <p className="mb-2 rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-600">{commercialMessage}</p>
                )}
                <div className="space-y-2">
                  <select
                    value={selected.commercial?.stage ?? "novo"}
                    onChange={(e) => handleCommercialStageChange(e.target.value as CommercialStage)}
                    disabled={commercialSaving}
                    className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs font-semibold text-neutral-800 focus:border-cyan-400 focus:outline-none disabled:opacity-60"
                  >
                    {commercial.stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                  {commercial.isSupervisor && (
                    <select
                      value={selected.commercial?.assignedSellerId ?? ""}
                      onChange={(e) => handleCommercialAssign(e.target.value)}
                      disabled={commercialSaving}
                      className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs font-semibold text-neutral-800 focus:border-cyan-400 focus:outline-none disabled:opacity-60"
                    >
                      <option value="">Repassar para vendedor</option>
                      {commercial.sellers.map((s) => <option key={s.chatwootUserId} value={s.chatwootUserId}>{s.name}{s.isSupervisor ? " (supervisor)" : ""}</option>)}
                    </select>
                  )}
                  <div className="flex gap-2">
                    <select
                      value={selected.commercial?.closingInboxId ?? ""}
                      onChange={(e) => { if (e.target.value) void handleOpenClosing(e.target.value); }}
                      disabled={commercialSaving}
                      className="flex-1 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs font-semibold text-neutral-800 focus:border-cyan-400 focus:outline-none disabled:opacity-60"
                    >
                      <option value="">Abrir fechamento em canal privado</option>
                      {chatwootChannels.map((ch) => <option key={ch.id} value={ch.id}>{ch.name}</option>)}
                    </select>
                    {selected.commercial?.closingConversationUrl && (
                      <a href={selected.commercial.closingConversationUrl} target="_blank" rel="noopener noreferrer"
                        className="flex items-center rounded-lg bg-neutral-900 px-3 text-xs font-bold text-white hover:bg-neutral-700">
                        Abrir
                      </a>
                    )}
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <InfoCard label="Vendedor" value={selected.commercial?.assignedSellerName ?? "Sem responsável"} />
                  <InfoCard label="Campanha" value={selected.commercial?.campaignSource || "—"} sub={selected.commercial?.campaignName ?? undefined} />
                </div>
              </div>

              {/* ─ Chatwoot ─ */}
              <div className="border-b border-neutral-100 px-5 py-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">Chatwoot</p>
                  {selectedChatwoot?.conversationUrl ? (
                    <a href={selectedChatwoot.conversationUrl} target="_blank" rel="noopener noreferrer"
                      className="rounded-md bg-cyan-600 px-2.5 py-1 text-[10px] font-bold text-white hover:bg-cyan-700">
                      Abrir conversa
                    </a>
                  ) : null}
                </div>
                {selectedChatwoot ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-3 gap-2">
                      <InfoCard label="Mensagens" value={String(selectedChatwoot.messageCount)} />
                      <InfoCard label="Recebidas" value={String(selectedChatwoot.incomingCount)} />
                      <InfoCard label="Enviadas" value={String(selectedChatwoot.outgoingCount)} />
                    </div>
                    {selectedChatwoot.lastMessagePreview && (
                      <div className="rounded-lg bg-neutral-50 px-3 py-2.5 ring-1 ring-neutral-100">
                        <p className="text-[10px] font-semibold uppercase text-neutral-400">Última mensagem · {fmtRelative(selectedChatwoot.lastMessageAt ?? "")}</p>
                        <p className="mt-1 text-sm text-neutral-800">{selectedChatwoot.lastMessagePreview}</p>
                      </div>
                    )}
                    {selectedChatwoot.organization.displayTags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {selectedChatwoot.organization.displayTags.slice(0, 8).map((tag) => (
                          <TagBadge key={tag} tag={tagFromDashboardDisplay(tag)} size="xs" />
                        ))}
                      </div>
                    )}
                    {selectedChatwoot.recentMessages.slice(0, 3).map((msg) => (
                      <div key={msg.id} className={`rounded-lg p-2.5 text-xs ${msg.direction === "incoming" ? "bg-emerald-50 text-emerald-900" : "bg-sky-50 text-sky-900"}`}>
                        <div className="mb-0.5 flex justify-between">
                          <span className="font-semibold">{fmtMessageDirection(msg.direction)}</span>
                          <span className="text-[10px] opacity-60">{fmtRelative(msg.createdAt)}</span>
                        </div>
                        <p className="line-clamp-2">{msg.content}</p>
                        {msg.direction === "outgoing" && msg.readStatus && (
                          <div className="mt-1">
                            {msg.readStatus === "read" ? (
                              <span className="text-[10px] font-semibold text-blue-600">✓✓ Lida</span>
                            ) : msg.readStatus === "delivered" ? (
                              <span className="text-[10px] opacity-60">✓✓ Entregue</span>
                            ) : msg.readStatus === "sent" ? (
                              <span className="text-[10px] opacity-60">✓ Enviada</span>
                            ) : msg.readStatus === "failed" ? (
                              <span className="text-[10px] font-semibold text-rose-600">✗ Falha</span>
                            ) : null}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div>
                    <p className="mb-2 text-xs text-neutral-400">Nenhum contato vinculado por telefone/e-mail.</p>
                    <button type="button" onClick={handleChatwootSync} disabled={syncingChatwoot}
                      className="w-full rounded-lg border border-cyan-200 bg-cyan-50 py-2 text-xs font-semibold text-cyan-700 hover:bg-cyan-100 disabled:opacity-60">
                      {syncingChatwoot ? "Sincronizando..." : "Sincronizar contato"}
                    </button>
                  </div>
                )}
              </div>

              {/* ─ Registrar atividade ─ */}
              <div className="border-b border-neutral-100 px-5 py-4">
                <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-neutral-400">Registrar Atividade</p>
                <form onSubmit={handleNoteSubmit} className="space-y-2">
                  <div className="flex gap-1">
                    {([
                      { key: "note", label: "Nota" },
                      { key: "whatsapp", label: "WhatsApp" },
                      { key: "call", label: "Ligação" },
                      { key: "email", label: "E-mail" },
                    ] as const).map((t) => (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => setNoteType(t.key)}
                        className={`h-7 rounded-lg px-2.5 text-[11px] font-semibold transition ${
                          noteType === t.key ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="Descreva a atividade..."
                    rows={2}
                    disabled={savingNote}
                    required
                    className="w-full resize-none rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm placeholder:text-neutral-400 focus:border-cyan-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-cyan-100"
                  />
                  <button
                    type="submit"
                    disabled={savingNote || !noteText.trim()}
                    className="w-full rounded-lg bg-neutral-900 py-2 text-xs font-bold text-white hover:bg-neutral-700 disabled:opacity-40"
                  >
                    {savingNote ? "Salvando..." : "Registrar"}
                  </button>
                </form>
              </div>

              {/* ─ Timeline ─ */}
              <div className="px-5 py-4">
                <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-neutral-400">Histórico</p>
                {timeline.length === 0 ? (
                  <p className="py-4 text-center text-xs text-neutral-400">Nenhuma atividade registrada.</p>
                ) : (
                  <div className="relative space-y-0">
                    <div className="absolute bottom-0 left-3.5 top-0 w-px bg-neutral-100" />
                    {timeline.map((event) => (
                      <div key={event.id} className="relative flex gap-3 pb-3">
                        <div className="relative z-10 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-white text-sm ring-1 ring-neutral-200">
                          {event.icon}
                        </div>
                        <div className={`min-w-0 flex-1 rounded-lg border px-3 py-2 ${event.color}`}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                              {event.type === "chatwoot" ? "Chatwoot" : event.type === "whatsapp" ? "WhatsApp" : event.type === "note" ? "Nota" : event.type === "status" ? "Status" : "Sistema"}
                            </span>
                            <span className="whitespace-nowrap text-[10px] text-neutral-400">{fmtRelative(event.date)}</span>
                          </div>
                          <p className="mt-0.5 text-xs text-neutral-800">{event.content}</p>
                          {event.isOutgoing && event.readStatus && (
                            <div className="mt-1 flex items-center gap-1">
                              {event.readStatus === "read" ? (
                                <span className="text-[10px] font-semibold text-blue-600" title="Lida pelo contato">✓✓ Lida</span>
                              ) : event.readStatus === "delivered" ? (
                                <span className="text-[10px] text-neutral-400" title="Entregue">✓✓ Entregue</span>
                              ) : event.readStatus === "sent" ? (
                                <span className="text-[10px] text-neutral-400" title="Enviada">✓ Enviada</span>
                              ) : event.readStatus === "failed" ? (
                                <span className="text-[10px] font-semibold text-rose-600" title="Falha no envio">✗ Falha</span>
                              ) : null}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Presence */}
              {selected.presencaValidada && (
                <div className="border-t border-neutral-100 px-5 py-4">
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-neutral-400">Presença</p>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${selected.presencaAprovada ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                      {selected.presencaAprovada ? "✓ Presente" : "⚠ Insuficiente"}
                    </span>
                    {selected.presencaParticipanteNome && (
                      <span className="text-xs text-neutral-500">como {selected.presencaParticipanteNome}</span>
                    )}
                  </div>
                </div>
              )}

              <div className="h-4" />

              </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ─ Merge modal (fora do layout) ─ */}
      {showMergeModal && selected && (
        <MergeLeadsModal
          primary={selected}
          onMerged={(updated) => {
            setRecords((prev) => prev.map((r) => r.id === updated.id ? { ...r, ...updated } : r));
            setShowMergeModal(false);
          }}
          onClose={() => setShowMergeModal(false)}
        />
      )}
    </div>
  );
}

/* ─── Small components ─── */

const filterSelectClass = "h-8 w-full rounded-lg border border-neutral-200 bg-white px-2.5 text-xs text-neutral-700 focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-100";

function InfoCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-neutral-50 px-3 py-2 ring-1 ring-neutral-100">
      <p className="text-[9px] font-bold uppercase tracking-widest text-neutral-400">{label}</p>
      <p className="mt-0.5 truncate text-xs font-semibold text-neutral-800">{value}</p>
      {sub && <p className="truncate text-[10px] text-neutral-400">{sub}</p>}
    </div>
  );
}
