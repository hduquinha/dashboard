"use client";

import { useEffect, useId, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { InscricaoItem, InscricaoStatus } from "@/types/inscricao";
import type { TrainingOption } from "@/types/training";
import type { AnamneseResposta } from "@/lib/anamnese";

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
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatPresenceTime(minutes: number): string {
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}min` : `${hours}h`;
}

export default function InscricaoDetails({
  inscricao,
  onClose,
  onUpdate,
  trainingOptions,
  recruiterOptions,
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
  const recruiterFieldId = useId();

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    if (inscricao) {
      window.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [inscricao, onClose]);

  useEffect(() => {
    if (!inscricao) {
      return;
    }

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

  // Carregar anamnese quando a inscrição é de um recrutador (tem código próprio)
  useEffect(() => {
    if (!inscricao || !inscricao.codigoProprio) {
      setAnamneses([]);
      return;
    }

    const fetchAnamnese = async () => {
      setIsLoadingAnamnese(true);
      try {
        const response = await fetch(`/api/anamnese/${encodeURIComponent(inscricao.codigoProprio!)}`);
        if (response.ok) {
          const data = await response.json();
          setAnamneses(data.anamneses ?? []);
        }
      } catch (error) {
        console.error("Failed to load anamnese:", error);
      } finally {
        setIsLoadingAnamnese(false);
      }
    };

    fetchAnamnese();
  }, [inscricao?.codigoProprio]);

  const createdAt = useMemo(() => {
    if (!inscricao) {
      return "";
    }

    return new Date(inscricao.criadoEm).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }, [inscricao]);

  const trainingOptionsById = useMemo(() => {
    return trainingOptions.reduce<Record<string, TrainingOption>>((accumulator, option) => {
      accumulator[option.id] = option;
      return accumulator;
    }, {});
  }, [trainingOptions]);

  const treinamentoDisplay = useMemo(() => {
    if (!inscricao) {
      return {
        text: "",
        rawDate: null as string | null,
      };
    }

    const id = inscricao.treinamentoId ?? "";
    const match = id ? trainingOptionsById[id] : undefined;
    const rawDate = inscricao.treinamentoData ?? match?.startsAt ?? null;
    const formattedDate = formatTrainingDate(rawDate ?? id);
    const fallbackLabel =
      inscricao.treinamentoNome ?? match?.label ?? (id.length > 0 ? id : "");
    const text = formattedDate ?? fallbackLabel;

    return { text, rawDate };
  }, [inscricao, trainingOptionsById]);

  const statusBadge = useMemo(() => {
    if (!inscricao) {
      return { label: "-", className: "bg-neutral-200 text-neutral-700" };
    }
    if (inscricao.tipo === "recrutador") {
      return { label: "Cluster", className: "bg-emerald-100 text-emerald-800" };
    }
    switch (inscricao.status) {
      case "aprovado":
        return { label: "Aprovado", className: "bg-emerald-100 text-emerald-800" };
      case "rejeitado":
        return { label: "Rejeitado", className: "bg-rose-100 text-rose-700" };
      default:
        return { label: "Aguardando", className: "bg-amber-100 text-amber-700" };
    }
  }, [inscricao]);

  if (!inscricao) {
    return null;
  }

  const notes = inscricao.notes ?? [];
  const isLead = inscricao.tipo !== "recrutador";

  const hasTrainingOption = formState.treinamento
    ? Boolean(trainingOptionsById[formState.treinamento])
    : false;
  const fallbackTrainingOptionLabel = !hasTrainingOption && formState.treinamento
    ? formatTrainingDate(inscricao.treinamentoData ?? formState.treinamento) ?? formState.treinamento
    : null;
  const fallbackTrainingOptionTitle = !hasTrainingOption && formState.treinamento
    ? inscricao.treinamentoData ?? formState.treinamento
    : null;
  const recruiterDatalistId = `${recruiterFieldId}-recruiters`;

  async function handleDelete() {
    if (!inscricao || isDeleting) {
      return;
    }

    const confirmed = window.confirm("Tem certeza de que deseja excluir esta inscrição?");
    if (!confirmed) {
      return;
    }

    setIsDeleting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const response = await fetch(`/api/inscricoes/${inscricao.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        const message = data?.error ?? "Não foi possível excluir a inscrição.";
        setErrorMessage(message);
        return;
      }

      onDelete?.(inscricao.id);
      onClose();
      router.refresh();
    } catch (error) {
      console.error("Failed to delete inscrição", error);
      setErrorMessage("Erro inesperado ao excluir a inscrição.");
    } finally {
      setIsDeleting(false);
    }
  }

  async function copyRecruiterLink() {
    if (!inscricao || !inscricao.recrutadorUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(inscricao.recrutadorUrl);
    } catch (error) {
      console.error("Failed to copy recruiter link", error);
    }
  }

  function openNetworkView() {
    if (!inscricao) {
      return;
    }

    const targetCode = inscricao.codigoProprio ?? inscricao.recrutadorCodigo;
    if (!targetCode) {
      return;
    }

    const params = new URLSearchParams({ focus: targetCode });
    router.push(`/rede?${params.toString()}`);
    onClose();
  }

  function handleFieldChange(event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value } = event.target;
    setFormState((previous) => ({ ...previous, [name]: value }));
  }

  function cancelEditing() {
    setFormState(buildInitialFormState(inscricao));
    setIsEditing(false);
    setErrorMessage(null);
    setSuccessMessage(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!inscricao) {
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const response = await fetch(`/api/inscricoes/${inscricao.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          nome: formState.nome,
          telefone: formState.telefone,
          cidade: formState.cidade,
          indicacao: formState.indicacao,
          treinamento: formState.treinamento,
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        const message = data?.error ?? "Não foi possível atualizar a inscrição.";
        setErrorMessage(message);
        return;
      }

      const data = (await response.json()) as { inscricao?: InscricaoItem };
      const updated = data.inscricao ?? inscricao;

      setFormState(buildInitialFormState(updated));
      setIsEditing(false);
      setSuccessMessage("Alterações salvas com sucesso.");
      onUpdate?.(updated);
      router.refresh();
    } catch (error) {
      console.error("Failed to update inscrição", error);
      setErrorMessage("Erro inesperado ao salvar as alterações.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleStatusChange(nextStatus: InscricaoStatus) {
    if (!inscricao || statusUpdating === nextStatus) {
      return;
    }

    if (!isLead) {
      return;
    }

    let whatsappContacted: boolean | undefined = undefined;
    if (nextStatus === "aprovado" || nextStatus === "rejeitado") {
      const confirmed = window.confirm("Você já entrou em contato com este lead no WhatsApp? Clique em OK para confirmar que sim.");
      whatsappContacted = confirmed;
    }

    setStatusUpdating(nextStatus);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const response = await fetch(`/api/inscricoes/${inscricao.id}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: nextStatus, whatsappContacted }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        const message = data?.error ?? "Não foi possível atualizar o status.";
        setErrorMessage(message);
        return;
      }

      const data = (await response.json()) as { inscricao?: InscricaoItem };
      const updated = data.inscricao ?? inscricao;
      onUpdate?.(updated);
      setSuccessMessage("Status atualizado com sucesso.");
    } catch (error) {
      console.error("Failed to update status", error);
      setErrorMessage("Erro inesperado ao atualizar o status.");
    } finally {
      setStatusUpdating(null);
    }
  }

  async function handleNoteSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!inscricao || !noteContent.trim() || isSavingNote) {
      return;
    }

    setIsSavingNote(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const response = await fetch(`/api/inscricoes/${inscricao.id}/notes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: noteContent, viaWhatsapp: noteWhatsapp })
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        const message = data?.error ?? "Não foi possível salvar a anotação.";
        setErrorMessage(message);
        return;
      }

      const data = (await response.json()) as { inscricao?: InscricaoItem };
      const updated = data.inscricao ?? inscricao;
      onUpdate?.(updated);
      setNoteContent("");
      setNoteWhatsapp(false);
      setSuccessMessage("Anotação registrada.");
    } catch (error) {
      console.error("Failed to add note", error);
      setErrorMessage("Erro inesperado ao salvar a anotação.");
    } finally {
      setIsSavingNote(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="my-4 flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-2xl sm:my-8 sm:max-h-[calc(100vh-4rem)]"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex flex-shrink-0 flex-wrap items-start justify-between gap-4 rounded-t-2xl border-b border-neutral-200 bg-gradient-to-r from-[#0f172a] to-[#1e293b] px-6 py-5">
          <div>
            <h2 className="text-lg font-bold text-white">Detalhes da Inscrição</h2>
            <p className="text-xs text-[#2DBDC2]">#{inscricao.id} • Recebida em {createdAt}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {isEditing ? (
              <button
                type="button"
                className="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={cancelEditing}
                disabled={isSaving}
              >
                Cancelar
              </button>
            ) : (
              <button
                type="button"
                className="rounded-lg border border-[#2DBDC2] bg-[#2DBDC2]/20 px-3 py-1.5 text-sm font-semibold text-[#2DBDC2] transition hover:bg-[#2DBDC2]/30"
                onClick={() => {
                  setIsEditing(true);
                  setErrorMessage(null);
                  setSuccessMessage(null);
                }}
              >
                Editar
              </button>
            )}
            <button
              type="button"
              className="rounded-lg border border-red-400/50 bg-red-500/20 px-3 py-1.5 text-sm font-semibold text-red-300 transition hover:bg-red-500/30 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={handleDelete}
              disabled={isSaving || isDeleting}
            >
              {isDeleting ? "Excluindo..." : "Excluir"}
            </button>
            <button
              type="button"
              className="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-white/20"
              onClick={onClose}
            >
              ✕
            </button>
          </div>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
          {errorMessage ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p>
          ) : null}
          {successMessage ? (
            <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {successMessage}
            </p>
          ) : null}

          <section className="space-y-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <header className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-bold text-[#0f172a]">📝 Anotações</h3>
                <p className="text-xs text-neutral-500">Registre interações e acompanhamentos.</p>
              </div>
              <span className="rounded-full bg-[#2DBDC2]/10 px-2.5 py-0.5 text-xs font-semibold text-[#1A9A9E]">{notes.length} anotação{notes.length === 1 ? "" : "ões"}</span>
            </header>
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {notes.length === 0 ? (
                <p className="py-4 text-center text-xs text-neutral-400">Nenhuma anotação registrada ainda.</p>
              ) : (
                notes.map((note) => (
                  <article key={note.id} className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-neutral-500">{formatDateTime(note.createdAt)}</p>
                      {typeof note.viaWhatsapp === "boolean" && note.viaWhatsapp ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                          <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                          </svg>
                          WhatsApp
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-neutral-800">{note.content}</p>
                  </article>
                ))
              )}
            </div>
            <form className="space-y-3 rounded-lg border border-dashed border-[#2DBDC2]/40 bg-[#2DBDC2]/5 p-3" onSubmit={handleNoteSubmit}>
              <textarea
                className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-800 placeholder:text-neutral-400 focus:border-[#2DBDC2] focus:outline-none focus:ring-2 focus:ring-[#2DBDC2]/20"
                rows={2}
                placeholder="Escreva uma nova anotação..."
                value={noteContent}
                onChange={(event) => setNoteContent(event.target.value)}
                disabled={isSavingNote}
                required
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="inline-flex items-center gap-2 text-xs font-medium text-neutral-600">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-neutral-300 text-[#2DBDC2] focus:ring-[#2DBDC2]"
                    checked={noteWhatsapp}
                    onChange={(event) => setNoteWhatsapp(event.target.checked)}
                    disabled={isSavingNote}
                  />
                  Contato via WhatsApp
                </label>
                <button
                  type="submit"
                  className="rounded-lg bg-[#2DBDC2] px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-[#1A9A9E] disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isSavingNote || !noteContent.trim()}
                >
                  {isSavingNote ? "Salvando..." : "+ Adicionar"}
                </button>
              </div>
            </form>
          </section>

          {isEditing ? (
            <form className="space-y-4 rounded-xl border border-[#2DBDC2]/30 bg-[#2DBDC2]/5 p-4" onSubmit={handleSubmit}>
              <h3 className="text-sm font-bold text-[#0f172a]">✏️ Editar Inscrição</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5 text-sm font-medium text-[#0f172a]">
                  Nome completo
                  <input
                    name="nome"
                    value={formState.nome}
                    onChange={handleFieldChange}
                    className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-800 focus:border-[#2DBDC2] focus:outline-none focus:ring-2 focus:ring-[#2DBDC2]/20"
                    placeholder="Atualize o nome"
                    disabled={isSaving}
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium text-[#0f172a]">
                  Telefone
                  <input
                    name="telefone"
                    value={formState.telefone}
                    onChange={handleFieldChange}
                    className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-800 focus:border-[#2DBDC2] focus:outline-none focus:ring-2 focus:ring-[#2DBDC2]/20"
                    placeholder="DDD + número"
                    disabled={isSaving}
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium text-[#0f172a]">
                  Cidade
                  <input
                    name="cidade"
                    value={formState.cidade}
                    onChange={handleFieldChange}
                    className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-800 focus:border-[#2DBDC2] focus:outline-none focus:ring-2 focus:ring-[#2DBDC2]/20"
                    placeholder="Onde mora"
                    disabled={isSaving}
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium text-[#0f172a]">
                  Treinamento
                  <select
                    name="treinamento"
                    value={formState.treinamento}
                    onChange={handleFieldChange}
                    className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-800 focus:border-[#2DBDC2] focus:outline-none focus:ring-2 focus:ring-[#2DBDC2]/20"
                    disabled={isSaving}
                  >
                    <option value="">Nenhuma seleção</option>
                    {fallbackTrainingOptionLabel ? (
                      <option value={formState.treinamento} title={fallbackTrainingOptionTitle ?? undefined}>
                        {fallbackTrainingOptionLabel}
                      </option>
                    ) : null}
                    {trainingOptions.map((option) => {
                      const formattedDate = formatTrainingDate(option.startsAt);
                      const optionTitle = option.startsAt ?? option.label ?? option.id;
                      const optionLabel = formattedDate ?? option.label ?? option.id;
                      return (
                        <option key={option.id} value={option.id} title={optionTitle ?? undefined}>
                          {optionLabel}
                        </option>
                      );
                    })}
                  </select>
                </label>
              </div>
              <label className="flex flex-col gap-1.5 text-sm font-medium text-[#0f172a]">
                Indicador
                <input
                  name="indicacao"
                  value={formState.indicacao}
                  onChange={handleFieldChange}
                  className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-800 focus:border-[#2DBDC2] focus:outline-none focus:ring-2 focus:ring-[#2DBDC2]/20"
                  placeholder="Selecione ou digite o código"
                  disabled={isSaving}
                  list={recruiterDatalistId}
                />
                <span className="text-xs text-neutral-500">
                  As sugestões listam os clusters cadastrados. Deixe em branco para remover a indicação.
                </span>
              </label>
              <datalist id={recruiterDatalistId}>
                {recruiterOptions.map((recruiter) => (
                  <option
                    key={recruiter.code}
                    value={recruiter.code}
                    label={`${recruiter.name} (${recruiter.code})`}
                  />
                ))}
              </datalist>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="submit"
                  className="rounded-lg bg-[#2DBDC2] px-5 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-[#1A9A9E] disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isSaving}
                >
                  {isSaving ? "Salvando..." : "✓ Salvar alterações"}
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
              <h3 className="text-sm font-bold text-[#0f172a]">📋 Resumo do Lead</h3>
              <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                <div className="rounded-lg bg-neutral-50 p-3">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-[#1A9A9E]">Nome</dt>
                  <dd className="mt-1 font-semibold text-neutral-900">{inscricao.nome ?? "Indisponível"}</dd>
                </div>
                <div className="rounded-lg bg-neutral-50 p-3">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-[#1A9A9E]">Telefone</dt>
                  <dd className="mt-1 font-semibold text-neutral-900">
                    {inscricao.telefone ? (
                      <a
                        href={`https://wa.me/55${inscricao.telefone.replace(/\D/g, '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-emerald-600 hover:text-emerald-700 hover:underline"
                      >
                        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                        </svg>
                        {inscricao.telefone}
                      </a>
                    ) : (
                      "Indisponível"
                    )}
                  </dd>
                </div>
                <div className="rounded-lg bg-neutral-50 p-3">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-[#1A9A9E]">Cidade</dt>
                  <dd className="mt-1 font-semibold text-neutral-900">{inscricao.cidade ?? "Indisponível"}</dd>
                </div>
                {inscricao.codigoProprio ? (
                  <div className="rounded-lg bg-neutral-50 p-3">
                    <dt className="text-xs font-semibold uppercase tracking-wide text-[#1A9A9E]">Cluster</dt>
                    <dd className="mt-1 font-semibold text-neutral-900">{inscricao.nome ?? inscricao.codigoProprio}</dd>
                  </div>
                ) : null}
                <div className="rounded-lg bg-neutral-50 p-3">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-[#1A9A9E]">Treinamento</dt>
                  <dd className="mt-1 font-semibold text-neutral-900">
                    {treinamentoDisplay.text ? (
                      <span
                        className="inline-flex w-max items-center rounded-lg bg-gradient-to-r from-[#0f172a] to-[#1e293b] px-3 py-1.5 text-xs font-bold text-[#2DBDC2] shadow-sm"
                        title={treinamentoDisplay.rawDate ?? undefined}
                      >
                        📅 {treinamentoDisplay.text}
                      </span>
                    ) : (
                      <span className="text-neutral-400 italic">Sem seleção</span>
                    )}
                  </dd>
                </div>
                <div className="rounded-lg bg-neutral-50 p-3 sm:col-span-2">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-[#1A9A9E]">Indicador</dt>
                  <dd className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-neutral-900">
                      {inscricao.recrutadorNome ?? "Sem indicador"}
                      {inscricao.recrutadorCodigo ? (
                        <span className="ml-1.5 rounded-full bg-[#2DBDC2]/20 px-2 py-0.5 text-xs font-semibold text-[#1A9A9E]">{inscricao.recrutadorCodigo}</span>
                      ) : null}
                    </span>
                    {inscricao.recrutadorUrl ? (
                      <button
                        type="button"
                        onClick={copyRecruiterLink}
                        className="rounded-lg border border-[#2DBDC2]/50 bg-[#2DBDC2]/10 px-2.5 py-1 text-xs font-semibold text-[#1A9A9E] transition hover:bg-[#2DBDC2]/20"
                      >
                        📋 Copiar link
                      </button>
                    ) : null}
                    {(inscricao.codigoProprio ?? inscricao.recrutadorCodigo) ? (
                      <button
                        type="button"
                        onClick={openNetworkView}
                        className="rounded-lg border border-[#2DBDC2]/50 bg-[#2DBDC2]/10 px-2.5 py-1 text-xs font-semibold text-[#1A9A9E] transition hover:bg-[#2DBDC2]/20"
                      >
                        🔗 Ver rede
                      </button>
                    ) : null}
                  </dd>
                </div>
              </dl>
            </div>
          )}

          {/* Seção de Presença - aparece quando a presença foi validada */}
          {inscricao.presencaValidada && (
            <section className="space-y-3 rounded-xl border border-cyan-200 bg-gradient-to-r from-cyan-50 to-cyan-100/50 p-4 shadow-sm">
              <header className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xl">✅</span>
                  <h3 className="text-sm font-bold text-cyan-900">Presença no Encontro</h3>
                </div>
                <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
                  inscricao.presencaAprovada 
                    ? "bg-emerald-100 text-emerald-800" 
                    : "bg-red-100 text-red-800"
                }`}>
                  {inscricao.presencaAprovada ? "✓ Aprovado" : "✗ Reprovado"}
                </span>
              </header>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg bg-white p-3 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-cyan-700">Nome no Zoom</p>
                  <p className="mt-1 text-sm font-medium text-cyan-900">
                    {inscricao.presencaParticipanteNome ?? "-"}
                  </p>
                </div>
                <div className="rounded-lg bg-white p-3 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-cyan-700">Tempo Total</p>
                  <p className="mt-1 text-sm font-medium text-cyan-900">
                    {inscricao.presencaTempoTotalMinutos != null 
                      ? formatPresenceTime(inscricao.presencaTempoTotalMinutos) 
                      : "-"}
                  </p>
                </div>
                <div className="rounded-lg bg-white p-3 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-cyan-700">Tempo na Dinâmica</p>
                  <p className="mt-1 text-sm font-medium text-cyan-900">
                    {inscricao.presencaTempoDinamicaMinutos != null 
                      ? formatPresenceTime(inscricao.presencaTempoDinamicaMinutos) 
                      : "-"}
                    {inscricao.presencaPercentualDinamica != null && (
                      <span className="ml-1 text-xs text-cyan-600">
                        ({inscricao.presencaPercentualDinamica}%)
                      </span>
                    )}
                  </p>
                </div>
                <div className="rounded-lg bg-white p-3 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-cyan-700">Validado em</p>
                  <p className="mt-1 text-sm font-medium text-cyan-900">
                    {inscricao.presencaValidadaEm 
                      ? formatDateTime(inscricao.presencaValidadaEm) 
                      : "-"}
                  </p>
                </div>
              </div>
            </section>
          )}

          {/* Seção de Anamnese - aparece quando o cluster tem anamnese vinculada */}
          {inscricao.codigoProprio && (
            <section className="space-y-3 rounded-xl border border-purple-200 bg-gradient-to-r from-purple-50 to-purple-100/50 p-4 shadow-sm">
              <header className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xl">🧠</span>
                  <h3 className="text-sm font-bold text-purple-900">Anamnese</h3>
                </div>
                {isLoadingAnamnese ? (
                  <span className="text-xs text-purple-600">Carregando...</span>
                ) : (
                  <span className="rounded-full bg-purple-200 px-2.5 py-0.5 text-xs font-semibold text-purple-800">
                    {anamneses.length} resposta{anamneses.length === 1 ? "" : "s"}
                  </span>
                )}
              </header>
              
              {isLoadingAnamnese ? (
                <div className="flex justify-center py-6">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-purple-300 border-t-purple-600"></div>
                </div>
              ) : anamneses.length === 0 ? (
                <p className="py-4 text-center text-sm text-purple-600">
                  Nenhuma anamnese vinculada a este cluster.
                </p>
              ) : (
                <div className="space-y-4">
                  {anamneses.map((anamnese) => (
                    <div key={anamnese.id} className="rounded-lg border border-purple-200 bg-white p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-xs font-semibold text-purple-700">
                          Enviada em {anamnese.data_envio ? new Date(anamnese.data_envio).toLocaleDateString("pt-BR") : "Data desconhecida"}
                        </span>
                        <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-bold text-purple-700">
                          ID #{anamnese.id}
                        </span>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        {anamnese.momento_atual && (
                          <AnamneseField label="Momento Atual" value={anamnese.momento_atual} />
                        )}
                        {anamnese.dificuldade_barreira && (
                          <AnamneseField label="Maior Dificuldade" value={anamnese.dificuldade_barreira} />
                        )}
                        {anamnese.maior_medo && (
                          <AnamneseField label="Maior Medo" value={anamnese.maior_medo} />
                        )}
                        {anamnese.tempo_disponivel && (
                          <AnamneseField label="Tempo Disponível" value={anamnese.tempo_disponivel} />
                        )}
                        {anamnese.visao_instituto && (
                          <AnamneseField label="Visão do Instituto" value={anamnese.visao_instituto} />
                        )}
                        {anamnese.visao_futuro && (
                          <AnamneseField label="Visão de Futuro" value={anamnese.visao_futuro} />
                        )}
                        {anamnese.contribuicao && (
                          <AnamneseField label="Contribuição" value={anamnese.contribuicao} />
                        )}
                        {anamnese.sonhos_objetivos && (
                          <AnamneseField label="Sonhos e Objetivos" value={anamnese.sonhos_objetivos} />
                        )}
                        {anamnese.o_que_falta && (
                          <AnamneseField label="O que Falta" value={anamnese.o_que_falta} />
                        )}
                        {anamnese.como_ajudar && (
                          <AnamneseField label="Como Podemos Ajudar" value={anamnese.como_ajudar} />
                        )}
                        {anamnese.renda_necessaria && (
                          <AnamneseField label="Renda Necessária" value={anamnese.renda_necessaria} />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          <details className="group rounded-xl border border-neutral-200 bg-white shadow-sm" open>
            <summary className="cursor-pointer rounded-t-xl bg-gradient-to-r from-[#0f172a] to-[#1e293b] px-4 py-3 text-sm font-bold text-white hover:from-[#1e293b] hover:to-[#0f172a]">
              📋 Informações do Formulário
            </summary>
            <div className="max-h-96 overflow-y-auto p-4">
              <div className="space-y-3">
                {(() => {
                  // Campos técnicos que devem ser ignorados
                  const ignoredKeys = new Set([
                    'source', 'traffic_source', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
                    'ip', 'user_agent', 'referrer', 'referer', 'fbclid', 'gclid', 'origin', 'origem',
                    'parentId', 'sponsorId', 'indicadorId', 'recrutadorId', 'nivel', 'isRecruiter',
                    'codigoRecrutador', 'tipo', 'type', 'formId', 'pageUrl', 'pageTitle',
                    'presenca_validada', 'presenca_aprovada', 'presenca_participante_nome', 'presenca_status',
                    'presenca_tempo_total_minutos', 'presenca_tempo_dinamica_minutos', 'presenca_percentual_dinamica',
                    'presenca_treinamento_id', 'presenca_validada_em', 'statusWhatsappContacted',
                    'cookies', 'session', 'token', 'device', 'browser', 'platform', 'id', 'ID',
                    'entry.', 'hidden_', 'field_', '_field', '__', 'fbc', 'fbp'
                  ]);
                  
                  // Mapeamento de nomes de campos para labels amigáveis
                  const fieldLabels: Record<string, string> = {
                    'nome': 'Nome',
                    'name': 'Nome',
                    'telefone': 'Telefone',
                    'phone': 'Telefone',
                    'celular': 'Celular',
                    'whatsapp': 'WhatsApp',
                    'email': 'E-mail',
                    'cidade': 'Cidade',
                    'city': 'Cidade',
                    'estado': 'Estado',
                    'state': 'Estado',
                    'uf': 'UF',
                    'profissao': 'Profissão',
                    'profession': 'Profissão',
                    'ocupacao': 'Ocupação',
                    'treinamento': 'Treinamento',
                    'training': 'Treinamento',
                    'training_date': 'Data do Treinamento',
                    'data_treinamento': 'Data do Treinamento',
                    'timestamp': 'Data de Preenchimento',
                    'created_at': 'Data de Preenchimento',
                    'createdAt': 'Data de Preenchimento',
                    'data_cadastro': 'Data de Cadastro',
                    'idade': 'Idade',
                    'age': 'Idade',
                    'sexo': 'Sexo',
                    'genero': 'Gênero',
                    'gender': 'Gênero',
                    'como_conheceu': 'Como nos Conheceu',
                    'indicacao': 'Indicação',
                    'observacao': 'Observação',
                    'observacoes': 'Observações',
                    'mensagem': 'Mensagem',
                    'message': 'Mensagem',
                    'interesse': 'Interesse',
                    'objetivo': 'Objetivo',
                    'experiencia': 'Experiência',
                    'disponibilidade': 'Disponibilidade',
                    'horario': 'Horário',
                    'renda': 'Renda',
                    'trabalho': 'Trabalho',
                    'empresa': 'Empresa',
                    'cargo': 'Cargo',
                    'escolaridade': 'Escolaridade',
                    'formacao': 'Formação',
                  };
                  
                  // Formatar valor de forma amigável
                  const formatValue = (value: unknown): string => {
                    if (value === null || value === undefined || value === '') {
                      return 'Não informado';
                    }
                    
                    // Se for data/timestamp
                    if (typeof value === 'string') {
                      // Tentar parsear como data
                      const dateMatch = value.match(/^\d{4}-\d{2}-\d{2}(T|\s)\d{2}:\d{2}/);
                      if (dateMatch) {
                        const date = new Date(value);
                        if (!Number.isNaN(date.getTime())) {
                          return date.toLocaleString('pt-BR', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          });
                        }
                      }
                      return value;
                    }
                    
                    if (typeof value === 'boolean') {
                      return value ? 'Sim' : 'Não';
                    }
                    
                    if (typeof value === 'number') {
                      return String(value);
                    }
                    
                    if (Array.isArray(value)) {
                      return value.map(v => formatValue(v)).join(', ');
                    }
                    
                    if (typeof value === 'object') {
                      // Para objetos, tentar extrair valores relevantes
                      const entries = Object.entries(value as Record<string, unknown>)
                        .filter(([k]) => !ignoredKeys.has(k))
                        .map(([, v]) => formatValue(v));
                      return entries.join(', ') || 'Não informado';
                    }
                    
                    return String(value);
                  };
                  
                  // Formatar label de campo
                  const formatLabel = (key: string): string => {
                    const lowerKey = key.toLowerCase();
                    if (fieldLabels[lowerKey]) {
                      return fieldLabels[lowerKey];
                    }
                    // Converter snake_case ou camelCase para texto legível
                    return key
                      .replace(/_/g, ' ')
                      .replace(/([A-Z])/g, ' $1')
                      .replace(/^./, str => str.toUpperCase())
                      .trim();
                  };
                  
                  // Verificar se campo deve ser ignorado
                  const shouldIgnoreKey = (key: string): boolean => {
                    const lowerKey = key.toLowerCase();
                    // Ignorar se está na lista
                    if (ignoredKeys.has(key) || ignoredKeys.has(lowerKey)) return true;
                    // Ignorar se começa com prefixos técnicos
                    if (/^(entry\.|hidden_|field_|utm_|_|__|fb)/.test(lowerKey)) return true;
                    // Ignorar campos de presença
                    if (lowerKey.startsWith('presenca')) return true;
                    return false;
                  };
                  
                  const filteredEntries = Object.entries(inscricao.payload)
                    .filter(([key, value]) => {
                      if (shouldIgnoreKey(key)) return false;
                      // Ignorar valores vazios
                      if (value === null || value === undefined || value === '') return false;
                      return true;
                    });
                  
                  if (filteredEntries.length === 0) {
                    return (
                      <p className="text-sm text-neutral-500 italic">Nenhuma informação adicional disponível.</p>
                    );
                  }
                  
                  return filteredEntries.map(([key, value]) => (
                    <div key={key} className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                      <p className="text-xs font-bold uppercase tracking-wide text-[#1A9A9E]">
                        {formatLabel(key)}
                      </p>
                      <p className="mt-1 text-sm text-neutral-800">
                        {formatValue(value)}
                      </p>
                    </div>
                  ));
                })()}
              </div>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}

function AnamneseField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-purple-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-purple-700">{label}</p>
      <p className="mt-1 text-sm text-purple-900">{value}</p>
    </div>
  );
}
