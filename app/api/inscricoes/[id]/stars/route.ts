import { NextResponse } from "next/server";
import { assertAuthenticatedRequest, UnauthorizedError } from "@/lib/auth";
import { setInscricaoStars } from "@/lib/db";

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
  const rawStars = record.stars;

  let stars: number | null;
  if (rawStars === null || rawStars === 0) {
    stars = null;
  } else if (
    typeof rawStars === "number" &&
    Number.isInteger(rawStars) &&
    rawStars >= 1 &&
    rawStars <= 5
  ) {
    stars = rawStars;
  } else {
    return NextResponse.json(
      { error: "stars deve ser um numero entre 1 e 5 (ou null para remover)" },
      { status: 400 }
    );
  }

  try {
    const inscricao = await setInscricaoStars(id, stars);
    return NextResponse.json({ inscricao });
  } catch (error) {
    if (error instanceof Error && /encontrad/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    console.error("Failed to update stars", error);
    return NextResponse.json({ error: "Erro ao atualizar avaliacao" }, { status: 500 });
  }
}
