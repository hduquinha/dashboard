import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { createTraining, listTrainingCatalog, type TrainingCatalogInput } from "@/lib/trainingCatalog";

export const dynamic = "force-dynamic";

/** Ver o catálogo basta para quem fecha venda; editar preço é da gestão. */
async function requireCatalogAccess(edit: boolean) {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (!session) {
    return { error: NextResponse.json({ error: "Nao autorizado" }, { status: 401 }), session: null };
  }
  const permission = edit ? "catalog.manage" : "view.catalog";
  if (!hasPermission(session.user, permission)) {
    return {
      error: NextResponse.json(
        { error: edit ? "Sem permissao para editar o catalogo." : "Sem permissao para ver o catalogo." },
        { status: 403 }
      ),
      session: null,
    };
  }
  return { error: null, session };
}

function parseInput(body: Record<string, unknown>): TrainingCatalogInput {
  return {
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
    // Aulas e rateio do contrato: o curso é quem sabe, não a venda.
    lessonsCount: typeof body.lessonsCount === "number" ? body.lessonsCount : null,
    lessonHours: typeof body.lessonHours === "number" ? body.lessonHours : null,
    lessonsPerWeek: typeof body.lessonsPerWeek === "number" ? body.lessonsPerWeek : 1,
    enrollmentFee: typeof body.enrollmentFee === "number" ? body.enrollmentFee : 0,
    materialFee: typeof body.materialFee === "number" ? body.materialFee : 0,
  };
}

export async function GET() {
  const auth = await requireCatalogAccess(false);
  if (auth.error) return auth.error;

  const trainings = await listTrainingCatalog();
  return NextResponse.json({ trainings });
}

export async function POST(request: Request) {
  const auth = await requireCatalogAccess(true);
  if (auth.error) return auth.error;

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const id = await createTraining(parseInput(body));
    return NextResponse.json({ id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao criar treinamento." },
      { status: 400 }
    );
  }
}
