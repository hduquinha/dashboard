import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { assertToken } from "@/lib/auth";
import { addInscricaoNote } from "@/lib/db";

type RouteParams = {
  id: string;
};

type RouteContext = {
  params: RouteParams | Promise<RouteParams>;
};

async function resolveInscricaoId(context: RouteContext): Promise<number | null> {
  const resolvedParams = await Promise.resolve(context.params);
  const idRaw = resolvedParams?.id;
  const id = Number.parseInt(idRaw ?? "", 10);
  if (!Number.isFinite(id) || id < 1) {
    return null;
  }
  return id;
}

async function ensureAuthorizedToken(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get("dashboardToken")?.value;

  try {
    assertToken(token);
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: Request, context: RouteContext) {
  if (!(await ensureAuthorizedToken())) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const id = await resolveInscricaoId(context);
  if (!id) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ error: "Corpo inválido" }, { status: 400 });
  }

  const record = payload as Record<string, unknown>;
  const content = typeof record.content === "string" ? record.content : null;
  if (!content || content.trim().length === 0) {
    return NextResponse.json({ error: "A anotação não pode estar vazia." }, { status: 400 });
  }

  const viaWhatsapp = typeof record.viaWhatsapp === "boolean" ? record.viaWhatsapp : undefined;

  try {
    const inscricao = await addInscricaoNote(id, content, { viaWhatsapp });
    return NextResponse.json({ inscricao });
  } catch (error) {
    if (error instanceof Error && error.message.includes("não encontrada")) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    console.error("Failed to add note", error);
    return NextResponse.json({ error: "Erro ao adicionar anotação" }, { status: 500 });
  }
}
