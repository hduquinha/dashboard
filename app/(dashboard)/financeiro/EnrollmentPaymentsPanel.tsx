"use client";

import { useEffect, useState } from "react";
import { Edit3, ExternalLink, Plus, Trash2, X } from "lucide-react";
import type {
  EnrollmentPayment,
  EnrollmentScheduleShift,
  FinanceCardBrand,
  FinanceEnrollment,
  FinanceRevenue,
  RevenuePaymentMethod,
} from "@/types/finance";
import {
  Field,
  IconButton,
  InvoiceFileInput,
  InvoiceLinks,
  Options,
  SelectInput,
  TextAreaInput,
  TextInput,
  dateLabel,
  formNumber,
  formOptionalNumber,
  formString,
  inputClass,
  money,
  parseDecimal,
  percent,
  toInputDate,
} from "./FinanceiroClient";

export const PAYMENT_METHOD_LABELS: Record<RevenuePaymentMethod, string> = {
  pix: "PIX",
  dinheiro: "Dinheiro",
  transferencia: "Transferência",
  debito: "Débito",
  credito: "Crédito",
  boleto: "Boleto",
  outros: "Outros",
};

export const PAYMENT_METHODS: RevenuePaymentMethod[] = ["pix", "dinheiro", "transferencia", "debito", "credito", "boleto", "outros"];

