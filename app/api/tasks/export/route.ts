import { NextResponse, type NextRequest } from "next/server";
import { requireTasks } from "@/lib/tasksApi";
import { userCanAccessBoard } from "@/lib/tasks";
import { boardExportToCsv, exportBoard } from "@/lib/taskSearch";

export const dynamic = "force-dynamic";

/** Exporta o quadro em JSON (reimportável) ou CSV (planilha). */
export async function GET(request: NextRequest) {
  const auth = await requireTasks(request);
  if (!auth.ok) return auth.response;
  const params = new URL(request.url).searchParams;
  const boardId = Number(params.get("boardId") ?? "");
  const format = params.get("format") === "csv" ? "csv" : "json";
  if (!Number.isFinite(boardId) || !(await userCanAccessBoard(auth.user, boardId))) {
    return NextResponse.json({ error: "Sem acesso a este quadro." }, { status: 403 });
  }
  const data = await exportBoard(boardId);
  if (!data) return NextResponse.json({ error: "Quadro nao encontrado." }, { status: 404 });

  const slug = data.board.name.replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase();
  if (format === "csv") {
    return new NextResponse(boardExportToCsv(data), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="quadro-${slug}.csv"`,
      },
    });
  }
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="quadro-${slug}.json"`,
    },
  });
}
