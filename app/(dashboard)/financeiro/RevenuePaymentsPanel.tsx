"use client";

import { useEffect, useState } from "react";
import { Edit3, Plus, Trash2, X } from "lucide-react";
import type { CommissionStatus, FinanceCardBrand, FinanceRevenue, RevenuePayment, RevenuePaymentMethod } from "@/types/finance";
import {
  DecimalInput,
  Field,
  IconButton,
  InvoiceFileInput,
  InvoiceLinks,
  Options,
  SelectInput,
  StatusBadge,
  TextAreaInput,
  TextInput,
  dateLabel,
  formNumber,
  formOptionalNumber,
  formString,
  inputClass,
  money,
  percent,
  toInputDate,
} from "./FinanceiroClient";

const PAYMENT_METHOD_LABELS: Record<RevenuePaymentMethod, string> = {
  pix: "PIX",
  dinheiro: "Dinheiro",
  transferencia: "Transferência",
  debito: "Débito",
  credito: "Crédito",
  boleto: "Boleto",
  outros: "Outros",
};

const PAYMENT_METHODS: RevenuePaymentMethod[] = ["pix", "dinheiro", "transferencia", "debito", "credito", "boleto", "outros"];

async function apiJson(endpoint: string, method: "POST" | "PATCH" | "DELETE", body?: Record<string, unknown>) {
  const response = await fetch(endpoint, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data.error === "string" ? data.error : "Falha ao salvar pagamento.");
  }
  return data;
}

async function uploadInvoiceFile(endpoint: string, form: FormData) {
  const file = form.get("invoiceFile");
  if (!(file instanceof File) || file.size === 0) return;
  const upload = new FormData();
  upload.set("file", file);
  const response = await fetch(endpoint, { method: "POST", body: upload });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data.error === "string" ? data.error : "Pagamento salvo, mas o comprovante não foi enviado.");
  }
}

interface RevenuePaymentsPanelProps {
  revenue: FinanceRevenue;
  cardBrands: FinanceCardBrand[];
  onClose: () => void;
  /** Chamado após qualquer alteração — o pai atualiza o resumo exibido e força um refresh dos dados do servidor. */
  onChanged: (updatedRevenue: FinanceRevenue) => void;
}

