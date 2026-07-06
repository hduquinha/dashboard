import { NextResponse } from "next/server";
import {
  assertAuthenticatedRequest,
  getRequestDashboardSession,
  UnauthorizedError,
} from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { listLeadVinculos, removeLeadVinculo, replaceLeadVinculo } from "@/lib/vozupFolders";

type RouteParams = { id: string; eventId: string };
type RouteContext = { params: RouteParams | Promise<RouteParams> };

async function resolveIds(
  context: RouteContext
): Promise<{ leadId: number; eventId: number } | null> {
  const resolved = await Promise.resolve(context.params);
  const leadId = Number.parseInt(resolved?.id ?? "", 10);
  const eventId = Number.parseInt(resolved?.eventId ?? "", 10);
  if (!Number.isFinite(leadId) || leadId < 1) return null;
  if (!Number.isFinite(eventId) || eventId < 1) return null;
  return { leadId, eventId };
}

function handleUnauthorized(error: unknown) {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }
  throw error;
}

/** Troca o vínculo por outro ({ pasta, bloco }) — ex.: Experimental → Exclusiva. */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    assertAuthenticatedRequest(request, { requireSameOriginForSession: false });
  } catch (error) {
    return handleUnauthorized(error);
  }

  const session = getRequestDashboardSession(request);
  if (session && !hasPermission(session.user, "crm.manage_links")) {
    return NextResponse.json({ error: "Sem permissao para gerenciar vinculos." }, { status: 403 });
  }

  const ids = await resolveIds(context);
  if (!ids) return NextResponse.json({ error: "Id inválido" }, { status: 400 });

  const body = (await request.json().catch(() => null)) as { pasta?: unknown; bloco?: unknown } | null;
  const pasta = typeof body?.pasta === "string" ? body.pasta.trim() : "";
  const bloco = typeof body?.bloco === "string" ? body.bloco.trim() : "";
  if (!pasta || !bloco) {
    return NextResponse.json({ error: "Informe pasta e bloco do vínculo" }, { status: 400 });
  }

  try {
    await replaceLeadVinculo(ids.leadId, ids.eventId, pasta, bloco);
    const vinculos = await listLeadVinculos(ids.leadId);
    return NextResponse.json({ vinculos });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao trocar vínculo";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** Remove o vínculo do lead (o cadastro do lead permanece). */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    assertAuthenticatedRequest(request, { requireSameOriginForSession: false });
  } catch (error) {
    return handleUnauthorized(error);
  }

  const session = getRequestDashboardSession(request);
  if (session && !hasPermission(session.user, "crm.manage_links")) {
    return NextResponse.json({ error: "Sem permissao para gerenciar vinculos." }, { status: 403 });
  }

  const ids = await resolveIds(context);
  if (!ids) return NextResponse.json({ error: "Id inválido" }, { status: 400 });

  try {
    await removeLeadVinculo(ids.leadId, ids.eventId);
    const vinculos = await listLeadVinculos(ids.leadId);
    return NextResponse.json({ vinculos });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao remover vínculo";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
