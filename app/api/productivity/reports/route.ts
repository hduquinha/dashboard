import { NextRequest, NextResponse } from "next/server";
import {
  assertAuthenticatedRequest,
  getRequestDashboardSession,
  UnauthorizedError,
} from "@/lib/auth";
import { getProductivityWorkspace, saveProductivityBoards } from "@/lib/productivity";
import type { SaveProductivityBoardsInput } from "@/types/productivity";

export const dynamic = "force-dynamic";

function unauthorized(error: unknown) {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }
  throw error;
}

function pickDate(value: string | null): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export async function GET(request: NextRequest) {
  try {
    assertAuthenticatedRequest(request, { requireSameOriginForSession: false });
  } catch (error) {
    return unauthorized(error);
  }

  const session = getRequestDashboardSession(request);
  const searchParams = request.nextUrl.searchParams;

  try {
    const workspace = await getProductivityWorkspace(session?.user ?? null, {
      dateFrom: pickDate(searchParams.get("dateFrom")),
      dateTo: pickDate(searchParams.get("dateTo")),
    });
    return NextResponse.json({ workspace });
  } catch (error) {
    console.error("Failed to load productivity workspace", error);
    return NextResponse.json({ error: "Falha ao carregar produtividade" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    assertAuthenticatedRequest(request);
  } catch (error) {
    return unauthorized(error);
  }

  const session = getRequestDashboardSession(request);

  try {
    const body = (await request.json()) as SaveProductivityBoardsInput & {
      dateFrom?: string | null;
      dateTo?: string | null;
    };
    const saved = await saveProductivityBoards(body, session?.user ?? null);
    const workspace = await getProductivityWorkspace(session?.user ?? null, {
      dateFrom: body.dateFrom,
      dateTo: body.dateTo,
    });

    return NextResponse.json({ saved, workspace });
  } catch (error) {
    console.error("Failed to save productivity boards", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao salvar produtividade" },
      { status: 400 }
    );
  }
}
