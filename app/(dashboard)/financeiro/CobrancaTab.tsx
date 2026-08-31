"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ExternalLink, Wallet } from "lucide-react";
import type {
  EnrollmentPaymentHealth,
  FinanceCardBrand,
  FinanceRevenue,
  RevenuePaymentMethod,
} from "@/types/finance";
import { daysOverdue, guessPaymentMethodKey, receivableDueDate, receivableStatus, todayIso } from "@/lib/receivables";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from "./EnrollmentPaymentsPanel";
import {
  Field,
  KpiMini,
  Section,
  SectionHeader,
  SmartTable,
  StatusBadge,
  dateLabel,
  inputClass,
  money,
} from "./FinanceiroClient";

/**
 * Aba Cobrança — o mês visto pelo VENCIMENTO.
 *
 * A aba Receitas responde "quanto este mês faturou" e é só leitura; a aba
 * Matrículas trabalha um contrato por vez. Faltava a pergunta do dia a dia:
 * "o que eu tenho para receber este mês, o que já entrou e o que está
 * vencido" — que numa venda em 24x é a única forma de acompanhar sem abrir
 * contrato por contrato.
 */

const STATUS_LABELS: Record<string, string> = {
  recebido: "Recebido",
  parcial: "Parcial",
  atrasado: "Vencido",
  previsto: "A vencer",
  cancelado: "Cancelado",
};

/**
 * Quanto ESTA parcela recebeu, no máximo o valor dela.
 *
 * O rateio de pagamentos antigos foi migrado apontando o valor cheio para a
 * parcela que o pagamento citava, então há parcela de R$ 600 com R$ 4.050
 * alocados — dinheiro real, mas de outras parcelas do mesmo contrato. Somar o
 * bruto faria "já recebido" passar de "a receber" no mesmo mês.
 */
function settledOnInstallment(row: FinanceRevenue): number {
  return Math.min(row.paidAmount, row.amount);
}

function installmentLabel(row: FinanceRevenue): string {
  if (row.installmentNumber === 0) return "Entrada";
  return row.installmentNumber ? `${row.installmentNumber}ª parcela` : "Parcela";
}

