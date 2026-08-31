import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { listSellerStatuses, setSellerStatus } from "@/lib/sellerStatus";

export const dynamic = "force-dynamic";

/** Status de todos — o Kanban e a Chegada de Leads leem daqui. */
export async function GET() {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const statuses = await listSellerStatuses();
  // `mine` evita que o botão do Kanban precise saber o próprio id: quem sabe
  // quem está logado é o servidor.
  const mine = statuses.get(session.user.id) ?? {
    memberId: session.user.id,
    status: "offline" as const,
    note: null,
    updatedAt: null,
  };
  return NextResponse.json({ statuses: [...statuses.values()], mine });
}

/**
 * Troca o próprio status. Não aceita `memberId` no corpo de propósito: o alvo
 * é sempre quem está logado, então nenhum usuário consegue declarar
 * disponibilidade por outro.
 */
export async function PUT(request: Request) {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const status = body.status === "online" ? "online" : "offline";
    const note = typeof body.note === "string" ? body.note : null;

    const saved = await setSellerStatus(session.user.id, status, note);
    return NextResponse.json({ status: saved });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao salvar o status." },
      { status: 400 }
    );
  }
}
