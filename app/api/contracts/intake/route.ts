import { NextRequest, NextResponse } from "next/server";
import { requireContractAccess } from "@/app/api/contracts/route";
import {
  intakeEnrollment,
  listEnrollmentPendencies,
  quickPlaceEnrollment,
  type IntakePerson,
} from "@/lib/enrollmentIntake";
import { listInscricoes } from "@/lib/db";
import {
  getContractProfileForLead,
  getContractProfileForStudent,
  listStudents,
} from "@/lib/academicStudents";
import { listOpenClassesForCourse } from "@/lib/academicClasses";
import { listTrainingCatalog } from "@/lib/trainingCatalog";
import { getFinanceCatalog, type EnrollmentScheduleItem } from "@/lib/finance";
import { listCommissionSellers } from "@/lib/leadSales";
import {
  normalizeContractProfile,
  planSplitTotal,
  type ContractPlanSplit,
} from "@/lib/contractProfile";

export const dynamic = "force-dynamic";

/**
 * A porta de "Novo contrato": tudo o que o assistente precisa para montar um
 * contrato do zero, e a execução dele.
 *
 * Fica sob a permissão de contratos, e não sob a de vendas, porque quem usa
 * esta tela é a secretaria fechando contrato de quem **não é lead** — o caminho
 * do lead continua sendo o modal do CRM.
 */

function optionalNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed !== 0 ? parsed : null;
}

function parseSplit(value: unknown): ContractPlanSplit | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const num = (key: string) => {
    const parsed = Number(raw[key]);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : 0;
  };
  const split: ContractPlanSplit = {
    matricula: num("matricula"),
    material: num("material"),
    curso: num("curso"),
  };
  return planSplitTotal(split) > 0 ? split : null;
}

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

function parsePeople(value: unknown): IntakePerson[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 6).map((item) => {
    const raw = (item ?? {}) as Record<string, unknown>;
    const amount = Number(raw.amount);
    return {
      leadInscricaoId: optionalNumber(raw.leadInscricaoId),
      profile: normalizeContractProfile((raw.profile ?? {}) as Record<string, never>),
      courseId: Number(raw.courseId) || 0,
      classId: optionalNumber(raw.classId),
      amount: Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : 0,
    };
  });
}

export async function GET(request: NextRequest) {
  const { error } = await requireContractAccess(false);
  if (error) return error;

  const params = request.nextUrl.searchParams;

  // Fila de regularização: toda matrícula e o que falta nela.
  if (params.get("pendencias") === "1") {
    return NextResponse.json({ pendencies: await listEnrollmentPendencies() });
  }

  // Quadro pronto de uma pessoa já conhecida — o assistente nunca pede para
  // redigitar o que o sistema já tem.
  const leadId = Number(params.get("leadId"));
  if (Number.isFinite(leadId) && leadId > 0) {
    return NextResponse.json({ profile: await getContractProfileForLead(leadId) });
  }
  const studentId = Number(params.get("studentId"));
  if (Number.isFinite(studentId) && studentId > 0) {
    return NextResponse.json({ profile: await getContractProfileForStudent(studentId) });
  }

  // Turmas abertas do treinamento escolhido.
  const courseId = Number(params.get("courseId"));
  if (Number.isFinite(courseId) && courseId > 0) {
    return NextResponse.json({ openClasses: await listOpenClassesForCourse(courseId) });
  }

  // Busca de pessoa. As duas origens juntas de propósito: quem digita um nome
  // não sabe (nem precisa saber) se aquela pessoa está cadastrada como lead do
  // CRM ou como aluno da escola.
  const term = (params.get("q") ?? "").trim();
  if (term.length >= 3) {
    const [leadsResult, students] = await Promise.all([
      listInscricoes({ page: 1, pageSize: 8, filters: { caracteristica: term } }),
      listStudents({ search: term }),
    ]);
    return NextResponse.json({
      leads: leadsResult.data.map((item) => ({
        id: item.id,
        nome: item.nome,
        telefone: item.telefone,
      })),
      students: students.slice(0, 8).map((item) => ({
        id: item.id,
        fullName: item.fullName,
        cpf: item.cpf,
        leadInscricaoId: item.leadInscricaoId,
        classes: item.classes.filter((turma) => turma.status === "ativa").map((turma) => turma.className),
      })),
    });
  }

  // Catálogo do formulário.
  const [catalog, trainings, sellers] = await Promise.all([
    getFinanceCatalog(),
    listTrainingCatalog(),
    listCommissionSellers(),
  ]);
  return NextResponse.json({
    trainings: trainings
      .filter((training) => training.active)
      .map((training) => ({
        id: training.id,
        name: training.name,
        defaultPrice: training.defaultPrice,
        defaultInstallments: training.defaultInstallments,
        lessonsCount: training.lessonsCount,
        lessonHours: training.lessonHours,
        enrollmentFee: training.enrollmentFee,
        materialFee: training.materialFee,
      })),
    paymentMethods: catalog.paymentMethods.map((item) => ({
      id: item.id,
      name: item.name,
      kind: item.kind,
      // Teto de parcelas da forma: é ele que o seletor do contrato usa.
      maxInstallments: item.maxInstallments,
    })),
    cardBrands: catalog.cardBrands.map((item) => ({ id: item.id, name: item.name })),
    branches: catalog.branches.map((item) => ({ id: item.id, name: item.name })),
    sellers: sellers.map((item) => ({ id: item.id, name: item.name })),
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireContractAccess(true);
  if (auth.error) return auth.error;

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    // Regularização em um clique: só o que é dedutível (ficha pelo nome que já
    // está na matrícula, cadeira na turma que ela já aponta).
    if (body.modo === "rapido") {
      const enrollmentId = Number(body.enrollmentId);
      if (!(enrollmentId > 0)) throw new Error("Matrícula inválida.");
      return NextResponse.json(await quickPlaceEnrollment(auth.session.user, enrollmentId));
    }

    const result = await intakeEnrollment(auth.session.user, {
      enrollmentId: optionalNumber(body.enrollmentId),
      people: parsePeople(body.people),
      planSplit: parseSplit(body.planSplit),
      courseHours: typeof body.courseHours === "string" ? body.courseHours : null,
      className: typeof body.className === "string" ? body.className : null,
      sale: body.sale
        ? (() => {
            const raw = body.sale as Record<string, unknown>;
            return {
              totalAmount: Number(raw.totalAmount) || 0,
              installments: Number(raw.installments) || 1,
              downPaymentAmount: Number(raw.downPaymentAmount) || 0,
              saleDate:
                typeof raw.saleDate === "string" && raw.saleDate
                  ? raw.saleDate
                  : new Date().toISOString().slice(0, 10),
              firstMonth: typeof raw.firstMonth === "string" ? raw.firstMonth : null,
              paymentMethodId: optionalNumber(raw.paymentMethodId),
              cardBrandId: optionalNumber(raw.cardBrandId),
              sellerId: optionalNumber(raw.sellerId),
              branchId: optionalNumber(raw.branchId),
              discountReason: typeof raw.discountReason === "string" ? raw.discountReason : null,
              notes: typeof raw.notes === "string" ? raw.notes : null,
              schedule: parseSchedule(raw.schedule),
            };
          })()
        : null,
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao criar o contrato." },
      { status: 400 }
    );
  }
}
