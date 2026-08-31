"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarDays, CheckCircle2, Edit3, FileSignature, Link2, Plus, Receipt, Search, Trash2, WalletCards } from "lucide-react";
import type {
  EnrollmentPaymentHealth,
  FinanceCatalog,
  FinanceEnrollment,
} from "@/types/finance";
import type { EnrollmentClassTag } from "@/types/academic";
import { AllocateClassModal, EnrollmentClassBadge } from "./EnrollmentClassTag";
import EnrollmentPaymentsPanel from "../financeiro/EnrollmentPaymentsPanel";
import EnrollmentInvoiceModal, {
  InvoiceStatusBadge,
  invoiceTargetFromEnrollment,
  type EnrollmentInvoiceTarget,
} from "../financeiro/EnrollmentInvoiceModal";
import EnrollmentEditor, {
  loadEnrollmentForEditor,
  type EnrollmentEditorState,
} from "./EnrollmentEditor";
import InstallmentSimulator from "./InstallmentSimulator";

/**
 * Tela oficial das matrículas: contrato, cronograma parcela a parcela,
 * recebimentos e nota fiscal no mesmo lugar.
 *
 * A aba Matrículas da Gestão Financeira continua existindo para a leitura
 * contábil (recorte por período, receita líquida, comissão), mas o cadastro e a
 * edição passam pelo editor de cronograma — que é esta tela e a de lá
 * compartilham.
 */

type ViewFilter = "todas" | "atrasadas" | "a_conciliar" | "em_dia" | "quitadas";

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value ?? 0);
}