async function apiJson(endpoint: string, method: "POST" | "PATCH" | "DELETE", body?: Record<string, unknown>) {
  const response = await fetch(endpoint, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Falha ao salvar pagamento.");
  return data;
}

async function uploadInvoiceFile(endpoint: string, form: FormData) {
  const file = form.get("invoiceFile");
  if (!(file instanceof File) || file.size === 0) return;
  const upload = new FormData();
  upload.set("file", file);
  const response = await fetch(endpoint, { method: "POST", body: upload });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Pagamento salvo, mas o comprovante não foi enviado.");
}

function paymentPayload(form: FormData): Record<string, unknown> {
  const paymentMethod = formString(form, "paymentMethod");
  const revenueIds = form
    .getAll("revenueIds")
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
  const body: Record<string, unknown> = {
    amount: formNumber(form, "amount"),
    paymentDate: formString(form, "paymentDate"),
    paymentMethod,
    installments: formOptionalNumber(form, "installments") ?? 1,
    revenueIds,
    redistributeShortfall: form.get("redistributeShortfall") === "on",
    notes: formString(form, "notes") || null,
    asaasPaymentUrl: formString(form, "asaasPaymentUrl") || null,
  };
  if (paymentMethod === "credito") {
    body.cardBrandId = formOptionalNumber(form, "cardBrandId");
  }
  return body;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

/** Mesma divisão do servidor: centavos exatos, com a última parcela absorvendo o resto. */
function splitCents(total: number, count: number): number[] {
  const parts = Math.max(1, Math.trunc(count));
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / parts);
  const remainder = cents - base * parts;
  return Array.from({ length: parts }, (_, index) => (base + (index === parts - 1 ? remainder : 0)) / 100);
}

interface RedistributionPreview {
  shortfall: number;
  settled: Array<{ revenue: FinanceRevenue; after: number }>;
  absorbers: Array<{ revenue: FinanceRevenue; after: number }>;
}

/**
 * Espelha `planShortfallRedistribution` do servidor para que a pessoa veja o
 * cronograma novo ANTES de gravar. Só faz sentido num lançamento novo: numa
 * edição, o saldo das parcelas já embute o rateio do próprio pagamento.
 */
function previewRedistribution(
  revenues: FinanceRevenue[],
  selectedRevenueIds: number[],
  amount: number
): RedistributionPreview | null {
  if (selectedRevenueIds.length === 0 || !(amount > 0)) return null;
  const selected = revenues
    .filter((revenue) => selectedRevenueIds.includes(revenue.id) && revenue.status !== "cancelado")
    .sort((a, b) => a.date.localeCompare(b.date) || (a.installmentNumber ?? 0) - (b.installmentNumber ?? 0) || a.id - b.id);

  let remaining = round2(amount);
  const settled: RedistributionPreview["settled"] = [];
  for (const revenue of selected) {
    const available = Math.max(0, round2(revenue.balanceRemaining));
    const allocated = Math.min(available, remaining);
    if (allocated <= 0.005) continue;
    remaining = round2(remaining - allocated);
    if (available - allocated > 0.005) settled.push({ revenue, after: round2(revenue.paidAmount + allocated) });
  }
  const shortfall = round2(settled.reduce((total, item) => total + (item.revenue.amount - item.after), 0));
  if (shortfall <= 0.005) return null;

  const open = revenues.filter(
    (revenue) =>
      !selectedRevenueIds.includes(revenue.id) &&
      revenue.status !== "cancelado" &&
      (revenue.installmentNumber ?? 0) > 0 &&
      revenue.paidAmount <= 0.005
  );
  const shares = splitCents(round2(open.reduce((total, revenue) => total + revenue.amount, 0) + shortfall), open.length);
  return {
    shortfall,
    settled,
    absorbers: open.map((revenue, index) => ({ revenue, after: shares[index] })),
  };
}

/** Quanto saiu das parcelas quitadas e foi parar nas que continuaram abertas. */
function shiftShortfall(shift: EnrollmentScheduleShift[]) {
  return round2(shift.reduce((total, entry) => total + Math.max(0, entry.before - entry.after), 0));
}

function installmentLabel(revenue: FinanceRevenue) {
  if (revenue.installmentNumber === 0) return "Entrada";
  return revenue.installmentNumber ? `${revenue.installmentNumber}ª parcela` : "Parcela";
}

interface EnrollmentPaymentsPanelProps {
  enrollmentId: number;
  cardBrands: FinanceCardBrand[];
  readOnly?: boolean;
  onClose: () => void;
  onChanged: (updatedEnrollment: FinanceEnrollment) => void;
}

export default function EnrollmentPaymentsPanel({ enrollmentId, cardBrands, readOnly = false, onClose, onChanged }: EnrollmentPaymentsPanelProps) {
  const [enrollment, setEnrollment] = useState<FinanceEnrollment | null>(null);
  const [revenues, setRevenues] = useState<FinanceRevenue[]>([]);
  const [payments, setPayments] = useState<EnrollmentPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [newPaymentMethod, setNewPaymentMethod] = useState<RevenuePaymentMethod>("pix");
  const [newPaymentFormKey, setNewPaymentFormKey] = useState(0);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [enrollmentResponse, paymentsResponse] = await Promise.all([
        fetch(`/api/finance/enrollments/${enrollmentId}`),
        fetch(`/api/finance/enrollments/${enrollmentId}/payments`),
      ]);
      const [enrollmentData, paymentsData] = await Promise.all([
        enrollmentResponse.json().catch(() => ({})),
        paymentsResponse.json().catch(() => ({})),
      ]);
      if (!enrollmentResponse.ok) throw new Error(typeof enrollmentData.error === "string" ? enrollmentData.error : "Falha ao carregar matrícula.");
      if (!paymentsResponse.ok) throw new Error(typeof paymentsData.error === "string" ? paymentsData.error : "Falha ao carregar pagamentos.");
      setEnrollment(enrollmentData.enrollment ?? null);
      setRevenues(Array.isArray(enrollmentData.revenues) ? enrollmentData.revenues : []);
      setPayments(Array.isArray(paymentsData.payments) ? paymentsData.payments : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Falha ao carregar pagamentos.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // O identificador da matrícula define integralmente os dados carregados.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enrollmentId]);

  async function reloadAndNotify(updatedEnrollment?: FinanceEnrollment) {
    if (updatedEnrollment) onChanged(updatedEnrollment);
    await load();
  }

  async function handleAdd(form: HTMLFormElement) {
    const formData = new FormData(form);
    setSaving(true);
    setError(null);
    try {
      const result = await apiJson(`/api/finance/enrollments/${enrollmentId}/payments`, "POST", paymentPayload(formData));
      if (result.id) await uploadInvoiceFile(`/api/finance/enrollment-payments/${result.id}/invoice`, formData);
      setNewPaymentMethod("pix");
      setNewPaymentFormKey((value) => value + 1);
      await reloadAndNotify(result.enrollment);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Falha ao lançar pagamento.");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(paymentId: number, form: HTMLFormElement) {
    const formData = new FormData(form);
    setSaving(true);
    setError(null);
    try {
      const result = await apiJson(`/api/finance/enrollment-payments/${paymentId}`, "PATCH", paymentPayload(formData));
      await uploadInvoiceFile(`/api/finance/enrollment-payments/${paymentId}/invoice`, formData);
      setEditingId(null);
      await reloadAndNotify(result.enrollment);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Falha ao atualizar pagamento.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(paymentId: number) {
    if (!window.confirm("Excluir este pagamento? O saldo da matrícula será recalculado.")) return;
    setSaving(true);
    setError(null);
    try {
      const result = await apiJson(`/api/finance/enrollment-payments/${paymentId}`, "DELETE");
      await reloadAndNotify(result.enrollment);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Falha ao excluir pagamento.");
    } finally {
      setSaving(false);
    }
  }

  const title = enrollment ? `Matrícula · ${enrollment.student}` : "Histórico de pagamentos da matrícula";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={title}>
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-lg font-black text-slate-950">{readOnly ? "Matrícula e recebimentos" : "Histórico de pagamentos"}</h2>
            <p className="text-sm text-slate-500">{enrollment ? `${enrollment.student}${enrollment.courseName ? ` · ${enrollment.courseName}` : ""}` : "Carregando matrícula..."}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="grid size-9 place-content-center rounded-lg hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto p-5">
          {enrollment ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <SummaryCard label="Valor contratado" value={money(enrollment.totalAmount)} />
              <SummaryCard label="Recebido" value={money(enrollment.paidAmount)} />
              <SummaryCard label="Saldo restante" value={money(enrollment.balanceRemaining)} />
              <SummaryCard label="Taxas reais" value={money(enrollment.paymentsFeeTotal)} />
              <SummaryCard label="Líquido recebido" value={money(enrollment.netReceived)} />
            </div>
          ) : null}

          {error ? <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">{error}</p> : null}

          <div className="mt-5 rounded-lg border border-slate-200">
            <div className="border-b border-slate-100 px-4 py-3">
              <p className="text-sm font-black text-slate-900">Parcelas previstas</p>
              <p className="text-xs text-slate-500">Um recebimento pode quitar uma ou mais parcelas. O caixa entra na data do pagamento, enquanto cada parcela selecionada fica marcada como quitada.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    {["Mês", "Parcela", "Previsto", "Recebido", "Saldo", "Situação"].map((label) => (
                      <th key={label} className="whitespace-nowrap px-3 py-2 text-left text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {loading ? <tr><td colSpan={6} className="px-4 py-6 text-center text-sm font-semibold text-slate-400">Carregando parcelas…</td></tr> : null}
                  {!loading && revenues.length === 0 ? <tr><td colSpan={6} className="px-4 py-6 text-center text-sm font-semibold text-slate-400">Esta matrícula não possui parcelas previstas.</td></tr> : null}
                  {!loading ? revenues.map((revenue) => (
                    <tr key={revenue.id}>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-700">{dateLabel(revenue.date)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-700">{revenue.installmentNumber === 0 ? "Entrada" : revenue.installmentNumber ? `${revenue.installmentNumber}ª` : "-"}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-700">{money(revenue.amount)}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-semibold text-emerald-700">{money(revenue.paidAmount)}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-semibold text-slate-900">{money(revenue.balanceRemaining)}</td>
                      <td className="whitespace-nowrap px-3 py-2"><RevenueStatus value={revenue.status} /></td>
                    </tr>
                  )) : null}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-5 rounded-lg border border-slate-200">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    {["Data", "Referente a", "Forma", "Parcelas/Bandeira", "Valor bruto", "Taxa", "Líquido", "Usuário", "Comprovante / Asaas", ...(readOnly ? [] : ["Ações"])].map((label) => (
                      <th key={label} className="whitespace-nowrap px-3 py-2 text-left text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {loading ? (
                    <tr><td colSpan={readOnly ? 9 : 10} className="px-4 py-8 text-center text-sm font-semibold text-slate-400">Carregando…</td></tr>
                  ) : payments.length === 0 ? (
                    <tr><td colSpan={readOnly ? 9 : 10} className="px-4 py-8 text-center text-sm font-semibold text-slate-400">Nenhum pagamento lançado ainda.</td></tr>
                  ) : payments.map((payment) => (
                    editingId === payment.id ? (
                      <tr key={payment.id} className="bg-cyan-50/40">
                        <td colSpan={10} className="px-3 py-3">
                          <EnrollmentPaymentForm cardBrands={cardBrands} revenues={revenues} defaultValues={payment} saving={saving} onCancel={() => setEditingId(null)} onSubmit={(form) => handleUpdate(payment.id, form)} />
                        </td>
                      </tr>
                    ) : (
                      <tr key={payment.id} className="hover:bg-cyan-50/40">
                        <td className="whitespace-nowrap px-3 py-2 text-slate-700">{dateLabel(payment.paymentDate)}</td>
                        <td className="px-3 py-2 text-xs text-slate-600">
                          {payment.allocations.length > 0
                            ? payment.allocations.map((allocation) => (
                              <div key={allocation.revenueId}>
                                <span className="font-bold text-slate-800">{dateLabel(allocation.revenueDate)}</span>
                                {allocation.installmentNumber === 0 ? " · entrada" : allocation.installmentNumber ? ` · ${allocation.installmentNumber}ª parcela` : ""}
                                {` · ${money(allocation.amount)}`}
                              </div>
                            ))
                            : payment.revenueDate
                              ? <><span className="font-bold text-slate-800">{dateLabel(payment.revenueDate)}</span>{payment.installmentNumber === 0 ? " · entrada" : payment.installmentNumber ? ` · ${payment.installmentNumber}ª parcela` : ""}</>
                              : "Não vinculada"}
                          {payment.scheduleShift.length > 0 ? (
                            <span className="mt-1 block rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-bold text-amber-900">
                              Quitou por menos: {money(shiftShortfall(payment.scheduleShift))} remanejados no cronograma
                            </span>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-slate-700">{PAYMENT_METHOD_LABELS[payment.paymentMethod]}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                          {`${payment.installments ?? 1}x${payment.paymentMethod === "credito" && payment.cardBrandName ? ` · ${payment.cardBrandName}` : ""}`}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-slate-700">{money(payment.amount)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-slate-700">{money(payment.feeAmount)}{payment.feePct !== null ? <span className="ml-1 text-xs text-slate-400">({percent(payment.feePct)})</span> : null}</td>
                        <td className="whitespace-nowrap px-3 py-2 font-bold text-slate-900">{money(payment.netAmount)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{payment.createdByName ?? "-"}</td>
                        <td className="whitespace-nowrap px-3 py-2">
                          <div className="flex items-center gap-2">
                            <InvoiceLinks fileHref={payment.hasInvoiceFile ? `/api/finance/enrollment-payments/${payment.id}/invoice` : null} filename={payment.invoiceFilename} />
                            {payment.asaasPaymentUrl ? <a href={payment.asaasPaymentUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-cyan-700 hover:underline"><ExternalLink size={13} />Asaas</a> : null}
                          </div>
                        </td>
                        {!readOnly ? <td className="whitespace-nowrap px-3 py-2 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <IconButton title="Editar pagamento" onClick={() => setEditingId(payment.id)}><Edit3 size={14} /></IconButton>
                            <IconButton title="Excluir pagamento" onClick={() => handleDelete(payment.id)} danger><Trash2 size={14} /></IconButton>
                          </div>
                        </td> : null}
                      </tr>
                    )
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {!readOnly ? <div className="mt-5 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4">
            <p className="mb-1 text-sm font-black text-slate-900">Registrar pagamento</p>
            <p className="mb-3 text-xs text-slate-500">Selecione uma ou mais parcelas para quitar. O valor recebido é contabilizado na data informada, inclusive quando houver antecipação de meses futuros.</p>
            <EnrollmentPaymentForm key={newPaymentFormKey} cardBrands={cardBrands} revenues={revenues} saving={saving} submitLabel="Registrar pagamento" methodOverride={newPaymentMethod} onMethodChange={setNewPaymentMethod} onSubmit={handleAdd} />
          </div> : null}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-1 text-base font-black text-slate-950">{value}</p>
    </div>
  );
}

function RevenueStatus({ value }: { value: FinanceRevenue["status"] }) {
  const labels = { recebido: "Recebido", parcial: "Parcial", atrasado: "Em atraso", previsto: "A receber", cancelado: "Cancelado" } as const;
  const colors = {
    recebido: "bg-emerald-50 text-emerald-700",
    parcial: "bg-amber-50 text-amber-700",
    atrasado: "bg-rose-50 text-rose-700",
    previsto: "bg-sky-50 text-sky-700",
    cancelado: "bg-slate-100 text-slate-500",
  } as const;
  return <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-wide ${colors[value]}`}>{labels[value]}</span>;
}

function EnrollmentPaymentForm({
  cardBrands,
  revenues,
  defaultValues,
  saving,
  submitLabel = "Salvar",
  methodOverride,
  onMethodChange,
  onCancel,
  onSubmit,
}: {
  cardBrands: FinanceCardBrand[];
  revenues: FinanceRevenue[];
  defaultValues?: EnrollmentPayment;
  saving: boolean;
  submitLabel?: string;
  methodOverride?: RevenuePaymentMethod;
  onMethodChange?: (method: RevenuePaymentMethod) => void;
  onCancel?: () => void;
  onSubmit: (form: HTMLFormElement) => void;
}) {
  const [method, setMethod] = useState<RevenuePaymentMethod>(methodOverride ?? defaultValues?.paymentMethod ?? "pix");
  const [amount, setAmount] = useState(String(defaultValues?.amount ?? ""));
  const initialRevenueIds = defaultValues?.allocations.length
    ? defaultValues.allocations.map((allocation) => allocation.revenueId)
    : defaultValues?.revenueId
      ? [defaultValues.revenueId]
      : [];
  const [selectedRevenueIds, setSelectedRevenueIds] = useState<number[]>(initialRevenueIds);
  const [redistribute, setRedistribute] = useState(true);
  const selectedBalance = revenues
    .filter((revenue) => selectedRevenueIds.includes(revenue.id))
    .reduce((total, revenue) => total + Math.max(0, revenue.balanceRemaining), 0);
  // Na edição os saldos já embutem o rateio do próprio pagamento, então a
  // prévia mentiria; a opção continua disponível, só sem o comparativo.
  const preview = defaultValues ? null : previewRedistribution(revenues, selectedRevenueIds, parseDecimal(amount));

  function toggleRevenue(revenueId: number) {
    setSelectedRevenueIds((current) =>
      current.includes(revenueId) ? current.filter((id) => id !== revenueId) : [...current, revenueId]
    );
  }

  function fillAmount(value: number) {
    setAmount(Math.round(value * 100) / 100 === 0 ? "" : String(Math.round(value * 100) / 100));
  }

  function selectAllOpenInstallments() {
    const open = revenues.filter((revenue) => revenue.balanceRemaining > 0.005);
    setSelectedRevenueIds(open.map((revenue) => revenue.id));
    fillAmount(open.reduce((total, revenue) => total + revenue.balanceRemaining, 0));
  }

  return (
    <form onSubmit={(event) => { event.preventDefault(); onSubmit(event.currentTarget); }} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Field label="Valor recebido agora">
        <input name="amount" type="text" inputMode="decimal" required value={amount} onChange={(event) => setAmount(event.target.value)} className={inputClass} />
      </Field>
      <TextInput label="Data" name="paymentDate" type="date" required defaultValue={toInputDate(defaultValues?.paymentDate) || new Date().toISOString().slice(0, 10)} />
      <fieldset className="sm:col-span-2 xl:col-span-2">
        <legend className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Parcelas quitadas neste recebimento</legend>
        <div className="mt-1 max-h-32 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2">
          {revenues.map((revenue) => {
            const selected = selectedRevenueIds.includes(revenue.id);
            const closed = revenue.balanceRemaining <= 0.005 && !selected;
            const label = revenue.installmentNumber === 0
              ? "Entrada"
              : revenue.installmentNumber
                ? `${revenue.installmentNumber}ª parcela`
                : "Parcela";
            return (
              <label key={revenue.id} className={`flex cursor-pointer items-center justify-between gap-3 rounded px-2 py-1.5 text-xs ${closed ? "cursor-not-allowed text-slate-400" : "text-slate-700 hover:bg-slate-50"}`}>
                <span className="flex min-w-0 items-center gap-2">
                  <input
                    type="checkbox"
                    name="revenueIds"
                    value={revenue.id}
                    checked={selected}
                    disabled={closed}
                    onChange={() => toggleRevenue(revenue.id)}
                  />
                  <span className="truncate">{dateLabel(revenue.date)} · {label}</span>
                </span>
                <span className="whitespace-nowrap font-bold">{money(revenue.balanceRemaining)}</span>
              </label>
            );
          })}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={() => fillAmount(selectedBalance)} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50">Usar saldo selecionado ({money(selectedBalance)})</button>
          <button type="button" onClick={selectAllOpenInstallments} className="rounded-md bg-cyan-100 px-2 py-1 text-xs font-black text-cyan-900 hover:bg-cyan-200">Quitar saldo total agora</button>
        </div>
        <p className="mt-1 text-xs text-slate-500">Para antecipar, selecione as parcelas futuras e use o saldo selecionado. Para quitar a matrícula antes do prazo, use “Quitar saldo total agora”. Sem seleção, será usada a parcela do mês da data.</p>
      </fieldset>

      <div className="sm:col-span-2 xl:col-span-4">
        <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
          <input type="checkbox" name="redistributeShortfall" checked={redistribute} onChange={(event) => setRedistribute(event.target.checked)} className="mt-0.5" />
          <span>
            <span className="font-black text-slate-900">Pagando menos que o saldo marcado, quitar as parcelas mesmo assim</span>
            <span className="block text-slate-500">A diferença é remanejada em partes iguais para as parcelas ainda em aberto. O valor do contrato não muda — é adiamento, não desconto. Desmarcado, a última parcela marcada fica parcial.</span>
          </span>
        </label>
        {preview ? (
          redistribute ? (
            preview.absorbers.length > 0 ? (
              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
                <p className="font-black">Diferença de {money(preview.shortfall)} será remanejada</p>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="font-bold uppercase tracking-wide text-[10px] text-amber-800">Ficam quitadas por menos</p>
                    {preview.settled.map((item) => (
                      <p key={item.revenue.id}>{installmentLabel(item.revenue)}: {money(item.revenue.amount)} → <strong>{money(item.after)}</strong></p>
                    ))}
                  </div>
                  <div>
                    <p className="font-bold uppercase tracking-wide text-[10px] text-amber-800">Absorvem a diferença</p>
                    {preview.absorbers.map((item) => (
                      <p key={item.revenue.id}>{installmentLabel(item.revenue)}: {money(item.revenue.amount)} → <strong>{money(item.after)}</strong></p>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-800">
                Não há parcela em aberto para absorver a diferença de {money(preview.shortfall)}. A última parcela marcada ficará parcial com esse saldo.
              </p>
            )
          ) : (
            <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs font-bold text-slate-600">
              A última parcela marcada ficará parcial com {money(preview.shortfall)} em aberto.
            </p>
          )
        ) : null}
      </div>
      <SelectInput label="Forma de pagamento" name="paymentMethod" defaultValue={method} onChange={(value) => { const next = value as RevenuePaymentMethod; setMethod(next); onMethodChange?.(next); }}>
        {PAYMENT_METHODS.map((value) => <option key={value} value={value}>{PAYMENT_METHOD_LABELS[value]}</option>)}
      </SelectInput>
      {method === "credito" ? (
        <>
          <Field label="Parcelas no cartão">
            <select name="installments" defaultValue={defaultValues?.installments ?? 1} className={inputClass}>
              {Array.from({ length: 24 }, (_, index) => index + 1).map((installment) => <option key={installment} value={installment}>{installment}x</option>)}
            </select>
            <p className="text-xs text-slate-500">É a divisão deste pagamento pela operadora; não altera o cronograma da matrícula.</p>
          </Field>
          <SelectInput label="Bandeira" name="cardBrandId" defaultValue={defaultValues?.cardBrandId}>
            <Options items={cardBrands} emptyLabel="Sem bandeira (taxa padrão)" />
          </SelectInput>
        </>
      ) : null}
      <TextInput label="Link de cobrança Asaas (opcional)" name="asaasPaymentUrl" type="url" defaultValue={defaultValues?.asaasPaymentUrl} />
      <InvoiceFileInput label="Anexar comprovante" accept="image/*,.pdf" currentFilename={defaultValues?.invoiceFilename} />
      <div className="sm:col-span-2 xl:col-span-4"><TextAreaInput label="Observação (opcional)" name="notes" defaultValue={defaultValues?.notes} /></div>
      <div className="flex items-center gap-2 sm:col-span-2 xl:col-span-4">
        <button disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-50"><Plus size={15} />{saving ? "Salvando..." : submitLabel}</button>
        {onCancel ? <button type="button" onClick={onCancel} className="h-10 rounded-lg border border-slate-200 px-4 text-sm font-bold text-slate-700 hover:bg-slate-50">Cancelar</button> : null}
      </div>
    </form>
  );
}
