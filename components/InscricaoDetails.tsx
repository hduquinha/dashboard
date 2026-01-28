"use client";

import { useEffect, useId, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { InscricaoItem, InscricaoStatus } from "@/types/inscricao";
import type { TrainingOption } from "@/types/training";
import type { Recruiter } from "@/lib/recruiters";

interface InscricaoDetailsProps {
  inscricao: InscricaoItem | null;
  onClose: () => void;
  onUpdate?: (inscricao: InscricaoItem) => void;
  trainingOptions: TrainingOption[];
  recruiterOptions: Recruiter[];
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
  }, [inscricao]);

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
      return { label: "Recrutador", className: "bg-emerald-100 text-emerald-800" };
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
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="my-4 w-full max-w-3xl rounded-lg bg-white shadow-xl sm:my-8"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-neutral-900">Inscrição #{inscricao.id}</h2>
            <p className="text-xs text-neutral-600">Recebida em {createdAt}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {isEditing ? (
              <button
                type="button"
                className="rounded-md border border-neutral-300 px-3 py-1 text-sm font-semibold text-neutral-700 transition hover:border-neutral-400 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={cancelEditing}
                disabled={isSaving}
              >
                Cancelar edição
              </button>
            ) : (
              <button
                type="button"
                className="rounded-md border border-neutral-300 px-3 py-1 text-sm font-semibold text-neutral-700 transition hover:border-neutral-400 hover:text-neutral-900"
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
              className="rounded-md border border-red-300 bg-red-50 px-3 py-1 text-sm font-semibold text-red-700 transition hover:border-red-400 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={handleDelete}
              disabled={isSaving || isDeleting}
            >
              {isDeleting ? "Excluindo..." : "Excluir"}
            </button>
            <button
              type="button"
              className="rounded-md border border-neutral-300 px-3 py-1 text-sm font-semibold text-neutral-700 transition hover:border-neutral-400 hover:text-neutral-900"
              onClick={onClose}
            >
              Fechar
            </button>
          </div>
        </header>

        <div className="space-y-4 px-6 py-4">
          {errorMessage ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p>
          ) : null}
          {successMessage ? (
            <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {successMessage}
            </p>
          ) : null}

          <section className="space-y-3 rounded-lg border border-neutral-200 bg-neutral-50/60 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Status atual</p>
                <div className="mt-1 inline-flex items-center gap-2">
                  <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${statusBadge.className}`}>
                    {statusBadge.label}
                  </span>
                  {inscricao.statusUpdatedAt ? (
                    <span className="text-xs text-neutral-500">Atualizado em {formatDateTime(inscricao.statusUpdatedAt)}</span>
                  ) : null}
                </div>
                {typeof inscricao.statusWhatsappContacted === "boolean" ? (
                  <p className="text-xs text-neutral-500">
                    WhatsApp: {inscricao.statusWhatsappContacted ? "Contato confirmado" : "Ainda não contatado"}
                  </p>
                ) : null}
              </div>
              {isLead ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-md border border-neutral-300 px-3 py-1 text-xs font-semibold text-neutral-700 transition hover:border-neutral-400 hover:text-neutral-900"
                    onClick={() => handleStatusChange("aguardando")}
                    disabled={statusUpdating !== null}
                  >
                    Voltar para aguardando
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-emerald-200 bg-emerald-600 px-3 py-1 text-xs font-semibold text-white shadow hover:bg-emerald-500 disabled:opacity-60"
                    onClick={() => handleStatusChange("aprovado")}
                    disabled={statusUpdating !== null}
                  >
                    {statusUpdating === "aprovado" ? "Atualizando..." : "Aprovar"}
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                    onClick={() => handleStatusChange("rejeitado")}
                    disabled={statusUpdating !== null}
                  >
                    {statusUpdating === "rejeitado" ? "Atualizando..." : "Rejeitar"}
                  </button>
                </div>
              ) : null}
            </div>
          </section>

          <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
            <header className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-neutral-900">Anotações</h3>
                <p className="text-xs text-neutral-500">Registre interações como em um CRM tradicional.</p>
              </div>
              <span className="text-xs text-neutral-400">{notes.length} anotação{notes.length === 1 ? "" : "es"}</span>
            </header>
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {notes.length === 0 ? (
                <p className="text-xs text-neutral-500">Nenhuma anotação registrada ainda.</p>
              ) : (
                notes.map((note) => (
                  <article key={note.id} className="rounded-md border border-neutral-100 bg-neutral-50 p-3">
                    <p className="text-xs text-neutral-500">{formatDateTime(note.createdAt)}</p>
                    <p className="text-sm text-neutral-800">{note.content}</p>
                    {typeof note.viaWhatsapp === "boolean" ? (
                      <p className="text-[11px] uppercase tracking-wide text-neutral-500">
                        WhatsApp: {note.viaWhatsapp ? "Sim" : "Não"}
                      </p>
                    ) : null}
                  </article>
                ))
              )}
            </div>
            <form className="space-y-2" onSubmit={handleNoteSubmit}>
              <textarea
                className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm text-neutral-800 focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-200"
                rows={3}
                placeholder="Escreva uma nova anotação"
                value={noteContent}
                onChange={(event) => setNoteContent(event.target.value)}
                disabled={isSavingNote}
                required
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-neutral-600">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-500"
                    checked={noteWhatsapp}
                    onChange={(event) => setNoteWhatsapp(event.target.checked)}
                    disabled={isSavingNote}
                  />
                  Contato feito por WhatsApp
                </label>
                <button
                  type="submit"
                  className="rounded-md bg-neutral-900 px-4 py-1.5 text-xs font-semibold text-white shadow hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isSavingNote || !noteContent.trim()}
                >
                  {isSavingNote ? "Salvando..." : "Adicionar anotação"}
                </button>
              </div>
            </form>
          </section>

          {isEditing ? (
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm text-neutral-700">
                  Nome completo
                  <input
                    name="nome"
                    value={formState.nome}
                    onChange={handleFieldChange}
                    className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-200"
                    placeholder="Atualize o nome"
                    disabled={isSaving}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm text-neutral-700">
                  Telefone
                  <input
                    name="telefone"
                    value={formState.telefone}
                    onChange={handleFieldChange}
                    className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-200"
                    placeholder="DDD + número"
                    disabled={isSaving}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm text-neutral-700">
                  Cidade
                  <input
                    name="cidade"
                    value={formState.cidade}
                    onChange={handleFieldChange}
                    className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-200"
                    placeholder="Onde mora"
                    disabled={isSaving}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm text-neutral-700">
                  Treinamento
                  <select
                    name="treinamento"
                    value={formState.treinamento}
                    onChange={handleFieldChange}
                    className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-200"
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
              <label className="flex flex-col gap-1 text-sm text-neutral-700">
                Indicador
                <input
                  name="indicacao"
                  value={formState.indicacao}
                  onChange={handleFieldChange}
                  className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-200"
                  placeholder="Selecione ou digite o código"
                  disabled={isSaving}
                  list={recruiterDatalistId}
                />
                <span className="text-xs text-neutral-500">
                  As sugestões listam os recrutadores cadastrados. Deixe em branco para remover a indicação.
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
              <div className="flex justify-end gap-2">
                <button
                  type="submit"
                  className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isSaving}
                >
                  {isSaving ? "Salvando..." : "Salvar alterações"}
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-neutral-800">Resumo</h3>
              <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-neutral-500">Nome</dt>
                  <dd className="font-medium text-neutral-900">{inscricao.nome ?? "Indisponível"}</dd>
                </div>
                <div>
                  <dt className="text-neutral-500">Telefone</dt>
                  <dd className="font-medium text-neutral-900">
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
                <div>
                  <dt className="text-neutral-500">Cidade</dt>
                  <dd className="font-medium text-neutral-900">{inscricao.cidade ?? "Indisponível"}</dd>
                </div>
                {inscricao.codigoProprio ? (
                  <div>
                    <dt className="text-neutral-500">Código do recrutador</dt>
                    <dd className="font-medium text-neutral-900">{inscricao.codigoProprio}</dd>
                  </div>
                ) : null}
                <div>
                  <dt className="text-neutral-500">Treinamento</dt>
                  <dd className="font-medium text-neutral-900">
                    {treinamentoDisplay.text ? (
                      <span
                        className="inline-flex w-max items-center rounded-md bg-neutral-900 px-3 py-1 text-xs font-semibold text-white shadow-sm"
                        title={treinamentoDisplay.rawDate ?? undefined}
                      >
                        {treinamentoDisplay.text}
                      </span>
                    ) : (
                      <span className="text-neutral-500">Sem seleção</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-neutral-500">Indicador</dt>
                  <dd className="flex flex-wrap items-center gap-2 font-medium text-neutral-900">
                    <span>
                      {inscricao.recrutadorNome ?? "Sem indicador"}
                      {inscricao.recrutadorCodigo ? (
                        <span className="ml-1 text-xs text-neutral-500">({inscricao.recrutadorCodigo})</span>
                      ) : null}
                    </span>
                    {inscricao.recrutadorUrl ? (
                      <button
                        type="button"
                        onClick={copyRecruiterLink}
                        className="rounded border border-neutral-300 px-2 py-1 text-xs font-semibold text-neutral-700 transition hover:border-neutral-400 hover:text-neutral-900"
                      >
                        Copiar link
                      </button>
                    ) : null}
                    {(inscricao.codigoProprio ?? inscricao.recrutadorCodigo) ? (
                      <button
                        type="button"
                        onClick={openNetworkView}
                        className="rounded border border-neutral-300 px-2 py-1 text-xs font-semibold text-neutral-700 transition hover:border-neutral-400 hover:text-neutral-900"
                      >
                        Ver rede
                      </button>
                    ) : null}
                  </dd>
                </div>
              </dl>
            </div>
          )}

          <div>
            <h3 className="mb-2 text-sm font-semibold text-neutral-800">Payload completo</h3>
            <pre className="max-h-80 overflow-auto rounded-md bg-neutral-950/90 p-4 text-xs text-neutral-100">
              {JSON.stringify(inscricao.payload, null, 2)}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
