"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Search, Trash2, UserPlus, X } from "lucide-react";
import { ContractProfileFields } from "@/components/ContractProfileFields";
import {
  EMPTY_CONTRACT_PROFILE,
  planSplitTotal,
  type ContractPlanSplit,
  type ContractStudentProfile,
} from "@/lib/contractProfile";
import { enrollmentInstallmentOptions, installmentCap } from "@/lib/enrollmentInstallments";
import type { EnrollmentPendency } from "./RegularizarPanel";

/**
 * "Novo contrato" — a porta que faltava.
 *
 * Até aqui só existiam duas entradas, e elas produziam realidades diferentes: a
 * do CRM (lead na etapa Fechado) criava matrícula, ficha, turma e contrato; a do
 * Financeiro criava **só dinheiro**, e a pessoa ficava sendo um nome em campo de
 * texto — sem ficha, sem cadeira em turma nenhuma, sem contrato. Quem fecha sem
 * nunca ter sido lead caía sempre na segunda.
 *
 * As três origens de pessoa entram por aqui: lead do CRM, aluno que já existe
 * (quem volta a comprar) e pessoa nova. E o contrato pode ter mais de uma
 * pessoa — cada uma com o treinamento, o valor e a **turma** dela.
 *
 * Ver `docs/plano-contrato-matricula-turma.md`.
 */

interface Training {
  id: number;
  name: string;
  defaultPrice: number | null;
  defaultInstallments: number;
  lessonsCount: number | null;
  lessonHours: number | null;
  enrollmentFee: number;
  materialFee: number;
}

interface OpenClass {
  id: number;
  name: string;
  scheduleLabel: string | null;
  seatsLeft: number | null;
}

interface Catalog {
  trainings: Training[];
  paymentMethods: Array<{ id: number; name: string; kind: string; maxInstallments: number | null }>;
  cardBrands: Array<{ id: number; name: string }>;
  branches: Array<{ id: number; name: string }>;
  sellers: Array<{ id: number; name: string }>;
}

/** Uma pessoa do contrato, do jeito que o formulário a segura. */
interface PersonDraft {
  profile: ContractStudentProfile;
  courseId: number;
  classId: string;
  amountText: string;
  leadId: number | null;
  studentId: number | null;
  /** Só para mostrar de onde a ficha veio. */
  origem: string | null;
}

function emptyPerson(): PersonDraft {
  return {
    profile: { ...EMPTY_CONTRACT_PROFILE },
    courseId: 0,
    classId: "",
    amountText: "",
    leadId: null,
    studentId: null,
    origem: null,
  };
}

