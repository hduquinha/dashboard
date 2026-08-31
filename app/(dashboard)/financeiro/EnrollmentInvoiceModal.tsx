"use client";

import { useState, type FormEvent } from "react";
import { FileDown, X } from "lucide-react";
import type { EnrollmentInvoiceStatus, FinanceEnrollment, PendingInvoiceEnrollment } from "@/types/finance";
import {
  InvoiceFileInput,
  SelectInput,
  TextAreaInput,
  TextInput,
  formOptionalDate,
  formString,
  money,
  toInputDate,
} from "./FinanceiroClient";
import { cn } from "@/lib/utils";

/**
 * Controle manual da NF da matrícula, num modal que se basta.
 *
 * Vive fora do FinanceiroClient porque a tela de Matrículas precisa do mesmo
 * controle — e duplicar as regras de preenchimento em dois formulários era
 * garantia de divergirem. As regras de verdade continuam no servidor
 * (`normalizeEnrollmentInvoiceInput`); aqui é só para a pessoa ver o que falta.
 */

/**
 * Matrícula vista pelo controle de nota fiscal.
 *
 * A fila de pendências ignora o filtro de período, então costuma listar
 * matrícula que não está na lista carregada — daí o modal trabalhar com este
 * recorte mínimo em vez do registro inteiro.
 */
export interface EnrollmentInvoiceTarget {
  id: number;
  student: string;
  courseName: string | null;
  totalAmount: number;
  paidAmount: number;
  invoiceStatus: EnrollmentInvoiceStatus;
  invoiceNumber: string | null;
  invoiceIssuedAt: string | null;
  invoiceNotes: string | null;
  invoiceFilename: string | null;
}

export function invoiceTargetFromEnrollment(record: FinanceEnrollment): EnrollmentInvoiceTarget {
  return {
    id: record.id,
    student: record.student,
    courseName: record.courseName,
    totalAmount: record.totalAmount,
    paidAmount: record.paidAmount,
    invoiceStatus: record.invoiceStatus,
    invoiceNumber: record.invoiceNumber,
    invoiceIssuedAt: record.invoiceIssuedAt,
    invoiceNotes: record.invoiceNotes,
    invoiceFilename: record.invoiceFilename,
  };
}

/** A consulta da fila já filtra por `invoice_status = 'pendente'`, e status pendente
 *  nunca guarda número nem data de emissão — por isso os dois entram vazios. */
export function invoiceTargetFromPending(row: PendingInvoiceEnrollment): EnrollmentInvoiceTarget {
  return {
    id: row.id,
    student: row.student,
    courseName: row.courseName,
    totalAmount: row.totalAmount,
    paidAmount: row.paidAmount,
    invoiceStatus: "pendente",
    invoiceNumber: null,
    invoiceIssuedAt: null,
    invoiceNotes: null,
    invoiceFilename: null,
  };
}

export const INVOICE_STATUS_LABELS: Record<EnrollmentInvoiceStatus, string> = {
  pendente: "NF pendente",
  emitida: "NF emitida",
  dispensada: "Sem NF",
};

/**
 * Estado da nota da matrícula. "Sem NF" (dispensada) é neutro de propósito —
 * não é uma pendência, mas também não é uma nota emitida.
 */
export function InvoiceStatusBadge({ record }: { record: FinanceEnrollment }) {
  const tone =
    record.invoiceStatus === "emitida"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
      : record.invoiceStatus === "dispensada"
        ? "bg-slate-100 text-slate-600 ring-slate-200"
        : "bg-amber-50 text-amber-700 ring-amber-100";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={cn("inline-flex rounded-md px-2 py-1 text-xs font-bold ring-1", tone)}>
        {INVOICE_STATUS_LABELS[record.invoiceStatus]}
      </span>
      {record.invoiceNumber ? (
        <span className="text-xs font-bold text-slate-500">nº {record.invoiceNumber}</span>
      ) : null}
      {record.hasInvoiceFile ? (
        <a
          className="inline-flex items-center gap-1 rounded-md bg-cyan-50 px-2 py-1 text-xs font-black text-cyan-700 hover:bg-cyan-100"
          href={`/api/finance/enrollments/${record.id}/invoice`}
        >
          <FileDown size={13} />
          Arquivo
        </a>
      ) : null}
    </div>
  );
}

