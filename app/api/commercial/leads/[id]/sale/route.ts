import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DASHBOARD_COOKIE_NAME, getDashboardSession, type DashboardUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import {
  deleteLeadSale,
  getLeadSale,
  getSaleContractCourse,
  getSaleContractPlan,
  listCommissionSellers,
  registerLeadSale,
} from "@/lib/leadSales";
import { getFinanceCatalog, type EnrollmentScheduleItem } from "@/lib/finance";
import { getContractForEnrollment, syncContractOnSale } from "@/lib/contracts";
import { listTrainingCatalog } from "@/lib/trainingCatalog";
import {
  EMPTY_PLAN_SPLIT,
  normalizeContractProfile,
  normalizeCourseInfo,
  planSplitTotal,
  validateContractProfile,
  validateCourseInfo,
  validatePlanSplit,
  type ContractPlanSplit,
} from "@/lib/contractProfile";
import {
  getContractProfileForLead,
  getContractProfileForStudent,
  upsertStudentContractProfile,
} from "@/lib/academicStudents";
import {
  listEnrollmentParticipants,
  replaceEnrollmentParticipants,
  type EnrollmentParticipantInput,
} from "@/lib/enrollmentParticipants";
import { addStudentToClass, listOpenClassesForCourse } from "@/lib/academicClasses";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

function parseId(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error("Lead invalido.");
  }
  return parsed;
}

async function requireSaleAccess(): Promise<
  { error: NextResponse; user: null } | { error: null; user: DashboardUser }
> {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (!session) {
    return { error: NextResponse.json({ error: "Nao autorizado" }, { status: 401 }), user: null };
  }
  if (!hasPermission(session.user, "crm.register_sale")) {
    return {
      error: NextResponse.json({ error: "Sem permissao para registrar vendas." }, { status: 403 }),
      user: null,
    };
  }
  return { error: null, user: session.user };
}

/** Rateio do item 4 do contrato; ausente vira "tudo em curso". */
function parsePlanSplit(value: unknown, amount: number): ContractPlanSplit {
  if (!value || typeof value !== "object") return { ...EMPTY_PLAN_SPLIT, curso: amount };
  const raw = value as Record<string, unknown>;
  const num = (key: string) => {
    const parsed = Number(raw[key]);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : 0;
  };
  const split = { matricula: num("matricula"), material: num("material"), curso: num("curso") };
  return planSplitTotal(split) > 0 ? split : { ...EMPTY_PLAN_SPLIT, curso: amount };
}

/**
 * Alunos adicionais vindos da tela. Lista vazia é o caso normal (um aluno) e
 * também o jeito de remover a segunda pessoa de uma venda já registrada.
 */
function parseCoStudents(value: unknown): EnrollmentParticipantInput[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 5).map((item) => {
    const raw = (item ?? {}) as Record<string, unknown>;
    const amount = Number(raw.amount);
    return {
      profile: normalizeContractProfile((raw.profile ?? {}) as Record<string, never>),
      leadInscricaoId: Number(raw.leadInscricaoId) || null,
      courseId: Number(raw.courseId) || 0,
      className: typeof raw.className === "string" ? raw.className : null,
      classId: Number(raw.classId) || null,
      amount: Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : 0,
    };
  });
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Parcelas combinadas uma a uma; formato invalido cai no cronograma padrao. */
function parseSchedule(value: unknown): EnrollmentScheduleItem[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const items = value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      amount: Number(item.amount),
      type: item.type === "entrada" ? ("entrada" as const) : ("parcela" as const),
      dueDate: typeof item.dueDate === "string" ? item.dueDate : "",
      paymentMethodId: optionalNumber(item.paymentMethodId),
      cardBrandId: optionalNumber(item.cardBrandId),
    }))
    .filter((item) => Number.isFinite(item.amount) && item.amount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(item.dueDate));
  return items.length > 0 ? items : null;
}

/**
 * Devolve a venda já registrada (se houver) junto das opções que o modal
 * precisa. Vai tudo numa chamada só porque o modal abre no meio de um
 * drag-and-drop — duas idas ao servidor deixariam o vendedor olhando um
 * formulário vazio.
 */
