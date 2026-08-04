"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Clock3,
  FileText,
  Flag,
  Globe2,
  History,
  Mail,
  MapPin,
  Phone,
  Route,
  UserRound,
} from "lucide-react";
import { CopyPhoneButton } from "@/components/CopyPhoneButton";
import { TagBadge } from "@/components/TagBadge";
import { LeadEditForm } from "@/components/LeadEditForm";
import { FormTrackingFields, hasFormTrackingFields, leadFormAnswerFields } from "@/components/FormHistoryView";
import { LeadTimeline } from "@/components/LeadTimeline";
import { LeadVinculosSection } from "@/components/LeadVinculosSection";
import { EncontroChatView } from "@/components/EncontroChatView";
import type { CommercialStage, InscricaoItem, InscricaoStatus } from "@/types/inscricao";
import type { TrainingOption } from "@/types/training";
import type { CommercialWorkspace } from "@/types/commercial";
import type { AnamneseResposta } from "@/lib/anamnese";
import { formatFormValue, UP_DAY_DISPLAY_FIELDS } from "@/lib/inscricaoForm";
import { buildOperationalTags, groupParticipantTags, isOnlineTraining } from "@/lib/participantTags";
import { buildWhatsAppWebUrl, humanizeName, openWhatsAppOnMobile } from "@/lib/utils";
import { describeLeadSource } from "@/lib/leadFields";
import { hasPermission, type PermissionUser } from "@/lib/permissions";
import { buildStageBadgeMap, FALLBACK_STAGE_BADGE } from "@/lib/stageColors";

interface RecruiterOption {
  code: string;
  name: string;
}

interface LeadProfileModalProps {
  /** Modal aberto sse != null. O componente busca os dados sozinho. */
  leadId: number | null;
  onClose: () => void;
  /** Pai atualiza sua propria lista/kanban apos qualquer mutacao. */
  onUpdate?: (updated: InscricaoItem) => void;
  onDelete?: (id: number) => void;
  trainingOptions: TrainingOption[];
  recruiterOptions: RecruiterOption[];
  /**
   * So /crm passa isso hoje. Presente = habilita estagio comercial +
   * atribuicao de vendedor interativos. Ausente = mostra so o resumo.
   */
  commercial?: CommercialWorkspace;
  currentUser?: PermissionUser | null;
  variant?: "modal" | "panel";
}

function formatTrainingDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatDateOnly(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatTimeOnly(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatPresenceTime(minutes: number): string {
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}min` : `${hours}h`;
}

function getInitials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

export function LeadProfileModal({
  leadId,
  onClose,
  onUpdate,
  onDelete,
  trainingOptions,
  recruiterOptions,
  commercial,
  currentUser,
  variant = "modal",
}: LeadProfileModalProps) {
  const router = useRouter();
  const isPanel = variant === "panel";
  const [inscricao, setInscricao] = useState<InscricaoItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState<InscricaoStatus | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [noteContent, setNoteContent] = useState("");
  const [noteWhatsapp, setNoteWhatsapp] = useState(false);
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [anamneses, setAnamneses] = useState<AnamneseResposta[]>([]);
  const [isLoadingAnamnese, setIsLoadingAnamnese] = useState(false);
  const [starsHover, setStarsHover] = useState(0);
  const [starsSaving, setStarsSaving] = useState(false);
  const [savingSuggestion, setSavingSuggestion] = useState<"nome" | "email" | null>(null);
  const [commercialSaving, setCommercialSaving] = useState(false);
  const [commercialMessage, setCommercialMessage] = useState<string | null>(null);

  // Busca os dados do lead quando o modal abre / o leadId muda.
  useEffect(() => {
    if (leadId === null) {
      setInscricao(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setIsEditing(false);
    setDeleteConfirm(false);
    setErrorMessage(null);
    setSuccessMessage(null);
    setNoteContent("");
    setNoteWhatsapp(false);
    setAnamneses([]);
    setCommercialMessage(null);

    fetch(`/api/inscricoes/${leadId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Falha ao carregar detalhes do lead.");
        return res.json() as Promise<{ inscricao?: InscricaoItem }>;
      })
      .then((data) => {
        if (!cancelled) setInscricao(data.inscricao ?? null);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Erro ao carregar lead.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [leadId]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    if (leadId !== null) window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [leadId, onClose]);

  useEffect(() => {
    if (!inscricao?.codigoProprio) {
      setAnamneses([]);
      return;
    }
    let cancelled = false;
    setIsLoadingAnamnese(true);
    fetch(`/api/anamnese/${encodeURIComponent(inscricao.codigoProprio)}`)
      .then(async (r) => (r.ok ? ((await r.json()) as { anamneses?: AnamneseResposta[] }) : null))
      .then((d) => {
        if (!cancelled) setAnamneses(d?.anamneses ?? []);
      })
      .catch(() => {
        /* ignore */
      })
      .finally(() => {
        if (!cancelled) setIsLoadingAnamnese(false);
      });
    return () => {
      cancelled = true;
    };
  }, [inscricao?.codigoProprio]);

  const stageBadgeMap = useMemo(() => buildStageBadgeMap(commercial?.funnels ?? []), [commercial]);
  function stageBadge(key: CommercialStage | null | undefined) {
    return (key ? stageBadgeMap.get(key) : null) ?? FALLBACK_STAGE_BADGE;
  }
  // Etapas do proprio funil do lead — cada funil tem seu conjunto de etapas.
  const leadFunnel = useMemo(() => {
    const funnelId = inscricao?.commercial?.funnelId ?? null;
    return (
      commercial?.funnels.find((funnel) => funnel.id === funnelId) ??
      commercial?.funnels.find((funnel) => funnel.isDefault) ??
      null
    );
  }, [commercial, inscricao?.commercial?.funnelId]);
  const leadStageOptions = leadFunnel?.stages ?? commercial?.stages ?? [];
  const hasFechamentoStage = leadStageOptions.some((stage) => stage.key === "fechamento");

  const trainingOptionsById = useMemo(() => {
    return trainingOptions.reduce<Record<string, TrainingOption>>((acc, o) => {
      acc[o.id] = o;
      return acc;
    }, {});
  }, [trainingOptions]);

  const treinamentoDisplay = useMemo(() => {
    if (!inscricao) return { text: "", rawDate: null as string | null };
    const id = inscricao.treinamentoId ?? "";
    const match = id ? trainingOptionsById[id] : undefined;
    const rawDate = inscricao.treinamentoData ?? match?.startsAt ?? null;
    const formattedDate = formatTrainingDate(rawDate ?? id);
    const fallbackLabel = inscricao.treinamentoNome ?? match?.label ?? (id.length > 0 ? id : "");
    const text = fallbackLabel && formattedDate && !fallbackLabel.includes(formattedDate)
      ? `${fallbackLabel} ${formattedDate}` : fallbackLabel || formattedDate || "";
    return { text, rawDate };
  }, [inscricao, trainingOptionsById]);

  const statusInfo = useMemo(() => {
    if (!inscricao) return { label: "-", color: "neutral" };
    if (inscricao.tipo === "recrutador") return { label: "Cluster", color: "blue" };
    switch (inscricao.status) {
      case "aprovado": return { label: "Qualificado", color: "emerald" };
      case "rejeitado": return { label: "Descartado", color: "rose" };
      default: return { label: "Aguardando", color: "amber" };
    }
  }, [inscricao]);
  const canEditLead = !currentUser || hasPermission(currentUser, "crm.edit_leads");
  const canDeleteLead = !currentUser || hasPermission(currentUser, "crm.delete_leads");
  const canMoveStage = !currentUser || hasPermission(currentUser, "crm.update_stage");
  const canManageStars = !currentUser || hasPermission(currentUser, "crm.manage_temperature");
  const canManageLinks = !currentUser || hasPermission(currentUser, "crm.manage_links");
  const canManageNotes = !currentUser || hasPermission(currentUser, "crm.manage_notes");
  const canViewNotes = !currentUser || hasPermission(currentUser, "field.view.notes");
  const canViewHistory = !currentUser || hasPermission(currentUser, "field.view.history");

  const avatarColor = useMemo(() => {
    const map: Record<string, string> = {
      emerald: "bg-emerald-500", rose: "bg-rose-500", amber: "bg-amber-500", blue: "bg-blue-500", neutral: "bg-neutral-400",
    };
    return map[statusInfo.color] ?? "bg-neutral-400";
  }, [statusInfo.color]);

  const statusBadgeClass = useMemo(() => {
    const map: Record<string, string> = {
      emerald: "bg-emerald-100 text-emerald-800", rose: "bg-rose-100 text-rose-700", amber: "bg-amber-100 text-amber-800",
      blue: "bg-blue-100 text-blue-800", neutral: "bg-neutral-100 text-neutral-600",
    };
    return map[statusInfo.color] ?? "bg-neutral-100 text-neutral-600";
  }, [statusInfo.color]);

  const autoTags = useMemo(() => (inscricao ? buildOperationalTags(inscricao) : []), [inscricao]);
  const groupedAutoTags = useMemo(() => groupParticipantTags(autoTags), [autoTags]);

  if (leadId === null) {
    if (!isPanel) return null;
    return (
      <div className="flex h-full min-h-[620px] items-center justify-center rounded-[24px] border border-[#dce8f2] bg-white shadow-[var(--dashboard-card-shadow)]">
        <div className="max-w-sm px-6 text-center">
          <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-[#e5f8ff] text-[#0086b8]">
            <UserRound size={30} />
          </div>
          <h2 className="mt-5 text-lg font-bold text-slate-950">Selecione um lead</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Escolha um contato na lista para visualizar as informações, origem, respostas e ações comerciais.
          </p>
        </div>
      </div>
    );
  }

  function updateInscricao(updated: InscricaoItem) {
    setInscricao(updated);
    onUpdate?.(updated);
  }

  async function handleDelete() {
    if (!inscricao || isDeleting || !canDeleteLead) return;
    if (!deleteConfirm) {
      setDeleteConfirm(true);
      return;
    }
    setIsDeleting(true);
    setErrorMessage(null);
    try {
      const r = await fetch(`/api/inscricoes/${inscricao.id}`, { method: "DELETE" });
      if (!r.ok) {
        const d = (await r.json().catch(() => null)) as { error?: string } | null;
        setErrorMessage(d?.error ?? "Não foi possível excluir a inscrição.");
        return;
      }
      onDelete?.(inscricao.id);
      onClose();
      router.refresh();
    } catch {
      setErrorMessage("Erro inesperado ao excluir a inscrição.");
    } finally {
      setIsDeleting(false);
      setDeleteConfirm(false);
    }
  }

  async function copyRecruiterLink() {
    if (inscricao?.recrutadorUrl) {
      try {
        await navigator.clipboard.writeText(inscricao.recrutadorUrl);
      } catch {
        /* ignore */
      }
    }
  }

  function openNetworkView() {
    if (!inscricao) return;
    const targetCode = inscricao.codigoProprio ?? inscricao.recrutadorCodigo;
    if (!targetCode) return;
    router.push(`/rede?${new URLSearchParams({ focus: targetCode }).toString()}`);
    onClose();
  }

  async function handleStatusChange(nextStatus: InscricaoStatus) {
    if (!inscricao || statusUpdating === nextStatus || inscricao.tipo === "recrutador" || !canMoveStage) return;
    let whatsappContacted: boolean | undefined;
    if (nextStatus === "aprovado" || nextStatus === "rejeitado") {
      whatsappContacted = window.confirm("Você já entrou em contato no WhatsApp?");
    }
    setStatusUpdating(nextStatus);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const r = await fetch(`/api/inscricoes/${inscricao.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus, whatsappContacted }),
      });
      if (!r.ok) {
        const d = (await r.json().catch(() => null)) as { error?: string } | null;
        setErrorMessage(d?.error ?? "Não foi possível atualizar o status.");
        return;
      }
      const d = (await r.json()) as { inscricao?: InscricaoItem };
      if (d.inscricao) updateInscricao(d.inscricao);
    } catch {
      setErrorMessage("Erro ao atualizar status.");
    } finally {
      setStatusUpdating(null);
    }
  }

  async function handleNoteSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!inscricao || !noteContent.trim() || isSavingNote || !canManageNotes) return;
    setIsSavingNote(true);
    setErrorMessage(null);
    try {
      const r = await fetch(`/api/inscricoes/${inscricao.id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: noteContent, viaWhatsapp: noteWhatsapp }),
      });
      if (!r.ok) {
        const d = (await r.json().catch(() => null)) as { error?: string } | null;
        setErrorMessage(d?.error ?? "Não foi possível salvar a anotação.");
        return;
      }
      const d = (await r.json()) as { inscricao?: InscricaoItem };
      if (d.inscricao) updateInscricao(d.inscricao);
      setNoteContent("");
      setNoteWhatsapp(false);
    } catch {
      setErrorMessage("Erro ao salvar anotação.");
    } finally {
      setIsSavingNote(false);
    }
  }

  async function handleStarClick(value: number) {
    if (!inscricao || starsSaving || !canManageStars) return;
    const nextValue = inscricao.stars === value ? 0 : value;
    setStarsSaving(true);
    try {
      const r = await fetch(`/api/inscricoes/${inscricao.id}/stars`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stars: nextValue }),
      });
      if (!r.ok) {
        const d = (await r.json().catch(() => null)) as { error?: string } | null;
        setErrorMessage(d?.error ?? "Erro ao salvar avaliação.");
        return;
      }
      const d = (await r.json()) as { inscricao?: InscricaoItem };
      if (d.inscricao) updateInscricao(d.inscricao);
    } catch {
      setErrorMessage("Erro ao salvar avaliação.");
    } finally {
      setStarsSaving(false);
    }
  }

  async function handleApplySuggestion(field: "nome" | "email", value: string) {
    if (!inscricao) return;
    setSavingSuggestion(field);
    try {
      const r = await fetch(`/api/inscricoes/${inscricao.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payloadUpdates: { [field]: value, [`dashboard_${field}_sugestoes`]: null } }),
      });
      if (r.ok) {
        const d = (await r.json()) as { inscricao?: InscricaoItem };
        if (d.inscricao) updateInscricao(d.inscricao);
      }
    } catch {
      /* ignore */
    } finally {
      setSavingSuggestion(null);
    }
  }

  async function refreshLead() {
    if (!inscricao) return;
    const r = await fetch(`/api/inscricoes/${inscricao.id}`);
    if (r.ok) {
      const d = (await r.json()) as { inscricao?: InscricaoItem };
      if (d.inscricao) updateInscricao(d.inscricao);
    }
  }

  async function handleCommercialStageChange(stage: CommercialStage) {
    if (!inscricao || commercialSaving) return;
    setCommercialSaving(true);
    setCommercialMessage(null);
    try {
      const res = await fetch(`/api/commercial/leads/${inscricao.id}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(data?.error ?? "Falha ao atualizar etapa.");
      await refreshLead();
      setCommercialMessage("Etapa comercial atualizada.");
    } catch (error) {
      setCommercialMessage(error instanceof Error ? error.message : "Falha ao atualizar etapa.");
    } finally {
      setCommercialSaving(false);
    }
  }

  async function handleCommercialAssign(sellerId: string) {
    if (!inscricao || commercialSaving) return;
    // Vazio = "Repassar para vendedor": remove a associação com o vendedor atual.
    const removing = sellerId === "";
    if (removing && inscricao.commercial?.assignedSellerId == null) return;
    setCommercialSaving(true);
    setCommercialMessage(null);
    try {
      const res = await fetch(`/api/commercial/leads/${inscricao.id}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sellerId: removing ? null : Number(sellerId) }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(data?.error ?? "Falha ao repassar lead.");
      await refreshLead();
      setCommercialMessage(removing ? "Atribuição removida. Lead sem vendedor responsável." : "Lead repassado.");
    } catch (error) {
      setCommercialMessage(error instanceof Error ? error.message : "Falha ao repassar lead.");
    } finally {
      setCommercialSaving(false);
    }
  }

  async function handleMoveFunnel(funnelId: string) {
    if (!inscricao || commercialSaving || !funnelId) return;
    setCommercialSaving(true);
    setCommercialMessage(null);
    try {
      const res = await fetch(`/api/commercial/leads/${inscricao.id}/funnel`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ funnelId: Number(funnelId) }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(data?.error ?? "Falha ao mover lead de funil.");
      await refreshLead();
      setCommercialMessage("Lead movido para outro funil.");
    } catch (error) {
      setCommercialMessage(error instanceof Error ? error.message : "Falha ao mover lead de funil.");
    } finally {
      setCommercialSaving(false);
    }
  }

  const nomeSugestoes = inscricao
    ? (() => {
        const p = (inscricao.payload ?? {}) as Record<string, unknown>;
        return Array.isArray(p.dashboard_nome_sugestoes) ? (p.dashboard_nome_sugestoes as string[]) : [];
      })()
    : [];
  const emailSugestoes = inscricao
    ? (() => {
        const p = (inscricao.payload ?? {}) as Record<string, unknown>;
        return Array.isArray(p.dashboard_email_sugestoes) ? (p.dashboard_email_sugestoes as string[]) : [];
      })()
    : [];

  return (
    <div
      className={isPanel ? "h-full" : "fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-0 backdrop-blur-[3px] sm:p-5"}
      role={isPanel ? undefined : "dialog"}
      aria-modal={isPanel ? undefined : true}
    >
      <div
        className={
          isPanel
            ? "flex h-full min-h-[720px] w-full flex-col overflow-hidden rounded-[24px] border border-[#dce8f2] bg-white shadow-[var(--dashboard-card-shadow)]"
            : "flex h-dvh max-h-dvh w-full flex-col overflow-hidden bg-white shadow-[0_30px_90px_rgba(15,23,42,0.22)] sm:h-auto sm:max-h-[91vh] sm:max-w-[1180px] sm:rounded-[22px] sm:border sm:border-slate-200"
        }
      >
        {loading && !inscricao ? (
          <div className="flex h-64 items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-200 border-t-neutral-600" />
          </div>
        ) : loadError && !inscricao ? (
          <div className="flex h-48 flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm text-rose-600">{loadError}</p>
            <button type="button" onClick={onClose} className="rounded-lg border border-neutral-200 px-4 py-2 text-xs font-semibold text-neutral-600 hover:bg-neutral-50">
              Fechar
            </button>
          </div>
        ) : !inscricao ? null : (
          <>
            {/* ── HEADER ─────────────────────────────── */}
            <div className="flex flex-shrink-0 flex-col border-b border-slate-200 bg-white">
              <div className={isPanel ? "flex items-center gap-5 px-8 py-8" : "flex flex-wrap items-center gap-3 px-4 py-4 sm:flex-nowrap sm:gap-5 sm:px-9 sm:py-7"}>
                <div className={`flex flex-shrink-0 items-center justify-center rounded-full font-black text-white shadow-[0_12px_28px_rgba(8,134,184,0.18)] ${isPanel ? "size-20 text-xl" : "size-12 text-base sm:size-16 sm:text-xl"} ${avatarColor}`}>
                  {getInitials(inscricao.nome)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                    <h2 className={isPanel ? "break-words text-2xl font-bold leading-tight text-slate-950" : "break-words text-lg font-black leading-tight text-slate-950 sm:text-2xl"}>
                      {humanizeName(inscricao.nome) ?? "Sem nome"}
                    </h2>
                    <span className={`flex-shrink-0 rounded-full px-3 py-1 text-xs font-bold ${statusBadgeClass}`}>
                      {statusInfo.label}
                    </span>
                  </div>
                  <p className="mt-1 text-xs font-semibold text-slate-500 sm:mt-2 sm:text-sm">#{inscricao.id} · Criado em {formatDateTime(inscricao.criadoEm)}</p>
                </div>
                <div className="flex w-full flex-shrink-0 items-center justify-end gap-2 sm:w-auto">
                  {isEditing ? (
                    <button
                      type="button"
                      onClick={() => setIsEditing(false)}
                      className="h-10 rounded-lg border border-[#dce8f2] px-4 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
                    >
                      Cancelar
                    </button>
                  ) : canEditLead ? (
                    <button
                      type="button"
                      onClick={() => { setIsEditing(true); setErrorMessage(null); setSuccessMessage(null); }}
                      className="h-10 rounded-lg border border-[#54c4ed] px-4 text-sm font-bold text-[#0086b8] transition hover:bg-[#e5f8ff]"
                    >
                      Editar lead
                    </button>
                  ) : null}
                  {canDeleteLead ? (
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={isDeleting}
                      className={`h-10 rounded-lg border px-4 text-sm font-bold transition disabled:opacity-50 ${
                        deleteConfirm ? "border-rose-600 bg-rose-600 text-white hover:bg-rose-700" : "border-red-200 bg-white text-red-600 hover:bg-red-50"
                      }`}
                    >
                      {isDeleting ? "..." : deleteConfirm ? "Confirmar" : "Excluir"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Fechar"
                    className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Sugestões de nome/e-mail vindas de merges por telefone */}
              {(nomeSugestoes.length > 0 || emailSugestoes.length > 0) && (
                <div className="flex flex-wrap items-center gap-2 border-t border-amber-100 bg-amber-50 px-6 py-3">
                  {nomeSugestoes.map((s) => (
                    <button
                      key={`nome-${s}`}
                      type="button"
                      disabled={savingSuggestion === "nome"}
                      onClick={() => handleApplySuggestion("nome", s)}
                      className="rounded-full border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                    >
                      Sugestão de nome: {s}
                    </button>
                  ))}
                  {emailSugestoes.map((s) => (
                    <button
                      key={`email-${s}`}
                      type="button"
                      disabled={savingSuggestion === "email"}
                      onClick={() => handleApplySuggestion("email", s)}
                      className="rounded-full border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                    >
                      Sugestão de e-mail: {s}
                    </button>
                  ))}
                </div>
              )}

              {/* Status + Stars */}
              {inscricao.tipo !== "recrutador" && (
                <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[#e3edf5] px-6 py-4">
                  <div className="flex flex-wrap gap-2">
                    {(["aguardando", "aprovado", "rejeitado"] as const).map((s) => {
                      const active = (inscricao.status ?? "aguardando") === s;
                      const labels = { aguardando: "Aguardando", aprovado: "Qualificado", rejeitado: "Descartado" };
                      const colors = {
                        aguardando: active ? "bg-amber-500 text-white border-amber-500" : "border-neutral-200 text-neutral-500 hover:border-amber-400 hover:text-amber-600",
                        aprovado: active ? "bg-emerald-500 text-white border-emerald-500" : "border-neutral-200 text-neutral-500 hover:border-emerald-400 hover:text-emerald-600",
                        rejeitado: active ? "bg-red-500 text-white border-red-500" : "border-neutral-200 text-neutral-500 hover:border-red-400 hover:text-red-500",
                      };
                      return (
                        <button
                          key={s}
                          type="button"
                          disabled={statusUpdating !== null || !canMoveStage}
                          onClick={() => handleStatusChange(s)}
                          className={`h-8 rounded-lg border px-3 text-xs font-bold transition ${colors[s]} disabled:opacity-50`}
                        >
                          {statusUpdating === s ? "..." : labels[s]}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex gap-0.5" onMouseLeave={() => setStarsHover(0)}>
                    {[1, 2, 3, 4, 5].map((star) => {
                      const filled = starsHover > 0 ? star <= starsHover : star <= (inscricao.stars ?? 0);
                      return (
                        <button
                          key={star}
                          type="button"
                          disabled={starsSaving || !canManageStars}
                          onMouseEnter={() => setStarsHover(star)}
                          onClick={() => handleStarClick(star)}
                          title={`${star} estrela${star > 1 ? "s" : ""}`}
                          className={`text-lg leading-none transition-transform hover:scale-110 disabled:opacity-40 ${filled ? "text-amber-400" : "text-neutral-200"}`}
                        >
                          ★
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* ── SCROLLABLE BODY ───────────────────────── */}
            <div className="flex-1 overflow-y-auto bg-[#f8fbfe] pb-6">
              {(errorMessage || successMessage) && (
                <div className="px-5 pt-4">
                  {errorMessage && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">{errorMessage}</p>}
                  {successMessage && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 ring-1 ring-emerald-200">{successMessage}</p>}
                </div>
              )}

              {isEditing && canEditLead ? (
                <LeadEditForm
                  inscricao={inscricao}
                  trainingOptions={trainingOptions}
                  recruiterOptions={recruiterOptions}
                  onSaved={(updated) => { updateInscricao(updated); setIsEditing(false); setSuccessMessage("Alterações salvas."); router.refresh(); }}
                  onCancel={() => setIsEditing(false)}
                />
              ) : (
                <>
                  {/* ── INFORMAÇÕES PADRÃO DO LEAD ────────── */}
                  <Section label="Informações Padrão do Lead">
                    <div className="space-y-4">
                      {inscricao.telefone ? (
                        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                          <a
                            href={buildWhatsAppWebUrl(inscricao.telefone)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => openWhatsAppOnMobile(e, inscricao.telefone)}
                            className="flex items-center justify-center gap-2 rounded-xl bg-[#25D366] px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#1ebe5c] active:scale-[0.98]"
                          >
                            <svg className="h-4 w-4 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                            </svg>
                            Abrir conversa · {inscricao.telefone}
                          </a>
                          <a
                            href={`tel:+55${inscricao.telefone.replace(/\D/g, "")}`}
                            className="flex items-center justify-center gap-1.5 rounded-xl border border-[#dce8f2] bg-white px-4 py-3 text-xs font-bold text-slate-700 hover:bg-slate-50"
                          >
                            <Phone size={14} />
                            Ligar
                          </a>
                          <CopyPhoneButton
                            phone={inscricao.telefone}
                            size={14}
                            withLabel
                            className="justify-center rounded-xl border border-[#dce8f2] bg-white px-4 py-3 text-slate-700 hover:bg-slate-50"
                          />
                        </div>
                      ) : (
                        <p className="rounded-lg bg-neutral-50 px-3 py-2 text-sm text-neutral-400 ring-1 ring-neutral-100">Sem telefone cadastrado</p>
                      )}

                      <div className="grid gap-2 sm:grid-cols-2">
                        <InfoCard label="Nome completo" value={humanizeName(inscricao.nome) ?? "—"} />
                        <InfoCard label="E-mail" value={inscricao.parsedPayload.email || "—"} />
                        <InfoCard label="Telefone / WhatsApp" value={inscricao.telefone || "—"} />
                        <InfoCard label="Data de nascimento" value={formatTrainingDate(inscricao.parsedPayload.data_nascimento) ?? "—"} />
                        <InfoCard label="Cidade" value={inscricao.cidade || "—"} />
                        <InfoCard label="Estado" value={inscricao.parsedPayload.estado || "—"} />
                        <InfoCard label="Empresa" value={inscricao.parsedPayload.empresa || "—"} />
                        <InfoCard label="Cargo / Profissão" value={inscricao.profissao || inscricao.parsedPayload.cargo || "—"} />
                        <InfoCard label="Data de cadastro" value={formatDateOnly(inscricao.criadoEm)} />
                        <InfoCard label="Hora de cadastro" value={formatTimeOnly(inscricao.criadoEm)} />
                        <InfoCard
                          label="Última alteração"
                          value={formatDateTime(
                            String((inscricao.payload as Record<string, unknown> | undefined)?.dashboard_ultima_interacao ?? "") ||
                              inscricao.criadoEm
                          )}
                        />
                        {/* Respostas do formulário viram campos normais aqui, sem cabeçalho próprio */}
                        {canViewHistory
                          ? leadFormAnswerFields(inscricao).map((field) => (
                              <InfoCard key={field.key} label={field.label} value={field.value} />
                            ))
                          : null}
                      </div>
                    </div>
                  </Section>

                  {/* ── LINHA DO TEMPO ───────────────────── */}
                  {/* Logo abaixo do contato: o vendedor registra "mandei
                      mensagem"/"liguei" na hora, e quem pegar o lead depois vê
                      todo o histórico (contatos + edições) sem procurar. */}
                  <Section label="Linha do tempo · contatos e alterações">
                    <LeadTimeline leadId={inscricao.id} canLog={canManageNotes} />
                  </Section>

                  {/* ── ORIGEM DO LEAD ───────────────────── */}
                  <Section label="Origem do Lead">
                    {(() => {
                      const source = describeLeadSource(inscricao.payload as Record<string, unknown> | undefined);
                      return (
                        <div className="grid gap-2 sm:grid-cols-2">
                          {/* Com mais de um vínculo, o canal de captação vence
                              o formulário de produto (ver lib/leadOriginPriority).
                              As duas linhas ficam à vista: a contagem usa a de
                              cima, a inscrição em si é a de baixo. */}
                          <InfoCard
                            label={source.origemPorPrioridade ? "Origem do lead (canal)" : "Origem do lead"}
                            value={source.origem || "—"}
                            sub={source.comoConheceu ?? undefined}
                          />
                          {source.origemPorPrioridade ? (
                            <InfoCard
                              label="Formulário preenchido"
                              value={source.origemFormulario || "—"}
                              sub="O canal tem prioridade sobre o formulário quando o lead tem mais de um vínculo."
                            />
                          ) : null}
                          <InfoCard label="Nome do formulário" value={source.formName || "—"} />
                          <InfoCard label="Rota de origem" value={source.paginaOrigem || "—"} />
                          <InfoCard label="Campanha" value={source.campanha || "—"} sub={source.fonte ?? undefined} />
                          <InfoCard label="Indicador" value={source.indicador || "—"} />
                          <InfoCard label="Data/hora de conversão" value={formatDateTime(inscricao.criadoEm)} />
                          {source.extras.length > 0 && (
                            <div className="col-span-2">
                              <InfoCard label="Também entrou por" value={source.extras.join(", ")} />
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </Section>

                  {/* ── VÍNCULOS (ATRIBUTOS DO LEAD) ─────── */}
                  {canManageLinks ? (
                    <Section label="Vínculos · aulas, treinamentos e origens">
                      <LeadVinculosSection
                        leadId={inscricao.id}
                        onChanged={() => {
                          void refreshLead();
                          router.refresh();
                        }}
                      />
                    </Section>
                  ) : null}

                  {/* ── OBSERVAÇÕES INTERNAS ─────────────── */}
                  {canViewNotes ? (
                  <Section label={`Observações internas · ${(inscricao.notes ?? []).length}`}>
                    {canManageNotes ? (
                    <form onSubmit={handleNoteSubmit} className="mb-3 rounded-xl bg-neutral-50 p-3 ring-1 ring-neutral-100">
                      <textarea
                        rows={2}
                        placeholder="Adicionar anotação..."
                        value={noteContent}
                        onChange={(e) => setNoteContent(e.target.value)}
                        disabled={isSavingNote}
                        required
                        className="w-full resize-none rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-800 placeholder:text-neutral-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-100"
                      />
                      <div className="mt-2 flex items-center justify-between">
                        <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-neutral-500">
                          <input type="checkbox" checked={noteWhatsapp} onChange={(e) => setNoteWhatsapp(e.target.checked)} disabled={isSavingNote} className="h-3.5 w-3.5 rounded border-neutral-300" />
                          Via WhatsApp
                        </label>
                        <button type="submit" disabled={isSavingNote || !noteContent.trim()} className="rounded-lg bg-neutral-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-neutral-700 disabled:opacity-40">
                          {isSavingNote ? "Salvando..." : "Registrar"}
                        </button>
                      </div>
                    </form>
                    ) : null}
                    {(inscricao.notes ?? []).length > 0 && (
                      <div className="space-y-2">
                        {[...(inscricao.notes ?? [])].reverse().map((note) => (
                          <article key={note.id} className="rounded-xl border border-neutral-100 bg-white p-3">
                            <div className="mb-1.5 flex items-center gap-2">
                              <div className="h-5 w-5 rounded-full bg-neutral-200 text-[9px] font-bold text-neutral-500 flex items-center justify-center">{getInitials("Admin")}</div>
                              <span className="flex-1 text-[10px] text-neutral-400">{formatDateTime(note.createdAt)}</span>
                              {note.viaWhatsapp && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">WhatsApp</span>}
                            </div>
                            <p className="whitespace-pre-wrap text-sm text-neutral-800">{note.content}</p>
                          </article>
                        ))}
                      </div>
                    )}
                  </Section>
                  ) : null}

                  {/* ── TREINAMENTO ──────────────────────── */}
                  {(treinamentoDisplay.text || inscricao.recrutadorNome || inscricao.recrutadorCodigo) && (
                    <Section label="Treinamento">
                      {treinamentoDisplay.text && (
                        <div className="mb-3 inline-flex items-center gap-2 rounded-xl bg-neutral-900 px-4 py-2 text-sm font-bold text-white" title={treinamentoDisplay.rawDate ?? undefined}>
                          {treinamentoDisplay.text}
                        </div>
                      )}
                      {(inscricao.recrutadorNome || inscricao.recrutadorCodigo) && (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Indicado por</span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-semibold text-neutral-800">{humanizeName(inscricao.recrutadorNome)}</span>
                            {inscricao.recrutadorCodigo && (
                              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-bold text-neutral-500">{inscricao.recrutadorCodigo}</span>
                            )}
                          </div>
                          <div className="flex gap-2">
                            {inscricao.recrutadorUrl && (
                              <button type="button" onClick={copyRecruiterLink} className="text-xs text-blue-600 hover:underline">Copiar link</button>
                            )}
                            {(inscricao.codigoProprio ?? inscricao.recrutadorCodigo) && (
                              <button type="button" onClick={openNetworkView} className="text-xs text-blue-600 hover:underline">Ver rede</button>
                            )}
                          </div>
                        </div>
                      )}
                      {inscricao.codigoProprio && (
                        <div className="mt-2 flex items-center gap-2">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Cluster</span>
                          <span className="text-sm font-semibold text-neutral-800">{inscricao.codigoProprio}</span>
                        </div>
                      )}
                    </Section>
                  )}

                  {/* ── COMERCIAL ────────────────────────── */}
                  {inscricao.commercial && (
                    <Section label="Comercial">
                      {commercial ? (
                        <>
                          <div className="mb-2 flex items-center justify-between">
                            <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ${stageBadge(inscricao.commercial.stage).className}`}>
                              {stageBadge(inscricao.commercial.stage).label}
                            </span>
                          </div>
                          {commercialMessage && (
                            <p className="mb-2 rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-600">{commercialMessage}</p>
                          )}
                          <div className="space-y-2">
                            <select
                              value={inscricao.commercial.stage}
                              onChange={(e) => handleCommercialStageChange(e.target.value as CommercialStage)}
                              disabled={commercialSaving}
                              className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs font-semibold text-neutral-800 focus:border-cyan-400 focus:outline-none disabled:opacity-60"
                            >
                              {leadStageOptions.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                            </select>
                            {commercial.isSupervisor && (
                              <select
                                value={inscricao.commercial.assignedSellerId ?? ""}
                                onChange={(e) => handleCommercialAssign(e.target.value)}
                                disabled={commercialSaving}
                                className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs font-semibold text-neutral-800 focus:border-cyan-400 focus:outline-none disabled:opacity-60"
                              >
                                <option value="">Repassar para vendedor</option>
                                {commercial.sellers.map((s) => (
                                  <option key={s.chatwootUserId} value={s.chatwootUserId}>{s.name}{s.isSupervisor ? " (supervisor)" : ""}</option>
                                ))}
                              </select>
                            )}
                            {commercial.isSupervisor && commercial.funnels.length > 1 && (
                              <select
                                value=""
                                onChange={(e) => handleMoveFunnel(e.target.value)}
                                disabled={commercialSaving}
                                title="O lead entra na etapa de entrada do funil de destino."
                                className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs font-semibold text-neutral-800 focus:border-cyan-400 focus:outline-none disabled:opacity-60"
                              >
                                <option value="">Mover para outro funil</option>
                                {commercial.funnels
                                  .filter((f) => f.id !== leadFunnel?.id)
                                  .map((f) => (
                                    <option key={f.id} value={f.id}>{f.name}</option>
                                  ))}
                              </select>
                            )}
                            {hasFechamentoStage && (
                              <button
                                type="button"
                                onClick={() => handleCommercialStageChange("fechamento")}
                                disabled={commercialSaving || inscricao.commercial.stage === "fechamento"}
                                className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs font-semibold text-neutral-800 hover:bg-neutral-100 disabled:opacity-60"
                              >
                                Marcar como fechamento
                              </button>
                            )}
                          </div>
                        </>
                      ) : (
                        <div>
                          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Etapa</p>
                          <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ${stageBadge(inscricao.commercial.stage).className}`}>
                            {stageBadge(inscricao.commercial.stage).label}
                          </span>
                        </div>
                      )}
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <InfoCard label="Vendedor" value={inscricao.commercial.assignedSellerName ?? "Sem responsável"} />
                        <InfoCard label="Campanha" value={inscricao.commercial.campaignSource || "—"} sub={inscricao.commercial.campaignName ?? undefined} />
                        {inscricao.commercial.campaignTerm && (
                          <div className="col-span-2">
                            <InfoCard label="Criativo" value={inscricao.commercial.campaignTerm} />
                          </div>
                        )}
                        <div className="col-span-2">
                          <InfoCard label="Última atualização" value={formatDateTime(inscricao.statusUpdatedAt ?? inscricao.commercial.assignedAt)} />
                        </div>
                      </div>
                    </Section>
                  )}

                  {/* ── ETIQUETAS ────────────────────────── */}
                  {autoTags.length > 0 && (
                    <Section label={`Etiquetas · ${autoTags.length}`}>
                      <div className="flex flex-wrap gap-1.5">
                        {groupedAutoTags.flatMap((group) =>
                          group.tags.map((tag) => <TagBadge key={`${group.category}-${tag.key}`} tag={tag} size="xs" showCategory />)
                        )}
                      </div>
                    </Section>
                  )}

                  {/* ── PRESENÇA ─────────────────────────── */}
                  {inscricao.presencaValidada && !inscricao.isUpDayInscricao && isOnlineTraining(inscricao.treinamentoId) && (
                    <Section label="Presença no Encontro">
                      {(() => {
                        const totalDias = inscricao.presencaTotalDias ?? 1;
                        const days: { label: string; data: typeof inscricao.presencaDia1 }[] = [];
                        if (totalDias >= 2) {
                          if (inscricao.presencaDia1) days.push({ label: "Dia 1", data: inscricao.presencaDia1 });
                          if (inscricao.presencaDia2) days.push({ label: "Dia 2", data: inscricao.presencaDia2 });
                        }
                        if (days.length === 0) {
                          days.push({
                            label: "Geral",
                            data: {
                              participanteNome: inscricao.presencaParticipanteNome,
                              aprovado: inscricao.presencaAprovada,
                              tempoTotal: inscricao.presencaTempoTotalMinutos,
                              tempoDinamica: inscricao.presencaTempoDinamicaMinutos,
                              percentualDinamica: inscricao.presencaPercentualDinamica,
                              temDinamica: (inscricao.presencaTempoDinamicaMinutos ?? 0) > 0,
                            },
                          });
                        }
                        return (
                          <div className="space-y-2">
                            {days.map((day) => {
                              const d = day.data;
                              if (!d) return null;
                              return (
                                <div key={day.label} className="rounded-xl bg-neutral-50 p-3 ring-1 ring-neutral-100">
                                  <div className="mb-2.5 flex items-center justify-between">
                                    <span className="text-xs font-bold text-neutral-700">{day.label}</span>
                                    <div className="flex gap-1">
                                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${d.aprovado ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                                        {d.aprovado ? "Aprovado" : "Insuficiente"}
                                      </span>
                                      {d.temDinamica && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">Dinâmica</span>}
                                    </div>
                                  </div>
                                  <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                                    <PresenceCell label="Nome Zoom" value={d.participanteNome} />
                                    <PresenceCell label="Tempo total" value={d.tempoTotal != null ? formatPresenceTime(d.tempoTotal) : null} />
                                    <PresenceCell label="Dinâmica" value={d.tempoDinamica != null ? `${formatPresenceTime(d.tempoDinamica)}${d.percentualDinamica != null ? ` (${d.percentualDinamica}%)` : ""}` : null} />
                                    <PresenceCell label="Validado em" value={inscricao.presencaValidadaEm ? formatDateTime(inscricao.presencaValidadaEm) : null} />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </Section>
                  )}

                  {/* ── COLAPSÁVEIS ──────────────────────── */}
                  {inscricao.codigoProprio && (
                    <Collapsible label="Anamnese" badge={isLoadingAnamnese ? "..." : String(anamneses.length)}>
                      {isLoadingAnamnese ? (
                        <div className="flex justify-center py-6">
                          <div className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-200 border-t-neutral-600" />
                        </div>
                      ) : anamneses.length === 0 ? (
                        <p className="py-2 text-sm text-neutral-400">Nenhuma anamnese vinculada.</p>
                      ) : (
                        <div className="space-y-3">
                          {anamneses.map((a) => (
                            <div key={a.id} className="rounded-xl bg-neutral-50 p-3 ring-1 ring-neutral-100">
                              <p className="mb-2 text-[10px] text-neutral-400">
                                Enviada em {a.data_envio ? new Date(a.data_envio).toLocaleDateString("pt-BR") : "—"}
                              </p>
                              <div className="grid gap-2 sm:grid-cols-2">
                                {a.momento_atual && <AnamneseField label="Momento Atual" value={a.momento_atual} />}
                                {a.dificuldade_barreira && <AnamneseField label="Maior Dificuldade" value={a.dificuldade_barreira} />}
                                {a.maior_medo && <AnamneseField label="Maior Medo" value={a.maior_medo} />}
                                {a.tempo_disponivel && <AnamneseField label="Tempo Disponível" value={a.tempo_disponivel} />}
                                {a.visao_instituto && <AnamneseField label="Visão do Instituto" value={a.visao_instituto} />}
                                {a.visao_futuro && <AnamneseField label="Visão de Futuro" value={a.visao_futuro} />}
                                {a.contribuicao && <AnamneseField label="Contribuição" value={a.contribuicao} />}
                                {a.sonhos_objetivos && <AnamneseField label="Sonhos e Objetivos" value={a.sonhos_objetivos} />}
                                {a.o_que_falta && <AnamneseField label="O que Falta" value={a.o_que_falta} />}
                                {a.como_ajudar && <AnamneseField label="Como Podemos Ajudar" value={a.como_ajudar} />}
                                {a.renda_necessaria && <AnamneseField label="Renda Necessária" value={a.renda_necessaria} />}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </Collapsible>
                  )}

                  {inscricao.isUpDayInscricao && (() => {
                    const visibleUpDayFields = UP_DAY_DISPLAY_FIELDS
                      .map((f) => ({ ...f, value: inscricao.upDay[f.key] }))
                      .filter((f) => f.value !== null && f.value !== undefined && f.value !== "");
                    if (visibleUpDayFields.length === 0) return null;
                    return (
                      <Collapsible label="Inscrição UP Day" badge={String(visibleUpDayFields.length)}>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {visibleUpDayFields.map((f) => <DetailField key={f.key} label={f.label} value={formatFormValue(f.value)} />)}
                        </div>
                      </Collapsible>
                    );
                  })()}

                  {(inscricao.previousFormFields ?? []).length > 0 && (
                    <Collapsible label="Formulário anterior" badge={String(inscricao.previousFormFields!.length)}>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {inscricao.previousFormFields!.map((f) => <DetailField key={f.key} label={f.label} value={formatFormValue(f.value)} />)}
                      </div>
                    </Collapsible>
                  )}

                  {isOnlineTraining(inscricao.treinamentoId) && inscricao.treinamentoData && (
                    <Collapsible label="Chat do Encontro Online">
                      <EncontroChatView dataEncontro={inscricao.treinamentoData.slice(0, 10)} leadNome={inscricao.nome} />
                    </Collapsible>
                  )}

                  {/* ── DADOS TÉCNICOS DO FORMULÁRIO ─────── */}
                  {canViewHistory && hasFormTrackingFields(inscricao) ? (
                    <Section label="Dados técnicos do formulário">
                      <FormTrackingFields inscricao={inscricao} />
                    </Section>
                  ) : null}

                  <div className="h-6" />
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Local helpers ────────────────────────────────────────

function renderIconForLabel(label: string, size: number) {
  const normalized = label.toLowerCase();
  if (normalized.includes("linha do tempo")) return <History size={size} />;
  if (normalized.includes("origem")) return <Globe2 size={size} />;
  if (normalized.includes("nome") || normalized.includes("lead") || normalized.includes("vendedor")) return <UserRound size={size} />;
  if (normalized.includes("e-mail") || normalized.includes("email")) return <Mail size={size} />;
  if (normalized.includes("telefone") || normalized.includes("whatsapp")) return <Phone size={size} />;
  if (normalized.includes("cidade") || normalized.includes("estado")) return <MapPin size={size} />;
  if (normalized.includes("empresa")) return <Building2 size={size} />;
  if (normalized.includes("cargo") || normalized.includes("profissão")) return <BriefcaseBusiness size={size} />;
  if (normalized.includes("data")) return <CalendarDays size={size} />;
  if (normalized.includes("hora")) return <Clock3 size={size} />;
  if (normalized.includes("rota")) return <Route size={size} />;
  if (normalized.includes("campanha")) return <Flag size={size} />;
  return <FileText size={size} />;
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mx-3 mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.035)] sm:mx-7 sm:mt-5">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-8 flex-shrink-0 items-center justify-center rounded-lg bg-[#e5f8ff] text-[#0086b8]">
            {renderIconForLabel(label, 17)}
          </span>
          <h3 className="break-words text-base font-bold leading-tight text-slate-950">{label}</h3>
        </div>
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

function Collapsible({ label, badge, children }: { label: string; badge?: string; children: React.ReactNode }) {
  return (
    <details className="group mx-3 mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.035)] sm:mx-7 sm:mt-5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 border-b border-slate-200 px-4 py-4 hover:bg-[#f8fbfe] sm:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <svg className="h-3.5 w-3.5 flex-shrink-0 rotate-0 text-[#0086b8] transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <span className="break-words text-base font-bold leading-tight text-slate-950">{label}</span>
        </div>
        {badge !== undefined && <span className="rounded-full bg-[#e5f8ff] px-2.5 py-1 text-[11px] font-bold text-[#0086b8]">{badge}</span>}
      </summary>
      <div className="p-4 sm:p-5">{children}</div>
    </details>
  );
}

function InfoCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex min-w-0 gap-3 rounded-xl bg-white p-3 ring-1 ring-[#e5eef6]">
      <span className="flex size-10 flex-shrink-0 items-center justify-center rounded-full bg-[#e5f8ff] text-[#0086b8]">
        {renderIconForLabel(label, 18)}
      </span>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-slate-500">{label}</p>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm font-bold leading-snug text-slate-950">{value}</p>
        {sub && <p className="mt-0.5 whitespace-pre-wrap break-words text-xs font-medium leading-snug text-slate-400">{sub}</p>}
      </div>
    </div>
  );
}

function PresenceCell({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase text-slate-400">{label}</p>
      <p className="mt-0.5 break-words text-xs font-semibold text-slate-800">{value ?? "—"}</p>
    </div>
  );
}

function AnamneseField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white p-3 ring-1 ring-[#e5eef6]">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-800">{value}</p>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white p-3 ring-1 ring-[#e5eef6]">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-800">{value}</p>
    </div>
  );
}
