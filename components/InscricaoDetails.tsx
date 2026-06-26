"use client";

import { useEffect, useId, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { TagBadge } from "@/components/TagBadge";
import type { InscricaoItem, InscricaoStatus } from "@/types/inscricao";
import type { TrainingOption } from "@/types/training";
import type { ChatwootChannelOption } from "@/types/chatwoot";
import type { AnamneseResposta } from "@/lib/anamnese";
import { formatFormValue, UP_DAY_DISPLAY_FIELDS } from "@/lib/inscricaoForm";
import { buildOperationalTags, groupParticipantTags, isOnlineTraining } from "@/lib/participantTags";
import { buildChatwootOpenChatUrl, humanizeName } from "@/lib/utils";
import { EncontroChatView } from "@/components/EncontroChatView";

interface RecruiterOption {
  code: string;
  name: string;
}

interface InscricaoDetailsProps {
  inscricao: InscricaoItem | null;
  onClose: () => void;
  onUpdate?: (inscricao: InscricaoItem) => void;
  trainingOptions: TrainingOption[];
  recruiterOptions: RecruiterOption[];
  chatwootChannels?: ChatwootChannelOption[];
  selectedChatwootInboxId?: string;
  onChatwootInboxIdChange?: (inboxId: string) => void;
  onDelete?: (id: number) => void;
}

interface FormState {
  nome: string;
  telefone: string;
  cidade: string;
  indicacao: string;
  treinamento: string;
}

function buildInitialFormState(inscricao: InscricaoItem | null): FormState {
  return {
    nome: inscricao?.nome ?? "",
    telefone: inscricao?.telefone ?? "",
    cidade: inscricao?.cidade ?? "",
    indicacao: inscricao?.recrutadorCodigo ?? "",
    treinamento: inscricao?.treinamentoId ?? "",
  };
}

function formatTrainingDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fmtEvolutionStatus(channel?: ChatwootChannelOption | null): string {
  if (!channel || channel.evolutionStatus === "unknown") return "";
  if (channel.evolutionStatus === "open") return "online";
  if (channel.evolutionStatus === "connecting") return "conectando";
  return "offline";
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatRelativeTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "agora";
  if (mins < 60) return `${mins}min atrás`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h atrás`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d atrás`;
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
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

export default function InscricaoDetails({
  inscricao,
  onClose,
  onUpdate,
  trainingOptions,
  recruiterOptions,
  chatwootChannels = [],
  selectedChatwootInboxId = "",
  onChatwootInboxIdChange,
  onDelete,
}: InscricaoDetailsProps) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState<InscricaoStatus | null>(null);
  const [formState, setFormState] = useState<FormState>(() => buildInitialFormState(inscricao));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [noteContent, setNoteContent] = useState("");
  const [noteWhatsapp, setNoteWhatsapp] = useState(false);
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [anamneses, setAnamneses] = useState<AnamneseResposta[]>([]);
  const [isLoadingAnamnese, setIsLoadingAnamnese] = useState(false);
  const [starsHover, setStarsHover] = useState(0);
  const [starsSaving, setStarsSaving] = useState(false);
  const recruiterFieldId = useId();

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    if (inscricao) window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [inscricao, onClose]);

  useEffect(() => {
    if (!inscricao) return;
    setFormState(buildInitialFormState(inscricao));
    setIsEditing(false);
    setIsSaving(false);
    setIsDeleting(false);
    setStatusUpdating(null);
    setErrorMessage(null);
    setSuccessMessage(null);
    setNoteContent("");
    setNoteWhatsapp(false);
    setIsSavingNote(false);
    setAnamneses([]);
    setIsLoadingAnamnese(false);
  }, [inscricao]);

  useEffect(() => {
    if (!inscricao?.codigoProprio) { setAnamneses([]); return; }
    const fetch_ = async () => {
      setIsLoadingAnamnese(true);
      try {
        const r = await fetch(`/api/anamnese/${encodeURIComponent(inscricao.codigoProprio!)}`);
        if (r.ok) { const d = await r.json(); setAnamneses(d.anamneses ?? []); }
      } catch { /* ignore */ } finally { setIsLoadingAnamnese(false); }
    };
    fetch_();
  }, [inscricao?.codigoProprio]);

  const createdAt = useMemo(() => {
    if (!inscricao) return "";
    return new Date(inscricao.criadoEm).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }, [inscricao]);

  const trainingOptionsById = useMemo(() => {
    return trainingOptions.reduce<Record<string, TrainingOption>>((acc, o) => { acc[o.id] = o; return acc; }, {});
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

  const avatarColor = useMemo(() => {
    const map: Record<string, string> = {
      emerald: "bg-emerald-500",
      rose: "bg-rose-500",
      amber: "bg-amber-500",
      blue: "bg-blue-500",
      neutral: "bg-neutral-400",
    };
    return map[statusInfo.color] ?? "bg-neutral-400";
  }, [statusInfo.color]);

  const statusBadgeClass = useMemo(() => {
    const map: Record<string, string> = {
      emerald: "bg-emerald-100 text-emerald-800",
      rose: "bg-rose-100 text-rose-700",
      amber: "bg-amber-100 text-amber-800",
      blue: "bg-blue-100 text-blue-800",
      neutral: "bg-neutral-100 text-neutral-600",
    };
    return map[statusInfo.color] ?? "bg-neutral-100 text-neutral-600";
  }, [statusInfo.color]);

  const autoTags = useMemo(() => inscricao ? buildOperationalTags(inscricao) : [], [inscricao]);
  const groupedAutoTags = useMemo(() => groupParticipantTags(autoTags), [autoTags]);

  if (!inscricao) return null;

  const notes = inscricao.notes ?? [];
  const isLead = inscricao.tipo !== "recrutador";
  const isOnlineInscricao = !inscricao.isUpDayInscricao && isOnlineTraining(inscricao.treinamentoId);
  const visibleUpDayFields = UP_DAY_DISPLAY_FIELDS
    .map((f) => ({ ...f, value: inscricao.upDay[f.key] }))
    .filter((f) => f.value !== null && f.value !== undefined && f.value !== "");
  const previousFormFields = inscricao.previousFormFields ?? [];

  const hasTrainingOption = formState.treinamento ? Boolean(trainingOptionsById[formState.treinamento]) : false;
  const fallbackTrainingOptionLabel = !hasTrainingOption && formState.treinamento
    ? formatTrainingDate(inscricao.treinamentoData ?? formState.treinamento) ?? formState.treinamento : null;
  const fallbackTrainingOptionTitle = !hasTrainingOption && formState.treinamento
    ? inscricao.treinamentoData ?? formState.treinamento : null;
  const recruiterDatalistId = `${recruiterFieldId}-recruiters`;

  async function handleDelete() {
    if (!inscricao || isDeleting) return;
    if (!window.confirm("Tem certeza de que deseja excluir esta inscrição?")) return;
    setIsDeleting(true); setErrorMessage(null); setSuccessMessage(null);
    try {
      const r = await fetch(`/api/inscricoes/${inscricao.id}`, { method: "DELETE" });
      if (!r.ok) {
        const d = (await r.json().catch(() => null)) as { error?: string } | null;
        setErrorMessage(d?.error ?? "Não foi possível excluir a inscrição."); return;
      }
      onDelete?.(inscricao.id); onClose(); router.refresh();
    } catch { setErrorMessage("Erro inesperado ao excluir a inscrição."); }
    finally { setIsDeleting(false); }
  }

  async function copyRecruiterLink() {
    if (inscricao?.recrutadorUrl) {
      try { await navigator.clipboard.writeText(inscricao.recrutadorUrl); } catch { /* ignore */ }
    }
  }

  function openNetworkView() {
    if (!inscricao) return;
    const targetCode = inscricao.codigoProprio ?? inscricao.recrutadorCodigo;
    if (!targetCode) return;
    router.push(`/rede?${new URLSearchParams({ focus: targetCode }).toString()}`);
    onClose();
  }

  function handleFieldChange(e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value } = e.target;
    setFormState((p) => ({ ...p, [name]: value }));
  }

  function cancelEditing() {
    setFormState(buildInitialFormState(inscricao));
    setIsEditing(false); setErrorMessage(null); setSuccessMessage(null);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!inscricao) return;
    setIsSaving(true); setErrorMessage(null); setSuccessMessage(null);
    try {
      const r = await fetch(`/api/inscricoes/${inscricao.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: formState.nome, telefone: formState.telefone, cidade: formState.cidade, indicacao: formState.indicacao, treinamento: formState.treinamento }),
      });
      if (!r.ok) {
        const d = (await r.json().catch(() => null)) as { error?: string } | null;
        setErrorMessage(d?.error ?? "Não foi possível atualizar a inscrição."); return;
      }
      const d = (await r.json()) as { inscricao?: InscricaoItem };
      const updated = d.inscricao ?? inscricao;
      setFormState(buildInitialFormState(updated));
      setIsEditing(false); setSuccessMessage("Alterações salvas.");
      onUpdate?.(updated); router.refresh();
    } catch { setErrorMessage("Erro inesperado ao salvar."); }
    finally { setIsSaving(false); }
  }

  async function handleStatusChange(nextStatus: InscricaoStatus) {
    if (!inscricao || statusUpdating === nextStatus || !isLead) return;
    let whatsappContacted: boolean | undefined;
    if (nextStatus === "aprovado" || nextStatus === "rejeitado") {
      whatsappContacted = window.confirm("Você já entrou em contato no WhatsApp?");
    }
    setStatusUpdating(nextStatus); setErrorMessage(null); setSuccessMessage(null);
    try {
      const r = await fetch(`/api/inscricoes/${inscricao.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus, whatsappContacted }),
      });
      if (!r.ok) {
        const d = (await r.json().catch(() => null)) as { error?: string } | null;
        setErrorMessage(d?.error ?? "Não foi possível atualizar o status."); return;
      }
      const d = (await r.json()) as { inscricao?: InscricaoItem };
      onUpdate?.(d.inscricao ?? inscricao);
    } catch { setErrorMessage("Erro ao atualizar status."); }
    finally { setStatusUpdating(null); }
  }

  async function handleNoteSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!inscricao || !noteContent.trim() || isSavingNote) return;
    setIsSavingNote(true); setErrorMessage(null);
    try {
      const r = await fetch(`/api/inscricoes/${inscricao.id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: noteContent, viaWhatsapp: noteWhatsapp }),
      });
      if (!r.ok) {
        const d = (await r.json().catch(() => null)) as { error?: string } | null;
        setErrorMessage(d?.error ?? "Não foi possível salvar a anotação."); return;
      }
      const d = (await r.json()) as { inscricao?: InscricaoItem };
      onUpdate?.(d.inscricao ?? inscricao);
      setNoteContent(""); setNoteWhatsapp(false);
    } catch { setErrorMessage("Erro ao salvar anotação."); }
    finally { setIsSavingNote(false); }
  }

  async function handleStarClick(value: number) {
    if (!inscricao || starsSaving) return;
    const nextValue = inscricao.stars === value ? null : value;
    setStarsSaving(true);
    try {
      const r = await fetch(`/api/inscricoes/${inscricao.id}/stars`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stars: nextValue ?? 0 }),
      });
      if (!r.ok) {
        const d = (await r.json().catch(() => null)) as { error?: string } | null;
        setErrorMessage(d?.error ?? "Erro ao salvar avaliação."); return;
      }
      const d = (await r.json()) as { inscricao?: InscricaoItem };
      if (d.inscricao) onUpdate?.(d.inscricao);
    } catch { setErrorMessage("Erro ao salvar avaliação."); }
    finally { setStarsSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <div
        className="flex-1 bg-black/30 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Right Panel */}
      <div className="flex h-full w-full max-w-[520px] flex-col bg-white shadow-2xl ring-1 ring-black/5">

        {/* ── STICKY HEADER ─────────────────────────────── */}
        <div className="flex flex-shrink-0 flex-col border-b border-neutral-100 bg-white">
          {/* Top bar */}
          <div className="flex items-center gap-3 px-5 py-4">
            {/* Avatar */}
            <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${avatarColor}`}>
              {getInitials(inscricao.nome)}
            </div>

            {/* Name + meta */}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <h2 className="truncate text-[15px] font-bold leading-tight text-neutral-900">
                  {humanizeName(inscricao.nome) ?? "Sem nome"}
                </h2>
                <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${statusBadgeClass}`}>
                  {statusInfo.label}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-neutral-400">
                #{inscricao.id} · {createdAt}
              </p>
            </div>

            {/* Actions */}
            <div className="flex flex-shrink-0 items-center gap-1.5">
              {isEditing ? (
                <button
                  type="button"
                  onClick={cancelEditing}
                  disabled={isSaving}
                  className="h-8 rounded-lg border border-neutral-200 px-3 text-xs font-semibold text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
                >
                  Cancelar
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => { setIsEditing(true); setErrorMessage(null); setSuccessMessage(null); }}
                  className="h-8 rounded-lg border border-neutral-200 px-3 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
                >
                  Editar
                </button>
              )}
              <button
                type="button"
                onClick={handleDelete}
                disabled={isSaving || isDeleting}
                className="h-8 rounded-lg border border-red-100 bg-red-50 px-3 text-xs font-semibold text-red-600 hover:bg-red-100 disabled:opacity-50"
              >
                {isDeleting ? "..." : "Excluir"}
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label="Fechar"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Status + Stars bar */}
          {isLead && (
            <div className="flex items-center justify-between gap-4 border-t border-neutral-100 px-5 py-2.5">
              <div className="flex gap-1">
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
                      disabled={statusUpdating !== null}
                      onClick={() => handleStatusChange(s)}
                      className={`h-7 rounded-lg border px-2.5 text-[11px] font-semibold transition ${colors[s]} disabled:opacity-50`}
                    >
                      {statusUpdating === s ? "..." : labels[s]}
                    </button>
                  );
                })}
              </div>
              <div
                className="flex gap-0.5"
                onMouseLeave={() => setStarsHover(0)}
              >
                {[1, 2, 3, 4, 5].map((star) => {
                  const filled = starsHover > 0 ? star <= starsHover : star <= (inscricao.stars ?? 0);
                  return (
                    <button
                      key={star}
                      type="button"
                      disabled={starsSaving}
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

        {/* ── SCROLLABLE BODY ───────────────────────────── */}
        <div className="flex-1 overflow-y-auto">

          {/* Feedback banners */}
          {(errorMessage || successMessage) && (
            <div className="px-5 pt-4">
              {errorMessage && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">{errorMessage}</p>}
              {successMessage && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 ring-1 ring-emerald-200">{successMessage}</p>}
            </div>
          )}

          {/* ── CONTACT ───────────────────────────────── */}
          <Section label="Contato">
            {isEditing ? (
              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Nome completo">
                    <input name="nome" value={formState.nome} onChange={handleFieldChange} disabled={isSaving} placeholder="Nome" className={inputClass} />
                  </Field>
                  <Field label="Telefone">
                    <input name="telefone" value={formState.telefone} onChange={handleFieldChange} disabled={isSaving} placeholder="DDD + número" className={inputClass} />
                  </Field>
                  <Field label="Cidade">
                    <input name="cidade" value={formState.cidade} onChange={handleFieldChange} disabled={isSaving} placeholder="Cidade" className={inputClass} />
                  </Field>
                  <Field label="Treinamento">
                    <select name="treinamento" value={formState.treinamento} onChange={handleFieldChange} disabled={isSaving} className={inputClass}>
                      <option value="">Nenhum</option>
                      {fallbackTrainingOptionLabel && (
                        <option value={formState.treinamento} title={fallbackTrainingOptionTitle ?? undefined}>{fallbackTrainingOptionLabel}</option>
                      )}
                      {trainingOptions.map((o) => {
                        const d = formatTrainingDate(o.startsAt);
                        return <option key={o.id} value={o.id} title={o.startsAt ?? undefined}>{d ?? o.label ?? o.id}</option>;
                      })}
                    </select>
                  </Field>
                </div>
                <Field label="Indicador">
                  <input name="indicacao" value={formState.indicacao} onChange={handleFieldChange} disabled={isSaving} placeholder="Código do indicador" className={inputClass} list={recruiterDatalistId} />
                  <datalist id={recruiterDatalistId}>
                    {recruiterOptions.map((r) => <option key={r.code} value={r.code} label={`${r.name} (${r.code})`} />)}
                  </datalist>
                  <p className="mt-1 text-[10px] text-neutral-400">Deixe em branco para remover</p>
                </Field>
                <div className="flex justify-end pt-1">
                  <button type="submit" disabled={isSaving} className="rounded-lg bg-neutral-900 px-5 py-2 text-xs font-semibold text-white hover:bg-neutral-700 disabled:opacity-50">
                    {isSaving ? "Salvando..." : "Salvar alterações"}
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-4">
                {/* Phone + WhatsApp */}
                {inscricao.telefone ? (
                  <div>
                    {chatwootChannels.length > 0 && (
                      <select
                        value={selectedChatwootInboxId}
                        onChange={(e) => onChatwootInboxIdChange?.(e.target.value)}
                        className="mb-2 w-full rounded-md border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-xs text-neutral-700 focus:border-blue-400 focus:outline-none"
                      >
                        <option value="">Selecionar canal WhatsApp</option>
                        {chatwootChannels.map((ch) => (
                          <option key={ch.id} value={ch.id}>
                            {ch.name}{fmtEvolutionStatus(ch) ? ` · ${fmtEvolutionStatus(ch)}` : ""}
                          </option>
                        ))}
                      </select>
                    )}
                    <a
                      href={buildChatwootOpenChatUrl(inscricao.id, selectedChatwootInboxId)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#25D366] py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1ebe5c] active:scale-[0.98]"
                    >
                      <svg className="h-4 w-4 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                      </svg>
                      Abrir conversa · {inscricao.telefone}
                    </a>
                  </div>
                ) : (
                  <p className="rounded-lg bg-neutral-50 px-3 py-2 text-sm text-neutral-400 ring-1 ring-neutral-100">Sem telefone cadastrado</p>
                )}

                {/* City */}
                {inscricao.cidade && (
                  <div className="flex items-center gap-2 text-sm text-neutral-700">
                    <svg className="h-3.5 w-3.5 flex-shrink-0 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <span className="font-medium">{inscricao.cidade}</span>
                  </div>
                )}
              </div>
            )}
          </Section>

          {/* ── TREINAMENTO ────────────────────────────── */}
          {!isEditing && (treinamentoDisplay.text || inscricao.recrutadorNome || inscricao.recrutadorCodigo) && (
            <Section label="Treinamento">
              {treinamentoDisplay.text && (
                <div className="mb-3 inline-flex items-center gap-2 rounded-xl bg-neutral-900 px-4 py-2 text-sm font-bold text-white" title={treinamentoDisplay.rawDate ?? undefined}>
                  <svg className="h-3.5 w-3.5 flex-shrink-0 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
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

          {/* ── ETIQUETAS ──────────────────────────────── */}
          {autoTags.length > 0 && (
            <Section label={`Etiquetas · ${autoTags.length}`}>
              <div className="flex flex-wrap gap-1.5">
                {groupedAutoTags.flatMap((group) =>
                  group.tags.map((tag) => (
                    <TagBadge key={`${group.category}-${tag.key}`} tag={tag} size="xs" showCategory />
                  ))
                )}
              </div>
            </Section>
          )}

          {/* ── PRESENÇA ───────────────────────────────── */}
          {inscricao.presencaValidada && isOnlineInscricao && (
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
                              {d.temDinamica && (
                                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">Dinâmica</span>
                              )}
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

          {/* ── ANOTAÇÕES ──────────────────────────────── */}
          <Section label={`Anotações · ${notes.length}`}>
            {/* Add note */}
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
                  <input
                    type="checkbox"
                    checked={noteWhatsapp}
                    onChange={(e) => setNoteWhatsapp(e.target.checked)}
                    disabled={isSavingNote}
                    className="h-3.5 w-3.5 rounded border-neutral-300"
                  />
                  Via WhatsApp
                </label>
                <button
                  type="submit"
                  disabled={isSavingNote || !noteContent.trim()}
                  className="rounded-lg bg-neutral-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-neutral-700 disabled:opacity-40"
                >
                  {isSavingNote ? "Salvando..." : "Registrar"}
                </button>
              </div>
            </form>

            {/* Notes list */}
            {notes.length > 0 && (
              <div className="space-y-2">
                {[...notes].reverse().map((note) => (
                  <article key={note.id} className="rounded-xl border border-neutral-100 bg-white p-3">
                    <div className="mb-1.5 flex items-center gap-2">
                      <div className="h-5 w-5 rounded-full bg-neutral-200 text-[9px] font-bold text-neutral-500 flex items-center justify-center">
                        {getInitials("Admin")}
                      </div>
                      <span className="flex-1 text-[10px] text-neutral-400">{formatDateTime(note.createdAt)}</span>
                      {note.viaWhatsapp && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">WhatsApp</span>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-neutral-800">{note.content}</p>
                  </article>
                ))}
              </div>
            )}
          </Section>

          {/* ── COLAPSÁVEIS ────────────────────────────── */}
          {inscricao.codigoProprio && (
            <Collapsible
              label="Anamnese"
              badge={isLoadingAnamnese ? "..." : String(anamneses.length)}
            >
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

          {inscricao.isUpDayInscricao && visibleUpDayFields.length > 0 && (
            <Collapsible label="Inscrição UP Day" badge={String(visibleUpDayFields.length)}>
              <div className="grid gap-2 sm:grid-cols-2">
                {visibleUpDayFields.map((f) => (
                  <DetailField key={f.key} label={f.label} value={formatFormValue(f.value)} />
                ))}
              </div>
            </Collapsible>
          )}

          {previousFormFields.length > 0 && (
            <Collapsible label="Formulário anterior" badge={String(previousFormFields.length)}>
              <div className="grid gap-2 sm:grid-cols-2">
                {previousFormFields.map((f) => (
                  <DetailField key={f.key} label={f.label} value={formatFormValue(f.value)} />
                ))}
              </div>
            </Collapsible>
          )}

          <Collapsible label="Dados do formulário">
            {(() => {
              const ignored = new Set([
                'source','traffic_source','utm_source','utm_medium','utm_campaign','utm_content','utm_term',
                'ip','user_agent','referrer','referer','fbclid','gclid','origin','origem',
                'parentId','sponsorId','indicadorId','recrutadorId','nivel','isRecruiter',
                'codigoRecrutador','tipo','type','formId','pageUrl','pageTitle',
                'presenca_validada','presenca_aprovada','presenca_participante_nome','presenca_status',
                'presenca_tempo_total_minutos','presenca_tempo_dinamica_minutos','presenca_percentual_dinamica',
                'presenca_treinamento_id','presenca_validada_em','statusWhatsappContacted',
                'cookies','session','token','device','browser','platform','id','ID',
                'dados_extras','dadosExtras','_final','_step','fbc','fbp',
                'rg','cpf','endereco','data_nascimento','estado_civil','estado_civil_outro',
                'profissao_area','contato_emergencia','medicamentos_tratamento','tamanho_camiseta',
                'pagamento_info_visualizada','multa_ciente','cancelamento_ciente',
                'indicacao','treinamento_nome','data_treinamento','data_treinamento_extenso',
                'treinamento_inicio','treinamento_fim',
                'ansiedade','sono','vida_financeira','areas_melhoria','sintomas_fisicos',
                'sintomas_emocionais','gatilhos_ansiedade','tentativas_anteriores',
                'saude_fisica','relacionamento','relacionamentos_familiares','comentarios_adicionais',
              ]);
              const labels: Record<string, string> = {
                nome:'Nome', name:'Nome', telefone:'Telefone', phone:'Telefone', celular:'Celular',
                whatsapp:'WhatsApp', email:'E-mail', cidade:'Cidade', city:'Cidade', estado:'Estado',
                state:'Estado', uf:'UF', profissao:'Profissão', profession:'Profissão', ocupacao:'Ocupação',
                treinamento:'Treinamento', training:'Treinamento', timestamp:'Data', created_at:'Data',
                idade:'Idade', age:'Idade', sexo:'Sexo', genero:'Gênero', gender:'Gênero',
                como_conheceu:'Como nos Conheceu', observacao:'Observação', mensagem:'Mensagem',
                message:'Mensagem', interesse:'Interesse', objetivo:'Objetivo',
                disponibilidade:'Disponibilidade', horario:'Horário', empresa:'Empresa',
                cargo:'Cargo', escolaridade:'Escolaridade', formacao:'Formação',
              };
              const fmt = (v: unknown): string => {
                if (v === null || v === undefined || v === '') return '—';
                if (typeof v === 'string') {
                  if (/^\d{4}-\d{2}-\d{2}(T|\s)\d{2}:\d{2}/.test(v)) {
                    const d = new Date(v);
                    if (!Number.isNaN(d.getTime())) return d.toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
                  }
                  return v;
                }
                if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
                if (typeof v === 'number') return String(v);
                if (Array.isArray(v)) return v.map(fmt).join(', ');
                if (typeof v === 'object') return Object.entries(v as Record<string, unknown>).filter(([k]) => !ignored.has(k)).map(([,val]) => fmt(val)).join(', ') || '—';
                return String(v);
              };
              const fmtLabel = (key: string) => {
                const lk = key.toLowerCase();
                if (labels[lk]) return labels[lk];
                return key.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim();
              };
              const shouldIgnore = (key: string) => {
                const lk = key.toLowerCase();
                if (ignored.has(key) || ignored.has(lk)) return true;
                if (/^(entry\.|hidden_|field_|utm_|_|__|fb)/.test(lk)) return true;
                if (lk.startsWith('presenca')) return true;
                return false;
              };
              const entries = Object.entries(inscricao.payload).filter(([k, v]) => !shouldIgnore(k) && v !== null && v !== undefined && v !== '');
              if (entries.length === 0) return <p className="py-2 text-sm text-neutral-400">Nenhum dado adicional.</p>;
              return (
                <div className="grid gap-2 sm:grid-cols-2">
                  {entries.map(([key, val]) => (
                    <DetailField key={key} label={fmtLabel(key)} value={fmt(val)} />
                  ))}
                </div>
              );
            })()}
          </Collapsible>

          {isOnlineTraining(inscricao.treinamentoId) && inscricao.treinamentoData && (
            <Collapsible label="Chat do Encontro Online">
              <EncontroChatView
                dataEncontro={inscricao.treinamentoData.slice(0, 10)}
                leadNome={inscricao.nome}
              />
            </Collapsible>
          )}

          <div className="h-6" />
        </div>
      </div>
    </div>
  );
}

// ── Local helpers ────────────────────────────────────────

const inputClass =
  "w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-800 placeholder:text-neutral-400 focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-100";

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-neutral-100 px-5 py-4">
      <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-neutral-400">{label}</p>
      {children}
    </div>
  );
}

function Collapsible({ label, badge, children }: { label: string; badge?: string; children: React.ReactNode }) {
  return (
    <details className="group border-b border-neutral-100">
      <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3 hover:bg-neutral-50">
        <div className="flex items-center gap-2">
          <svg className="h-3.5 w-3.5 flex-shrink-0 rotate-0 text-neutral-400 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">{label}</span>
        </div>
        {badge !== undefined && (
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-bold text-neutral-500">{badge}</span>
        )}
      </summary>
      <div className="px-5 pb-4 pt-1">
        {children}
      </div>
    </details>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{label}</span>
      {children}
    </div>
  );
}

function PresenceCell({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase text-neutral-400">{label}</p>
      <p className="mt-0.5 text-xs font-medium text-neutral-800">{value ?? "—"}</p>
    </div>
  );
}

function AnamneseField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white p-2.5 ring-1 ring-neutral-100">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{label}</p>
      <p className="mt-0.5 text-sm text-neutral-800">{value}</p>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-neutral-50 p-2.5 ring-1 ring-neutral-100">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{label}</p>
      <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-neutral-800">{value}</p>
    </div>
  );
}
