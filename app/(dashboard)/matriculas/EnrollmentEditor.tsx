"use client";

import { useEffect, useState } from "react";
import { ChevronRight, X } from "lucide-react";
import type { FinanceCatalog, FinanceEnrollment, FinanceRevenue } from "@/types/finance";
import type { AcademicClass } from "@/types/academic";
import { installmentCap, normalizeEnrollmentInstallments } from "@/lib/enrollmentInstallments";

/**
 * Editor do PLANO da matrícula — contrato, entrada e cada parcela com valor e
 * vencimento próprios.
 *
 * Mora aqui, fora das duas telas, porque as duas precisam dele. Enquanto a
 * Gestão Financeira teve um formulário separado, editar por lá regenerava as
 * parcelas em fatias iguais e apagava o cronograma combinado — o servidor
 * refaz o cronograma quando o payload não traz `schedule` (ver
 * `resolveSchedule` em lib/finance.ts). Um editor só elimina esse caminho.
 */

export type PlanType = "entrada" | "parcela";

export type PlanLine = {
  key: string;
  id?: number;
  type: PlanType;
  dueDate: string;
  amount: number;
  /** Valor já recebido nesta linha. Linhas com recebimento não podem ser reabertas. */
  paidAmount?: number;
};

export interface EnrollmentEditorState {
  record?: FinanceEnrollment;
  schedule?: PlanLine[];
}

const inputClass =
  "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100";
const labelClass = "mb-1 block text-[11px] font-black uppercase tracking-[0.12em] text-slate-500";

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value ?? 0);
}

