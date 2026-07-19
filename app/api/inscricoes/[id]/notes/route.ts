import { NextResponse } from "next/server";
import {
  assertAuthenticatedRequest,
  getRequestDashboardSession,
  UnauthorizedError,
} from "@/lib/auth";
import { addInscricaoNote } from "@/lib/db";
import { logLeadTimelineEvent } from "@/lib/commercial";
import { maskInscricaoForUser } from "@/lib/leadPermissions";
import { hasPermission } from "@/lib/permissions";

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

export async function POST(request: Request, context: RouteContext) {
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
  const content = typeof record.content === "string" ? record.content : null;
  if (!content || content.trim().length === 0) {
    return NextResponse.json({ error: "A anotacao nao pode estar vazia." }, { status: 400 });
  }

  const viaWhatsapp = typeof record.viaWhatsapp === "boolean" ? record.viaWhatsapp : undefined;
  const session = getRequestDashboardSession(request);
  if (session && !hasPermission(session.user, "crm.manage_notes")) {
    return NextResponse.json({ error: "Sem permissao para criar observacoes." }, { status: 403 });
  }
  const author =
    session?.user.name || session?.user.email || null;

  try {
    const inscricao = await addInscricaoNote(id, content, { viaWhatsapp, author });

    // Auditoria: observação interna também aparece na linha do tempo do lead.
    await logLeadTimelineEvent(session?.user ?? null, id, "lead_note_added", {
      content: content.trim().slice(0, 2000),
      viaWhatsapp: viaWhatsapp ?? false,
    });

    return NextResponse.json({ inscricao: maskInscricaoForUser(inscricao, session?.user ?? null) });
  } catch (error) {
    if (error instanceof Error && /encontrad/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    console.error("Failed to add note", error);
    return NextResponse.json({ error: "Erro ao adicionar anotacao" }, { status: 500 });
  }
}
