import { NextResponse, type NextRequest } from "next/server";
import { requireTasksAdmin } from "@/lib/tasksApi";
import { userCanAccessSector } from "@/lib/tasks";
import { importBoard, type BoardExport } from "@/lib/taskSearch";

export const dynamic = "force-dynamic";

/** Importa um quadro exportado. Sempre cria um quadro NOVO no setor indicado. */
export async function POST(request: NextRequest) {
  const auth = await requireTasksAdmin(request);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => ({}));
  const sectorId = Number(body?.sectorId);
  if (!Number.isFinite(sectorId) || !(await userCanAccessSector(auth.user, sectorId))) {
    return NextResponse.json({ error: "Sem acesso a este setor." }, { status: 403 });
  }
  const data = body?.data as BoardExport | undefined;
  if (!data || !Array.isArray(data.tasks) || !data.board?.name) {
    return NextResponse.json({ error: "Arquivo de importacao invalido." }, { status: 400 });
  }
  try {
    const result = await importBoard(sectorId, data, typeof body?.name === "string" ? body.name : undefined);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[tasks] falha ao importar quadro", error);
    return NextResponse.json({ error: "Falha ao importar o quadro." }, { status: 500 });
  }
}
