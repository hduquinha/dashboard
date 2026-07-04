import { NextResponse } from "next/server";
import { assertAuthenticatedRequest, UnauthorizedError } from "@/lib/auth";
import { mergeInscricoes } from "@/lib/db";

export async function POST(request: Request) {
  try {
    assertAuthenticatedRequest(request);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }
    throw error;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Corpo invalido" }, { status: 400 });
  }

  const { primaryId, secondaryId, mergedPayload } = body as Record<string, unknown>;

  const pid = Number(primaryId);
  const sid = Number(secondaryId);

  if (!Number.isFinite(pid) || pid < 1 || !Number.isFinite(sid) || sid < 1) {
    return NextResponse.json({ error: "IDs invalidos" }, { status: 400 });
  }

  if (!mergedPayload || typeof mergedPayload !== "object" || Array.isArray(mergedPayload)) {
    return NextResponse.json({ error: "mergedPayload invalido" }, { status: 400 });
  }

  try {
    const inscricao = await mergeInscricoes(pid, sid, mergedPayload as Record<string, unknown>);
    return NextResponse.json({ inscricao });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Failed to merge inscricoes", error);
    return NextResponse.json({ error: "Erro ao mesclar leads" }, { status: 500 });
  }
}
