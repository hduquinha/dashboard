import { NextResponse, type NextRequest } from "next/server";
import { deleteRevenue, getRevenueById, updateRevenue } from "@/lib/finance";
import { financeError, parseId, readJsonBody, requireFinanceAccess } from "../../utils";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  try {
    const { id } = await context.params;
    const revenue = await getRevenueById(parseId(id));
    if (!revenue) return NextResponse.json({ error: "Receita não encontrada." }, { status: 404 });
    return NextResponse.json({ revenue });
  } catch (error) {
    return financeError(error, "Falha ao carregar receita.");
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  try {
    const { id } = await context.params;
    await updateRevenue(parseId(id), await readJsonBody(request));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return financeError(error, "Falha ao atualizar receita.");
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  try {
    const { id } = await context.params;
    await deleteRevenue(parseId(id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return financeError(error, "Falha ao excluir receita.");
  }
}
