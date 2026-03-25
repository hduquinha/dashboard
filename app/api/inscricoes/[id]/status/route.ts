import { NextResponse } from "next/server";
import { assertAuthenticatedRequest, UnauthorizedError } from "@/lib/auth";
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
  try {
    assertAuthenticatedRequest(request);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    throw error;
  }

  const id = await resolveInscricaoId(context);
  if (!id) {
    return NextResponse.json({ error: "ID invalido" }, { status: 400 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }

  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ error: "Corpo invalido" }, { status: 400 });
  }

  const record = payload as Record<string, unknown>;
  const status = parseStatus(record.status);
  if (!status) {
    return NextResponse.json({ error: "Status invalido" }, { status: 400 });
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
    if (error instanceof Error && /encontrad/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    console.error("Failed to update status", error);
    return NextResponse.json({ error: "Erro ao atualizar status" }, { status: 500 });
  }
}
