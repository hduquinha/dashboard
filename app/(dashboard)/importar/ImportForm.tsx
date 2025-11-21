"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useFormState } from "react-dom";
import type { ImportPayload } from "@/lib/importSpreadsheet";
import { confirmImportAction, type ConfirmImportResponse } from "./actions";
import { initialImportState, type ImportActionState } from "./state";

interface ImportFormProps {
  action: (prevState: ImportActionState, formData: FormData) => Promise<ImportActionState>;
}

const PREVIEW_COLUMNS: Array<{ key: keyof ImportPayload; label: string }> = [
  { key: "nome", label: "Nome" },
  { key: "telefone", label: "Telefone" },
  { key: "cidade", label: "Cidade" },
  { key: "data_treinamento", label: "Treinamento" },
  { key: "clientId", label: "Client ID" },
];

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "-";
  }
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  return String(value);
}

export default function ImportForm({ action }: ImportFormProps) {
  const [state, formAction] = useFormState<ImportActionState, FormData>(action, initialImportState);
  const [confirmFeedback, setConfirmFeedback] = useState<ConfirmImportResponse | null>(null);
  const [isConfirming, startConfirm] = useTransition();

  const previewSignature = useMemo(() => {
    if (!state.result) {
      return null;
    }
    const importados = state.result.importados.length;
    const duplicados = state.result.duplicados.length;
    const comErros = state.result.comErros.length;
    const filename = state.filename ?? "";
    return `${importados}-${duplicados}-${comErros}-${filename}`;
  }, [state.result, state.filename]);

  useEffect(() => {
    setConfirmFeedback(null);
  }, [previewSignature]);

  const confirmationStatus = isConfirming
    ? "pending"
    : confirmFeedback?.status === "success"
    ? "done"
    : confirmFeedback?.status === "error"
    ? "error"
    : "idle";

  const hasPreview = state.status === "success" && state.result;
  const confirmSummary = confirmFeedback?.summary ?? null;

  function handleConfirm() {
    if (!state.result || state.result.importados.length === 0) {
      return;
    }

    startConfirm(() => {
      setConfirmFeedback(null);
      void confirmImportAction({
        filename: state.filename ?? null,
        registros: state.result!.importados,
      })
        .then((response) => {
          setConfirmFeedback(response);
        })
        .catch((error) => {
          console.error("Failed to confirm import", error);
          setConfirmFeedback({
            status: "error",
            message: "Não foi possível concluir a importação.",
          });
        });
    });
  }

  return (
    <div className="space-y-6">
      <form
        className="rounded-2xl border border-dashed border-neutral-300 bg-white p-6 shadow-sm"
        action={formAction}
        encType="multipart/form-data"
      >
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-neutral-900">Importar planilha</h2>
          <p className="text-sm text-neutral-600">
            Faça upload de um arquivo XLS, XLSX ou CSV para validar os dados antes da importação definitiva.
          </p>
        </div>

        <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-end">
          <label className="flex-1 text-sm font-medium text-neutral-700">
            Arquivo da planilha
            <input
              type="file"
              name="planilha"
              accept=".xlsx,.xls,.csv"
              required
              className="mt-2 w-full rounded-lg border border-neutral-300 px-4 py-3 text-sm text-neutral-800 focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-200"
            />
            <span className="mt-1 block text-xs text-neutral-500">
              Limite de 15MB. Use a planilha exportada do Meta Ads ou RD Station.
            </span>
          </label>
          <button
            type="submit"
            className="rounded-xl bg-neutral-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-neutral-800 disabled:opacity-60"
            disabled={state.status === "success" && !state.result}
          >
            {state.status === "success" ? "Reprocessar" : "Pré-visualizar"}
          </button>
        </div>

        {state.message ? (
          <p
            className={`mt-4 rounded-md border px-4 py-3 text-sm ${
              state.status === "error"
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-800"
            }`}
          >
            {state.message}
          </p>
        ) : null}
      </form>

      {hasPreview ? (
        <section className="space-y-4 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
          <header className="flex flex-col gap-2">
            <h3 className="text-lg font-semibold text-neutral-900">Pré-visualização</h3>
            <p className="text-sm text-neutral-600">
              Analise os dados identificados. Confirme para enviar o lote higienizado diretamente ao banco e bloquear duplicados.
            </p>
          </header>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
              <p className="text-xs uppercase tracking-wide text-neutral-500">Registros válidos</p>
              <p className="text-2xl font-semibold text-neutral-900">{state.result!.importados.length}</p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-xs uppercase tracking-wide text-amber-700">Possíveis duplicados</p>
              <p className="text-2xl font-semibold text-amber-900">{state.result!.duplicados.length}</p>
            </div>
            <div className="rounded-xl border border-red-200 bg-red-50 p-4">
              <p className="text-xs uppercase tracking-wide text-red-700">Linhas com erro</p>
              <p className="text-2xl font-semibold text-red-900">{state.result!.comErros.length}</p>
            </div>
            <div className="rounded-xl border border-sky-200 bg-sky-50 p-4">
              <p className="text-xs uppercase tracking-wide text-sky-700">Arquivo</p>
              <p className="truncate text-sm font-semibold text-sky-900">{state.filename ?? "Sem nome"}</p>
            </div>
          </div>

          <div className="space-y-6">
            <PreviewTable
              title="Registros válidos"
              description="O lote abaixo será enviado para o banco após confirmação."
              rows={state.result!.importados}
            />
            <PreviewTable
              title="Possíveis duplicados"
              description="Revise rapidamente os registros bloqueados pelo clientId ou telefone repetido."
              rows={state.result!.duplicados}
              emptyMessage="Nenhum possível duplicado encontrado."
            />
            <ErrorTable
              title="Linhas ignoradas"
              errors={state.result!.comErros}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-100 pt-4">
            <p className="text-xs text-neutral-500">
              Ao confirmar, os registros válidos são gravados diretamente no banco de dados.
            </p>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={state.result!.importados.length === 0 || confirmationStatus === "pending"}
              className="rounded-xl bg-emerald-600 px-6 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {confirmationStatus === "done"
                ? "Importação concluída"
                : confirmationStatus === "pending"
                ? "Importando..."
                : confirmationStatus === "error"
                ? "Tentar novamente"
                : "Confirmar importação"}
            </button>
          </div>
          {confirmFeedback ? (
            <div
              className={`mt-3 w-full rounded-lg border px-4 py-3 text-sm ${
                confirmFeedback.status === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-red-200 bg-red-50 text-red-800"
              }`}
            >
              <p className="font-medium">{confirmFeedback.message}</p>
              {confirmSummary ? (
                <ul className="mt-2 space-y-1 text-xs">
                  <li>
                    Inseridos: <span className="font-semibold">{confirmSummary.inserted}</span>
                  </li>
                  <li>
                    Ignorados: <span className="font-semibold">{confirmSummary.skipped}</span>
                  </li>
                  {confirmSummary.duplicateClientIds.length ? (
                    <li>Client IDs duplicados: {confirmSummary.duplicateClientIds.length}</li>
                  ) : null}
                  {confirmSummary.duplicatePhones.length ? (
                    <li>Telefones duplicados: {confirmSummary.duplicatePhones.length}</li>
                  ) : null}
                </ul>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

interface PreviewTableProps {
  title: string;
  description: string;
  rows: ImportPayload[];
  emptyMessage?: string;
}

function PreviewTable({ title, description, rows, emptyMessage }: PreviewTableProps) {
  const previewRows = rows.slice(0, 10);
  return (
    <section className="space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-neutral-900">{title}</h4>
        <p className="text-xs text-neutral-500">{description}</p>
      </div>
      {previewRows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-500">
          {emptyMessage ?? "Nenhum registro encontrado."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200">
          <table className="min-w-full divide-y divide-neutral-200 text-sm">
            <thead className="bg-neutral-100 text-left text-xs font-semibold uppercase tracking-wide text-neutral-600">
              <tr>
                {PREVIEW_COLUMNS.map((column) => (
                  <th key={column.key} className="px-4 py-3">
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 bg-white">
              {previewRows.map((row, index) => (
                <tr key={`${row.clientId ?? row.telefone ?? index}`} className="hover:bg-neutral-50">
                  {PREVIEW_COLUMNS.map((column) => (
                    <td key={column.key as string} className="px-4 py-2 text-neutral-700">
                      {formatValue(row[column.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > previewRows.length ? (
        <p className="text-xs text-neutral-500">
          Exibindo {previewRows.length} de {rows.length} registros.
        </p>
      ) : null}
    </section>
  );
}

interface ErrorTableProps {
  title: string;
  errors: Array<{ linha: number; mensagem: string }>;
}

function ErrorTable({ title, errors }: ErrorTableProps) {
  if (!errors.length) {
    return null;
  }
  return (
    <section className="space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-neutral-900">{title}</h4>
        <p className="text-xs text-neutral-500">As linhas abaixo foram ignoradas por inconsistência.</p>
      </div>
      <ul className="space-y-2">
        {errors.map((error) => (
          <li
            key={`${error.linha}-${error.mensagem}`}
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800"
          >
            Linha {error.linha}: {error.mensagem}
          </li>
        ))}
      </ul>
    </section>
  );
}
