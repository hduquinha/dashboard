import { NextRequest, NextResponse } from "next/server";
import {
  assertAuthenticatedRequest,
  getRequestDashboardSession,
  UnauthorizedError,
} from "@/lib/auth";
import { getProductivityWorkspace, verifyProductivityBoard } from "@/lib/productivity";

export const dynamic = "force-dynamic";

type RouteContext = {
  params:
    | {
        model: string;
        id: string;
      }
    | Promise<{
        model: string;
        id: string;
      }>;
};

function unauthorized(error: unknown) {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }
  throw error;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    assertAuthenticatedRequest(request);
  } catch (error) {
    return unauthorized(error);
  }

  const params = await Promise.resolve(context.params);
  const model = params.model === "daily" || params.model === "closing" ? params.model : null;
  const id = Number.parseInt(params.id, 10);

  if (!model || !Number.isFinite(id) || id < 1) {
    return NextResponse.json({ error: "Parametros invalidos" }, { status: 400 });
  }

  const session = getRequestDashboardSession(request);
  const body = (await request.json().catch(() => ({}))) as {
    dateFrom?: string | null;
    dateTo?: string | null;
  };

  try {
    const board = await verifyProductivityBoard(model, id, session?.user ?? null);
    const workspace = await getProductivityWorkspace(session?.user ?? null, {
      dateFrom: body.dateFrom,
      dateTo: body.dateTo,
    });

    return NextResponse.json({ board, workspace });
  } catch (error) {
    console.error("Failed to verify productivity board", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao verificar registro" },
      { status: 400 }
    );
  }
}
