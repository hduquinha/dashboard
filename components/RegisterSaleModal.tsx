"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, RefreshCw, Trash2, X } from "lucide-react";
import { enrollmentInstallmentOptions, installmentCap } from "@/lib/enrollmentInstallments";
import {
  EMPTY_CONTRACT_PROFILE,
  describePlanSplitDivergence,
  EMPTY_COURSE_INFO,
  planSplitTotal,
  validateContractProfile,
  validateCourseInfo,
  validatePlanSplit,
  type ContractCourseInfo,
  type ContractPlanSplit,
  type ContractStudentProfile,
} from "@/lib/contractProfile";
import { ContractProfileFields } from "@/components/ContractProfileFields";

export interface RegisterSaleTarget {
  id: number;
  nome: string | null;
}

interface TrainingOption {
  id: number;
  name: string;
  defaultPrice: number | null;
  minPrice: number | null;
  defaultInstallments: number;
  durationLabel: string | null;
  /** Empresa dona do curso: decide em qual Financeiro a venda entra. */
  businessUnit: "vozup" | "instituto";
  /** Do cadastro do curso: alimentam carga horária e rateio sem digitação. */
  lessonsCount: number | null;
  lessonHours: number | null;
  enrollmentFee: number;
  materialFee: number;
}

/**
 * "24 aulas · 48 horas" — texto do item 3 montado a partir do curso. Curso sem
 * nº de aulas é imersão: sai só o tempo ("25 horas"). Mesma regra de
 * `getEnrollmentCourseInfo` em `lib/contracts.ts`.
 */
function courseHoursLabel(training: TrainingOption | null | undefined): string {
  const horas = (value: number) => {
    const total = Math.round(value * 10) / 10;
    return Number.isInteger(total) ? String(total) : String(total).replace(".", ",");
  };
  if (!training?.lessonsCount || training.lessonsCount <= 0) {
    return training?.lessonHours && training.lessonHours > 0 ? `${horas(training.lessonHours)} horas` : "";
  }
  if (!training.lessonHours || training.lessonHours <= 0) return `${training.lessonsCount} aulas`;
  return `${training.lessonsCount} aulas · ${horas(training.lessonsCount * training.lessonHours)} horas`;
}

interface NamedOption {
  id: number;
  name: string;
  kind?: string;
  /** Só nas formas de pagamento: teto de parcelas da forma (null = teto do sistema). */
  maxInstallments?: number | null;
}

/** Turma aberta do curso escolhido, oferecida na hora de fechar. */
interface OpenClassOption {
  id: number;
  name: string;
  startDate: string | null;
  seatsLeft: number | null;
  scheduleLabel: string;
  teacherName: string | null;
  lessonsTotal: number;
}

interface SaleOptions {
  trainings: TrainingOption[];
  paymentMethods: NamedOption[];
  cardBrands: NamedOption[];
  sellers: NamedOption[];
  branches: NamedOption[];
}

interface SaleInstallment {
  number: number;
  amount: number;
  dueDate: string | null;
  paymentMethodId: number | null;
  cardBrandId: number | null;
  status: string;
  paid: number;
}

interface ExistingSale {
  enrollmentId: number;
  courseId: number | null;
  amount: number;
  installments: number;
  saleDate: string;
  firstMonth: string;
  paymentMethodId: number | null;
  cardBrandId: number | null;
  sellerId: number | null;
  branchId: number | null;
  discountReason: string | null;
  notes: string | null;
  paid: number;
  schedule: SaleInstallment[];
}

/** Linha editável do cronograma. Valor fica como texto pelo mesmo motivo do
 *  valor fechado: converter a cada tecla impede digitar decimais. */
interface InstallmentDraft {
  /** Entrada é a parcela 0 no Financeiro; o resto é parcela mensal. */
  type: "entrada" | "parcela";
  amountText: string;
  dueDate: string;
  paymentMethodId: number | null;
  cardBrandId: number | null;
}

/**
 * Segunda pessoa do mesmo contrato (casal ou dupla que compra junto). O valor
 * fica como texto pelo mesmo motivo do valor fechado: converter a cada tecla
 * impede digitar decimais.
 */
interface CoStudentDraft {
  profile: ContractStudentProfile;
  courseId: number;
  amountText: string;
  /** Turma dela no item 3 do contrato — o TEXTO que sai no PDF. */
  className: string;
  /**
   * Turma de verdade dela. É este id que coloca a pessoa no diário de classe:
   * enquanto o co-aluno só tinha o texto acima, ele existia no contrato e não
   * existia na turma. "" é "definir depois", como no 1º aluno.
   */
  classId: string;
  /** Lead do CRM desta pessoa, quando ela foi puxada da busca. */
  leadId: number | null;
  /** Nome mostrado do lead vinculado — só para o vendedor ver o que puxou. */
  leadLabel: string | null;
}

interface RegisterSaleModalProps {
  lead: RegisterSaleTarget;
  onSaved: (leadId: number, amount: number, courseName: string | null) => void;
  onCancel: () => void;
  /**
   * O lead JÁ está em Fechado e esta venda é a contrapartida disso. Sem ela o
   * lead fica marcado como ganho sem matrícula, sem parcelas e sem contrato —
   * por isso não há saída pelo X nem por "Agora não": só salvando.
   */
  required?: boolean;
}

const money = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

/** "1.497,50" e "1497.50" viram 1497.5. Vazio vira NaN, tratado no submit. */
function parseAmount(raw: string): number {
  const normalized = raw.trim().replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  return Number.parseFloat(normalized);
}

/** Mesmo dia do mês, N meses à frente; encurta para o último dia quando o mês
 *  não tem aquele dia (31 de janeiro + 1 mês = 28/29 de fevereiro).
 *  `dayOfMonth` troca o dia — é o vencimento fixo combinado com o aluno. */
