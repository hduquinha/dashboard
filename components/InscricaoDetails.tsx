"use client";

import { useEffect, useId, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { InscricaoItem } from "@/types/inscricao";
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
  const [formState, setFormState] = useState<FormState>(() => buildInitialFormState(inscricao));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
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
    setErrorMessage(null);
    setSuccessMessage(null);
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

  if (!inscricao) {
    return null;
  }

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="max-h-full w-full max-w-3xl overflow-hidden rounded-lg bg-white shadow-xl"
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

        <div className="space-y-4 overflow-y-auto px-6 py-4">
          {errorMessage ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p>
          ) : null}
          {successMessage ? (
            <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {successMessage}
            </p>
          ) : null}

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
                  <dd className="font-medium text-neutral-900">{inscricao.telefone ?? "Indisponível"}</dd>
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
