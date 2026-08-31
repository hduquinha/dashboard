import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { listEnrollmentClassTags } from "@/lib/academicClasses";

export const dynamic = "force-dynamic";

/**
 * Etiqueta "em que turma este matriculado está", consumida pela tela de Matrículas.
 *
 * Rota separada da de matrículas de propósito: a Gestão Financeira não pode passar a
 * depender do schema acadêmico para listar contrato (ver `listEnrollmentClassTags`).
 * Se esta rota falhar, a tela perde a etiqueta e continua mostrando o dinheiro.
 */
export async function GET() {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  if (!hasPermission(session.user, "view.finance") && !hasPermission(session.user, "view.classes")) {
    return NextResponse.json({ error: "Sem permissao para ver turmas." }, { status: 403 });
  }

  try {
    return NextResponse.json({ tags: await listEnrollmentClassTags() });
  } catch {
    return NextResponse.json({ tags: [] });
  }
}