export default function RevenuePaymentsPanel({ revenue, cardBrands, onClose, onChanged }: RevenuePaymentsPanelProps) {
  const [payments, setPayments] = useState<RevenuePayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [method, setMethod] = useState<RevenuePaymentMethod>("pix");

  async function loadPayments() {
    setLoading(true);
    try {
      const res = await fetch(`/api/finance/revenues/${revenue.id}/payments`);
      const data = await res.json().catch(() => ({}));
      setPayments(Array.isArray(data.payments) ? data.payments : []);
    } finally {
      setLoading(false);
    }
  }

  async function refreshRevenue() {
    const res = await fetch(`/api/finance/revenues/${revenue.id}`);
    const data = await res.json().catch(() => ({}));
    if (data.revenue) onChanged(data.revenue);
  }

  useEffect(() => {
    loadPayments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revenue.id]);

  async function handleAdd(form: HTMLFormElement) {
    const formData = new FormData(form);
    const body: Record<string, unknown> = {
      amount: formNumber(formData, "amount"),
      paymentDate: formString(formData, "paymentDate"),
      paymentMethod: formString(formData, "paymentMethod"),
      notes: formString(formData, "notes") || null,
    };
    if (formString(formData, "paymentMethod") === "credito") {
      body.installments = formOptionalNumber(formData, "installments") ?? 1;
      body.cardBrandId = formOptionalNumber(formData, "cardBrandId");
    }
    setSaving(true);
    setError(null);
    try {
      const result = await apiJson(`/api/finance/revenues/${revenue.id}/payments`, "POST", body);
      if (result.id) await uploadInvoiceFile(`/api/finance/revenue-payments/${result.id}/invoice`, formData);
      form.reset();
      setMethod("pix");
      await loadPayments();
      await refreshRevenue();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao lançar pagamento.");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(paymentId: number, form: HTMLFormElement) {
    const formData = new FormData(form);
    const body: Record<string, unknown> = {
      amount: formNumber(formData, "amount"),
      paymentDate: formString(formData, "paymentDate"),
      paymentMethod: formString(formData, "paymentMethod"),
      notes: formString(formData, "notes") || null,
    };
    if (formString(formData, "paymentMethod") === "credito") {
      body.installments = formOptionalNumber(formData, "installments") ?? 1;
      body.cardBrandId = formOptionalNumber(formData, "cardBrandId");
    }
    setSaving(true);
    setError(null);
    try {
      await apiJson(`/api/finance/revenue-payments/${paymentId}`, "PATCH", body);
      await uploadInvoiceFile(`/api/finance/revenue-payments/${paymentId}/invoice`, formData);
      setEditingId(null);
      await loadPayments();
      await refreshRevenue();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao atualizar pagamento.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(paymentId: number) {
    if (!window.confirm("Excluir este pagamento? O saldo e o status da receita serão recalculados.")) return;
    setSaving(true);
    setError(null);
    try {
      await apiJson(`/api/finance/revenue-payments/${paymentId}`, "DELETE");
      await loadPayments();
      await refreshRevenue();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao excluir pagamento.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleCommission(payment: RevenuePayment) {
    const next: CommissionStatus = payment.commissionStatus === "paga" ? "disponivel" : "paga";
    setSaving(true);
    try {
      await apiJson(`/api/finance/revenue-payments/${payment.id}/commission-status`, "PATCH", { status: next });
      await loadPayments();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao atualizar comissão.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-lg font-black text-slate-950">Histórico de Pagamentos</h2>
            <p className="text-sm text-slate-500">{revenue.description}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="grid size-9 place-content-center rounded-lg hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto p-5">
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <SummaryCard label="Valor Bruto" value={money(revenue.amount)} />
            <SummaryCard label="Recebido" value={money(revenue.paidAmount)} />
            <SummaryCard label="Saldo Restante" value={money(revenue.balanceRemaining)} />
            <SummaryCard label="Taxas" value={money(revenue.paymentsFeeTotal)} />
            <SummaryCard label="Comissão" value={money(revenue.paymentsCommissionTotal)} />
            <SummaryCard label="Líquido Recebido" value={money(revenue.netReceived)} />
          </div>

          {error ? <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">{error}</p> : null}

          <div className="mt-5 rounded-lg border border-slate-200">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    {["Data", "Forma", "Parcelas/Bandeira", "Valor Bruto", "Taxa", "Líquido", "Comissão", "Usuário", "Comprovante", "Ações"].map((label) => (
                      <th key={label} className="whitespace-nowrap px-3 py-2 text-left text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {loading ? (
                    <tr><td colSpan={10} className="px-4 py-8 text-center text-sm font-semibold text-slate-400">Carregando…</td></tr>
                  ) : payments.length === 0 ? (
                    <tr><td colSpan={10} className="px-4 py-8 text-center text-sm font-semibold text-slate-400">Nenhum pagamento lançado ainda</td></tr>
                  ) : (
                    payments.map((payment) =>
                      editingId === payment.id ? (
                        <tr key={payment.id} className="bg-cyan-50/40">
                          <td colSpan={10} className="px-3 py-3">
                            <PaymentInlineForm
                              cardBrands={cardBrands}
                              defaultValues={payment}
                              saving={saving}
                              onCancel={() => setEditingId(null)}
                              onSubmit={(form) => handleUpdate(payment.id, form)}
                            />
                          </td>
                        </tr>
                      ) : (
                        <tr key={payment.id} className="hover:bg-cyan-50/40">
                          <td className="whitespace-nowrap px-3 py-2 text-slate-700">{dateLabel(payment.paymentDate)}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-slate-700">{PAYMENT_METHOD_LABELS[payment.paymentMethod]}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                            {payment.paymentMethod === "credito"
                              ? `${payment.installments ?? 1}x${payment.cardBrandName ? ` · ${payment.cardBrandName}` : ""}`
                              : "-"}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-slate-700">{money(payment.amount)}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                            {money(payment.feeAmount)}
                            {payment.feePct !== null ? <span className="ml-1 text-xs text-slate-400">({percent(payment.feePct)})</span> : null}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 font-bold text-slate-900">{money(payment.netAmount)}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                            <button type="button" onClick={() => handleToggleCommission(payment)} className="inline-flex items-center gap-1.5">
                              {money(payment.commissionAmount)}
                              <StatusBadge status={payment.commissionStatus === "paga" ? "pago" : "pendente"} label={payment.commissionStatus === "paga" ? "Paga" : "Disponível"} />
                            </button>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{payment.createdByName ?? "-"}</td>
                          <td className="whitespace-nowrap px-3 py-2">
                            <InvoiceLinks fileHref={payment.hasInvoiceFile ? `/api/finance/revenue-payments/${payment.id}/invoice` : null} filename={payment.invoiceFilename} />
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-right">
                            <div className="inline-flex items-center gap-1.5">
                              <IconButton title="Editar pagamento" onClick={() => setEditingId(payment.id)}><Edit3 size={14} /></IconButton>
                              <IconButton title="Excluir pagamento" onClick={() => handleDelete(payment.id)} danger><Trash2 size={14} /></IconButton>
                            </div>
                          </td>
                        </tr>
                      )
                    )
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-5 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4">
            <p className="mb-3 text-sm font-black text-slate-900">Lançar novo pagamento</p>
            <PaymentInlineForm
              cardBrands={cardBrands}
              saving={saving}
              submitLabel="Lançar pagamento"
              methodOverride={method}
              onMethodChange={setMethod}
              onSubmit={handleAdd}
            />
          </div>
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

function PaymentInlineForm({
  cardBrands,
  defaultValues,
  saving,
  submitLabel = "Salvar",
  methodOverride,
  onMethodChange,
  onCancel,
  onSubmit,
}: {
  cardBrands: FinanceCardBrand[];
  defaultValues?: RevenuePayment;
  saving: boolean;
  submitLabel?: string;
  methodOverride?: RevenuePaymentMethod;
  onMethodChange?: (method: RevenuePaymentMethod) => void;
  onCancel?: () => void;
  onSubmit: (form: HTMLFormElement) => void;
}) {
  const [method, setMethod] = useState<RevenuePaymentMethod>(methodOverride ?? defaultValues?.paymentMethod ?? "pix");

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(event.currentTarget);
      }}
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
    >
      <DecimalInput label="Valor pago" name="amount" required defaultValue={defaultValues?.amount} />
      <TextInput label="Data" name="paymentDate" type="date" required defaultValue={toInputDate(defaultValues?.paymentDate) || new Date().toISOString().slice(0, 10)} />
      <SelectInput
        label="Forma de pagamento"
        name="paymentMethod"
        defaultValue={method}
        onChange={(value) => {
          const next = value as RevenuePaymentMethod;
          setMethod(next);
          onMethodChange?.(next);
        }}
      >
        {PAYMENT_METHODS.map((value) => (
          <option key={value} value={value}>{PAYMENT_METHOD_LABELS[value]}</option>
        ))}
      </SelectInput>
      {method === "credito" ? (
        <>
          <Field label="Parcelas">
            <select name="installments" defaultValue={defaultValues?.installments ?? 1} className={inputClass}>
              {Array.from({ length: 24 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>{n}x</option>
              ))}
            </select>
          </Field>
          <SelectInput label="Bandeira" name="cardBrandId" defaultValue={defaultValues?.cardBrandId}>
            <Options items={cardBrands} emptyLabel="Sem bandeira (taxa padrão)" />
          </SelectInput>
        </>
      ) : null}
      <InvoiceFileInput label="Anexar comprovante" accept="image/*,.pdf" currentFilename={defaultValues?.invoiceFilename} />
      <div className="sm:col-span-2 xl:col-span-4"><TextAreaInput label="Observação (opcional)" name="notes" defaultValue={defaultValues?.notes} /></div>
      <div className="flex items-center gap-2 sm:col-span-2 xl:col-span-4">
        <button disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-50">
          <Plus size={15} />
          {saving ? "Salvando..." : submitLabel}
        </button>
        {onCancel ? (
          <button type="button" onClick={onCancel} className="h-10 rounded-lg border border-slate-200 px-4 text-sm font-bold text-slate-700 hover:bg-slate-50">
            Cancelar
          </button>
        ) : null}
      </div>
    </form>
  );
}