export async function GET(request: Request, context: RouteContext) {
  const auth = await requireSaleAccess();
  if (auth.error) return auth.error;

  try {
    const { id } = await context.params;
    const leadId = parseId(id);

    // A ficha do lead só exibe a venda; carregar o catálogo do Financeiro
    // (dez consultas) a cada abertura de ficha seria peso sem uso — as opções
    // só interessam a quem vai editar.
    // A ficha do lead mostra a venda E o contrato digital dela: é ali que o
    // vendedor está quando precisa reenviar o link de assinatura.
    if (new URL(request.url).searchParams.get("options") === "0") {
      const sale = await getLeadSale(leadId);
      const contract = sale ? await getContractForEnrollment(sale.enrollmentId) : null;
      return NextResponse.json({ sale, contract });
    }

    const [sale, trainings, catalog, contractProfile] = await Promise.all([
      getLeadSale(leadId),
      listTrainingCatalog(),
      getFinanceCatalog(),
      // Quadro do contrato já preenchido com o que se sabe do aluno/lead.
      getContractProfileForLead(leadId),
    ]);
    const contract = sale ? await getContractForEnrollment(sale.enrollmentId) : null;
    const contractPlan = sale ? await getSaleContractPlan(sale.enrollmentId) : null;
    // Alunos adicionais (contrato de casal): a tela reabre com o quadro de
    // cada um, senão corrigir a venda apagaria a segunda pessoa.
    const coStudents = sale
      ? await Promise.all(
          (await listEnrollmentParticipants(sale.enrollmentId)).map(async (participant) => ({
            profile: participant.studentId
              ? await getContractProfileForStudent(participant.studentId)
              : null,
            courseId: participant.courseId,
            amount: participant.amount,
            className: participant.className,
            classId: participant.classId,
            leadInscricaoId: participant.leadInscricaoId,
          }))
        )
      : [];
    const contractCourse = sale ? await getSaleContractCourse(sale.enrollmentId) : null;
    // Turmas abertas do curso escolhido: o vendedor combina o dia com o cliente
    // na mesma tela em que fecha, em vez de deixar o aluno sem turma.
    const courseForClasses = Number(new URL(request.url).searchParams.get("courseId")) || sale?.courseId || 0;
    const openClasses = courseForClasses > 0 ? await listOpenClassesForCourse(courseForClasses) : [];
    // Vendedores: a equipe real, não a lista antiga do Financeiro (ver
    // listCommissionSellers).
    const commissionSellers = await listCommissionSellers();

    return NextResponse.json({
      sale,
      contract,
      contractProfile,
      contractPlan,
      contractCourse,
      coStudents: coStudents.filter((item) => item.profile !== null),
      openClasses,
      options: {
        trainings: trainings
          .filter((training) => training.active || training.id === sale?.courseId)
          .map((training) => ({
            id: training.id,
            name: training.name,
            defaultPrice: training.defaultPrice,
            minPrice: training.minPrice,
            defaultInstallments: training.defaultInstallments,
            durationLabel: training.durationLabel,
            // O vendedor precisa saber em qual empresa a venda vai cair; ele
            // não escolhe, mas vê antes de fechar.
            businessUnit: training.businessUnit,
            // O curso é quem sabe: aulas, carga horária e o rateio do contrato.
            lessonsCount: training.lessonsCount,
            lessonHours: training.lessonHours,
            enrollmentFee: training.enrollmentFee,
            materialFee: training.materialFee,
          })),
        paymentMethods: catalog.paymentMethods
          .filter((method) => method.active)
          .map((method) => ({
            id: method.id,
            name: method.name,
            kind: method.kind,
            // Teto de parcelas da forma: é ele que o seletor do fechamento usa.
            maxInstallments: method.maxInstallments,
          })),
        cardBrands: catalog.cardBrands
          .filter((brand) => brand.active)
          .map((brand) => ({ id: brand.id, name: brand.name })),
        // A equipe de verdade. A lista do Financeiro continua existindo para o
        // histórico de comissão, mas não é oferecida no fechamento: ela tem
        // gente que saiu da escola e nome duplicado.
        sellers: commissionSellers,
        branches: catalog.branches
          .filter((branch) => branch.active)
          .map((branch) => ({ id: branch.id, name: branch.name })),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao carregar a venda." },
      { status: 400 }
    );
  }
}

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireSaleAccess();
  if (auth.error) return auth.error;

  try {
    const [{ id }, body] = await Promise.all([
      context.params,
      request.json().catch(() => ({})) as Promise<Record<string, unknown>>,
    ]);

    const leadId = parseId(id);
    const amount = Number(body.amount);

    // Quadro do contrato: validado ANTES de gravar qualquer coisa. Registrar a
    // venda e só depois recusar os dados do aluno deixaria o lead em Fechado
    // com matrícula pela metade — exatamente o que este passo existe para
    // impedir.
    const hasProfile = Boolean(body.contractProfile);
    const profile = hasProfile
      ? normalizeContractProfile(body.contractProfile as Record<string, never>)
      : null;
    const courseInfo = hasProfile ? normalizeCourseInfo(body.contractCourse as never) : null;
    if (profile) {
      const problem = validateContractProfile(profile) ?? validateCourseInfo(courseInfo!);
      if (problem) throw new Error(problem);
    }

    const planSplit = parsePlanSplit(body.contractPlan, amount);
    if (body.contractPlan) {
      const problem = validatePlanSplit(planSplit, amount);
      if (problem) throw new Error(problem);
    }

    // Alunos adicionais do mesmo contrato. O quadro de cada um passa pelas
    // MESMAS regras do pagador — contrato com meia ficha preenchida não é
    // assinável, e descobrir isso depois custa uma reemissão.
    const coStudents = parseCoStudents(body.coStudents);
    const coTotal = coStudents.reduce((sum, item) => sum + item.amount, 0);
    for (const [index, co] of coStudents.entries()) {
      const problem = validateContractProfile(co.profile);
      if (problem) throw new Error(`${index + 2}º aluno: ${problem.toLowerCase()}`);
      if (!(co.courseId > 0)) throw new Error(`Escolha o treinamento do ${index + 2}º aluno.`);
      if (!(co.amount > 0)) throw new Error(`Informe o valor do ${index + 2}º aluno.`);
    }
    if (coStudents.length > 0 && coTotal >= amount) {
      throw new Error(
        "A soma dos alunos adicionais tem que ser menor que o valor fechado — o que sobra é o curso de quem paga."
      );
    }

    // Tabela dos cursos que entram junto — o desconto é do contrato inteiro.
    const extraListPrice =
      coStudents.length === 0
        ? 0
        : await (async () => {
            const catalog = await listTrainingCatalog();
            return coStudents.reduce((sum, co) => {
              const item = catalog.find((option) => option.id === co.courseId);
              return sum + (item?.defaultPrice ?? 0);
            }, 0);
          })();

    const result = await registerLeadSale(auth.user, leadId, {
      extraListPrice,
      contractPlan: planSplit,
      contractCourse: courseInfo,
      courseId: Number(body.courseId),
      amount: Number(body.amount),
      installments: Number(body.installments ?? 1),
      downPaymentAmount: Number(body.downPaymentAmount) || 0,
      saleDate: typeof body.saleDate === "string" ? body.saleDate : "",
      firstMonth: typeof body.firstMonth === "string" ? body.firstMonth : null,
      paymentMethodId: optionalNumber(body.paymentMethodId),
      cardBrandId: optionalNumber(body.cardBrandId),
      sellerId: optionalNumber(body.sellerId),
      branchId: optionalNumber(body.branchId),
      discountReason: typeof body.discountReason === "string" ? body.discountReason : null,
      notes: typeof body.notes === "string" ? body.notes : null,
      schedule: parseSchedule(body.schedule),
    });

    // Ficha do aluno depois da matrícula existir: é ela que recebe o
    // student_id, e é dela que o contrato tira o item 2.
    let studentId: number | null = null;
    if (profile) {
      studentId = await upsertStudentContractProfile(
        leadId,
        profile,
        { id: auth.user.id ?? null, name: auth.user.name ?? auth.user.email ?? null },
        result.sale.enrollmentId
      );
    }

    // Alunos adicionais depois da matrícula existir: cada um ganha ficha
    // própria (reencontrada pelo CPF quando já é aluno) e entra na tabela
    // filha da matrícula, que é de onde o contrato tira os quadros extras.
    await replaceEnrollmentParticipants(result.sale.enrollmentId, coStudents, {
      id: auth.user.id ?? null,
      name: auth.user.name ?? auth.user.email ?? null,
    });

    // Turma escolhida no fechamento: o aluno entra nela e a matrícula passa a
    // apontar para a turma, que é de onde o contrato tira o item 3. Sem turma
    // escolhida ("definir depois"), a venda segue e o aluno aparece na lista de
    // quem está sem turma.
    //
    // Vale para TODAS as pessoas do contrato, não só para quem paga. Enquanto
    // só o pagador era alocado, o segundo aluno de um contrato de casal ganhava
    // ficha e nunca entrava no diário: existia no PDF e não existia na turma.
    // Sem turma própria escolhida, ele vai para a mesma do 1º aluno — comprar
    // junto é, quase sempre, estudar junto.
    const classId = Number(body.classId) || 0;
    const participants = await listEnrollmentParticipants(result.sale.enrollmentId);
    const seats: Array<{ studentId: number | null; classId: number }> = [
      { studentId, classId },
      ...participants.map((participant, index) => ({
        studentId: participant.studentId,
        classId: coStudents[index]?.classId || classId,
      })),
    ];
    for (const seat of seats) {
      if (!(seat.classId > 0) || !seat.studentId) continue;
      try {
        await addStudentToClass({
          classId: seat.classId,
          studentId: seat.studentId,
          financeEnrollmentId: result.sale.enrollmentId,
          startDate: result.sale.saleDate,
        });
      } catch {
        // Turma lotada não desfaz a venda: o que falta é logística, e a
        // pendência aparece na turma e na fila de regularização.
      }
    }

    // O contrato é gerado dentro de `registerLeadSale`, ANTES de a ficha do
    // aluno e a turma existirem — e nasceria sem CPF, sem turma e sem carga
    // horária (ou seria recusado por incompleto). Uma segunda passada agora
    // aproveita tudo o que acabou de ser gravado.
    if (studentId || coStudents.length > 0) {
      await syncContractOnSale(auth.user, result.sale.enrollmentId, { saleWasUpdated: true });
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao registrar a venda." },
      { status: 400 }
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireSaleAccess();
  if (auth.error) return auth.error;

  try {
    const { id } = await context.params;
    await deleteLeadSale(auth.user, parseId(id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao excluir a venda." },
      { status: 400 }
    );
  }
}