function parseAmount(text: string): number {
  const parsed = Number(text.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : 0;
}

function money(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function amountToText(value: number): string {
  return value > 0 ? value.toFixed(2).replace(".", ",") : "";
}

const inputClass =
  "w-full rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-sm text-neutral-900 focus:border-cyan-400 focus:outline-none";
const labelClass = "mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-neutral-400";

export function NovoContratoModal({
  pendency,
  onClose,
  onSaved,
}: {
  /**
   * Matrícula que já existe, quando o assistente é aberto pela fila de
   * regularização. Com ela, o bloco de dinheiro some: regularizar cadastro não
   * é refazer venda, e mexer no cronograma de quem já pagou seria estrago.
   */
  pendency: EnrollmentPendency | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const regularizando = Boolean(pendency);

  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [people, setPeople] = useState<PersonDraft[]>([emptyPerson()]);
  const [openClasses, setOpenClasses] = useState<Record<number, OpenClass[]>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hoje = new Date().toISOString().slice(0, 10);
  const [totalText, setTotalText] = useState("");
  const [installments, setInstallments] = useState(1);
  const [downPaymentText, setDownPaymentText] = useState("");
  const [saleDate, setSaleDate] = useState(hoje);
  const [paymentMethodId, setPaymentMethodId] = useState<string>("");
  const [cardBrandId, setCardBrandId] = useState<string>("");
  const [sellerId, setSellerId] = useState<string>("");
  const [branchId, setBranchId] = useState<string>("");
  const [notes, setNotes] = useState("");
  /** Forma escolhida: é o teto dela que define quantas parcelas o seletor oferece. */
  const selectedPaymentMethod =
    (catalog?.paymentMethods ?? []).find((item) => String(item.id) === paymentMethodId) ?? null;
  const [courseHours, setCourseHours] = useState("");
  const [split, setSplit] = useState<{ matricula: string; material: string; curso: string }>({
    matricula: "",
    material: "",
    curso: "",
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/contracts/intake");
        const data = (await response.json().catch(() => ({}))) as Catalog;
        if (!cancelled) setCatalog(data);
      } catch {
        if (!cancelled) setError("Não foi possível carregar o catálogo.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Regularização: o assistente abre já sabendo de quem é a matrícula.
  useEffect(() => {
    if (!pendency) return;
    setPeople((current) => {
      const first = { ...current[0] };
      first.courseId = pendency.courseId ?? 0;
      first.classId = pendency.classId ? String(pendency.classId) : "";
      first.leadId = pendency.leadInscricaoId;
      first.studentId = pendency.studentId;
      first.profile = { ...first.profile, fullName: pendency.student };
      return [first, ...current.slice(1)];
    });
    setTotalText(amountToText(pendency.amount));
  }, [pendency]);

  // A ficha que o sistema já tem, quando existe: ninguém redigita o que o CRM
  // ou a secretaria já cadastraram.
  useEffect(() => {
    if (!pendency) return;
    const query = pendency.studentId
      ? `studentId=${pendency.studentId}`
      : pendency.leadInscricaoId
        ? `leadId=${pendency.leadInscricaoId}`
        : null;
    if (!query) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/contracts/intake?${query}`);
        const data = (await response.json().catch(() => ({}))) as { profile?: ContractStudentProfile | null };
        if (cancelled || !data.profile) return;
        setPeople((current) =>
          current.map((person, index) =>
            index === 0
              ? { ...person, profile: { ...data.profile!, fullName: data.profile!.fullName || pendency.student } }
              : person
          )
        );
      } catch {
        // Sem ficha pronta, o formulário fica em branco — que é o esperado.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pendency]);

  /** Turmas abertas de cada treinamento escolhido, uma lista por curso. */
  useEffect(() => {
    const faltando = Array.from(new Set(people.map((p) => p.courseId).filter((id) => id > 0))).filter(
      (id) => !(id in openClasses)
    );
    if (faltando.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const courseId of faltando) {
        try {
          const response = await fetch(`/api/contracts/intake?courseId=${courseId}`);
          const data = (await response.json().catch(() => ({}))) as { openClasses?: OpenClass[] };
          if (cancelled) return;
          setOpenClasses((current) => ({ ...current, [courseId]: data.openClasses ?? [] }));
        } catch {
          if (cancelled) return;
          setOpenClasses((current) => ({ ...current, [courseId]: [] }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [people, openClasses]);

  const training = useMemo(
    () => catalog?.trainings.find((item) => item.id === people[0]?.courseId) ?? null,
    [catalog, people]
  );

  // Carga horária e rateio saem do cadastro do curso — os dois campos existem
  // para a exceção, não para a digitação de todo dia.
  useEffect(() => {
    if (!training || regularizando) return;
    if (training.lessonsCount && training.lessonHours) {
      setCourseHours(`${training.lessonsCount * training.lessonHours} horas`);
    }
    setTotalText((current) => current || amountToText(training.defaultPrice ?? 0));
    setInstallments((current) => (current > 1 ? current : training.defaultInstallments || 1));
  }, [training, regularizando]);

  const total = parseAmount(totalText);
  const othersTotal = people.slice(1).reduce((sum, person) => sum + parseAmount(person.amountText), 0);
  const payerShare = Math.max(0, Math.round((total - othersTotal) * 100) / 100);

  // Rateio do item 4: matrícula e material vêm do curso, e o curso é o que
  // sobra — assim a soma sempre fecha com o valor cobrado.
  useEffect(() => {
    if (!training || total <= 0) return;
    setSplit((current) => {
      if (current.matricula || current.material || current.curso) return current;
      const matricula = Math.min(training.enrollmentFee, total);
      const material = Math.min(training.materialFee, Math.max(0, total - matricula));
      return {
        matricula: amountToText(matricula),
        material: amountToText(material),
        curso: amountToText(Math.max(0, Math.round((total - matricula - material) * 100) / 100)),
      };
    });
  }, [training, total]);

  const splitValues: ContractPlanSplit = {
    matricula: parseAmount(split.matricula),
    material: parseAmount(split.material),
    curso: parseAmount(split.curso),
  };
  const splitTotal = planSplitTotal(splitValues);

  const setPerson = useCallback((index: number, patch: Partial<PersonDraft>) => {
    setPeople((current) => current.map((person, i) => (i === index ? { ...person, ...patch } : person)));
  }, []);

  async function salvar() {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        enrollmentId: pendency?.enrollmentId ?? null,
        people: people.map((person, index) => ({
          leadInscricaoId: person.leadId,
          profile: person.profile,
          courseId: person.courseId,
          classId: person.classId ? Number(person.classId) : null,
          amount: index === 0 ? payerShare : parseAmount(person.amountText),
        })),
        planSplit: splitTotal > 0 ? splitValues : null,
        courseHours: courseHours.trim() || null,
        className: null,
        sale: regularizando
          ? null
          : {
              totalAmount: total,
              installments,
              downPaymentAmount: parseAmount(downPaymentText),
              saleDate,
              firstMonth: saleDate.slice(0, 7),
              paymentMethodId: paymentMethodId ? Number(paymentMethodId) : null,
              cardBrandId: cardBrandId ? Number(cardBrandId) : null,
              sellerId: sellerId ? Number(sellerId) : null,
              branchId: branchId ? Number(branchId) : null,
              notes: notes.trim() || null,
            },
      };

      const response = await fetch("/api/contracts/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => ({}))) as {
        enrollmentId?: number;
        allocated?: number;
        contractId?: number | null;
        contractError?: string | null;
        error?: string;
      };
      if (!response.ok) throw new Error(data.error ?? "Não foi possível criar o contrato.");

      const partes = [
        `Matrícula #${data.enrollmentId}`,
        (data.allocated ?? 0) > 0 ? `${data.allocated} aluno(s) no diário` : "sem turma definida",
        data.contractId ? "contrato gerado" : null,
      ].filter(Boolean);
      onSaved(
        data.contractError
          ? `${partes.join(" · ")}. O contrato não saiu: ${data.contractError}`
          : `${partes.join(" · ")}.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar o contrato.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-neutral-950/40 p-0 sm:items-center sm:p-6">
      <div className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-neutral-900">
              {regularizando ? `Completar matrícula #${pendency!.enrollmentId}` : "Novo contrato"}
            </h2>
            <p className="text-xs text-neutral-500">
              {regularizando
                ? "O dinheiro desta matrícula não é tocado aqui — o que falta é ficha, turma e contrato."
                : "Escolha as pessoas, o treinamento e a turma. A matrícula e o contrato saem juntos."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && <p role="alert" className="mb-3 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}

        <div className="space-y-4">
          {people.map((person, index) => (
            <section
              key={index}
              className="rounded-xl border border-neutral-200 bg-neutral-50/60 p-4"
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wide text-neutral-500">
                  {index === 0 ? "Quem paga (1º aluno)" : `${index + 1}º aluno do mesmo contrato`}
                  {person.origem && (
                    <span className="ml-2 rounded-full bg-cyan-100 px-2 py-0.5 text-[10px] font-bold text-cyan-800">
                      {person.origem}
                    </span>
                  )}
                </h3>
                {index > 0 && (
                  <button
                    type="button"
                    onClick={() => setPeople((current) => current.filter((_, i) => i !== index))}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 hover:underline"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> remover
                  </button>
                )}
              </div>

              {/* A busca cobre as duas origens de uma vez: quem digita um nome
                  não precisa saber se aquela pessoa está no CRM como lead ou na
                  escola como aluno. */}
              <PersonPicker
                onPick={(picked, profile) =>
                  setPerson(index, {
                    profile,
                    leadId: picked.leadId,
                    studentId: picked.studentId,
                    origem: picked.origem,
                  })
                }
              />

              <div className="mt-3">
                <ContractProfileFields
                  profile={person.profile}
                  onChange={(next) => setPerson(index, { profile: next })}
                  labelClass={labelClass}
                  inputClass={inputClass}
                />
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <div>
                  <label className={labelClass}>Treinamento *</label>
                  <select
                    value={person.courseId || ""}
                    onChange={(event) => setPerson(index, { courseId: Number(event.target.value) || 0, classId: "" })}
                    className={inputClass}
                  >
                    <option value="">Escolha…</option>
                    {(catalog?.trainings ?? []).map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Turma</label>
                  <select
                    value={person.classId}
                    onChange={(event) => setPerson(index, { classId: event.target.value })}
                    className={inputClass}
                  >
                    <option value="">Definir depois (fica pendente)</option>
                    {(openClasses[person.courseId] ?? []).map((turma) => (
                      <option key={turma.id} value={turma.id}>
                        {turma.name}
                        {turma.scheduleLabel ? ` — ${turma.scheduleLabel}` : ""}
                        {turma.seatsLeft !== null ? ` · ${turma.seatsLeft} vaga(s)` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>
                    {index === 0 ? "Valor do curso dele" : "Valor do curso *"}
                  </label>
                  {index === 0 ? (
                    <p className="mt-1.5 text-sm font-bold text-neutral-900">
                      {money(payerShare)}
                      <span className="ml-1 text-[10px] font-normal text-neutral-500">
                        (o que sobra do total)
                      </span>
                    </p>
                  ) : (
                    <input
                      value={person.amountText}
                      onChange={(event) => setPerson(index, { amountText: event.target.value })}
                      inputMode="decimal"
                      placeholder="0,00"
                      className={inputClass}
                    />
                  )}
                </div>
              </div>
            </section>
          ))}

          <button
            type="button"
            onClick={() => setPeople((current) => [...current, emptyPerson()])}
            className="inline-flex items-center gap-2 rounded-lg border border-violet-300 bg-white px-3 py-1.5 text-xs font-bold text-violet-700 hover:bg-violet-50"
          >
            <UserPlus className="h-3.5 w-3.5" /> Adicionar pessoa ao contrato
          </button>

          {people.length > 1 && (
            <p className="rounded-xl bg-violet-50 px-4 py-3 text-xs leading-relaxed text-violet-900">
              Contrato de {people.length} pessoas: <strong>um</strong> contrato e{" "}
              <strong>uma</strong> cobrança (de quem paga), e <strong>{people.length} matrículas na
              turma</strong> — cada pessoa com a ficha e a cadeira dela no diário.
            </p>
          )}

          {!regularizando && (
            <section className="space-y-3 rounded-xl border border-neutral-200 p-4">
              <h3 className="text-xs font-bold uppercase tracking-wide text-neutral-500">Valores e cobrança</h3>
              <div className="grid gap-2 sm:grid-cols-4">
                <div>
                  <label className={labelClass}>Valor fechado *</label>
                  <input
                    value={totalText}
                    onChange={(event) => setTotalText(event.target.value)}
                    inputMode="decimal"
                    placeholder="0,00"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Entrada</label>
                  <input
                    value={downPaymentText}
                    onChange={(event) => setDownPaymentText(event.target.value)}
                    inputMode="decimal"
                    placeholder="0,00"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Parcelas</label>
                  <select
                    value={installments}
                    onChange={(event) => setInstallments(Number(event.target.value))}
                    className={inputClass}
                  >
                    {enrollmentInstallmentOptions(selectedPaymentMethod?.maxInstallments).map((option) => (
                      <option key={option} value={option}>
                        {option}x
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Data da venda</label>
                  <input
                    type="date"
                    value={saleDate}
                    onChange={(event) => setSaleDate(event.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-4">
                <div>
                  <label className={labelClass}>Forma de pagamento</label>
                  <select
                    value={paymentMethodId}
                    onChange={(event) => {
                      setPaymentMethodId(event.target.value);
                      // Teto menor que o já escolhido puxa as parcelas para
                      // baixo — o servidor recusaria na hora de salvar.
                      const cap = installmentCap(
                        (catalog?.paymentMethods ?? []).find((item) => String(item.id) === event.target.value)
                          ?.maxInstallments
                      );
                      setInstallments((current) => Math.min(current, cap));
                    }}
                    className={inputClass}
                  >
                    <option value="">—</option>
                    {(catalog?.paymentMethods ?? []).map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Bandeira</label>
                  <select
                    value={cardBrandId}
                    onChange={(event) => setCardBrandId(event.target.value)}
                    className={inputClass}
                  >
                    <option value="">—</option>
                    {(catalog?.cardBrands ?? []).map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Vendedor</label>
                  <select value={sellerId} onChange={(event) => setSellerId(event.target.value)} className={inputClass}>
                    <option value="">—</option>
                    {(catalog?.sellers ?? []).map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Unidade</label>
                  <select value={branchId} onChange={(event) => setBranchId(event.target.value)} className={inputClass}>
                    <option value="">—</option>
                    {(catalog?.branches ?? []).map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className={labelClass}>Observações</label>
                <input value={notes} onChange={(event) => setNotes(event.target.value)} className={inputClass} />
              </div>
            </section>
          )}

          <section className="space-y-2 rounded-xl border border-neutral-200 p-4">
            <h3 className="text-xs font-bold uppercase tracking-wide text-neutral-500">
              Como o contrato descreve o curso
            </h3>
            <div>
              <label className={labelClass}>Carga horária total</label>
              <input
                value={courseHours}
                onChange={(event) => setCourseHours(event.target.value)}
                placeholder="Ex.: 72 horas"
                className={inputClass}
              />
            </div>
            <div>
              <p className={labelClass}>Valores do contrato (item 4)</p>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    ["matricula", "Matrícula"],
                    ["material", "Material"],
                    ["curso", "Curso"],
                  ] as const
                ).map(([campo, rotulo]) => (
                  <div key={campo}>
                    <label className="text-[10px] font-semibold text-neutral-500">{rotulo}</label>
                    <input
                      value={split[campo]}
                      onChange={(event) => setSplit({ ...split, [campo]: event.target.value })}
                      inputMode="decimal"
                      placeholder="0,00"
                      className={inputClass}
                    />
                  </div>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-neutral-500">
                Soma {money(splitTotal)}
                {total > 0 && Math.abs(splitTotal - total) > 0.01 && (
                  <span className="ml-1 font-bold text-amber-700">
                    — diferente do valor cobrado ({money(total)})
                  </span>
                )}
              </p>
            </div>
          </section>
        </div>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-bold text-neutral-700 hover:bg-neutral-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void salvar()}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {regularizando ? "Completar e gerar contrato" : "Criar contrato e matrícula"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Busca de pessoa nas duas origens ao mesmo tempo.
 *
 * Separar "buscar lead" de "buscar aluno" obrigaria quem usa a tela a saber, de
 * antemão, em qual das duas tabelas aquela pessoa está — que é exatamente a
 * pergunta que ela veio fazer ao sistema.
 */
function PersonPicker({
  onPick,
}: {
  onPick: (
    picked: { leadId: number | null; studentId: number | null; origem: string },
    profile: ContractStudentProfile
  ) => void;
}) {
  const [term, setTerm] = useState("");
  const [searching, setSearching] = useState(false);
  const [leads, setLeads] = useState<Array<{ id: number; nome: string | null; telefone: string | null }>>([]);
  const [students, setStudents] = useState<
    Array<{ id: number; fullName: string; cpf: string | null; leadInscricaoId: number | null; classes: string[] }>
  >([]);

  async function buscar() {
    if (term.trim().length < 3) return;
    setSearching(true);
    try {
      const response = await fetch(`/api/contracts/intake?q=${encodeURIComponent(term.trim())}`);
      const data = (await response.json().catch(() => ({}))) as {
        leads?: typeof leads;
        students?: typeof students;
      };
      setLeads(data.leads ?? []);
      setStudents(data.students ?? []);
    } catch {
      setLeads([]);
      setStudents([]);
    } finally {
      setSearching(false);
    }
  }

  async function escolher(query: string, picked: { leadId: number | null; studentId: number | null; origem: string }) {
    try {
      const response = await fetch(`/api/contracts/intake?${query}`);
      const data = (await response.json().catch(() => ({}))) as { profile?: ContractStudentProfile | null };
      if (data.profile) onPick(picked, data.profile);
    } catch {
      // Sem ficha pronta, quem preenche é quem está na tela.
    }
    setLeads([]);
    setStudents([]);
    setTerm("");
  }

  return (
    <div>
      <label className={labelClass}>Já está no sistema? (lead do CRM ou aluno)</label>
      <div className="flex gap-2">
        <input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void buscar();
            }
          }}
          placeholder="Nome, telefone ou CPF — mínimo 3 letras"
          className={inputClass}
        />
        <button
          type="button"
          onClick={() => void buscar()}
          className="inline-flex flex-none items-center gap-1 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-700 hover:bg-neutral-50"
        >
          {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Buscar
        </button>
      </div>
      <p className="mt-1 text-[11px] text-neutral-500">
        Quem nunca foi lead não precisa virar um: basta preencher a ficha abaixo.
      </p>

      {(leads.length > 0 || students.length > 0) && (
        <div className="mt-2 space-y-1 rounded-lg border border-neutral-200 bg-white p-2">
          {students.map((student) => (
            <button
              key={`s${student.id}`}
              type="button"
              onClick={() =>
                void escolher(`studentId=${student.id}`, {
                  leadId: student.leadInscricaoId,
                  studentId: student.id,
                  origem: "aluno da escola",
                })
              }
              className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-neutral-50"
            >
              <span className="font-semibold text-neutral-900">{student.fullName}</span>
              <span className="ml-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                aluno
              </span>
              {student.classes.length > 0 && (
                <span className="ml-1 text-neutral-500">· {student.classes.join(", ")}</span>
              )}
            </button>
          ))}
          {leads.map((lead) => (
            <button
              key={`l${lead.id}`}
              type="button"
              onClick={() =>
                void escolher(`leadId=${lead.id}`, { leadId: lead.id, studentId: null, origem: "lead do CRM" })
              }
              className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-neutral-50"
            >
              <span className="font-semibold text-neutral-900">{lead.nome ?? `Lead #${lead.id}`}</span>
              <span className="ml-1 rounded bg-cyan-100 px-1.5 py-0.5 text-[10px] font-bold text-cyan-800">lead</span>
              {lead.telefone && <span className="ml-1 text-neutral-500">· {lead.telefone}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