async function postPayment(enrollmentId: number, body: Record<string, unknown>) {
  const response = await fetch(`/api/finance/enrollments/${enrollmentId}/payments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Falha ao dar baixa na parcela.");
  return data;
}

/**
 * Baixa de uma parcela só.
 *
 * Passa pela mesma rota de pagamento da matrícula (`POST /enrollments/:id/payments`)
 * com a parcela já marcada, em vez de escrever direto na receita: taxa da
 * maquininha, comissão e a cascata de recebimentos moram lá. Uma baixa que
 * gravasse `status = recebido` na mão deixaria o contrato sem o pagamento
 * correspondente — exatamente o buraco que existe hoje em matrícula cujo
 * dinheiro só foi anotado em texto.
 *
 * O rateio de sobra fica desligado: aqui a pessoa está quitando UMA parcela, e
 * receber menos que ela significa parcela parcial, não renegociação do saldo.
 */
function BaixaModal({
  row,
  cardBrands,
  onClose,
  onDone,
}: {
  row: FinanceRevenue;
  cardBrands: FinanceCardBrand[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [amount, setAmount] = useState(String(row.balanceRemaining.toFixed(2)));
  const [paymentDate, setPaymentDate] = useState(todayIso());
  const [method, setMethod] = useState<RevenuePaymentMethod>(guessPaymentMethodKey(row.paymentMethodName));
  const [cardBrandId, setCardBrandId] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedAmount = Number(amount.replace(/\./g, "").replace(",", "."));
  const partial = Number.isFinite(parsedAmount) && parsedAmount > 0 && parsedAmount < row.balanceRemaining - 0.005;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError("Informe o valor recebido.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await postPayment(row.enrollmentId as number, {
        amount: parsedAmount,
        paymentDate,
        paymentMethod: method,
        installments: 1,
        cardBrandId: method === "credito" && cardBrandId ? Number(cardBrandId) : null,
        revenueIds: [row.id],
        redistributeShortfall: false,
        notes: notes.trim() || null,
      });
      onDone(partial ? "Baixa parcial registrada." : "Parcela baixada.");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Falha ao dar baixa na parcela.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-4 sm:items-center">
      <form onSubmit={submit} className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-black text-slate-950">Dar baixa na parcela</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            {row.student ?? "Aluno"} · {installmentLabel(row)} · vence {dateLabel(receivableDueDate(row))}
          </p>
        </div>
        <div className="space-y-3 px-5 py-4">
          {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{error}</p> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Valor recebido">
              <input value={amount} onChange={(event) => setAmount(event.target.value)} className={inputClass} inputMode="decimal" />
            </Field>
            <Field label="Data do recebimento">
              <input type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} className={inputClass} />
            </Field>
            <Field label="Forma de pagamento">
              <select value={method} onChange={(event) => setMethod(event.target.value as RevenuePaymentMethod)} className={inputClass}>
                {PAYMENT_METHODS.map((item) => (
                  <option key={item} value={item}>
                    {PAYMENT_METHOD_LABELS[item]}
                  </option>
                ))}
              </select>
            </Field>
            {method === "credito" ? (
              <Field label="Bandeira">
                <select value={cardBrandId} onChange={(event) => setCardBrandId(event.target.value)} className={inputClass}>
                  <option value="">Taxa padrão</option>
                  {cardBrands.map((brand) => (
                    <option key={brand.id} value={brand.id}>
                      {brand.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
          </div>
          <Field label="Observação (opcional)">
            <input value={notes} onChange={(event) => setNotes(event.target.value)} className={inputClass} />
          </Field>
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Saldo desta parcela: <strong>{money(row.balanceRemaining)}</strong>
            {partial ? " — o valor informado é menor, então ela fica como parcial e o restante continua em aberto." : null}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600">
            Cancelar
          </button>
          <button type="submit" disabled={saving} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-black text-white disabled:opacity-60">
            {saving ? "Registrando…" : "Confirmar baixa"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ReceivableTable({
  rows,
  today,
  emptyLabel,
  showOverdueDays,
  toReconcile,
  onSettle,
  onOpenEnrollment,
}: {
  rows: FinanceRevenue[];
  today: string;
  emptyLabel: string;
  showOverdueDays: boolean;
  /** Contratos cujo dinheiro já entrou e só falta vincular à parcela. */
  toReconcile?: Set<number>;
  onSettle: (row: FinanceRevenue) => void;
  onOpenEnrollment: (enrollmentId: number) => void;
}) {
  if (rows.length === 0) {
    return <p className="px-5 py-6 text-sm text-slate-500">{emptyLabel}</p>;
  }
  return (
    <div className="p-5">
      <SmartTable
        rows={rows}
        defaultSortKey="due"
        defaultSortDir="asc"
        searchPlaceholder="Pesquisar aluno, curso ou forma de pagamento"
        columns={[
          {
            key: "due",
            label: "Vencimento",
            render: (r) => dateLabel(receivableDueDate(r)),
            value: (r) => receivableDueDate(r),
          },
          { key: "student", label: "Aluno", render: (r) => r.student ?? "-", value: (r) => r.student },
          { key: "installment", label: "Parcela", render: (r) => installmentLabel(r), value: (r) => r.installmentNumber ?? 0 },
          { key: "course", label: "Curso", render: (r) => r.courseName ?? "-", value: (r) => r.courseName },
          { key: "method", label: "Forma", render: (r) => r.paymentMethodName ?? "-", value: (r) => r.paymentMethodName },
          { key: "amount", label: "Valor", render: (r) => money(r.amount), value: (r) => r.amount },
          { key: "paid", label: "Recebido", render: (r) => money(settledOnInstallment(r)), value: (r) => settledOnInstallment(r) },
          { key: "balance", label: "Em aberto", render: (r) => money(r.balanceRemaining), value: (r) => r.balanceRemaining },
          ...(showOverdueDays
            ? [
                {
                  key: "contract",
                  label: "Pago no contrato",
                  render: (r: FinanceRevenue) =>
                    // Crédito suficiente no contrato deixa de ser aviso e vira
                    // veredito: não é cobrança, é conciliação. Mesma classificação da
                    // carteira de matrículas e do alerta automático.
                    r.enrollmentId !== null && toReconcile?.has(r.enrollmentId) ? (
                      <span
                        className="inline-flex items-center gap-1 font-black text-amber-700"
                        title="O contrato já recebeu dinheiro suficiente para cobrir esta parcela — falta vincular o pagamento a ela. Não cobre antes de conferir."
                      >
                        <AlertTriangle size={13} />
                        {money(r.enrollmentPaidAmount ?? 0)} · conciliar
                      </span>
                    ) : r.enrollmentPaymentCount > 0 ? (
                      <span className="inline-flex items-center gap-1 font-bold text-amber-700" title="Este aluno já tem pagamentos lançados no contrato — confira antes de cobrar.">
                        <AlertTriangle size={13} />
                        {money(r.enrollmentPaidAmount ?? 0)}
                      </span>
                    ) : (
                      money(0)
                    ),
                  value: (r: FinanceRevenue) => r.enrollmentPaidAmount ?? 0,
                },
                {
                  key: "late",
                  label: "Atraso",
                  render: (r: FinanceRevenue) => {
                    const dias = daysOverdue(receivableDueDate(r), today);
                    return <span className="font-bold text-rose-700">{dias} {dias === 1 ? "dia" : "dias"}</span>;
                  },
                  value: (r: FinanceRevenue) => daysOverdue(receivableDueDate(r), today),
                },
              ]
            : []),
          {
            key: "status",
            label: "Situação",
            render: (r) => {
              const status = receivableStatus(r, today);
              return <StatusBadge status={status} label={STATUS_LABELS[status] ?? status} />;
            },
            value: (r) => receivableStatus(r, today),
          },
        ]}
        actions={(row) => (
          <div className="flex items-center justify-end gap-1">
            {row.balanceRemaining > 0.005 ? (
              <button
                type="button"
                onClick={() => onSettle(row)}
                className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-black text-white hover:bg-emerald-700"
                title="Registrar o recebimento desta parcela"
              >
                <Wallet size={13} />
                Dar baixa
              </button>
            ) : null}
            {row.enrollmentId ? (
              <button
                type="button"
                onClick={() => onOpenEnrollment(row.enrollmentId as number)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                title="Abrir os pagamentos da matrícula"
              >
                <ExternalLink size={14} />
              </button>
            ) : null}
          </div>
        )}
      />
    </div>
  );
}

export default function CobrancaTab({
  rows,
  overdue,
  cardBrands,
  periodLabel,
  onOpenEnrollment,
  onDone,
}: {
  /** Parcelas que vencem no período selecionado no topo. */
  rows: FinanceRevenue[];
  /** Vencidas em aberto de qualquer mês — não respeita o filtro de período. */
  overdue: FinanceRevenue[];
  cardBrands: FinanceCardBrand[];
  periodLabel: string;
  onOpenEnrollment: (enrollmentId: number) => void;
  onDone: (message: string) => void;
}) {
  const [settling, setSettling] = useState<FinanceRevenue | null>(null);
  const [health, setHealth] = useState<EnrollmentPaymentHealth[]>([]);
  const today = todayIso();

  // A aba busca a situação por contrato por conta própria (setState no callback da
  // promise, padrão do repo). É a MESMA fonte que a carteira de matrículas e o alerta
  // automático usam — três leituras diferentes do que é "atrasado" foi o que fazia a
  // tela e o sino discordarem sobre a mesma pessoa.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/finance/enrollments?health=1")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { health?: EnrollmentPaymentHealth[] } | null) => {
        if (!cancelled && Array.isArray(data?.health)) setHealth(data.health);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const toReconcile = useMemo(
    () => new Set(health.filter((item) => item.status === "a_conciliar").map((item) => item.enrollmentId)),
    [health]
  );

  const previsto = rows.reduce((sum, row) => sum + row.amount, 0);
  const recebido = rows.reduce((sum, row) => sum + settledOnInstallment(row), 0);
  const emAberto = rows.reduce((sum, row) => sum + row.balanceRemaining, 0);
  const vencidoNoPeriodo = rows
    .filter((row) => receivableStatus(row, today) === "atrasado")
    .reduce((sum, row) => sum + row.balanceRemaining, 0);

  const overdueTotal = overdue.reduce((sum, row) => sum + row.balanceRemaining, 0);
  const overdueStudents = new Set(overdue.map((row) => row.student ?? String(row.enrollmentId))).size;
  const conciliarRows = overdue.filter((row) => row.enrollmentId !== null && toReconcile.has(row.enrollmentId));
  const oldest = overdue.reduce((max, row) => Math.max(max, daysOverdue(receivableDueDate(row), today)), 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-cyan-100 bg-cyan-50 p-3 text-sm text-cyan-950">
        <span className="font-black">Como ler:</span>
        <span>
          esta aba recorta pelo <strong>vencimento</strong> das parcelas, não pela competência — é o que você tem para
          receber e cobrar. A baixa é registrada como pagamento da matrícula, com taxa e comissão.
        </span>
      </div>

      <Section>
        <SectionHeader
          title="Parcelas vencidas"
          subtitle="Vencidas e ainda em aberto, de qualquer mês. Independe do período selecionado no topo — dívida não expira na virada do mês."
        />
        {overdue.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-500">Nenhuma parcela vencida em aberto. </p>
        ) : (
          <>
            <div className="grid gap-3 p-5 pb-0 sm:grid-cols-2 xl:grid-cols-4">
              <KpiMini label="Parcelas vencidas" value={String(overdue.length)} />
              <KpiMini label="Total em atraso" value={money(overdueTotal)} />
              <KpiMini label="Alunos" value={String(overdueStudents)} />
              <KpiMini
                label="A conciliar (não cobrar)"
                value={String(conciliarRows.length)}
                hint="dinheiro já no contrato, falta vincular à parcela"
              />
              <KpiMini label="Atraso mais antigo" value={`${oldest} ${oldest === 1 ? "dia" : "dias"}`} />
            </div>
            <div className="mx-5 mt-4 flex items-start gap-2 rounded-lg border border-rose-100 bg-rose-50 p-3 text-xs text-rose-800">
              <AlertTriangle size={15} className="mt-0.5 flex-none" />
              <span>
                Antes de cobrar, confira se o dinheiro não entrou por outro contrato — matrícula de casal em que os dois
                pagam pelo mesmo boleto deixa um dos dois falsamente em atraso enquanto a cobrança conjunta não existir.
              </span>
            </div>
            <ReceivableTable
              rows={overdue}
              today={today}
              emptyLabel=""
              showOverdueDays
              toReconcile={toReconcile}
              onSettle={setSettling}
              onOpenEnrollment={onOpenEnrollment}
            />
          </>
        )}
      </Section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiMini label={`A receber em ${periodLabel}`} value={money(previsto)} />
        <KpiMini label="Já recebido" value={money(recebido)} />
        <KpiMini label="Em aberto" value={money(emAberto)} />
        <KpiMini label="Vencido no período" value={money(vencidoNoPeriodo)} />
      </div>

      <Section>
        <SectionHeader
          title={`Parcelas que vencem em ${periodLabel}`}
          subtitle={`${rows.length} parcela(s) · ${money(recebido)} recebido de ${money(previsto)}`}
        />
        <ReceivableTable
          rows={rows}
          today={today}
          emptyLabel="Nenhuma parcela vence no período selecionado."
          showOverdueDays={false}
          onSettle={setSettling}
          onOpenEnrollment={onOpenEnrollment}
        />
      </Section>

      {settling ? (
        <BaixaModal
          row={settling}
          cardBrands={cardBrands}
          onClose={() => setSettling(null)}
          onDone={(message) => {
            setSettling(null);
            onDone(message);
          }}
        />
      ) : null}
    </div>
  );
}
