/**
 * Porta única de entrada de contrato/matrícula.
 *
 * Antes existiam duas portas que produziam realidades diferentes: a do CRM
 * (lead na etapa Fechado) criava matrícula + ficha + turma + contrato, e a do
 * Financeiro (`/matriculas`) criava **só dinheiro**. Quem entrava pela segunda
 * ficava sendo um nome em campo de texto: sem CPF, sem ficha, sem cadeira em
 * turma nenhuma e sem contrato — e a turma abria com o diário vazio mesmo tendo
 * matrícula apontando para ela.
 *
 * Aqui o caminho é um só, e vale para as três origens de pessoa: lead do CRM,
 * aluno que já existe (quem volta a comprar) e pessoa que nunca foi lead.
 *
 * **A ordem interna continua matrícula → contrato.** `contracts.enrollment_id`
 * é NOT NULL e é dele que pendem receitas, comissão, parcelas e a assinatura
 * eletrônica; inverter a chave para espelhar a ordem da tela seria reescrever o
 * Financeiro inteiro sem o usuário ver diferença nenhuma. O que a tela mostra
 * como "contrato primeiro" é este módulo montando a matrícula por baixo.
 *
 * Ver `docs/plano-contrato-matricula-turma.md`.
 */
import { getPool } from "@/lib/db";
import type { DashboardUser } from "@/lib/auth";
import { createEnrollment, type EnrollmentScheduleItem } from "@/lib/finance";
import { normalizeBusinessUnit } from "@/lib/financeBusinessUnits";
import { registerLeadSale } from "@/lib/leadSales";
import { upsertStudentContractProfile } from "@/lib/academicStudents";
import {
  listEnrollmentParticipants,
  replaceEnrollmentParticipants,
  type EnrollmentParticipantInput,
} from "@/lib/enrollmentParticipants";
import { addStudentToClass } from "@/lib/academicClasses";
import { createContractForEnrollment } from "@/lib/contracts";
import {
  validateContractProfile,
  type ContractPlanSplit,
  type ContractStudentProfile,
} from "@/lib/contractProfile";

const SCHEMA = "dashboard";

/**
 * Uma pessoa do contrato. A primeira da lista é o **pagador** — dela sai o
 * `student_id` da matrícula, e é o nome dela que o Financeiro cobra. As demais
 * são os alunos adicionais do mesmo contrato (o caso do casal), cada uma com
 * treinamento, valor e **turma próprios**: comprar junto não obriga a estudar
 * no mesmo horário.
 */
export interface IntakePerson {
  /** Lead do CRM desta pessoa, quando ela é lead. Nulo para quem nunca foi. */
  leadInscricaoId: number | null;
  profile: ContractStudentProfile;
  courseId: number;
  /** Turma desta pessoa. Nulo é "definir depois", e cai na fila de pendências. */
  classId: number | null;
  /** Quanto do total do contrato é o curso desta pessoa. Ignorado no pagador,
   *  cujo valor é o que sobra do total (ver `payerAmount`). */
  amount: number;
}

export interface IntakeSaleInput {
  totalAmount: number;
  installments: number;
  downPaymentAmount?: number | null;
  saleDate: string;
  firstMonth?: string | null;
  paymentMethodId?: number | null;
  cardBrandId?: number | null;
  sellerId?: number | null;
  branchId?: number | null;
  discountReason?: string | null;
  notes?: string | null;
  schedule?: EnrollmentScheduleItem[] | null;
}

export interface EnrollmentIntakeInput {
  /**
   * Matrícula que já existe, no caso da **regularização**: completar ficha,
   * turma e contrato de quem foi lançado direto no Financeiro. Quando vem, o
   * dinheiro não é tocado — cronograma, comissão e recebimentos ficam como
   * estão, porque regularizar cadastro não é refazer venda.
   */
  enrollmentId?: number | null;
  people: IntakePerson[];
  sale?: IntakeSaleInput | null;
  planSplit?: ContractPlanSplit | null;
  courseHours?: string | null;
  /** Turma no texto do item 3, para quando não existe turma cadastrada. */
  className?: string | null;
}

