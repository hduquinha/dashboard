import { NextResponse, type NextRequest } from "next/server";
import { deleteEnrollment } from "@/lib/finance";
import { financeError, parseId, requireFinanceAccess } from "../../utils";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  try {
    const { id } = await context.params;
    await deleteEnrollment(parseId(id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return financeError(error, "Falha ao excluir matricula.");
  }
}