function dayLabel(value: string | null) {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function monthLabel(value: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${value.slice(0, 7)}-01T00:00:00Z`)
  );
}

async function apiJson(endpoint: string, method: "DELETE") {
  const response = await fetch(endpoint, { method });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Não foi possível concluir a operação.");
  return data;
}

export default function MatriculasClient({
  initialCatalog,
  initialEnrollments,
  initialHealth,
  initialClassTags,
  canManageInvoices,
  canViewClasses,
  canManageClasses,
  canViewStudents,
}: {
  initialCatalog: FinanceCatalog;
  initialEnrollments: FinanceEnrollment[];
  /** Situação de pagamento por matrícula (em dia × atrasada), fora do recorte de mês. */
  initialHealth: EnrollmentPaymentHealth[];
  /** Em que turma cada matriculado está (ou o que falta para ele estar em uma). */
  initialClassTags: EnrollmentClassTag[];
  /** Pode declarar nota emitida/dispensada e anexar o arquivo (finance.invoices). */
  canManageInvoices: boolean;
  canViewClasses: boolean;
  canManageClasses: boolean;
  canViewStudents: boolean;
}) {
  const [catalog] = useState(initialCatalog);
  const [enrollments, setEnrollments] = useState(initialEnrollments);
  const [health, setHealth] = useState(initialHealth);
  const [classTags, setClassTags] = useState(initialClassTags);
  /**
   * Situação do contrato de cada matrícula. "Toda matrícula tem contrato" era
   * combinado verbal: sem etiqueta na carteira, a matrícula sem documento não
   * se distinguia da que já foi assinada.
   */
  const [contractByEnrollment, setContractByEnrollment] = useState<Map<number, string | null>>(new Map());
  const [view, setView] = useState<ViewFilter>("todas");
  // `?turma=` chega do link "ver em Matrículas" dentro da turma. Ler na montagem (e
  // não guardar no estado inicial do servidor) mantém a tela funcionando igual quando
  // se chega por ela pelo menu.
  const [classFilter, setClassFilter] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("turma") ?? "";
  });
  const [allocating, setAllocating] = useState<EnrollmentClassTag | null>(null);
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<EnrollmentEditorState | null>(null);
  const [paymentsEnrollment, setPaymentsEnrollment] = useState<number | null>(null);
  const [invoiceTarget, setInvoiceTarget] = useState<EnrollmentInvoiceTarget | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingEditor, setLoadingEditor] = useState(false);

  const healthByEnrollment = useMemo(() => {
    const index = new Map<number, EnrollmentPaymentHealth>();
    for (const row of health) index.set(row.enrollmentId, row);
    return index;
  }, [health]);

  const counts = useMemo(() => {
    const base = { todas: enrollments.length, atrasadas: 0, a_conciliar: 0, em_dia: 0, quitadas: 0 };
    for (const enrollment of enrollments) {
      const status = healthByEnrollment.get(enrollment.id)?.status;
      if (status === "atrasado") base.atrasadas += 1;
      else if (status === "a_conciliar") base.a_conciliar += 1;
      else if (status === "quitado") base.quitadas += 1;
      else base.em_dia += 1;
    }
    return base;
  }, [enrollments, healthByEnrollment]);

  const overdueRows = useMemo(
    () =>
      enrollments
        .map((enrollment) => ({ enrollment, health: healthByEnrollment.get(enrollment.id) }))
        .filter((row): row is { enrollment: FinanceEnrollment; health: EnrollmentPaymentHealth } =>
          row.health?.status === "atrasado"
        )
        .sort((left, right) => right.health.daysLate - left.health.daysLate),
    [enrollments, healthByEnrollment]
  );

  const classOptions = useMemo(() => {
    const options = new Map<number, string>();
    for (const tag of classTags) {
      for (const item of tag.studentClasses) options.set(item.classId, item.className);
      if (tag.contractClassId && tag.contractClassName) options.set(tag.contractClassId, tag.contractClassName);
    }
    return [...options.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
  }, [classTags]);

  const tagsByEnrollment = useMemo(() => {
    const index = new Map<number, EnrollmentClassTag>();
    for (const tag of classTags) index.set(tag.enrollmentId, tag);
    return index;
  }, [classTags]);

  const visibleEnrollments = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    const byClass = enrollments.filter((enrollment) => {
      if (!classFilter) return true;
      const tag = tagsByEnrollment.get(enrollment.id);
      if (classFilter === "sem_turma") {
        return !tag || (tag.studentClasses.length === 0 && tag.contractClassId === null);
      }
      const wanted = Number(classFilter);
      return Boolean(
        tag &&
          (tag.contractClassId === wanted || tag.studentClasses.some((item) => item.classId === wanted))
      );
    });
    const byView = byClass.filter((enrollment) => {
      if (view === "todas") return true;
      const status = healthByEnrollment.get(enrollment.id)?.status;
      if (view === "atrasadas") return status === "atrasado";
      if (view === "a_conciliar") return status === "a_conciliar";
      if (view === "quitadas") return status === "quitado";
      // "Em dia" junta quem está no prazo e quem ainda não tem cronograma: nenhum dos
      // dois está devendo hoje, que é a pergunta que a lista responde.
      return status !== "atrasado" && status !== "a_conciliar" && status !== "quitado";
    });
    const ordered =
      view === "atrasadas"
        ? [...byView].sort(
            (left, right) =>
              (healthByEnrollment.get(right.id)?.daysLate ?? 0) - (healthByEnrollment.get(left.id)?.daysLate ?? 0)
          )
        : byView;
    if (!term) return ordered;
    return ordered.filter((enrollment) =>
      [
        enrollment.student,
        enrollment.courseName,
        enrollment.sellerName,
        enrollment.paymentMethodName,
        enrollment.cardBrandName,
        // Buscar pelo nome da turma responde "quem da turma das terças ainda deve",
        // que hoje só dava para responder abrindo as duas telas lado a lado.
        ...(tagsByEnrollment.get(enrollment.id)?.studentClasses.map((item) => item.className) ?? []),
      ]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase("pt-BR").includes(term))
    );
  }, [enrollments, search, tagsByEnrollment, view, healthByEnrollment, classFilter]);

  const totals = useMemo(
    () =>
      enrollments.reduce(
        (acc, enrollment) => ({
          contracted: acc.contracted + enrollment.totalAmount,
          received: acc.received + enrollment.paidAmount,
          outstanding: acc.outstanding + enrollment.balanceRemaining,
          // "A receber" é o contrato inteiro; "vencido" é só o que já venceu E não tem
          // dinheiro correspondente no contrato. Ter os dois lado a lado é o que impede
          // ler saldo alto de venda nova como dívida.
          overdue: acc.overdue + (healthByEnrollment.get(enrollment.id)?.uncoveredAmount ?? 0),
        }),
        { contracted: 0, received: 0, outstanding: 0, overdue: 0 }
      ),
    [enrollments, healthByEnrollment]
  );

  async function refreshAll() {
    const response = await fetch("/api/finance/enrollments?health=1");
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Não foi possível atualizar as matrículas.");
    setEnrollments(Array.isArray(data.enrollments) ? data.enrollments : []);
    if (Array.isArray(data.health)) setHealth(data.health);
    await refreshClassTags();
  }

  /** Situação do contrato, da mesma consulta que alimenta a fila de regularização. */
  const refreshContractStatus = useCallback(async () => {
    const response = await fetch("/api/contracts/intake?pendencias=1").catch(() => null);
    if (!response?.ok) return;
    const data = (await response.json().catch(() => ({}))) as {
      pendencies?: Array<{ enrollmentId: number; contractStatus: string | null }>;
    };
    if (!Array.isArray(data.pendencies)) return;
    setContractByEnrollment(new Map(data.pendencies.map((item) => [item.enrollmentId, item.contractStatus])));
  }, []);

  useEffect(() => {
    void refreshContractStatus();
  }, [refreshContractStatus]);

  async function refreshClassTags() {
    // Falha aqui não derruba a tela: a etiqueta de turma é informação extra sobre
    // um contrato que já está na mão de quem olha.
    const response = await fetch("/api/academic/enrollment-classes").catch(() => null);
    if (!response?.ok) return;
    const data = await response.json().catch(() => ({}));
    if (Array.isArray(data.tags)) setClassTags(data.tags);
  }

  async function openEditor(record?: FinanceEnrollment) {
    setError(null);
    setMessage(null);
    if (!record) {
      setEditor({});
      return;
    }
    setLoadingEditor(true);
    try {
      setEditor(await loadEnrollmentForEditor(record.id));
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "Não foi possível abrir a matrícula.");
    } finally {
      setLoadingEditor(false);
    }
  }

  async function deleteEnrollment(record: FinanceEnrollment) {
    if (!window.confirm(`Excluir a matrícula de ${record.student}? Os recebimentos vinculados também serão removidos.`)) return;
    setError(null);
    try {
      await apiJson(`/api/finance/enrollments/${record.id}`, "DELETE");
      await refreshAll();
      setMessage("Matrícula excluída.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Não foi possível excluir a matrícula.");
    }
  }

  return (
    <div className="min-h-full bg-slate-50 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-4 rounded-2xl bg-slate-950 px-6 py-6 text-white shadow-xl sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-300">Gestão financeira</p>
            <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">Matrículas e recebimentos</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-300">Contrato, entrada, parcelas mensais, recebimentos e nota fiscal reunidos em um único lugar.</p>
          </div>
          <button type="button" onClick={() => void openEditor()} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 text-sm font-black text-slate-950 hover:bg-cyan-300">
            <Plus size={18} /> Nova matrícula
          </button>
        </header>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Summary label="Contratado" value={money(totals.contracted)} />
          <Summary label="Recebido" value={money(totals.received)} tone="emerald" />
          <Summary label="A receber (contrato)" value={money(totals.outstanding)} tone="amber" />
          <Summary
            label="Vencido em aberto"
            value={money(totals.overdue)}
            tone={totals.overdue > 0 ? "rose" : "emerald"}
            hint={counts.atrasadas > 0 ? `${counts.atrasadas} matrícula(s) em atraso` : "ninguém em atraso"}
          />
        </div>

        {message ? <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">{message}</p> : null}
        {error ? <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800">{error}</p> : null}

        <OverduePanel rows={overdueRows} onOpenPayments={(id) => setPaymentsEnrollment(id)} />

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-black text-slate-950">Carteira de matrículas</h2>
              <p className="text-sm text-slate-500">
                Situação pelo vencimento das parcelas — saldo de contrato novo não é dívida.
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(
                  [
                    ["todas", "Todas", counts.todas],
                    ["atrasadas", "Em atraso", counts.atrasadas],
                    ["a_conciliar", "A conciliar", counts.a_conciliar],
                    ["em_dia", "Em dia", counts.em_dia],
                    ["quitadas", "Quitadas", counts.quitadas],
                  ] as Array<[ViewFilter, string, number]>
                ).map(([key, label, count]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setView(key)}
                    className={`rounded-full px-3 py-1 text-xs font-black ${
                      view === key
                        ? key === "atrasadas"
                          ? "bg-rose-600 text-white"
                          : "bg-slate-950 text-white"
                        : "border border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {label} ({count})
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {classOptions.length > 0 ? (
                <select
                  value={classFilter}
                  onChange={(event) => {
                    setClassFilter(event.target.value);
                    if (typeof window !== "undefined") {
                      const url = new URL(window.location.href);
                      if (event.target.value) url.searchParams.set("turma", event.target.value);
                      else url.searchParams.delete("turma");
                      window.history.replaceState(null, "", url.toString());
                    }
                  }}
                  className="h-10 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-cyan-500"
                >
                  <option value="">Todas as turmas</option>
                  {classOptions.map((option) => (
                    <option key={option.id} value={option.id}>{option.name}</option>
                  ))}
                  <option value="sem_turma">Sem turma</option>
                </select>
              ) : null}
              <label className="relative block sm:w-80">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar aluno, curso, vendedor ou forma" className="h-10 w-full rounded-lg border border-slate-200 pl-10 pr-3 text-sm outline-none focus:border-cyan-500" />
              </label>
            </div>
          </div>

          <div className="divide-y divide-slate-100">
            {visibleEnrollments.length === 0 ? (
              <p className="p-10 text-center text-sm font-semibold text-slate-500">Nenhuma matrícula encontrada.</p>
            ) : visibleEnrollments.map((enrollment) => (
              <article key={enrollment.id} className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1.2fr)_repeat(3,minmax(0,.7fr))_auto] lg:items-center">
                <div className="min-w-0">
                  <p className="truncate text-base font-black text-slate-950">{enrollment.student}</p>
                  <p className="mt-0.5 truncate text-sm text-slate-500">{enrollment.courseName ?? "Curso não informado"}{enrollment.sellerName ? ` · ${enrollment.sellerName}` : ""}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold">
                    {enrollment.downPaymentAmount > 0 ? <span className="rounded-full bg-cyan-50 px-2 py-1 text-cyan-800">Entrada {money(enrollment.downPaymentAmount)}</span> : null}
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-700">{enrollment.regularInstallments}x após a entrada</span>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-700">Início: {monthLabel(enrollment.firstMonth)}</span>
                    {enrollment.paymentMethodName ? (
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-700">
                        {enrollment.paymentMethodName}{enrollment.cardBrandName ? ` · ${enrollment.cardBrandName}` : ""}
                      </span>
                    ) : null}
                    {enrollment.sellerName && enrollment.commissionPct > 0 ? (
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-700">Comissão {enrollment.commissionPct}%</span>
                    ) : null}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <PaymentHealthBadge health={healthByEnrollment.get(enrollment.id)} />
                    {/* NF pendente não aparece aqui: cobrar nota é trabalho da Gestão
                        Financeira, e o aviso em cima de toda linha virava ruído numa
                        tela cuja pergunta é "quem está pagando". A nota emitida (ou
                        dispensada) continua visível porque aí é informação, não
                        cobrança — e o botão de registrar segue à direita. */}
                    {enrollment.invoiceStatus !== "pendente" ? <InvoiceStatusBadge record={enrollment} /> : null}
                    <ContractStatusBadge status={contractByEnrollment.get(enrollment.id)} />
                    <EnrollmentClassBadge
                      tag={tagsByEnrollment.get(enrollment.id)}
                      canViewClasses={canViewClasses}
                      canManageClasses={canManageClasses}
                      canViewStudents={canViewStudents}
                      onAllocate={setAllocating}
                    />
                  </div>
                </div>
                <Amount label="Contrato" value={money(enrollment.totalAmount)} hint={`Líquido ${money(enrollment.netTotal)}`} />
                <Amount label="Recebido" value={money(enrollment.paidAmount)} tone="emerald" />
                <Amount label="Saldo" value={money(enrollment.balanceRemaining)} tone={enrollment.balanceRemaining > 0 ? "amber" : "emerald"} />
                <div className="flex items-center gap-2 lg:justify-end">
                  <button type="button" onClick={() => setPaymentsEnrollment(enrollment.id)} className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-3 text-sm font-black text-white hover:bg-slate-800" title="Abrir recebimentos">
                    <WalletCards size={16} /> <span className="hidden xl:inline">Recebimentos</span>
                  </button>
                  {canManageInvoices ? (
                    <button type="button" onClick={() => setInvoiceTarget(invoiceTargetFromEnrollment(enrollment))} title="Nota fiscal" className="grid size-10 place-items-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"><Receipt size={16} /></button>
                  ) : null}
                  <button type="button" onClick={() => void openEditor(enrollment)} disabled={loadingEditor} title={enrollment.paymentCount > 0 ? "Ajustar parcelas ainda em aberto" : "Editar plano"} className="grid size-10 place-items-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35"><Edit3 size={16} /></button>
                  <button type="button" onClick={() => void deleteEnrollment(enrollment)} title="Excluir matrícula" className="grid size-10 place-items-center rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50"><Trash2 size={16} /></button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <InstallmentSimulator catalog={catalog} />

        <section className="rounded-2xl border border-cyan-100 bg-cyan-50 p-5 text-sm text-cyan-950">
          <div className="flex gap-3">
            <CalendarDays className="mt-0.5 shrink-0 text-cyan-700" size={19} />
            <div className="space-y-2">
              <p><strong>Antecipação:</strong> ao registrar, por exemplo, as parcelas de agosto e setembro em um pagamento feito em agosto, selecione as duas parcelas. O caixa de agosto recebe a soma, e setembro fica quitado — sem nova cobrança.</p>
              <p><strong>“Pago, falta vincular”:</strong> o contrato recebeu dinheiro que não está aplicado na parcela vencida — normalmente pagamento lançado sem selecionar a parcela, ou rateio antigo preso na primeira. Não é inadimplência: abra os recebimentos e marque as parcelas certas. Enquanto isso, essa matrícula fica fora do painel de atraso.</p>
              <p><strong>Pagou menos que o combinado:</strong> marque as parcelas e informe o valor recebido. Elas ficam quitadas pelo que entrou e a diferença é remanejada para as parcelas ainda em aberto, sem mudar o valor do contrato.</p>
            </div>
          </div>
        </section>
      </div>

      {editor ? (
        <EnrollmentEditor
          key={editor.record?.id ?? "new"}
          catalog={catalog}
          record={editor.record}
          initialSchedule={editor.schedule}
          onClose={() => setEditor(null)}
          onSaved={async () => {
            setEditor(null);
            await refreshAll();
            setMessage("Matrícula e cronograma salvos.");
          }}
        />
      ) : null}
      {paymentsEnrollment ? (
        <EnrollmentPaymentsPanel
          enrollmentId={paymentsEnrollment}
          cardBrands={catalog.cardBrands}
          onClose={() => setPaymentsEnrollment(null)}
          onChanged={(updated) => setEnrollments((current) => current.map((item) => item.id === updated.id ? updated : item))}
        />
      ) : null}
      {allocating ? (
        <AllocateClassModal
          tag={allocating}
          onClose={() => setAllocating(null)}
          onDone={async (text) => {
            setAllocating(null);
            await refreshClassTags();
            setMessage(text);
          }}
        />
      ) : null}
      {invoiceTarget ? (
        <EnrollmentInvoiceModal
          record={invoiceTarget}
          onClose={() => setInvoiceTarget(null)}
          onSaved={async (text) => {
            setInvoiceTarget(null);
            await refreshAll();
            setMessage(text);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * O único alerta desta tela: dinheiro que já venceu e não entrou.
 *
 * Substituiu a fila de notas fiscais a pedido da operação — nota pendente é trabalho
 * de outra área (a fila continua na Gestão Financeira) e, disputando o topo da tela
 * com a inadimplência, ensinava a ignorar o painel de aviso. Fica fora do filtro de
 * período pelo mesmo motivo de sempre: parcela de março continua devida em agosto.
 */
function OverduePanel({
  rows,
  onOpenPayments,
}: {
  rows: Array<{ enrollment: FinanceEnrollment; health: EnrollmentPaymentHealth }>;
  onOpenPayments: (enrollmentId: number) => void;
}) {
  if (rows.length === 0) return null;
  const total = rows.reduce((sum, row) => sum + row.health.uncoveredAmount, 0);
  const oldest = rows.reduce((max, row) => Math.max(max, row.health.daysLate), 0);

  return (
    <section className="overflow-hidden rounded-2xl border border-rose-200 bg-rose-50 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rose-200 px-5 py-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 shrink-0 text-rose-700" size={19} />
          <div>
            <h2 className="text-base font-black text-rose-950">Pagamentos em atraso</h2>
            <p className="text-sm text-rose-800">
              {rows.length} matrícula(s) com parcela vencida em aberto · {money(total)} · atraso mais antigo há {oldest}{" "}
              {oldest === 1 ? "dia" : "dias"}
            </p>
          </div>
        </div>
      </div>
      <div className="divide-y divide-rose-200/70">
        {rows.map(({ enrollment, health }) => (
          <div key={enrollment.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-rose-950">{enrollment.student}</p>
              <p className="truncate text-xs font-semibold text-rose-800">
                {enrollment.courseName ?? "Sem curso"} · {money(health.uncoveredAmount)} em atraso em{" "}
                {health.overdueCount} {health.overdueCount === 1 ? "parcela" : "parcelas"} · desde{" "}
                {dayLabel(health.oldestDueDate)} ({health.daysLate} {health.daysLate === 1 ? "dia" : "dias"})
                {enrollment.sellerName ? ` · ${enrollment.sellerName}` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onOpenPayments(enrollment.id)}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-rose-600 px-3 text-xs font-black text-white hover:bg-rose-700"
            >
              <WalletCards size={14} /> Registrar recebimento
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Situação de pagamento de uma matrícula, em uma etiqueta.
 *
 * "Em dia" não é o mesmo que "quitado", e nenhum dos dois é "saldo zero": um contrato
 * de 12x recém-vendido tem saldo cheio e está em dia. Por isso a etiqueta fala de
 * VENCIMENTO — o que já venceu e não entrou — e mostra a próxima parcela de quem está
 * em dia, que é a informação que a secretaria usa para cobrar antes de virar atraso.
 */
function PaymentHealthBadge({ health }: { health: EnrollmentPaymentHealth | undefined }) {
  if (!health || health.status === "sem_cronograma") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600"
        title="Esta matrícula não tem parcelas lançadas, então não há vencimento para acompanhar."
      >
        <CalendarDays size={13} /> Sem cronograma
      </span>
    );
  }
  if (health.status === "atrasado") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-1 text-xs font-black text-rose-800"
        title={`${health.overdueCount} parcela(s) vencida(s) desde ${dayLabel(health.oldestDueDate)}.`}
      >
        <AlertTriangle size={13} /> Atrasado {health.daysLate} {health.daysLate === 1 ? "dia" : "dias"} ·{" "}
        {money(health.uncoveredAmount)}
      </span>
    );
  }
  if (health.status === "a_conciliar") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-xs font-black text-amber-900"
        title="Parcela vencida em aberto, mas o contrato já recebeu dinheiro que não está aplicado nela. Abra os recebimentos e vincule o pagamento às parcelas certas."
      >
        <Link2 size={13} /> Pago, falta vincular · {money(health.creditAmount)} em crédito
      </span>
    );
  }
  if (health.status === "quitado") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 text-xs font-black text-emerald-800">
        <CheckCircle2 size={13} /> Quitado
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-800">
      <CheckCircle2 size={13} /> Em dia
      {health.nextDueDate ? (
        <span className="font-semibold text-emerald-700">
          · próxima {dayLabel(health.nextDueDate)} ({money(health.nextAmount)})
        </span>
      ) : null}
    </span>
  );
}

function Summary({
  label,
  value,
  tone = "slate",
  hint,
}: {
  label: string;
  value: string;
  tone?: "slate" | "emerald" | "amber" | "rose";
  hint?: string;
}) {
  const tones = {
    slate: "border-slate-200 bg-white text-slate-950",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-950",
    amber: "border-amber-200 bg-amber-50 text-amber-950",
    rose: "border-rose-200 bg-rose-50 text-rose-950",
  };
  return (
    <div className={`rounded-2xl border p-5 shadow-sm ${tones[tone]}`}>
      <p className="text-xs font-black uppercase tracking-[0.14em] opacity-60">{label}</p>
      <p className="mt-2 text-2xl font-black">{value}</p>
      {hint ? <p className="mt-1 text-xs font-bold opacity-60">{hint}</p> : null}
    </div>
  );
}

function Amount({ label, value, tone = "slate", hint }: { label: string; value: string; tone?: "slate" | "emerald" | "amber"; hint?: string }) {
  const tones = { slate: "text-slate-950", emerald: "text-emerald-700", amber: "text-amber-700" };
  return (
    <div>
      <p className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-400">{label}</p>
      <p className={`mt-1 whitespace-nowrap text-base font-black ${tones[tone]}`}>{value}</p>
      {hint ? <p className="mt-0.5 whitespace-nowrap text-[11px] font-semibold text-slate-400">{hint}</p> : null}
    </div>
  );
}

/**
 * Situação do contrato desta matrícula.
 *
 * "Sem contrato" é rosa e não cinza de propósito: é a única das três que
 * significa que a escola não tem documento nenhum daquela venda. Aguardando
 * assinatura é normal — a matrícula está feita mesmo sem a assinatura, e travar
 * a matrícula na assinatura foi descartado pela operação.
 */
function ContractStatusBadge({ status }: { status: string | null | undefined }) {
  if (status === undefined) return null;
  const visual =
    status === "assinado"
      ? { label: "Contrato assinado", tone: "bg-emerald-100 text-emerald-700", href: "/contratos?status=assinado" }
      : status === "pendente"
        ? { label: "Contrato a assinar", tone: "bg-amber-100 text-amber-800", href: "/contratos?status=pendente" }
        : { label: "Sem contrato", tone: "bg-rose-100 text-rose-700", href: "/contratos" };
  return (
    <Link
      href={visual.href}
      title="Toda matrícula precisa de contrato. A fila de regularização fica em Contratos."
      className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold hover:opacity-80 ${visual.tone}`}
    >
      <FileSignature size={13} /> {visual.label}
    </Link>
  );
}
