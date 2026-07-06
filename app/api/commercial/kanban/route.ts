import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { listInscricoes } from "@/lib/db";
import { canUseKanbanFilter, getKanbanFilter, type KanbanFilterCriteria } from "@/lib/kanbanFilters";
import { isProductivityManager } from "@/lib/productivity";
import type { CommercialStage } from "@/types/inscricao";

export const dynamic = "force-dynamic";

const ACTIVE_STAGES: CommercialStage[] = [
  "novo",
  "primeiro_contato",
  "em_atendimento",
  "agendado",
  "fechamento",
  "no_show",
  "ganho",
  "perdido",
];

// Alto o suficiente pra carregar a coluna inteira de uma vez: o
// drag-and-drop precisa ver todos os cards pra reordenar corretamente,
// nao so uma pagina. O indice (commercial_stage, position) mantem isso barato.
const PAGE_SIZE = 200;

function parseStages(value: string | null): CommercialStage[] {
  if (!value) return ACTIVE_STAGES;
  const requested = value
    .split(",")
    .map((stage) => stage.trim())
    .filter((stage): stage is CommercialStage => ACTIVE_STAGES.includes(stage as CommercialStage));
  return requested.length > 0 ? requested : ACTIVE_STAGES;
}

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const produto = searchParams.get("produto") as "vozup" | "instituto" | null;
  const stages = parseStages(searchParams.get("stages"));
  // Kanban da equipe: so leads com responsavel — os sem responsavel vivem
  // na Chegada de Leads, mesmo estando na etapa "novo".
  const assignedOnly = searchParams.get("assignedOnly") === "1";
  const isManager = isProductivityManager(session.user);
  const assignedSellerEmail = isManager
    ? (searchParams.get("assignedSellerEmail") ?? undefined)
    : session.user.email;

  // Filtro salvo (criado pelo admin): restringe quais leads aparecem.
  // Vendedor comum so pode usar filtros atribuidos a ele.
  let filterCriteria: KanbanFilterCriteria = {};
  const filterIdRaw = Number.parseInt(searchParams.get("filterId") ?? "", 10);
  if (Number.isFinite(filterIdRaw) && filterIdRaw > 0) {
    const filter = await getKanbanFilter(filterIdRaw);
    if (!filter) {
      return NextResponse.json({ error: "Filtro nao encontrado" }, { status: 404 });
    }
    if (!canUseKanbanFilter(session.user, filter)) {
      return NextResponse.json({ error: "Sem acesso a este filtro" }, { status: 403 });
    }
    filterCriteria = filter.criteria;
  }

  const results = await Promise.all(
    stages.map((stage) =>
      listInscricoes({
        page: 1,
        pageSize: PAGE_SIZE,
        orderBy: "commercial_position",
        orderDirection: "asc",
        filters: {
          commercialStage: stage,
          produto: filterCriteria.produto ?? produto ?? undefined,
          assignedSellerEmail: assignedSellerEmail || undefined,
          assignedOnly: assignedOnly || undefined,
          treinamentoIds:
            filterCriteria.treinamentoIds && filterCriteria.treinamentoIds.length > 0
              ? filterCriteria.treinamentoIds
              : undefined,
          campaignSource: filterCriteria.campaignSource,
          campaignName: filterCriteria.campaignName,
          caracteristica: filterCriteria.caracteristica,
        },
      }).then((r) => ({ stage, leads: r.data, total: r.total }))
    )
  );

  const stagesPayload = Object.fromEntries(
    results.map(({ stage, leads, total }) => [stage, { leads, total }])
  );

  return NextResponse.json({ success: true, stages: stagesPayload });
}
