import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { assertToken } from "@/lib/auth";
import { setInscricaoStatus } from "@/lib/db";
import type { InscricaoStatus } from "@/types/inscricao";

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

function parseStatus(value: unknown): InscricaoStatus | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "aguardando" || normalized === "aprovado" || normalized === "rejeitado") {
    return normalized;
  }
  return null;
}

export async function PATCH(request: Request, context: RouteContext) {
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
  const status = parseStatus(record.status);
  if (!status) {
    return NextResponse.json({ error: "Status inválido" }, { status: 400 });
  }

  const whatsappContacted =
    typeof record.whatsappContacted === "boolean" ? record.whatsappContacted : undefined;
  const note = typeof record.note === "string" ? record.note : undefined;

  try {
    const inscricao = await setInscricaoStatus(id, status, {
      whatsappContacted,
      note,
    });
    return NextResponse.json({ inscricao });
  } catch (error) {
    if (error instanceof Error && error.message.includes("não encontrada")) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    console.error("Failed to update status", error);
    return NextResponse.json({ error: "Erro ao atualizar status" }, { status: 500 });
  }
}
