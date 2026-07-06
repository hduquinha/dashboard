import { NextResponse } from "next/server";
import {
  assertAuthenticatedRequest,
  getRequestDashboardSession,
  UnauthorizedError,
} from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { addLeadVinculo, listLeadVinculos } from "@/lib/vozupFolders";

type RouteParams = { id: string };
type RouteContext = { params: RouteParams | Promise<RouteParams> };

async function resolveLeadId(context: RouteContext): Promise<number | null> {
  const resolved = await Promise.resolve(context.params);
  const id = Number.parseInt(resolved?.id ?? "", 10);
  return Number.isFinite(id) && id >= 1 ? id : null;
}

function handleUnauthorized(error: unknown) {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }
  throw error;
}

/** Vínculos (pastas/blocos) do lead — eventos próprios + satélites mesclados. */
export async function GET(request: Request, context: RouteContext) {
  try {
    assertAuthenticatedRequest(request, { requireSameOriginForSession: false });
  } catch (error) {
    return handleUnauthorized(error);
  }

  const session = getRequestDashboardSession(request);
  if (session && !hasPermission(session.user, "crm.manage_links")) {
    return NextResponse.json({ error: "Sem permissao para gerenciar vinculos." }, { status: 403 });
  }

  const leadId = await resolveLeadId(context);
  if (!leadId) return NextResponse.json({ error: "Id inválido" }, { status: 400 });

  try {
    const vinculos = await listLeadVinculos(leadId);
    return NextResponse.json({ vinculos });
  } catch (error) {
    console.error("Erro ao listar vínculos:", error);
    return NextResponse.json({ error: "Erro ao listar vínculos" }, { status: 500 });
  }
}

/** Adiciona um vínculo ({ pasta, bloco }) ao lead. */
export async function POST(request: Request, context: RouteContext) {
  try {
    assertAuthenticatedRequest(request, { requireSameOriginForSession: false });
  } catch (error) {
    return handleUnauthorized(error);
  }

  const session = getRequestDashboardSession(request);
  if (session && !hasPermission(session.user, "crm.manage_links")) {
    return NextResponse.json({ error: "Sem permissao para gerenciar vinculos." }, { status: 403 });
  }

  const leadId = await resolveLeadId(context);
  if (!leadId) return NextResponse.json({ error: "Id inválido" }, { status: 400 });

  const body = (await request.json().catch(() => null)) as { pasta?: unknown; bloco?: unknown } | null;
  const pasta = typeof body?.pasta === "string" ? body.pasta.trim() : "";
  const bloco = typeof body?.bloco === "string" ? body.bloco.trim() : "";
  if (!pasta || !bloco) {
    return NextResponse.json({ error: "Informe pasta e bloco do vínculo" }, { status: 400 });
  }

  try {
    await addLeadVinculo(leadId, pasta, bloco);
    const vinculos = await listLeadVinculos(leadId);
    return NextResponse.json({ vinculos });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao adicionar vínculo";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