async function saveInvoice(id: number, form: FormData) {
  const response = await fetch(`/api/finance/enrollments/${id}/invoice`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      status: formString(form, "invoiceStatus") as EnrollmentInvoiceStatus,
      number: formString(form, "invoiceNumber") || null,
      issuedAt: formOptionalDate(form, "invoiceIssuedAt"),
      notes: formString(form, "invoiceNotes") || null,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Falha ao salvar a nota fiscal.");

  // O arquivo vai numa segunda chamada porque a rota de dados é JSON. Falhar
  // aqui não desfaz o status já gravado — por isso a mensagem separa as duas.
  const file = form.get("invoiceFile");
  if (file instanceof File && file.size > 0) {
    const upload = new FormData();
    upload.set("file", file);
    const uploadResponse = await fetch(`/api/finance/enrollments/${id}/invoice`, { method: "POST", body: upload });
    const uploadData = await uploadResponse.json().catch(() => ({}));
    if (!uploadResponse.ok) {
      throw new Error(typeof uploadData.error === "string" ? uploadData.error : "Nota salva, mas o arquivo não foi enviado.");
    }
  }
}

export default function EnrollmentInvoiceModal({
  record,
  onClose,
  onSaved,
}: {
  record: EnrollmentInvoiceTarget;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [status, setStatus] = useState<EnrollmentInvoiceStatus>(record.invoiceStatus);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await saveInvoice(record.id, new FormData(event.currentTarget));
      onSaved("Nota fiscal atualizada.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Falha ao salvar a nota fiscal.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-lg font-black text-slate-950">Nota fiscal da matrícula</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" className="grid size-9 place-content-center rounded-lg hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={submit} className="overflow-y-auto p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-black text-slate-950">{record.student}</p>
              <p className="mt-1 text-xs font-semibold text-slate-500">
                {record.courseName ?? "Sem curso"} · Matrícula de {money(record.totalAmount)} · Recebido {money(record.paidAmount)}
              </p>
            </div>
            <SelectInput label="Situação da nota" name="invoiceStatus" required defaultValue={record.invoiceStatus} onChange={(value) => setStatus(value as EnrollmentInvoiceStatus)}>
              <option value="pendente">Pendente de emissão</option>
              <option value="emitida">Emitida</option>
              <option value="dispensada">Não gera nota</option>
            </SelectInput>
            {status === "emitida" ? (
              <>
                <TextInput label="Número da nota" name="invoiceNumber" required defaultValue={record.invoiceNumber} />
                <TextInput label="Data de emissão" name="invoiceIssuedAt" type="date" defaultValue={toInputDate(record.invoiceIssuedAt)} />
              </>
            ) : (
              <p className="self-center text-xs font-semibold text-slate-500">
                {status === "dispensada"
                  ? "Explique abaixo por que esta matrícula não gera nota — é o que sustenta ela sair da fila de pendências."
                  : "A matrícula continua na fila de cobrança enquanto a nota não for emitida ou dispensada."}
              </p>
            )}
            <div className="md:col-span-2">
              <TextAreaInput
                label={status === "dispensada" ? "Motivo (obrigatório)" : "Observações"}
                name="invoiceNotes"
                defaultValue={record.invoiceNotes}
              />
            </div>
            <div className="md:col-span-2">
              <InvoiceFileInput label="Anexar nota fiscal" accept="image/*,.pdf" currentFilename={record.invoiceFilename} />
            </div>
          </div>
          {error ? <p className="mt-4 rounded-lg bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800">{error}</p> : null}
          <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4">
            <button type="button" onClick={onClose} disabled={saving} className="h-10 rounded-lg border border-slate-200 px-4 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancelar</button>
            <button disabled={saving} className="h-10 rounded-lg bg-slate-950 px-5 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-50">
              {saving ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
