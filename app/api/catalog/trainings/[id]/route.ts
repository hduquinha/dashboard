import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { deleteTraining, updateTraining, type TrainingCatalogInput } from "@/lib/trainingCatalog";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

async function requireManage() {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }
  if (!hasPermission(session.user, "catalog.manage")) {
    return NextResponse.json({ error: "Sem permissao para editar o catalogo." }, { status: 403 });
  }
  return null;
}

function parseId(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error("Treinamento invalido.");
  }
  return parsed;
}

export async function PATCH(request: Request, context: RouteContext) {
  const denied = await requireManage();
  if (denied) return denied;

  try {
    const [{ id }, body] = await Promise.all([
      context.params,
      request.json().catch(() => ({})) as Promise<Record<string, unknown>>,
    ]);
    const input: TrainingCatalogInput = {
      name: typeof body.name === "string" ? body.name : "",
      description: typeof body.description === "string" ? body.description : null,
      durationLabel: typeof body.durationLabel === "string" ? body.durationLabel : null,
      defaultPrice: typeof body.defaultPrice === "number" ? body.defaultPrice : null,
      minPrice: typeof body.minPrice === "number" ? body.minPrice : null,
      defaultInstallments: typeof body.defaultInstallments === "number" ? body.defaultInstallments : 1,
      // Empresa dona do curso: é ela que a venda carimba na matrícula.
      businessUnit: typeof body.businessUnit === "string" ? body.businessUnit : null,
      // Vazio = comissão do vendedor; 0 = curso que não paga comissão.
      commissionPct: typeof body.commissionPct === "number" ? body.commissionPct : null,
      active: body.active === undefined ? true : Boolean(body.active),
      sort: typeof body.sort === "number" ? body.sort : 0,
      lessonsCount: typeof body.lessonsCount === "number" ? body.lessonsCount : null,
      lessonHours: typeof body.lessonHours === "number" ? body.lessonHours : null,
      lessonsPerWeek: typeof body.lessonsPerWeek === "number" ? body.lessonsPerWeek : 1,
      enrollmentFee: typeof body.enrollmentFee === "number" ? body.enrollmentFee : 0,
      materialFee: typeof body.materialFee === "number" ? body.materialFee : 0,
    };
    await updateTraining(parseId(id), input);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao atualizar treinamento." },
      { status: 400 }
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const denied = await requireManage();
  if (denied) return denied;

  try {
    const { id } = await context.params;
    const result = await deleteTraining(parseId(id));
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao excluir treinamento." },
      { status: 400 }
    );
  }
}
