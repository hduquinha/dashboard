import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { listInscricoes } from "@/lib/db";
import { getContractProfileForLead } from "@/lib/academicStudents";

export const dynamic = "force-dynamic";

/**
 * Busca de lead para preencher o quadro de outra pessoa no contrato.
 *
 * A segunda pessoa de um contrato de casal quase sempre **já é um lead** — foi
 * ela que preencheu um formulário, ou o vendedor a cadastrou. Redigitar CPF,
 * endereço e e-mail de quem o CRM já conhece é retrabalho e fonte de divergência
 * entre a ficha e o contrato; pior, cria uma segunda pessoa sem ligação com o
 * card dela.
 *
 * `?q=` devolve a lista curta para escolher; `?id=` devolve o quadro do
 * contrato já montado daquele lead (mesma função que preenche o do pagador).
 * A permissão é a de registrar venda: quem pode fechar já vê a ficha inteira.
 */
async function requireSaleAccess() {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (!session) {
    return { error: NextResponse.json({ error: "Nao autorizado" }, { status: 401 }) };
  }
  if (!hasPermission(session.user, "crm.register_sale")) {
    return {
      error: NextResponse.json({ error: "Sem permissao para registrar vendas." }, { status: 403 }),
    };
  }
  return { error: null };
}

export async function GET(request: Request) {
  const auth = await requireSaleAccess();
  if (auth.error) return auth.error;

  const params = new URL(request.url).searchParams;

  const id = Number(params.get("id"));
  if (Number.isFinite(id) && id > 0) {
    return NextResponse.json({ profile: await getContractProfileForLead(id) });
  }

  const term = (params.get("q") ?? "").trim();
  if (term.length < 3) return NextResponse.json({ leads: [] });

  const { data } = await listInscricoes({
    page: 1,
    pageSize: 8,
    filters: { caracteristica: term },
  });

  return NextResponse.json({
    leads: data.map((item) => ({
      id: item.id,
      nome: item.nome,
      telefone: item.telefone,
      cidade: item.cidade,
    })),
  });
}