export interface EnrollmentIntakeResult {
  enrollmentId: number;
  /** Fichas criadas/reencontradas, na ordem das pessoas enviadas. */
  studentIds: number[];
  /** Quantas cadeiras em turma foram efetivamente criadas. */
  allocated: number;
  contractId: number | null;
  /** Por que o contrato não saiu, quando não saiu. Nunca derruba a matrícula. */
  contractError: string | null;
}

function round2(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function monthOf(date: string): string {
  return date.slice(0, 7);
}

/**
 * Itens 3 e 4 do contrato vivem na matrícula porque é dela que o contrato
 * nasce. Mesma gravação que `registerLeadSale` faz — repetida aqui porque o
 * caminho sem lead não passa por lá.
 */
async function stampContractFields(
  enrollmentId: number,
  planSplit: ContractPlanSplit | null | undefined,
  courseHours: string | null | undefined,
  className: string | null | undefined
): Promise<void> {
  if (!planSplit && !courseHours && !className) return;
  await getPool().query(
    `UPDATE ${SCHEMA}.finance_enrollments
        SET contract_plan = COALESCE($2::jsonb, contract_plan),
            contract_course_hours = COALESCE($3, contract_course_hours),
            contract_class_name   = COALESCE($4, contract_class_name)
      WHERE id = $1`,
    [
      enrollmentId,
      planSplit ? JSON.stringify(planSplit) : null,
      courseHours?.trim() || null,
      className?.trim() || null,
    ]
  );
}

/**
 * Liga o lead à matrícula na regularização, sem apagar vínculo existente. É o
 * caso de quem foi lançado no Financeiro só com o nome e depois foi
 * reconhecido como um lead do CRM.
 */
async function linkLeadIfMissing(enrollmentId: number, leadId: number | null): Promise<void> {
  if (!leadId) return;
  await getPool().query(
    `UPDATE ${SCHEMA}.finance_enrollments
        SET lead_inscricao_id = COALESCE(lead_inscricao_id, $2)
      WHERE id = $1`,
    [enrollmentId, leadId]
  );
}

async function courseBusinessUnit(courseId: number) {
  const { rows } = await getPool().query(
    `SELECT business_unit, commission_pct FROM ${SCHEMA}.finance_courses WHERE id = $1`,
    [courseId]
  );
  if (!rows[0]) throw new Error("Treinamento não encontrado no catálogo.");
  return {
    businessUnit: normalizeBusinessUnit(rows[0].business_unit),
    commissionPct: rows[0].commission_pct === null ? null : Number(rows[0].commission_pct),
  };
}

/**
 * Faz o caminho inteiro: matrícula → fichas → cadeiras na turma → contrato.
 *
 * A alocação em turma acontece para **todas** as pessoas do contrato, não só
 * para o pagador. Era exatamente esse o buraco que deixava o segundo aluno de
 * um contrato de casal com ficha e sem turma: ele existia no PDF e não existia
 * no diário de classe.
 */
export async function intakeEnrollment(
  user: DashboardUser | null | undefined,
  input: EnrollmentIntakeInput
): Promise<EnrollmentIntakeResult> {
  const people = input.people ?? [];
  if (people.length === 0) throw new Error("Escolha ao menos uma pessoa para o contrato.");

  for (const [index, person] of people.entries()) {
    const problem = validateContractProfile(person.profile);
    if (problem) {
      throw new Error(index === 0 ? problem : `${index + 1}º aluno: ${problem.toLowerCase()}`);
    }
    if (!(person.courseId > 0)) {
      throw new Error(
        index === 0 ? "Escolha o treinamento." : `Escolha o treinamento do ${index + 1}º aluno.`
      );
    }
  }

  const payer = people[0];
  const others = people.slice(1);
  const actor = { id: user?.id ?? null, name: user?.name ?? user?.email ?? null };

  // ── 1. A matrícula financeira ────────────────────────────────────────────
  let enrollmentId: number;
  if (input.enrollmentId) {
    // Regularização: a matrícula já existe e o dinheiro dela não se discute aqui.
    enrollmentId = input.enrollmentId;
    await linkLeadIfMissing(enrollmentId, payer.leadInscricaoId);
  } else {
    const sale = input.sale;
    if (!sale) throw new Error("Informe os valores do contrato.");
    if (!(round2(sale.totalAmount) > 0)) throw new Error("Informe o valor fechado do contrato.");

    const othersTotal = others.reduce((sum, person) => sum + round2(person.amount), 0);
    if (others.length > 0 && othersTotal >= round2(sale.totalAmount)) {
      throw new Error(
        "A soma dos alunos adicionais tem que ser menor que o valor do contrato — o que sobra é o curso de quem paga."
      );
    }

    if (payer.leadInscricaoId) {
      // Com lead, o caminho é o mesmo do fechamento no CRM: o card vai para
      // Fechado, a comissão sai pelo vendedor do lead e a venda entra na linha
      // do tempo dele. Registrar por fora deixaria o Kanban mentindo.
      const result = await registerLeadSale(user, payer.leadInscricaoId, {
        courseId: payer.courseId,
        amount: sale.totalAmount,
        installments: sale.installments,
        downPaymentAmount: sale.downPaymentAmount ?? 0,
        saleDate: sale.saleDate,
        firstMonth: sale.firstMonth ?? null,
        paymentMethodId: sale.paymentMethodId ?? null,
        cardBrandId: sale.cardBrandId ?? null,
        sellerId: sale.sellerId ?? null,
        branchId: sale.branchId ?? null,
        discountReason: sale.discountReason ?? null,
        notes: sale.notes ?? null,
        schedule: sale.schedule ?? null,
        extraListPrice: 0,
        contractPlan: input.planSplit ?? null,
        contractCourse: input.courseHours
          ? { hours: input.courseHours, className: input.className ?? "" }
          : null,
      });
      enrollmentId = result.sale.enrollmentId;
    } else {
      const course = await courseBusinessUnit(payer.courseId);
      enrollmentId = await createEnrollment({
        student: payer.profile.fullName.trim(),
        courseId: payer.courseId,
        classId: payer.classId ?? null,
        totalAmount: sale.totalAmount,
        downPaymentAmount: sale.downPaymentAmount ?? 0,
        installments: sale.installments,
        paymentMethodId: sale.paymentMethodId ?? null,
        cardBrandId: sale.cardBrandId ?? null,
        firstMonth: sale.firstMonth?.trim() || monthOf(sale.saleDate),
        saleDate: sale.saleDate,
        sellerId: sale.sellerId ?? null,
        branchId: sale.branchId ?? null,
        notes: sale.notes ?? null,
        schedule: sale.schedule ?? null,
        businessUnit: course.businessUnit,
        commissionPct: course.commissionPct,
      });
      await getPool().query(
        `UPDATE ${SCHEMA}.finance_enrollments
            SET created_by_user_id = COALESCE(created_by_user_id, $2),
                created_by_name    = COALESCE(created_by_name, $3)
          WHERE id = $1`,
        [enrollmentId, actor.id, actor.name]
      );
    }
  }

  await stampContractFields(enrollmentId, input.planSplit, input.courseHours, input.className);

  // ── 2. As fichas ─────────────────────────────────────────────────────────
  // Depois da matrícula existir, porque é ela que recebe o `student_id` — e é
  // do `student_id` que sai o item 2 do contrato.
  const payerStudentId = await upsertStudentContractProfile(
    payer.leadInscricaoId,
    payer.profile,
    actor,
    enrollmentId
  );

  const participantInput: EnrollmentParticipantInput[] = others.map((person) => ({
    profile: person.profile,
    leadInscricaoId: person.leadInscricaoId,
    courseId: person.courseId,
    amount: round2(person.amount),
    className: null,
    classId: person.classId,
  }));
  await replaceEnrollmentParticipants(enrollmentId, participantInput, actor);

  const participants = others.length > 0 ? await listEnrollmentParticipants(enrollmentId) : [];
  const studentIds = [payerStudentId, ...participants.map((item) => item.studentId ?? 0)];

  // ── 3. As cadeiras na turma ──────────────────────────────────────────────
  // Turma lotada não pode derrubar o contrato inteiro: a venda já aconteceu, e
  // o que falta é logística. O erro vira pendência na fila, não rollback.
  let allocated = 0;
  const seats: Array<{ studentId: number; classId: number | null }> = [
    { studentId: payerStudentId, classId: payer.classId },
    ...others.map((person, index) => ({
      studentId: participants[index]?.studentId ?? 0,
      classId: person.classId,
    })),
  ];
  for (const seat of seats) {
    if (!seat.classId || !seat.studentId) continue;
    try {
      await addStudentToClass({
        classId: seat.classId,
        studentId: seat.studentId,
        financeEnrollmentId: enrollmentId,
        startDate: input.sale?.saleDate ?? null,
      });
      allocated += 1;
    } catch {
      // Fica para a fila de regularização, com o motivo visível na turma.
    }
  }

  // ── 4. O contrato ────────────────────────────────────────────────────────
  // Por último, quando ficha e turma já existem: é delas que saem os itens 2 e
  // 3. Falhar aqui (falta CPF, falta dado da escola) NÃO desfaz a matrícula —
  // "mesmo sem assinar, a matrícula está feita" foi decisão da operação.
  let contractId: number | null = null;
  let contractError: string | null = null;
  try {
    const contract = await createContractForEnrollment(user, enrollmentId, {
      planSplit: input.planSplit ?? null,
      reason: input.enrollmentId ? "contrato gerado na regularização" : "contrato novo",
    });
    contractId = contract.id;
  } catch (error) {
    contractError = error instanceof Error ? error.message : "Falha ao gerar o contrato.";
  }

  return { enrollmentId, studentIds, allocated, contractId, contractError };
}

// ── Regularização ──────────────────────────────────────────────────────────

export interface EnrollmentPendency {
  enrollmentId: number;
  student: string;
  courseId: number | null;
  courseName: string | null;
  businessUnit: string;
  saleDate: string | null;
  amount: number;
  leadInscricaoId: number | null;
  studentId: number | null;
  classId: number | null;
  className: string | null;
  /** Situação do contrato vivo, ou null quando não há nenhum. */
  contractStatus: string | null;
  /** Pessoas do contrato (pagador incluído) e quantas já estão no diário. */
  peopleCount: number;
  seatedCount: number;
  /**
   * Cadeiras carimbadas com esta matrícula cujo aluno NÃO é nenhuma das pessoas
   * dela. Quase sempre é ficha duplicada da mesma pessoa — a chamada mostra o
   * nome duas vezes e o número de alunos da turma mente.
   */
  strayCount: number;
  /**
   * O que falta, na ordem em que precisa ser resolvido. Vazio = matrícula
   * completa: ficha, turma e contrato.
   */
  missing: EnrollmentGap[];
}

export type EnrollmentGap = "ficha" | "turma" | "diario" | "estranho" | "contrato";

export const ENROLLMENT_GAP_LABELS: Record<EnrollmentGap, string> = {
  ficha: "sem ficha de aluno",
  turma: "sem turma",
  diario: "fora do diário",
  estranho: "gente a mais no diário",
  contrato: "sem contrato",
};

/**
 * Toda matrícula e o que falta nela.
 *
 * A informação existia espalhada em três telas — `/contratos` sabia quem não
 * tinha contrato, `/alunos` sabia quem não tinha ficha e `/matriculas` sabia
 * quem não tinha turma — e nenhuma das três mostrava o quadro inteiro. Sem ele,
 * a pergunta "por que a turma de hoje abre com o diário vazio?" não tinha onde
 * ser respondida.
 *
 * "Fora do diário" é o caso mais traiçoeiro: a matrícula APONTA para a turma
 * (`class_id` preenchido) e mesmo assim o aluno não aparece na chamada, porque
 * quem entra no diário é a ficha, e ela nunca foi criada.
 */
export async function listEnrollmentPendencies(options: { onlyPending?: boolean } = {}): Promise<
  EnrollmentPendency[]
> {
  const { rows } = await getPool().query(
    `SELECT e.id, e.student, e.course_id, e.business_unit, e.total_amount,
            e.sale_date::text AS sale_date, e.lead_inscricao_id, e.student_id, e.class_id,
            fc.name AS course_name,
            ac.name AS class_name,
            ct.status AS contract_status,
            1 + COALESCE(p.total, 0) AS people_count,
            COALESCE(seats.total, 0) AS seated_count,
            COALESCE(strays.total, 0) AS stray_count
       FROM ${SCHEMA}.finance_enrollments e
       LEFT JOIN ${SCHEMA}.finance_courses fc ON fc.id = e.course_id
       LEFT JOIN ${SCHEMA}.academic_classes ac ON ac.id = e.class_id
       LEFT JOIN LATERAL (
         SELECT status FROM ${SCHEMA}.contracts c
          WHERE c.enrollment_id = e.id AND c.status <> 'cancelado'
          ORDER BY c.version DESC LIMIT 1
       ) ct ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS total
           FROM ${SCHEMA}.finance_enrollment_participants fp
          WHERE fp.enrollment_id = e.id
       ) p ON TRUE
       LEFT JOIN LATERAL (
         -- Quantas das pessoas DESTA matrícula têm cadeira ativa em alguma turma.
         -- Contar só as pessoas dela (e não toda cadeira que a aponta) mantém o
         -- número entre 0 e o total de pessoas: antes, uma ficha duplicada fazia
         -- o contador passar do total e a matrícula aparecia como resolvida.
         -- Alocação feita à mão em /turmas não carimba finance_enrollment_id,
         -- por isso a cadeira é procurada pelo ALUNO, não pelo vínculo.
         SELECT COUNT(*)::int AS total
           FROM (
             SELECT e.student_id AS sid WHERE e.student_id IS NOT NULL
             UNION
             SELECT fp2.student_id FROM ${SCHEMA}.finance_enrollment_participants fp2
              WHERE fp2.enrollment_id = e.id AND fp2.student_id IS NOT NULL
           ) pessoas
          WHERE EXISTS (
            SELECT 1 FROM ${SCHEMA}.academic_class_students cs
             WHERE cs.student_id = pessoas.sid AND cs.status = 'ativa'
          )
       ) seats ON TRUE
       LEFT JOIN LATERAL (
         -- Cadeira carimbada com esta matrícula que pertence a mais ninguém dela.
         SELECT COUNT(*)::int AS total
           FROM ${SCHEMA}.academic_class_students cs
          WHERE cs.finance_enrollment_id = e.id
            AND cs.status = 'ativa'
            AND cs.student_id IS DISTINCT FROM e.student_id
            AND cs.student_id NOT IN (
              SELECT COALESCE(fp3.student_id, -1) FROM ${SCHEMA}.finance_enrollment_participants fp3
               WHERE fp3.enrollment_id = e.id
            )
       ) strays ON TRUE
      ORDER BY e.sale_date DESC NULLS LAST, e.id DESC
      LIMIT 500`
  );

  const items = rows.map((row): EnrollmentPendency => {
    const studentId = row.student_id === null ? null : Number(row.student_id);
    const classId = row.class_id === null ? null : Number(row.class_id);
    const peopleCount = Number(row.people_count) || 1;
    const seatedCount = Number(row.seated_count) || 0;
    const strayCount = Number(row.stray_count) || 0;
    const contractStatus = (row.contract_status as string | null) ?? null;

    const missing: EnrollmentGap[] = [];
    if (!studentId) missing.push("ficha");
    if (!classId && seatedCount === 0) missing.push("turma");
    // Aponta para turma mas ninguém sentou: é o caso que esvazia a chamada.
    if (classId && seatedCount === 0) missing.push("diario");
    // Contrato de casal com só uma pessoa no diário também é diário incompleto.
    if (seatedCount > 0 && seatedCount < peopleCount) missing.push("diario");
    if (strayCount > 0) missing.push("estranho");
    if (!contractStatus) missing.push("contrato");

    return {
      enrollmentId: Number(row.id),
      student: String(row.student ?? ""),
      courseId: row.course_id === null ? null : Number(row.course_id),
      courseName: (row.course_name as string | null) ?? null,
      businessUnit: String(row.business_unit ?? "vozup"),
      saleDate: (row.sale_date as string | null) ?? null,
      amount: Number(row.total_amount) || 0,
      leadInscricaoId: row.lead_inscricao_id === null ? null : Number(row.lead_inscricao_id),
      studentId,
      classId,
      className: (row.class_name as string | null) ?? null,
      contractStatus,
      peopleCount,
      seatedCount,
      strayCount,
      missing,
    };
  });

  return options.onlyPending ? items.filter((item) => item.missing.length > 0) : items;
}

export interface QuickPlaceResult {
  studentId: number;
  seated: boolean;
  contractId: number | null;
  contractError: string | null;
}

/**
 * Resolve, num clique, só o que o sistema consegue deduzir sozinho: cria a
 * ficha do aluno a partir do nome que já está na matrícula e senta essa ficha
 * na turma que a matrícula já aponta.
 *
 * **Não inventa CPF, RG nem endereço** — esses dados não estão em lugar nenhum
 * do sistema, e preenchê-los por conta própria colocaria número errado dentro
 * de um documento assinado. Por isso o contrato costuma continuar pendente
 * depois desta ação: o que falta nele é dado que só uma pessoa tem.
 */
export async function quickPlaceEnrollment(
  user: DashboardUser | null | undefined,
  enrollmentId: number
): Promise<QuickPlaceResult> {
  const { rows } = await getPool().query(
    `SELECT student, student_id, class_id, lead_inscricao_id, sale_date::text AS sale_date
       FROM ${SCHEMA}.finance_enrollments WHERE id = $1`,
    [enrollmentId]
  );
  const row = rows[0];
  if (!row) throw new Error("Matrícula não encontrada.");

  const actor = { id: user?.id ?? null, name: user?.name ?? user?.email ?? null };
  const leadId = row.lead_inscricao_id === null ? null : Number(row.lead_inscricao_id);

  let studentId = row.student_id === null ? null : Number(row.student_id);
  if (!studentId) {
    const name = String(row.student ?? "").trim();
    if (!name) throw new Error("A matrícula não tem nem o nome do aluno — corrija no Financeiro antes.");
    // Ficha só com o nome, de propósito: é o mínimo que permite a pessoa
    // existir como aluna, entrar na turma e aparecer na chamada. O resto do
    // quadro fica para quem tiver os documentos em mãos.
    studentId = await upsertStudentContractProfile(
      leadId,
      {
        fullName: name,
        cpf: null,
        rg: null,
        birthDate: null,
        profession: null,
        company: null,
        landline: null,
        phone: null,
        email: null,
        address: null,
        neighborhood: null,
        city: null,
        state: null,
        zip: null,
        guardian: null,
      },
      actor,
      enrollmentId
    );
  }

  let seated = false;
  const classId = row.class_id === null ? null : Number(row.class_id);
  if (classId) {
    await addStudentToClass({
      classId,
      studentId,
      financeEnrollmentId: enrollmentId,
      startDate: (row.sale_date as string | null) ?? null,
    });
    seated = true;
  }

  // Alunos adicionais que já têm ficha entram junto — cada um na turma dele,
  // ou na do pagador quando não escolheu uma.
  const participants = await listEnrollmentParticipants(enrollmentId);
  for (const participant of participants) {
    const seat = participant.classId ?? classId;
    if (!participant.studentId || !seat) continue;
    try {
      await addStudentToClass({
        classId: seat,
        studentId: participant.studentId,
        financeEnrollmentId: enrollmentId,
        startDate: (row.sale_date as string | null) ?? null,
      });
    } catch {
      // Turma lotada continua como pendência na fila.
    }
  }

  let contractId: number | null = null;
  let contractError: string | null = null;
  try {
    const contract = await createContractForEnrollment(user, enrollmentId, {
      reason: "contrato gerado na regularização",
    });
    contractId = contract.id;
  } catch (error) {
    contractError = error instanceof Error ? error.message : "Falha ao gerar o contrato.";
  }

  return { studentId, seated, contractId, contractError };
}
