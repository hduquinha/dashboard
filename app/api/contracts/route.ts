import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import {
  createContractForEnrollment,
  getContractCompany,
  listContracts,
  listEnrollmentsWithoutContract,
  type ListContractsFilters,
} from "@/lib/contracts";
import { planSplitTotal, type ContractPlanSplit } from "@/lib/contractProfile";
import type { ContractStatus } from "@/lib/contractRules";

export const dynamic = "force-dynamic";

/** Ver contrato é uma coisa; gerar/cancelar é outra — mesmo par view/manage de alunos e cupons. */
export async function requireContractAccess(manage: boolean) {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (!session) {
    return { error: NextResponse.json({ error: "Nao autorizado" }, { status: 401 }), session: null };
  }
  const permission = manage ? "contracts.manage" : "view.contracts";
  if (!hasPermission(session.user, permission)) {
    return {
      error: NextResponse.json(
        { error: manage ? "Sem permissao para gerenciar contratos." : "Sem permissao para ver contratos." },
        { status: 403 }
      ),
      session: null,
    };
  }
  return { error: null, session };
}

/** Números da tela; negativo e lixo viram zero. Tudo zerado = sem override. */
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

function parseStatus(value: string | null): ListContractsFilters["status"] {
  const allowed: Array<ContractStatus | "todos"> = ["pendente", "assinado", "cancelado", "todos"];
  return allowed.includes(value as ContractStatus | "todos") ? (value as ContractStatus | "todos") : "todos";
}

export async function GET(request: NextRequest) {
  const { error } = await requireContractAccess(false);
  if (error) return error;

  const params = request.nextUrl.searchParams;

  // A fila de matrículas sem contrato é pedida à parte: ela só interessa quando
  // alguém abre "Gerar contrato", e carregá-la sempre custaria uma consulta em
  // toda abertura da tela.
  if (params.get("fila") === "1") {
    return NextResponse.json({ enrollments: await listEnrollmentsWithoutContract() });
  }

  const [contracts, company] = await Promise.all([
    listContracts({ status: parseStatus(params.get("status")), search: params.get("search") }),
    getContractCompany(),
  ]);

  return NextResponse.json({ contracts, company });
}

/** Gera o contrato de uma matrícula que ainda não tem (venda antiga, ou venda lançada direto no Financeiro). */
export async function POST(request: NextRequest) {
  const { error, session } = await requireContractAccess(true);
  if (error) return error;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const enrollmentId = Number(body.enrollmentId);
  if (!Number.isFinite(enrollmentId) || enrollmentId < 1) {
    return NextResponse.json({ error: "Informe a matricula." }, { status: 400 });
  }

  // Rateio escolhido na tela. Sem ele, vale o que foi combinado na venda.
  const planSplit = parseSplit(body.planSplit);

  try {
    const contract = await createContractForEnrollment(session.user, enrollmentId, {
      reason: planSplit
        ? "gerado manualmente no CRM, com valores editados na geração"
        : "gerado manualmente no CRM",
      planSplit,
    });
    return NextResponse.json({ contract });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Nao foi possivel gerar o contrato.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
