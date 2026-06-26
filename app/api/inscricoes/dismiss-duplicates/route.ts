import { NextRequest, NextResponse } from "next/server";
import { assertAuthenticatedRequest } from "@/lib/auth";
import { dismissDuplicateGroup } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    assertAuthenticatedRequest(request);
  } catch {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const ids: unknown = body?.ids;

    if (
      !Array.isArray(ids) ||
      ids.length < 1 ||
      !ids.every((id) => typeof id === "number" && Number.isFinite(id))
    ) {
      return NextResponse.json(
        { error: "Envie um array 'ids' com pelo menos 1 ID numerico." },
        { status: 400 }
      );
    }

    await dismissDuplicateGroup(ids as number[]);

    return NextResponse.json({ ok: true, dismissed: ids.length });
  } catch (error) {
    console.error("Failed to dismiss duplicate alert:", error);
    return NextResponse.json(
      { error: "Falha ao registrar dispensa do alerta." },
      { status: 500 }
    );
  }
}