function parseNumber(value: string) {
  const parsed = Number(value.replace(".", "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function splitCents(total: number, count: number): number[] {
  const safeCount = Math.max(1, Math.trunc(count));
  const cents = Math.max(0, Math.round(total * 100));
  const base = Math.floor(cents / safeCount);
  const remainder = cents - base * safeCount;
  return Array.from({ length: safeCount }, (_, index) => (base + (index === safeCount - 1 ? remainder : 0)) / 100);
}

function addMonths(month: string, offset: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const target = year * 12 + (monthNumber - 1) + offset;
  return `${Math.floor(target / 12)}-${String((target % 12) + 1).padStart(2, "0")}`;
}

function monthDate(month: string, dayFromDate: string) {
  const day = Number(dayFromDate.slice(8, 10)) || 1;
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return `${month}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

/**
 * Aviso de vaga na hora da venda.
 *
 * A capacidade da turma só é checada quando o aluno é ALOCADO — o que quer dizer que
 * hoje dá para vender cinco contratos para uma turma de doze lugares que já tem doze,
 * e o estouro só aparece semanas depois, quando a secretaria tenta encaixar. Contrato
 * apontando para a turma não ocupa a vaga sozinho (o aluno pode nem ter ficha ainda),
 * por isso aqui é aviso e não bloqueio.
 */
function ClassCapacityHint({ turma, editing }: { turma: AcademicClass | undefined; editing: boolean }) {
  if (!turma) {
    return (
      <p className="mt-1 text-xs text-slate-500">
        Registra a turma no contrato. A alocação do aluno (com checagem de vaga) continua em Turmas.
      </p>
    );
  }
  const contratos = turma.linkedContracts + (editing ? 0 : 1);
  if (turma.capacity !== null && contratos > turma.capacity) {
    return (
      <p className="mt-1 text-xs font-bold text-amber-700">
        Atenção: com esta venda ficam {contratos} contratos para {turma.capacity} vagas · {turma.activeStudents}{" "}
        aluno(s) já alocados.
      </p>
    );
  }
  return (
    <p className="mt-1 text-xs text-slate-500">
      {turma.activeStudents} aluno(s) alocados
      {turma.capacity === null ? " · sem limite de vagas" : ` · ${turma.seatsLeft} vaga(s) livres`}
      {turma.linkedContracts > 0 ? ` · ${turma.linkedContracts} contrato(s) apontando` : ""}
    </p>
  );
}

export function buildPlan(total: number, entry: number, installments: number, saleDate: string, firstMonth: string): PlanLine[] {
  const safeTotal = Math.max(0, round2(total));
  const safeEntry = Math.max(0, Math.min(round2(entry), safeTotal));
  const count = Math.max(1, Math.trunc(installments));
  const regular = splitCents(safeTotal - safeEntry, count).map((amount, index) => ({
    key: `parcela-${index + 1}`,
    type: "parcela" as const,
    dueDate: monthDate(addMonths(firstMonth, index), saleDate),
    amount,
  }));
  return safeEntry > 0
    ? [{ key: "entrada", type: "entrada" as const, dueDate: saleDate, amount: safeEntry }, ...regular]
    : regular;
}

export function planFromRevenues(revenues: FinanceRevenue[]): PlanLine[] {
  return revenues.map((revenue, index) => ({
    key: revenue.installmentNumber === 0 ? "entrada" : `parcela-${revenue.installmentNumber ?? index + 1}`,
    id: revenue.id,
    type: revenue.installmentNumber === 0 ? "entrada" : "parcela",
    dueDate: revenue.dueDate ?? revenue.date,
    amount: revenue.amount,
    paidAmount: revenue.paidAmount,
  }));
}

/**
 * Abre uma matrícula existente já com o cronograma real dela. Sem isto, quem
 * edita parte do cronograma teórico e sobrescreve o combinado.
 */
export async function loadEnrollmentForEditor(id: number): Promise<EnrollmentEditorState> {
  const response = await fetch(`/api/finance/enrollments/${id}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Não foi possível abrir a matrícula.");
  return {
    record: data.enrollment as FinanceEnrollment,
    schedule: planFromRevenues(data.revenues as FinanceRevenue[]),
  };
}

async function apiJson(endpoint: string, method: "POST" | "PATCH", body: Record<string, unknown>) {
  const response = await fetch(endpoint, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Não foi possível salvar a matrícula.");
  return data;
}

export default function EnrollmentEditor({
  catalog,
  record,
  initialSchedule,
  onClose,
  onSaved,
}: {
  catalog: FinanceCatalog;
  record?: FinanceEnrollment;
  initialSchedule?: PlanLine[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [student, setStudent] = useState(record?.student ?? "");
  const [courseId, setCourseId] = useState(record?.courseId ? String(record.courseId) : "");
  const [total, setTotal] = useState(record?.totalAmount ?? 10000);
  const [entry, setEntry] = useState(record?.downPaymentAmount ?? 0);
  const [installments, setInstallments] = useState(record?.regularInstallments ?? record?.installments ?? 10);
  const [saleDate, setSaleDate] = useState(record?.saleDate ?? today);
  const [firstMonth, setFirstMonth] = useState(record?.firstMonth ?? today.slice(0, 7));
  const [paymentMethodId, setPaymentMethodId] = useState(record?.paymentMethodId ? String(record.paymentMethodId) : "");
  const [cardBrandId, setCardBrandId] = useState(record?.cardBrandId ? String(record.cardBrandId) : "");
  const [sellerId, setSellerId] = useState(record?.sellerId ? String(record.sellerId) : "");
  const [commissionPct, setCommissionPct] = useState(record?.commissionPct ?? 0);
  const [branchId, setBranchId] = useState(record?.branchId ? String(record.branchId) : "");
  const [notes, setNotes] = useState(record?.notes ?? "");
  const [classId, setClassId] = useState(record?.classId ? String(record.classId) : "");
  const [classes, setClasses] = useState<AcademicClass[]>([]);

  // A turma combinada na venda entra aqui porque quem fecha o contrato é quem sabe o
  // horário acertado com o aluno — antes disso, o vínculo só nascia quando a
  // secretaria alocava em /turmas, e o horário combinado se perdia no caminho.
  // Quem não tem permissão de ver turmas simplesmente não recebe a lista e o campo
  // não aparece; o `classId` continua preservado no servidor.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/academic/classes")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { classes?: AcademicClass[] } | null) => {
        if (!cancelled && Array.isArray(data?.classes)) setClasses(data.classes);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  const [plan, setPlan] = useState<PlanLine[]>(initialSchedule ?? buildPlan(total, entry, installments, saleDate, firstMonth));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedMethod = catalog.paymentMethods.find((method) => String(method.id) === paymentMethodId);
  const hasRegisteredPayments = Boolean(record && record.paymentCount > 0);
  const remaining = Math.max(0, round2(total - entry));
  const scheduledTotal = round2(plan.reduce((sum, line) => sum + line.amount, 0));

  /**
   * Depois de um recebimento, a linha que já recebeu qualquer valor é um fato
   * financeiro: nem o valor nem o vencimento podem ser reescritos. As demais
   * parcelas continuam livres para renegociar o saldo.
   */
  function isLockedPlanLine(line: PlanLine) {
    return hasRegisteredPayments && (line.type === "entrada" || (line.paidAmount ?? 0) > 0.005);
  }

  function rebuild(next: Partial<{ total: number; entry: number; installments: number; saleDate: string; firstMonth: string }>) {
    const nextTotal = next.total ?? total;
    const nextEntry = next.entry ?? entry;
    const nextInstallments = next.installments ?? installments;
    const nextSaleDate = next.saleDate ?? saleDate;
    const nextFirstMonth = next.firstMonth ?? firstMonth;
    setPlan(buildPlan(nextTotal, nextEntry, nextInstallments, nextSaleDate, nextFirstMonth));
  }

  function changeRegularAmount(key: string, raw: string) {
    const value = Math.max(0, round2(parseNumber(raw)));
    const current = plan.find((line) => line.key === key);
    if (!current || isLockedPlanLine(current)) {
      setError("Esta parcela já possui recebimento e não pode ser alterada.");
      return;
    }
    const otherRegular = plan.filter((line) => line.type === "parcela" && line.key !== key && !isLockedPlanLine(line));
    const fixedTotal = plan
      .filter((line) => line.type === "entrada" || isLockedPlanLine(line))
      .reduce((sum, line) => sum + line.amount, 0);
    const availableForOthers = round2(total - fixedTotal - value);
    if (availableForOthers < 0) {
      setError("Uma parcela não pode ultrapassar o saldo disponível no cronograma.");
      return;
    }
    const redistributed = splitCents(availableForOthers, otherRegular.length);
    let cursor = 0;
    setPlan((current) => current.map((line) => {
      if (line.key === key) return { ...line, amount: value };
      if (line.type === "parcela" && !isLockedPlanLine(line)) return { ...line, amount: redistributed[cursor++] };
      return line;
    }));
    setError(null);
  }

  function changeEntry(raw: string) {
    if (hasRegisteredPayments) {
      setError("A entrada não pode ser alterada depois que há recebimentos. Ajuste apenas as parcelas ainda em aberto.");
      return;
    }
    const value = Math.max(0, Math.min(round2(parseNumber(raw)), total));
    setEntry(value);
    rebuild({ entry: value });
    setError(null);
  }

  async function submit() {
    setError(null);
    if (!student.trim()) {
      setError("Informe o aluno.");
      return;
    }
    if (Math.abs(scheduledTotal - total) > 0.01) {
      setError("A soma da entrada e das parcelas precisa ser igual ao valor contratado.");
      return;
    }
    setSaving(true);
    try {
      const body = {
        student: student.trim(),
        courseId: courseId ? Number(courseId) : null,
        totalAmount: total,
        downPaymentAmount: entry,
        installments,
        paymentMethodId: paymentMethodId ? Number(paymentMethodId) : null,
        cardBrandId: selectedMethod?.kind === "parcelado" && cardBrandId ? Number(cardBrandId) : null,
        firstMonth,
        saleDate,
        sellerId: sellerId ? Number(sellerId) : null,
        commissionPct,
        branchId: branchId ? Number(branchId) : null,
        classId: classId ? Number(classId) : null,
        notes: notes.trim() || null,
        schedule: plan.map((line) => ({ amount: line.amount, dueDate: line.dueDate, type: line.type })),
      };
      await apiJson(record ? `/api/finance/enrollments/${record.id}` : "/api/finance/enrollments", record ? "PATCH" : "POST", body);
      await onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Não foi possível salvar a matrícula.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/50 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={record ? "Editar matrícula" : "Nova matrícula"}>
      <div className="mx-auto my-4 max-w-6xl rounded-2xl bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <div><p className="text-xs font-black uppercase tracking-[0.15em] text-cyan-700">Plano da matrícula</p><h2 className="mt-1 text-xl font-black text-slate-950">{record ? `Editar ${record.student}` : "Nova matrícula"}</h2></div>
          <button type="button" onClick={onClose} className="grid size-10 place-items-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Fechar"><X size={19} /></button>
        </header>
        {hasRegisteredPayments ? <div className="mx-6 mt-5 rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-950"><strong>Renegociação do saldo:</strong> parcelas já recebidas permanecem protegidas. Você pode alterar o valor e o vencimento somente das parcelas que ainda estão em aberto; as demais serão recalculadas para manter o valor total do contrato.</div> : null}
        <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_minmax(420px,.9fr)]">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Aluno"><input disabled={hasRegisteredPayments} value={student} onChange={(event) => setStudent(event.target.value)} className={inputClass} /></Field>
            <Field label="Curso"><select disabled={hasRegisteredPayments} value={courseId} onChange={(event) => setCourseId(event.target.value)} className={inputClass}><option value="">Não informado</option>{catalog.courses.filter((course) => course.active).map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}</select></Field>
            {classes.length > 0 ? (
              <Field label="Turma (combinada na venda)">
                <select value={classId} onChange={(event) => setClassId(event.target.value)} className={inputClass}>
                  <option value="">A definir</option>
                  {classes
                    .filter((item) => item.status !== "encerrada" || String(item.id) === classId)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                        {item.capacity === null
                          ? ""
                          : ` · ${item.linkedContracts}/${item.capacity} contratos`}
                      </option>
                    ))}
                </select>
                <ClassCapacityHint turma={classes.find((item) => String(item.id) === classId)} editing={Boolean(record)} />
              </Field>
            ) : null}
            <Field label="Valor total"><input disabled={hasRegisteredPayments} value={total} onChange={(event) => { const value = Math.max(0, round2(parseNumber(event.target.value))); setTotal(value); const adjustedEntry = Math.min(entry, value); if (adjustedEntry !== entry) setEntry(adjustedEntry); rebuild({ total: value, entry: adjustedEntry }); }} inputMode="decimal" className={inputClass} /></Field>
            <Field label="Entrada"><input disabled={hasRegisteredPayments} value={entry} onChange={(event) => changeEntry(event.target.value)} inputMode="decimal" className={inputClass} /><p className="mt-1 text-xs text-slate-500">É abatida antes do cálculo das parcelas.</p></Field>
            <Field label="Parcelas após a entrada"><input disabled={hasRegisteredPayments} value={installments} onChange={(event) => { const value = normalizeEnrollmentInstallments(event.target.value, selectedMethod?.maxInstallments); setInstallments(value); rebuild({ installments: value }); }} type="number" min={1} max={installmentCap(selectedMethod?.maxInstallments)} className={inputClass} /></Field>
            <Field label="Mês da 1ª parcela"><input disabled={hasRegisteredPayments} value={firstMonth} onChange={(event) => { setFirstMonth(event.target.value); rebuild({ firstMonth: event.target.value }); }} type="month" className={inputClass} /></Field>
            <Field label="Data da contratação/entrada"><input disabled={hasRegisteredPayments} value={saleDate} onChange={(event) => { setSaleDate(event.target.value); rebuild({ saleDate: event.target.value }); }} type="date" className={inputClass} /></Field>
            <Field label="Forma de pagamento"><select disabled={hasRegisteredPayments} value={paymentMethodId} onChange={(event) => setPaymentMethodId(event.target.value)} className={inputClass}><option value="">Não informada</option>{catalog.paymentMethods.filter((method) => method.active).map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}</select></Field>
            {selectedMethod?.kind === "parcelado" ? <Field label="Bandeira"><select disabled={hasRegisteredPayments} value={cardBrandId} onChange={(event) => setCardBrandId(event.target.value)} className={inputClass}><option value="">Taxa padrão</option>{catalog.cardBrands.filter((brand) => brand.active).map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></Field> : null}
            <Field label="Vendedor"><select disabled={hasRegisteredPayments} value={sellerId} onChange={(event) => { setSellerId(event.target.value); const seller = catalog.sellers.find((item) => String(item.id) === event.target.value); setCommissionPct(seller?.defaultPct ?? 0); }} className={inputClass}><option value="">Não informado</option>{catalog.sellers.filter((seller) => seller.active).map((seller) => <option key={seller.id} value={seller.id}>{seller.name}</option>)}</select></Field>
            <Field label="Comissão (%)"><input value={commissionPct} onChange={(event) => setCommissionPct(parseNumber(event.target.value))} inputMode="decimal" disabled={!sellerId || hasRegisteredPayments} className={inputClass} /></Field>
            <Field label="Unidade"><select disabled={hasRegisteredPayments} value={branchId} onChange={(event) => setBranchId(event.target.value)} className={inputClass}><option value="">Não informada</option>{catalog.branches.filter((branch) => branch.active).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></Field>
            <div className="sm:col-span-2"><Field label="Observações"><textarea disabled={hasRegisteredPayments} value={notes} onChange={(event) => setNotes(event.target.value)} className="min-h-24 w-full rounded-lg border border-slate-200 p-3 text-sm outline-none focus:border-cyan-500" /></Field></div>
          </div>

          <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-start justify-between gap-4"><div><h3 className="font-black text-slate-950">Cronograma calculado</h3><p className="mt-1 text-xs text-slate-500">Edite uma parcela mensal e as demais em aberto são recalculadas automaticamente.</p></div><ChevronRight className="text-cyan-600" size={20} /></div>
            <div className="mt-4 grid grid-cols-2 gap-3"><Mini label="Após a entrada" value={money(remaining)} /><Mini label="Média das parcelas" value={money(remaining / Math.max(1, installments))} /></div>
            <div className="mt-4 max-h-[420px] divide-y divide-slate-200 overflow-y-auto rounded-lg border border-slate-200 bg-white">
              {plan.map((line, index) => {
                const locked = isLockedPlanLine(line);
                return (
                <div key={line.key} className="grid grid-cols-[auto_minmax(0,1fr)_132px] items-center gap-3 p-3">
                  <span className={`grid size-8 place-items-center rounded-full text-xs font-black ${line.type === "entrada" ? "bg-cyan-100 text-cyan-800" : "bg-slate-100 text-slate-600"}`}>{line.type === "entrada" ? "E" : index}</span>
                  <div><p className="text-sm font-black text-slate-900">{line.type === "entrada" ? "Entrada" : `${line.key.replace("parcela-", "")}ª parcela`}{locked ? <span className="ml-1 text-[10px] uppercase tracking-wide text-emerald-700">recebida</span> : null}</p><input disabled={locked} value={line.dueDate} onChange={(event) => setPlan((current) => current.map((item) => item.key === line.key ? { ...item, dueDate: event.target.value } : item))} type="date" className="mt-1 h-7 w-full border-0 bg-transparent p-0 text-xs text-slate-500 outline-none disabled:cursor-not-allowed disabled:opacity-60" /></div>
                  <input disabled={locked} value={line.amount} onChange={(event) => line.type === "entrada" ? changeEntry(event.target.value) : changeRegularAmount(line.key, event.target.value)} inputMode="decimal" className="h-9 rounded-lg border border-slate-200 px-2 text-right text-sm font-black text-slate-900 outline-none focus:border-cyan-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500" />
                </div>
                );
              })}
            </div>
            <div className="mt-3 flex items-center justify-between text-sm"><span className="font-bold text-slate-500">Total do cronograma</span><span className={`font-black ${Math.abs(scheduledTotal - total) <= 0.01 ? "text-emerald-700" : "text-rose-700"}`}>{money(scheduledTotal)}</span></div>
          </section>
        </div>
        {error ? <p className="mx-6 mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800">{error}</p> : null}
        <footer className="flex justify-end gap-3 border-t border-slate-100 px-6 py-4"><button type="button" onClick={onClose} className="h-10 rounded-lg px-4 text-sm font-bold text-slate-700 hover:bg-slate-100">Cancelar</button><button type="button" disabled={saving} onClick={() => void submit()} className="h-10 rounded-lg bg-slate-950 px-5 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-50">{saving ? "Salvando..." : "Salvar matrícula"}</button></footer>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label><span className={labelClass}>{label}</span>{children}</label>;
}

function Mini({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-slate-200 bg-white p-3"><p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">{label}</p><p className="mt-1 text-base font-black text-slate-950">{value}</p></div>;
}
