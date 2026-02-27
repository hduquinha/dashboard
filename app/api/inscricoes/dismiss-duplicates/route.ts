import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { assertToken } from "@/lib/auth";
import { dismissDuplicateGroup } from "@/lib/db";

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get("dashboardToken")?.value;

  try {
    assertToken(token);
  } catch {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const ids: unknown = body?.ids;

    if (!Array.isArray(ids) || ids.length < 2 || !ids.every((id) => typeof id === "number" && Number.isFinite(id))) {
      return NextResponse.json(
        { error: "Envie um array 'ids' com pelo menos 2 IDs numéricos." },
        { status: 400 },
      );
    }

    await dismissDuplicateGroup(ids as number[]);

    return NextResponse.json({ ok: true, dismissed: ids.length });
  } catch (error) {
    console.error("Failed to dismiss duplicate group:", error);
    return NextResponse.json(
      { error: "Falha ao registrar dismissal de duplicados." },
      { status: 500 },
    );
  }
}
