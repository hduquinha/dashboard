import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { assertAuthenticatedRequest } from "@/lib/auth";
import { listAulaBlockOptions } from "@/lib/vozupFolders";

export const dynamic = "force-dynamic";

/** Aulas VozUP existentes — alimenta o seletor de aula do cadastro manual de lead. */
export async function GET(request: NextRequest) {
  try {
    assertAuthenticatedRequest(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const aulas = await listAulaBlockOptions();
    return NextResponse.json({ aulas });
  } catch (error) {
    console.error("Erro ao listar aulas VozUP:", error);
    return NextResponse.json({ error: "Erro ao listar aulas" }, { status: 500 });
  }
}