function addMonthsIso(isoDate: string, months: number, dayOfMonth?: number | null): string {
  const [year, month, day] = isoDate.split("-").map((part) => Number.parseInt(part, 10));
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  const wanted = dayOfMonth && dayOfMonth >= 1 ? dayOfMonth : day;
  const safeDay = String(Math.min(wanted, lastDay)).padStart(2, "0");
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}-${safeDay}`;
}

/** Cronograma padrão: parcelas iguais, uma por mês a partir da data da venda,
 *  com a sobra dos centavos na última. É o ponto de partida que o vendedor
 *  ajusta linha a linha.
 *
 *  Com entrada, ela é a primeira linha (vence no dia da venda) e as mensais
 *  dividem só o que sobrou, começando no mês seguinte. `dueDay` fixa o dia do
 *  vencimento das mensais; se esse dia já passou no mês da venda, o cronograma
 *  inteiro anda um mês para nenhuma parcela nascer vencida. */
function buildDefaultSchedule(
  total: number,
  count: number,
  saleDate: string,
  paymentMethodId: number | null,
  cardBrandId: number | null,
  entry = 0,
  dueDay: number | null = null
): InstallmentDraft[] {
  const entryAmount = Math.max(0, Math.min(Math.round(entry * 100) / 100, total));
  const cents = Math.round((total - entryAmount) * 100);
  const base = Math.floor(cents / count);
  const saleDay = Number.parseInt(saleDate.slice(8, 10), 10);
  const firstOffset = entryAmount > 0 || (dueDay !== null && dueDay < saleDay) ? 1 : 0;
  const parcelas = Array.from({ length: count }, (_, index) => {
    const amount = (base + (index === count - 1 ? cents - base * count : 0)) / 100;
    return {
      type: "parcela" as const,
      amountText: amount.toFixed(2).replace(".", ","),
      dueDate: addMonthsIso(saleDate, index + firstOffset, dueDay),
      paymentMethodId,
      cardBrandId,
    };
  });
  if (entryAmount <= 0) return parcelas;
  return [
    {
      type: "entrada" as const,
      amountText: entryAmount.toFixed(2).replace(".", ","),
      dueDate: saleDate,
      paymentMethodId,
      cardBrandId,
    },
    ...parcelas,
  ];
}

function todayIso(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

/**
 * Registra (ou corrige) a venda do lead: qual treinamento, por quanto e em
 * quantas parcelas. Salvar cria a matrícula no Financeiro com as parcelas
 * previstas, já vinculada a este lead — é o que faz o relatório saber quanto
 * cada campanha gerou.
 *
 * O valor vem preenchido com o preço de tabela do treinamento e continua
 * editável: o desconto é calculado e registrado, não bloqueado.
 */
export function RegisterSaleModal({ lead, onSaved, onCancel, required = false }: RegisterSaleModalProps) {
  const [options, setOptions] = useState<SaleOptions | null>(null);
  const [existing, setExisting] = useState<ExistingSale | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [courseId, setCourseId] = useState<number | null>(null);
  // String bruta, não número: converter a cada tecla impede digitar decimais.
  const [amountText, setAmountText] = useState("");
  // Nº de parcelas MENSAIS; a entrada não conta como parcela (mesma leitura
  // do editor de matrículas do Financeiro).
  const [installments, setInstallments] = useState(1);
  // Entrada combinada: sai do valor dividido nas mensais e vira a parcela 0.
  // Texto pelo mesmo motivo do valor fechado.
  const [entryText, setEntryText] = useState("");
  /** Dia fixo de vencimento das mensais; null = o mesmo dia da venda. */
  const [dueDay, setDueDay] = useState<number | null>(null);
  const [saleDate, setSaleDate] = useState(todayIso());
  const [paymentMethodId, setPaymentMethodId] = useState<number | null>(null);
  const [cardBrandId, setCardBrandId] = useState<number | null>(null);
  const [sellerId, setSellerId] = useState<number | null>(null);
  const [branchId, setBranchId] = useState<number | null>(null);
  const [discountReason, setDiscountReason] = useState("");
  const [notes, setNotes] = useState("");
  const [schedule, setSchedule] = useState<InstallmentDraft[]>([]);
  // Quadro do CONTRATANTE (item 2) e rateio do item 4 do contrato.
  const [profile, setProfile] = useState<ContractStudentProfile>(EMPTY_CONTRACT_PROFILE);
  const [courseInfo, setCourseInfo] = useState<ContractCourseInfo>(EMPTY_COURSE_INFO);
  // Turma do aluno. "" = definir depois; vira pendência em vez de sumir.
  const [openClasses, setOpenClasses] = useState<OpenClassOption[]>([]);
  const [classId, setClassId] = useState<string>("");
  const [matriculaText, setMatriculaText] = useState("");
  const [materialText, setMaterialText] = useState("");
  /** Vazio = "o resto do valor fechado". Digitado, manda — e aí o contrato pode
      ter total próprio, diferente da matrícula. */
  const [cursoText, setCursoText] = useState("");
  // Alunos adicionais do contrato — vazio é o caso normal.
  const [coStudents, setCoStudents] = useState<CoStudentDraft[]>([]);
  const [coOpenClasses, setCoOpenClasses] = useState<Record<number, OpenClassOption[]>>({});
  /**
   * Valor do curso de quem paga. Só existe quando há alunos adicionais: aí o
   * "valor fechado" deixa de ser digitado e passa a ser a SOMA dos cursos —
   * que é o motivo de as duas pessoas estarem no mesmo contrato.
   */
  const [payerAmountText, setPayerAmountText] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(`/api/commercial/leads/${lead.id}/sale`);
        const data = (await response.json().catch(() => ({}))) as {
          sale?: ExistingSale | null;
          options?: SaleOptions;
          contractProfile?: ContractStudentProfile;
          contractPlan?: ContractPlanSplit | null;
          contractCourse?: ContractCourseInfo | null;
          coStudents?: Array<{
            profile: ContractStudentProfile;
            courseId: number | null;
            amount: number;
            className?: string | null;
            classId?: number | null;
            leadInscricaoId?: number | null;
          }>;
          openClasses?: OpenClassOption[];
          error?: string;
        };
        if (!response.ok) throw new Error(data.error ?? "Falha ao carregar o catálogo.");
        if (cancelled) return;

        setOptions(data.options ?? null);
        if (data.contractProfile) setProfile(data.contractProfile);
        if (data.contractCourse) setCourseInfo(data.contractCourse);
        const carregados = (data.coStudents ?? []).map((item) => ({
          profile: item.profile,
          courseId: item.courseId ?? 0,
          amountText: item.amount > 0 ? item.amount.toFixed(2).replace(".", ",") : "",
          className: item.className ?? "",
          classId: item.classId ? String(item.classId) : "",
          leadId: item.leadInscricaoId ?? null,
          leadLabel: item.leadInscricaoId ? item.profile.fullName : null,
        }));
        setCoStudents(carregados);
        // O valor de quem paga é o total menos o dos outros — é assim que a
        // venda foi gravada, e é o que o formulário volta a mostrar.
        if (carregados.length > 0 && data.sale) {
          const outros = carregados.reduce((sum, item) => sum + (parseAmount(item.amountText) || 0), 0);
          const doPagador = Math.max(0, Math.round((data.sale.amount - outros) * 100) / 100);
          setPayerAmountText(doPagador > 0 ? doPagador.toFixed(2).replace(".", ",") : "");
        }
        setOpenClasses(data.openClasses ?? []);
        if (data.contractPlan) {
          // Reabre a divisão combinada.
          setMatriculaText(
            data.contractPlan.matricula > 0
              ? data.contractPlan.matricula.toFixed(2).replace(".", ",")
              : ""
          );
          setMaterialText(
            data.contractPlan.material > 0
              ? data.contractPlan.material.toFixed(2).replace(".", ",")
              : ""
          );
          // O curso só volta preenchido quando foi ESCOLHIDO — isto é, quando o
          // total do contrato não é o resto do valor fechado. Preencher sempre
          // congelaria o rateio: corrigir o valor da venda deixaria de recalcular
          // o curso sozinho.
          const resto =
            Math.round(
              Math.max(
                0,
                (data.sale?.amount ?? 0) -
                  data.contractPlan.matricula -
                  data.contractPlan.material
              ) * 100
            ) / 100;
          const escolhido = Math.round(data.contractPlan.curso * 100) / 100;
          setCursoText(
            Math.abs(Math.round(escolhido * 100) - Math.round(resto * 100)) > 1
              ? escolhido.toFixed(2).replace(".", ",")
              : ""
          );
        }
        const sale = data.sale ?? null;
        setExisting(sale);

        if (sale) {
          setCourseId(sale.courseId);
          setAmountText(sale.amount.toFixed(2).replace(".", ","));
          // Entrada é a parcela 0 no Financeiro; o seletor de parcelas conta
          // só as mensais.
          const entrada = sale.schedule.find((item) => item.number === 0) ?? null;
          const mensais = sale.schedule.filter((item) => item.number !== 0);
          setInstallments(mensais.length || sale.installments);
          setEntryText(entrada ? entrada.amount.toFixed(2).replace(".", ",") : "");
          // O dia do vencimento só é "fixo" quando todas as mensais caem nele.
          const dias = mensais.map((item) => Number.parseInt((item.dueDate ?? "").slice(8, 10), 10));
          setDueDay(dias.length > 0 && dias.every((dia) => dia === dias[0]) && dias[0] >= 1 ? dias[0] : null);
          setSaleDate(sale.saleDate || todayIso());
          setPaymentMethodId(sale.paymentMethodId);
          setCardBrandId(sale.cardBrandId);
          setSellerId(sale.sellerId);
          setBranchId(sale.branchId);
          setDiscountReason(sale.discountReason ?? "");
          setNotes(sale.notes ?? "");
          // Reabre exatamente o que foi combinado, não o padrão calculado.
          setSchedule(
            sale.schedule.map((item) => ({
              type: item.number === 0 ? ("entrada" as const) : ("parcela" as const),
              amountText: item.amount.toFixed(2).replace(".", ","),
              dueDate: item.dueDate ?? sale.saleDate,
              paymentMethodId: item.paymentMethodId,
              cardBrandId: item.cardBrandId,
            }))
          );
        } else {
          const first = data.options?.trainings[0];
          const today = todayIso();
          if (first) {
            setCourseId(first.id);
            setCourseInfo((current) => ({ ...current, hours: courseHoursLabel(first) || current.hours }));
            setMatriculaText(first.enrollmentFee > 0 ? first.enrollmentFee.toFixed(2).replace(".", ",") : "");
            setMaterialText(first.materialFee > 0 ? first.materialFee.toFixed(2).replace(".", ",") : "");
            setAmountText(first.defaultPrice === null ? "" : first.defaultPrice.toFixed(2).replace(".", ","));
            setInstallments(first.defaultInstallments);
            setSchedule(
              buildDefaultSchedule(first.defaultPrice ?? 0, first.defaultInstallments, today, null, null)
            );
          }
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Falha ao carregar o catálogo.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [lead.id]);

  const training = useMemo(
    () => options?.trainings.find((item) => item.id === courseId) ?? null,
    [options, courseId]
  );

  // Quanto é o curso de cada aluno adicional.
  const coStudentsTotal = coStudents.reduce((sum, co) => {
    const value = parseAmount(co.amountText);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
  const payerOwnAmount = parseAmount(payerAmountText);
  /**
   * Valor fechado do contrato. Com uma pessoa é o que o vendedor digita; com
   * duas é a **soma dos cursos**, porque é isso que vai ser cobrado num
   * contrato só. Antes o campo continuava digitado e o valor da segunda pessoa
   * era descontado dele — quem preenchia os dois com o mesmo número acabava
   * com R$ 0,00 para quem paga.
   */
  const amount =
    coStudents.length > 0
      ? Math.round(((Number.isFinite(payerOwnAmount) ? payerOwnAmount : 0) + coStudentsTotal) * 100) / 100
      : parseAmount(amountText);
  // Tabela do contrato inteiro: o curso de quem paga mais o de cada pessoa que
  // entra junto. Sem somar, o desconto de um contrato de duas pessoas apareceria
  // como "acréscimo" e nunca cobraria motivo.
  const coListPrice = coStudents.reduce((sum, co) => {
    const item = options?.trainings.find((option) => option.id === co.courseId);
    return sum + (item?.defaultPrice ?? 0);
  }, 0);
  const listPrice =
    training?.defaultPrice === null || training?.defaultPrice === undefined
      ? null
      : Math.round((training.defaultPrice + coListPrice) * 100) / 100;
  const discount = listPrice !== null && Number.isFinite(amount) ? Math.max(0, listPrice - amount) : 0;
  const discountPct = listPrice && listPrice > 0 && discount > 0 ? (discount / listPrice) * 100 : 0;
  const belowFloor =
    training?.minPrice !== null &&
    training?.minPrice !== undefined &&
    Number.isFinite(amount) &&
    amount < training.minPrice;

  /**
   * Item 4 do contrato. O vendedor digita matrícula e material; deixando CURSO
   * em branco, ele é o que sobra do valor fechado — a soma bate sozinha, que é o
   * caso normal.
   *
   * Digitando o curso, o total do contrato passa a ser livre e pode divergir da
   * matrícula (decisão do usuário em 25/08/2026). Divergir é permitido, mas
   * nunca em silêncio: `describePlanSplitDivergence` põe o aviso na tela.
   */
  const planSplit = useMemo<ContractPlanSplit>(() => {
    const matricula = parseAmount(matriculaText) || 0;
    const material = parseAmount(materialText) || 0;
    const total = Number.isFinite(amount) ? amount : 0;
    const cursoDigitado = cursoText.trim() ? parseAmount(cursoText) || 0 : null;
    return {
      matricula,
      material,
      curso:
        cursoDigitado === null
          ? Math.round(Math.max(0, total - matricula - material) * 100) / 100
          : Math.round(cursoDigitado * 100) / 100,
    };
  }, [matriculaText, materialText, cursoText, amount]);

  const planDivergence = useMemo(
    () => (Number.isFinite(amount) ? describePlanSplitDivergence(planSplit, amount) : null),
    [planSplit, amount]
  );

  const selectedMethod = options?.paymentMethods.find((method) => method.id === paymentMethodId) ?? null;
  const needsCardBrand = selectedMethod?.kind === "parcelado";

  /** Entrada combinada; 0 quando o campo está vazio. */
  const entryAmount = Math.max(0, parseAmount(entryText) || 0);
  const hasEntryRow = schedule[0]?.type === "entrada";
  const parcelCount = schedule.filter((item) => item.type === "parcela").length;

  const scheduleTotal = useMemo(
    () => schedule.reduce((total, item) => total + (parseAmount(item.amountText) || 0), 0),
    [schedule]
  );
  const scheduleGap = Number.isFinite(amount) ? Math.round((amount - scheduleTotal) * 100) / 100 : 0;
  const scheduleMatches = Math.abs(scheduleGap) < 0.01;

  /** Refaz o cronograma padrão. Chamado quando muda algo que invalida o que
   *  estava na tela (valor, nº de parcelas, data da venda). */
  const regenerate = useCallback(
    (
      total: number,
      count: number,
      date: string,
      methodId: number | null,
      brandId: number | null,
      // Entrada e dia do vencimento vêm do estado; os overrides existem para
      // quem acabou de mudar um dos dois e ainda não viu o novo estado.
      entryOverride?: number,
      dayOverride?: number | null
    ) => {
      if (!Number.isFinite(total) || total <= 0 || count < 1) return;
      setSchedule(
        buildDefaultSchedule(
          total,
          count,
          date,
          methodId,
          brandId,
          entryOverride ?? entryAmount,
          dayOverride === undefined ? dueDay : dayOverride
        )
      );
    },
    [entryAmount, dueDay]
  );

  /** Turmas abertas do curso — recarregadas a cada troca de treinamento. */
  const loadOpenClasses = useCallback(
    async (courseIdValue: number) => {
      try {
        const response = await fetch(
          `/api/commercial/leads/${lead.id}/sale?courseId=${courseIdValue}`
        );
        const data = (await response.json().catch(() => ({}))) as { openClasses?: OpenClassOption[] };
        setOpenClasses(data.openClasses ?? []);
      } catch {
        // Turma é conveniência: falha aqui não pode impedir o registro da venda.
        setOpenClasses([]);
      }
    },
    [lead.id]
  );

  /**
   * Turmas abertas dos cursos dos alunos ADICIONAIS, uma lista por curso. O 2º
   * aluno pode ter comprado outro treinamento, e oferecer a ele as turmas do
   * curso do pagador seria oferecer horário de aula que não é o dele.
   */
  useEffect(() => {
    const faltando = Array.from(
      new Set(coStudents.map((co) => co.courseId).filter((id) => id > 0))
    ).filter((id) => !(id in coOpenClasses));
    if (faltando.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const courseIdValue of faltando) {
        try {
          const response = await fetch(
            `/api/commercial/leads/${lead.id}/sale?courseId=${courseIdValue}`
          );
          const data = (await response.json().catch(() => ({}))) as { openClasses?: OpenClassOption[] };
          if (cancelled) return;
          setCoOpenClasses((current) => ({ ...current, [courseIdValue]: data.openClasses ?? [] }));
        } catch {
          if (cancelled) return;
          setCoOpenClasses((current) => ({ ...current, [courseIdValue]: [] }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [coStudents, coOpenClasses, lead.id]);

  const handleTrainingChange = useCallback(
    (value: number) => {
      setCourseId(value);
      setClassId("");
      void loadOpenClasses(value);
      const next = options?.trainings.find((item) => item.id === value);
      if (!next) return;
      // O curso preenche o contrato: carga horária e o rateio do item 4 deixam
      // de ser digitação a cada venda.
      setCourseInfo((current) => ({ ...current, hours: courseHoursLabel(next) || current.hours }));
      setMatriculaText(next.enrollmentFee > 0 ? next.enrollmentFee.toFixed(2).replace(".", ",") : "");
      setMaterialText(next.materialFee > 0 ? next.materialFee.toFixed(2).replace(".", ",") : "");
      // Trocar de treinamento repõe o valor de tabela: o número que estava lá
      // era o preço do outro curso e passaria batido como se fosse desconto.
      setAmountText(next.defaultPrice === null ? "" : next.defaultPrice.toFixed(2).replace(".", ","));
      setInstallments(next.defaultInstallments);
      regenerate(next.defaultPrice ?? 0, next.defaultInstallments, saleDate, paymentMethodId, cardBrandId);
    },
    [options, regenerate, saleDate, paymentMethodId, cardBrandId, loadOpenClasses]
  );

  function updateInstallment(index: number, patch: Partial<InstallmentDraft>) {
    setSchedule((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  /** Joga a diferença na última parcela — o ajuste que o vendedor faria na mão
   *  depois de mexer nas outras linhas. */
  function absorbGapInLastInstallment() {
    setSchedule((current) => {
      if (current.length === 0) return current;
      const lastIndex = current.length - 1;
      const lastAmount = parseAmount(current[lastIndex].amountText) || 0;
      const fixed = Math.round((lastAmount + scheduleGap) * 100) / 100;
      if (fixed <= 0) return current;
      return current.map((item, i) =>
        i === lastIndex ? { ...item, amountText: fixed.toFixed(2).replace(".", ",") } : item
      );
    });
  }

  async function submit() {
    if (!courseId) {
      setError("Escolha o treinamento vendido.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Informe o valor fechado. Ex.: 5000,00");
      return;
    }
    if (entryAmount > 0 && entryAmount >= amount) {
      setError("A entrada precisa ser menor que o valor fechado.");
      return;
    }
    if (discount > 0 && !discountReason.trim()) {
      setError("Houve desconto sobre o valor de tabela — informe o motivo.");
      return;
    }
    if (!scheduleMatches) {
      setError(
        `A soma das parcelas (${money(scheduleTotal)}) não bate com o valor fechado (${money(amount)}).`
      );
      return;
    }
    // Mesmas funções que a rota usa: o contrato não pode nascer sem quem assina.
    const profileProblem = validateContractProfile(profile) ?? validateCourseInfo(courseInfo);
    if (profileProblem) {
      setError(profileProblem);
      return;
    }
    const planProblem = validatePlanSplit(planSplit, amount);
    if (planProblem) {
      setError(planProblem);
      return;
    }
    // Mesmas regras do pagador para cada pessoa que entra no contrato.
    for (const [index, co] of coStudents.entries()) {
      const problem = validateContractProfile(co.profile);
      if (problem) {
        setError(`${index + 2}º aluno: ${problem[0].toLowerCase()}${problem.slice(1)}`);
        return;
      }
      if (!co.courseId) {
        setError(`Escolha o treinamento do ${index + 2}º aluno.`);
        return;
      }
      if (!(parseAmount(co.amountText) > 0)) {
        setError(`Informe o valor do ${index + 2}º aluno.`);
        return;
      }
    }
    if (coStudents.length > 0 && !(payerOwnAmount > 0)) {
      setError(
        `Informe o valor do curso de ${profile.fullName.trim() || "quem paga"} — o total do contrato é a soma dos cursos.`
      );
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/commercial/leads/${lead.id}/sale`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId,
          amount,
          installments,
          downPaymentAmount: entryAmount,
          saleDate,
          firstMonth: saleDate.slice(0, 7),
          paymentMethodId,
          cardBrandId: needsCardBrand ? cardBrandId : null,
          sellerId,
          branchId,
          discountReason: discountReason.trim() || null,
          notes: notes.trim() || null,
          schedule: schedule.map((item) => ({
            type: item.type,
            amount: parseAmount(item.amountText),
            dueDate: item.dueDate,
            paymentMethodId: item.paymentMethodId,
            cardBrandId: item.cardBrandId,
          })),
          contractProfile: profile,
          contractPlan: planSplit,
          coStudents: coStudents.map((co) => ({
            profile: co.profile,
            courseId: co.courseId,
            amount: parseAmount(co.amountText),
            className: co.className.trim() || null,
            classId: co.classId ? Number(co.classId) : null,
            leadInscricaoId: co.leadId,
          })),
          // Carga horária só vai gravada quando o vendedor MUDOU o texto. O
          // valor que o próprio modal sugere a partir do curso não pode virar
          // exceção digitada: gravado, ele passa a ganhar do cadastro, e
          // corrigir o curso (de "2 aulas · 25 horas" para "25 horas") não
          // alcançaria mais nenhum contrato já vendido.
          contractCourse: {
            ...courseInfo,
            hours: courseInfo.hours === courseHoursLabel(training) ? "" : courseInfo.hours,
          },
          classId: classId ? Number(classId) : null,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Falha ao registrar a venda.");
      onSaved(lead.id, amount, training?.name ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao registrar a venda.");
      setSaving(false);
    }
  }

  async function removeSale() {
    if (!existing) return;
    if (!window.confirm("Excluir a venda registrada? A matrícula e as parcelas previstas serão apagadas do Financeiro.")) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/commercial/leads/${lead.id}/sale`, { method: "DELETE" });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Falha ao excluir a venda.");
      onSaved(lead.id, 0, null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao excluir a venda.");
      setSaving(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-sm text-neutral-900 focus:border-cyan-400 focus:outline-none";
  const labelClass = "mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-neutral-400";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-neutral-100 bg-white px-6 py-4">
          <div>
            <p className="text-sm font-bold text-neutral-900">
              {existing ? "Editar venda" : "Registrar venda"}
            </p>
            <p className="text-xs text-neutral-400">
              {lead.nome ?? `Lead #${lead.id}`} — vira matrícula com parcelas previstas no Financeiro
            </p>
            {required && (
              <p className="mt-1 flex items-start gap-1 text-[11px] font-semibold text-amber-700">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                O lead já está em Fechado: sem registrar a venda ele fica sem matrícula, sem
                parcelas e sem contrato.
              </p>
            )}
          </div>
          {!required && (
            <button
              type="button"
              onClick={onCancel}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100"
              aria-label="Fechar"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 px-6 py-10 text-sm text-neutral-500">
            <RefreshCw className="h-4 w-4 animate-spin" /> Carregando catálogo…
          </div>
        ) : (
          <>
            <div className="space-y-3 px-6 py-4">
              {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}

              {existing && existing.paid > 0 && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Esta venda já tem {money(existing.paid)} recebidos, então o contrato está travado: o
                  Financeiro não deixa alterar valor ou parcelas sem antes ajustar os pagamentos lançados.
                </p>
              )}

              {options && options.trainings.length === 0 ? (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Nenhum treinamento cadastrado. Cadastre a tabela de preços em Treinamentos e Valores.
                </p>
              ) : null}

              <div>
                <label className={labelClass}>Treinamento vendido *</label>
                <select
                  value={courseId ?? ""}
                  onChange={(event) => handleTrainingChange(Number(event.target.value))}
                  className={inputClass}
                >
                  <option value="">Selecione…</option>
                  {options?.trainings.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                      {item.defaultPrice !== null ? ` — ${money(item.defaultPrice)}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>
                    {coStudents.length > 0 ? "Valor fechado (soma dos cursos)" : "Valor fechado (R$) *"}
                  </label>
                  {coStudents.length > 0 ? (
                    // Com duas pessoas o total não se digita: ele é a soma dos
                    // cursos, e cada um tem seu campo no bloco de baixo.
                    <div className="flex h-[34px] items-center rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 text-sm font-bold text-neutral-900">
                      {money(amount)}
                    </div>
                  ) : (
                    <input
                      type="text"
                      inputMode="decimal"
                      value={amountText}
                      onChange={(event) => setAmountText(event.target.value)}
                      // No blur, não a cada tecla: regenerar enquanto digita
                      // apagaria o número no meio da digitação.
                      onBlur={(event) =>
                        regenerate(parseAmount(event.target.value), installments, saleDate, paymentMethodId, cardBrandId)
                      }
                      placeholder="Ex.: 5000,00"
                      className={inputClass}
                    />
                  )}
                </div>
                <div>
                  <label className={labelClass}>Parcelas</label>
                  <select
                    value={installments}
                    onChange={(event) => {
                      const count = Number(event.target.value);
                      setInstallments(count);
                      regenerate(amount, count, saleDate, paymentMethodId, cardBrandId);
                    }}
                    className={inputClass}
                  >
                    {enrollmentInstallmentOptions(selectedMethod?.maxInstallments).map((n) => (
                      <option key={n} value={n}>
                        {n}x
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Entrada e dia fixo do vencimento: os dois combinados que antes
                  obrigavam a reescrever o cronograma linha a linha. */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Entrada (R$)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={entryText}
                    onChange={(event) => setEntryText(event.target.value)}
                    // No blur, como o valor fechado: regenerar a cada tecla
                    // apagaria o número no meio da digitação.
                    onBlur={(event) =>
                      regenerate(
                        amount,
                        installments,
                        saleDate,
                        paymentMethodId,
                        cardBrandId,
                        Math.max(0, parseAmount(event.target.value) || 0)
                      )
                    }
                    placeholder="Sem entrada"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Dia do vencimento</label>
                  <select
                    value={dueDay ?? ""}
                    onChange={(event) => {
                      const dia = event.target.value ? Number(event.target.value) : null;
                      setDueDay(dia);
                      regenerate(amount, installments, saleDate, paymentMethodId, cardBrandId, undefined, dia);
                    }}
                    className={inputClass}
                  >
                    <option value="">Mesmo dia da venda</option>
                    {Array.from({ length: 31 }, (_, index) => index + 1).map((dia) => (
                      <option key={dia} value={dia}>
                        Todo dia {dia}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Treinamento de outra empresa: o vendedor fecha e emite contrato
                  do mesmo jeito, mas o dinheiro não entra nas vendas da Voz UP.
                  Dizer isso aqui evita a pergunta "sumiu do faturamento?". */}
              {training?.businessUnit === "instituto" && (
                <p className="rounded-xl bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-800">
                  Curso do Instituto UP: a venda entra no Financeiro do Instituto e não conta nas
                  vendas da Voz UP. O contrato é o mesmo.
                </p>
              )}

              <div className="rounded-xl bg-neutral-50 p-3 text-xs text-neutral-600">
                {listPrice !== null && (
                  <p>
                    Tabela: <strong>{money(listPrice)}</strong>
                    {discount > 0 && (
                      <>
                        {" · "}
                        Desconto: <strong className="text-amber-700">{money(discount)}</strong> (
                        {discountPct.toFixed(1)}%)
                      </>
                    )}
                  </p>
                )}
                {Number.isFinite(amount) && amount > 0 && (
                  <p className="mt-0.5">
                    {entryAmount > 0 && (
                      <>
                        Entrada <strong>{money(entryAmount)}</strong>
                        {" + "}
                      </>
                    )}
                    {parcelCount}x · total <strong>{money(amount)}</strong>
                  </p>
                )}
                {belowFloor && training?.minPrice !== null && training?.minPrice !== undefined && (
                  <p className="mt-1 flex items-center gap-1.5 font-semibold text-rose-600">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Abaixo do piso de {money(training.minPrice)} definido para este treinamento.
                  </p>
                )}
              </div>

              {discount > 0 && (
                <div>
                  <label className={labelClass}>Motivo do desconto *</label>
                  <input
                    type="text"
                    value={discountReason}
                    onChange={(event) => setDiscountReason(event.target.value)}
                    placeholder="Ex.: pagamento à vista, indicação de aluno…"
                    className={inputClass}
                  />
                </div>
              )}

              {/* Cronograma: cada parcela pode ter valor, vencimento e forma
                  de pagamento próprios — entrada maior, uma no Pix e o resto
                  no cartão é o caso normal. */}
              {schedule.length > 0 && (
                <div className="rounded-xl border border-neutral-200">
                  <div className="flex items-center justify-between border-b border-neutral-100 px-3 py-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                      Parcelas combinadas
                    </span>
                    <button
                      type="button"
                      onClick={() => regenerate(amount, installments, saleDate, paymentMethodId, cardBrandId)}
                      className="text-[10px] font-semibold text-cyan-700 hover:underline"
                    >
                      Redistribuir igualmente
                    </button>
                  </div>

                  <div className="max-h-56 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-neutral-50 text-[9px] uppercase tracking-wide text-neutral-400">
                        <tr>
                          <th className="px-2 py-1.5 text-left font-semibold">#</th>
                          <th className="px-2 py-1.5 text-left font-semibold">Valor</th>
                          <th className="px-2 py-1.5 text-left font-semibold">Vencimento</th>
                          <th className="px-2 py-1.5 text-left font-semibold">Forma</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100">
                        {schedule.map((item, index) => {
                          const rowMethod = options?.paymentMethods.find(
                            (method) => method.id === item.paymentMethodId
                          );
                          return (
                            <tr key={index}>
                              <td className="px-2 py-1.5 text-neutral-400">
                                {item.type === "entrada" ? "Entrada" : hasEntryRow ? index : index + 1}
                              </td>
                              <td className="px-2 py-1.5">
                                <input
                                  inputMode="decimal"
                                  value={item.amountText}
                                  onChange={(event) => updateInstallment(index, { amountText: event.target.value })}
                                  className="w-24 rounded border border-neutral-200 px-1.5 py-1 text-xs focus:border-cyan-400 focus:outline-none"
                                />
                              </td>
                              <td className="px-2 py-1.5">
                                <input
                                  type="date"
                                  value={item.dueDate}
                                  onChange={(event) => updateInstallment(index, { dueDate: event.target.value })}
                                  className="rounded border border-neutral-200 px-1.5 py-1 text-xs focus:border-cyan-400 focus:outline-none"
                                />
                              </td>
                              <td className="px-2 py-1.5">
                                <div className="flex gap-1">
                                  <select
                                    value={item.paymentMethodId ?? ""}
                                    onChange={(event) =>
                                      updateInstallment(index, {
                                        paymentMethodId: event.target.value ? Number(event.target.value) : null,
                                        cardBrandId: null,
                                      })
                                    }
                                    className="rounded border border-neutral-200 px-1 py-1 text-xs focus:border-cyan-400 focus:outline-none"
                                  >
                                    <option value="">—</option>
                                    {options?.paymentMethods.map((method) => (
                                      <option key={method.id} value={method.id}>
                                        {method.name}
                                      </option>
                                    ))}
                                  </select>
                                  {rowMethod?.kind === "parcelado" && (
                                    <select
                                      value={item.cardBrandId ?? ""}
                                      onChange={(event) =>
                                        updateInstallment(index, {
                                          cardBrandId: event.target.value ? Number(event.target.value) : null,
                                        })
                                      }
                                      className="rounded border border-neutral-200 px-1 py-1 text-xs focus:border-cyan-400 focus:outline-none"
                                    >
                                      <option value="">Bandeira</option>
                                      {options?.cardBrands.map((brand) => (
                                        <option key={brand.id} value={brand.id}>
                                          {brand.name}
                                        </option>
                                      ))}
                                    </select>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div
                    className={`flex items-center justify-between border-t border-neutral-100 px-3 py-2 text-xs ${
                      scheduleMatches ? "text-neutral-600" : "bg-rose-50 text-rose-700"
                    }`}
                  >
                    <span>
                      Soma das parcelas: <strong>{money(scheduleTotal)}</strong>
                      {!scheduleMatches && (
                        <>
                          {" · "}
                          {scheduleGap > 0 ? "faltam" : "sobram"}{" "}
                          <strong>{money(Math.abs(scheduleGap))}</strong>
                        </>
                      )}
                    </span>
                    {!scheduleMatches && (
                      <button
                        type="button"
                        onClick={absorbGapInLastInstallment}
                        className="font-semibold underline"
                      >
                        Ajustar última parcela
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Data da venda</label>
                  <input
                    type="date"
                    value={saleDate}
                    onChange={(event) => {
                      setSaleDate(event.target.value);
                      regenerate(amount, installments, event.target.value, paymentMethodId, cardBrandId);
                    }}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Forma de pagamento (padrão)</label>
                  <select
                    value={paymentMethodId ?? ""}
                    onChange={(event) => {
                      const nextMethod = event.target.value ? Number(event.target.value) : null;
                      setPaymentMethodId(nextMethod);
                      setCardBrandId(null);
                      // Trocar para uma forma de teto menor (carnê 48x → cartão
                      // 12x) tem que puxar o cronograma para baixo — senão a
                      // tela mostra 36x e o servidor recusa na hora de salvar.
                      const cap = installmentCap(
                        options?.paymentMethods.find((item) => item.id === nextMethod)?.maxInstallments
                      );
                      if (installments > cap) {
                        setInstallments(cap);
                        regenerate(amount, cap, saleDate, nextMethod, null);
                      }
                      // A forma do contrato é o padrão de todas as parcelas;
                      // quem precisar de uma diferente troca na linha dela.
                      setSchedule((current) =>
                        current.map((item) => ({ ...item, paymentMethodId: nextMethod, cardBrandId: null }))
                      );
                    }}
                    className={inputClass}
                  >
                    <option value="">Não informada</option>
                    {options?.paymentMethods.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {needsCardBrand && (
                <div>
                  <label className={labelClass}>Bandeira do cartão</label>
                  <select
                    value={cardBrandId ?? ""}
                    onChange={(event) => setCardBrandId(event.target.value ? Number(event.target.value) : null)}
                    className={inputClass}
                  >
                    <option value="">Não informada</option>
                    {options?.cardBrands.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Vendedor (comissão)</label>
                  <select
                    value={sellerId ?? ""}
                    onChange={(event) => setSellerId(event.target.value ? Number(event.target.value) : null)}
                    className={inputClass}
                  >
                    <option value="">Responsável do lead</option>
                    {options?.sellers.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Unidade</label>
                  <select
                    value={branchId ?? ""}
                    onChange={(event) => setBranchId(event.target.value ? Number(event.target.value) : null)}
                    className={inputClass}
                  >
                    <option value="">Não informada</option>
                    {options?.branches.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* ── QUADRO DO CONTRATO ───────────────────────────────
                  Item 2 e item 4 do contrato de matrícula. Preenchido aqui, na
                  venda, porque é o único momento em que o cliente ainda está
                  na frente do vendedor — depois vira caça ao CPF por WhatsApp. */}
              <div className="space-y-2 rounded-xl border border-cyan-200 bg-cyan-50/40 p-3">
                <div>
                  <p className="text-xs font-bold text-neutral-900">Dados para o contrato</p>
                  <p className="text-[11px] text-neutral-500">
                    Vira o quadro do contrato de matrícula. Os campos com <strong>*</strong> são
                    o que o contrato precisa para valer — nome, CPF, e-mail e celular (é por
                    onde a pessoa assina) e o endereço completo. O resto ajuda, mas não trava a
                    venda.
                  </p>
                </div>

                <ContractProfileFields
                  profile={profile}
                  onChange={setProfile}
                  labelClass={labelClass}
                  inputClass={inputClass}
                />

                {/* ── OUTRA PESSOA NO MESMO CONTRATO ───────────────
                    Casal ou dupla que compra junto e tem um pagador só. Cada
                    pessoa tem quadro, treinamento e valor próprios; quem assina
                    continua sendo quem paga. */}
                <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-bold text-neutral-900">
                        Outra pessoa neste contrato
                      </p>
                      <p className="text-[11px] text-neutral-500">
                        Duas pessoas comprando juntas, uma só pagando. O contrato sai com o
                        quadro das duas e o valor de cada uma.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setCoStudents((current) => {
                          // A primeira pessoa adicionada transfere o valor já
                          // digitado para o campo do pagador: o "valor fechado"
                          // passa a ser a soma dos dois cursos.
                          if (current.length === 0 && !payerAmountText) setPayerAmountText(amountText);
                          return [
                            ...current,
                            {
                              profile: { ...EMPTY_CONTRACT_PROFILE },
                              courseId: 0,
                              amountText: "",
                              className: "",
                              classId: "",
                              leadId: null,
                              leadLabel: null,
                            },
                          ];
                        })
                      }
                      className="rounded-lg border border-violet-300 bg-white px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-100"
                    >
                      Adicionar pessoa
                    </button>
                  </div>

                  {coStudents.length > 0 && (
                    <div className="mt-3 rounded-lg border border-violet-200 bg-white p-3">
                      <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-violet-700">
                        1º aluno — quem paga
                      </p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div>
                          <label className={labelClass}>Treinamento</label>
                          <div className="flex h-[34px] items-center rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 text-sm text-neutral-700">
                            {training?.name ?? "—"}
                          </div>
                        </div>
                        <div>
                          <label className={labelClass}>Valor deste aluno (R$) *</label>
                          <input
                            inputMode="decimal"
                            value={payerAmountText}
                            onChange={(event) => setPayerAmountText(event.target.value)}
                            onBlur={() =>
                              regenerate(amount, installments, saleDate, paymentMethodId, cardBrandId)
                            }
                            placeholder="Ex.: 9499,08"
                            className={inputClass}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {coStudents.map((co, index) => (
                    <div key={index} className="mt-3 rounded-lg border border-violet-200 bg-white p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-violet-700">
                          {index + 2}º aluno
                        </p>
                        <button
                          type="button"
                          onClick={() =>
                            setCoStudents((current) => current.filter((_, i) => i !== index))
                          }
                          className="text-[11px] font-semibold text-rose-600 hover:underline"
                        >
                          Remover
                        </button>
                      </div>

                      <CoStudentLeadPicker
                        leadLabel={co.leadLabel}
                        onPick={(picked, profile) =>
                          setCoStudents((current) =>
                            current.map((item, i) =>
                              i === index
                                ? { ...item, profile, leadId: picked.id, leadLabel: picked.nome ?? `Lead #${picked.id}` }
                                : item
                            )
                          )
                        }
                        onClear={() =>
                          setCoStudents((current) =>
                            current.map((item, i) =>
                              i === index ? { ...item, leadId: null, leadLabel: null } : item
                            )
                          )
                        }
                        labelClass={labelClass}
                        inputClass={inputClass}
                      />

                      <div className="mb-2 grid gap-2 sm:grid-cols-2">
                        <div>
                          <label className={labelClass}>Treinamento *</label>
                          <select
                            value={co.courseId || ""}
                            onChange={(event) => {
                              const nextId = Number(event.target.value);
                              const chosen = options?.trainings.find((item) => item.id === nextId);
                              setCoStudents((current) =>
                                current.map((item, i) =>
                                  i === index
                                    ? {
                                        ...item,
                                        courseId: nextId,
                                        // Valor de tabela do curso dele, editável
                                        // como o do pagador.
                                        amountText:
                                          item.amountText ||
                                          (chosen?.defaultPrice
                                            ? chosen.defaultPrice.toFixed(2).replace(".", ",")
                                            : ""),
                                      }
                                    : item
                                )
                              );
                            }}
                            className={inputClass}
                          >
                            <option value="">Escolha…</option>
                            {options?.trainings.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name}
                                {item.defaultPrice !== null ? ` — ${money(item.defaultPrice)}` : ""}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className={labelClass}>Valor deste aluno (R$) *</label>
                          <input
                            inputMode="decimal"
                            value={co.amountText}
                            onChange={(event) =>
                              setCoStudents((current) =>
                                current.map((item, i) =>
                                  i === index ? { ...item, amountText: event.target.value } : item
                                )
                              )
                            }
                            // As parcelas são do contrato inteiro: mudar o valor
                            // de um aluno muda o que vai ser cobrado.
                            onBlur={() =>
                              regenerate(amount, installments, saleDate, paymentMethodId, cardBrandId)
                            }
                            placeholder="Ex.: 3997,00"
                            className={inputClass}
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className={labelClass}>Turma</label>
                          {/* Turma DE VERDADE, igual à do 1º aluno: é ela que
                              coloca esta pessoa no diário de classe. Enquanto
                              aqui só havia texto livre, o 2º aluno do contrato
                              de casal aparecia no PDF e não aparecia na turma. */}
                          <select
                            value={co.classId}
                            onChange={(event) => {
                              const escolhida = (coOpenClasses[co.courseId] ?? []).find(
                                (turma) => String(turma.id) === event.target.value
                              );
                              setCoStudents((current) =>
                                current.map((item, i) =>
                                  i === index
                                    ? {
                                        ...item,
                                        classId: event.target.value,
                                        className: escolhida ? escolhida.name : item.className,
                                      }
                                    : item
                                )
                              );
                            }}
                            className={inputClass}
                          >
                            <option value="">
                              {classId
                                ? "Mesma turma do 1º aluno"
                                : "Definir depois (fica pendente)"}
                            </option>
                            {(coOpenClasses[co.courseId] ?? []).map((turma) => (
                              <option key={turma.id} value={turma.id}>
                                {turma.name}
                                {turma.scheduleLabel ? ` — ${turma.scheduleLabel}` : ""}
                                {turma.seatsLeft !== null ? ` · ${turma.seatsLeft} vaga(s)` : ""}
                              </option>
                            ))}
                          </select>
                          <p className="mt-1 text-[11px] text-neutral-500">
                            {co.courseId === 0
                              ? "Escolha o treinamento para ver as turmas."
                              : (coOpenClasses[co.courseId] ?? []).length === 0
                                ? "Nenhuma turma aberta para este treinamento."
                                : "Deixando em branco, esta pessoa entra na mesma turma do 1º aluno."}
                          </p>
                          {/* O texto do item 3 continua editável: turma que
                              ainda não foi cadastrada só existe como texto. */}
                          <input
                            value={co.className}
                            onChange={(event) =>
                              setCoStudents((current) =>
                                current.map((item, i) =>
                                  i === index ? { ...item, className: event.target.value } : item
                                )
                              )
                            }
                            placeholder={
                              courseInfo.className
                                ? `Como sai no contrato — mesma do 1º aluno: ${courseInfo.className}`
                                : "Como sai no contrato. Ex.: Terças 19h — Tatuapé"
                            }
                            className={`${inputClass} mt-1.5`}
                          />
                        </div>
                      </div>

                      <ContractProfileFields
                        profile={co.profile}
                        onChange={(next) =>
                          setCoStudents((current) =>
                            current.map((item, i) => (i === index ? { ...item, profile: next } : item))
                          )
                        }
                        labelClass={labelClass}
                        inputClass={inputClass}
                      />
                    </div>
                  ))}

                  {coStudents.length > 0 && (
                    <p className="mt-2 text-[11px] text-neutral-600">
                      {profile.fullName.trim() || "Quem paga"}:{" "}
                      <strong>{money(Number.isFinite(payerOwnAmount) ? payerOwnAmount : 0)}</strong>
                      {" + alunos adicionais "}
                      <strong>{money(coStudentsTotal)}</strong>
                      {" = total do contrato "}
                      <strong>{money(amount)}</strong>
                    </p>
                  )}
                </div>

                {/* Item 3 do contrato: não vem do catálogo do Financeiro, que só
                    conhece preço e parcelas. */}
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <label className={labelClass}>Carga horária total *</label>
                    <input
                      value={courseInfo.hours}
                      onChange={(event) => setCourseInfo({ ...courseInfo, hours: event.target.value })}
                      placeholder="Ex.: 72 horas"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Turma</label>
                    <input
                      value={courseInfo.className}
                      onChange={(event) =>
                        setCourseInfo({ ...courseInfo, className: event.target.value })
                      }
                      placeholder="Ex.: Terças 19h — Tatuapé"
                      className={inputClass}
                    />
                  </div>
                </div>

                {/* Turma: combinada com o cliente na hora, não depois. */}
                <div>
                  <label className={labelClass}>Turma</label>
                  <select
                    value={classId}
                    onChange={(event) => {
                      setClassId(event.target.value);
                      const turma = openClasses.find((item) => String(item.id) === event.target.value);
                      if (turma) setCourseInfo((current) => ({ ...current, className: turma.name }));
                    }}
                    className={inputClass}
                  >
                    <option value="">Definir depois (fica pendente)</option>
                    {openClasses.map((turma) => (
                      <option key={turma.id} value={turma.id}>
                        {turma.name}
                        {turma.scheduleLabel ? ` — ${turma.scheduleLabel}` : ""}
                        {turma.seatsLeft !== null ? ` · ${turma.seatsLeft} vaga(s)` : ""}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-neutral-500">
                    {openClasses.length === 0
                      ? "Nenhuma turma aberta para este curso — crie uma em Turmas ou deixe para definir depois."
                      : "O aluno entra na turma escolhida e o contrato recebe o nome dela."}
                  </p>
                </div>

                {/* Item 4: o curso é o que sobra, para a soma sempre fechar. */}
                <div className="rounded-lg border border-neutral-200 bg-white p-2.5">
                  <p className={labelClass}>Como o valor aparece no contrato</p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <div>
                      <label className="text-[10px] font-semibold text-neutral-500">Matrícula</label>
                      <input
                        value={matriculaText}
                        onChange={(event) => setMatriculaText(event.target.value)}
                        inputMode="decimal"
                        placeholder="0,00"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-neutral-500">
                        Material didático
                      </label>
                      <input
                        value={materialText}
                        onChange={(event) => setMaterialText(event.target.value)}
                        inputMode="decimal"
                        placeholder="0,00"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-neutral-500">Curso</label>
                      <input
                        value={cursoText}
                        onChange={(event) => setCursoText(event.target.value)}
                        inputMode="decimal"
                        placeholder={money(planSplit.curso)}
                        className={inputClass}
                      />
                    </div>
                  </div>
                  <p className="mt-1 text-[10px] text-neutral-500">
                    Soma: {money(planSplitTotal(planSplit))}
                    {Number.isFinite(amount) ? ` · valor fechado: ${money(amount)}` : ""}
                    {cursoText.trim() ? "" : " · curso em branco = o resto do valor fechado"}
                  </p>
                  {planDivergence && (
                    <p className="mt-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-800">
                      {planDivergence}
                    </p>
                  )}
                </div>
              </div>

              <div>
                <label className={labelClass}>Observações / aditivo (item 5 do contrato)</label>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={2}
                  placeholder="Ex.: entrada de R$ 1.000 no Pix em 01/07; turma a definir."
                  className={inputClass}
                />
                {/* O quadro do item 5 saía sempre em branco porque ninguém
                    associava este campo a ele — o rótulo genérico escondia a
                    única entrada que o contrato tem. */}
                <p className="mt-1 text-[11px] text-neutral-400">
                  O que estiver aqui sai impresso no contrato. Vazio, o quadro fica em branco.
                </p>
              </div>
            </div>

            <div className="sticky bottom-0 flex items-center justify-between gap-2 border-t border-neutral-100 bg-white px-6 py-4">
              {existing ? (
                <button
                  type="button"
                  onClick={removeSale}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Excluir venda
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                {!required && (
                  <button
                    type="button"
                    onClick={onCancel}
                    disabled={saving}
                    className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
                  >
                    Agora não
                  </button>
                )}
                <button
                  type="button"
                  onClick={submit}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null}
                  {existing ? "Salvar alterações" : "Registrar venda"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * O quadro do CONTRATANTE (item 2). Vive num componente próprio porque o
 * contrato de casal repete os mesmos catorze campos para a segunda pessoa —
 * duas cópias do formulário divergiriam no primeiro campo novo.
 */

/**
 * Busca do lead da segunda pessoa e preenchimento do quadro dela.
 *
 * A pessoa que entra no contrato quase sempre já é um lead do CRM — redigitar
 * CPF e endereço de quem o sistema já conhece produz divergência entre a ficha
 * e o contrato, e cria alguém sem ligação com o card dela. Puxando o lead, a
 * ficha de aluno nasce amarrada a ele.
 */
function CoStudentLeadPicker({
  leadLabel,
  onPick,
  onClear,
  labelClass,
  inputClass,
}: {
  leadLabel: string | null;
  onPick: (lead: { id: number; nome: string | null }, profile: ContractStudentProfile) => void;
  onClear: () => void;
  labelClass: string;
  inputClass: string;
}) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<Array<{ id: number; nome: string | null; telefone: string | null; cidade: string | null }>>([]);
  const [searching, setSearching] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function search() {
    const query = term.trim();
    if (query.length < 3) {
      setProblem("Digite ao menos 3 letras do nome ou o telefone.");
      return;
    }
    setSearching(true);
    setProblem(null);
    try {
      const response = await fetch(`/api/commercial/leads/lookup?q=${encodeURIComponent(query)}`);
      const data = (await response.json().catch(() => ({}))) as {
        leads?: Array<{ id: number; nome: string | null; telefone: string | null; cidade: string | null }>;
        error?: string;
      };
      if (!response.ok) throw new Error(data.error ?? "Falha ao buscar o lead.");
      setResults(data.leads ?? []);
      if ((data.leads ?? []).length === 0) setProblem("Nenhum lead encontrado — preencha à mão.");
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Falha ao buscar o lead.");
    } finally {
      setSearching(false);
    }
  }

  async function pick(chosen: { id: number; nome: string | null }) {
    setSearching(true);
    setProblem(null);
    try {
      const response = await fetch(`/api/commercial/leads/lookup?id=${chosen.id}`);
      const data = (await response.json().catch(() => ({}))) as {
        profile?: ContractStudentProfile;
        error?: string;
      };
      if (!response.ok || !data.profile) throw new Error(data.error ?? "Falha ao carregar o lead.");
      onPick(chosen, data.profile);
      setResults([]);
      setTerm("");
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Falha ao carregar o lead.");
    } finally {
      setSearching(false);
    }
  }

  if (leadLabel) {
    return (
      <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg bg-violet-50 px-2.5 py-1.5 text-[11px] text-violet-800">
        <span>
          Lead vinculado: <strong>{leadLabel}</strong> — a ficha deste aluno fica ligada ao card
          dele no CRM.
        </span>
        <button type="button" onClick={onClear} className="font-semibold underline">
          desvincular
        </button>
      </div>
    );
  }

  return (
    <div className="mb-2">
      <label className={labelClass}>Puxar de um lead do CRM</label>
      <div className="flex gap-2">
        <input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void search();
            }
          }}
          placeholder="Nome, telefone ou CPF"
          className={inputClass}
        />
        <button
          type="button"
          onClick={() => void search()}
          disabled={searching}
          className="shrink-0 rounded-lg border border-violet-300 bg-white px-3 text-xs font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-50"
        >
          {searching ? "..." : "Buscar"}
        </button>
      </div>
      {problem && <p className="mt-1 text-[11px] text-amber-700">{problem}</p>}
      {results.length > 0 && (
        <ul className="mt-1 divide-y divide-neutral-100 rounded-lg border border-neutral-200">
          {results.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => void pick(item)}
                className="block w-full px-2.5 py-1.5 text-left text-xs hover:bg-violet-50"
              >
                <span className="font-semibold text-neutral-900">{item.nome ?? `Lead #${item.id}`}</span>
                {item.telefone && <span className="text-neutral-500"> · {item.telefone}</span>}
                {item.cidade && <span className="text-neutral-400"> · {item.cidade}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
