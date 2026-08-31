import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { listCouponUses } from "@/lib/coupons";

export const dynamic = "force-dynamic";

/**
 * Quem usou um cupom. A busca é pelo CÓDIGO, não pelo id do cadastro: as
 * cortesias ficam registradas no payload do lead, então códigos que ainda nem
 * foram cadastrados aqui (os que vieram da variável de ambiente) também
 * conseguem mostrar a lista de quem entrou por eles.
 */
export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }
  if (!hasPermission(session.user, "view.coupons")) {
    return NextResponse.json({ error: "Sem permissao para ver cupons." }, { status: 403 });
  }

  const code = new URL(request.url).searchParams.get("code") ?? "";
  const uses = await listCouponUses(code);
  return NextResponse.json({ uses });
}
