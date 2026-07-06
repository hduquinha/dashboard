import { NextResponse, type NextRequest } from "next/server";
import { deleteCatalogEntity, updateCatalogEntity } from "@/lib/finance";
import { financeError, parseId, readJsonBody, requireFinanceAccess } from "../../../utils";

interface RouteContext {
  params: Promise<{ entity: string; id: string }>;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  try {
    const [{ entity, id }, body] = await Promise.all([context.params, readJsonBody(request)]);
    await updateCatalogEntity(entity, parseId(id), body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return financeError(error, "Falha ao atualizar configuracao.");
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  try {
    const { entity, id } = await context.params;
    await deleteCatalogEntity(entity, parseId(id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return financeError(error, "Falha ao excluir configuracao.");
  }
}
