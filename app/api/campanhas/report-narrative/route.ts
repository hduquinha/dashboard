import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DASHBOARD_COOKIE_NAME, getDashboardSession, isValidAccessToken } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { generateReportNarrative, hasNarrativeConfig } from "@/lib/reportNarrative";
import { getReportSegments } from "@/lib/reportSegments";
import { loadCampaignReport } from "@/lib/monthlyReportData";
import { getGoogleAdsReport } from "@/lib/googleAdsReport";

/**
 * Gera a análise escrita do relatório sob demanda.
 *
 * Por que rota separada e não na renderização da página: a geração leva ~70s.
 * Pendurar isso no carregamento da aba faria o relatório inteiro parecer
 * quebrado enquanto espera. Aqui o usuário clica, vê o estado de carregando e
 * o resto da tela já está utilizável.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isoDate(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getDashboardSession(cookieStore.get(DASHBOARD_COOKIE_NAME)?.value);
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const authorized = session
    ? hasPermission(session.user, "view.campaigns")
    : isValidAccessToken(bearer);
  if (!authorized) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  if (!hasNarrativeConfig()) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY não configurada — o relatório segue sem a análise escrita." },
      { status: 503 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const from = isoDate(body.from);
  const to = isoDate(body.to);
  const periodLabel = typeof body.periodLabel === "string" ? body.periodLabel.slice(0, 120) : "";
  if (!from || !to) {
    return NextResponse.json({ error: "Informe from e to no formato AAAA-MM-DD." }, { status: 400 });
  }

  try {
    // O relatório INTEIRO vai para a análise: investimento, escada de custo,
    // destinos, públicos, criativos, engajamento, horários, vendedores e
    // pontos cegos. A primeira versão mandava só quatro números de mídia e o
    // funil por origem — a análise saía sem falar de criativo, público ou
    // tema, porque nunca tinha visto nenhum dos três.
    const [report, segments, google] = await Promise.all([
      loadCampaignReport({
        filters: { from, to, status: "all" },
        purposeFilter: "todas",
        campaignIds: [],
        adsetId: null,
        ticketMedio: null,
        saleStageKey: null,
        includeFinance: true,
      }),
      getReportSegments(from, to),
      getGoogleAdsReport(from, to).catch(() => null),
    ]);

    const narrative = await generateReportNarrative(
      {
        periodo: { de: from, ate: to },
        meta: report,
        google: google && google.hasData ? { totais: google.totals, campanhas: google.campaigns } : null,
        funilPorOrigem: segments.rows,
        totaisFunil: segments.totals,
        vinculoReceita: segments.revenueLink,
        triagem: segments.triagem,
      },
      { periodLabel: periodLabel || `${from} a ${to}` }
    );

    if (!narrative) {
      return NextResponse.json({ error: "A geração não retornou análise. Tente de novo." }, { status: 502 });
    }
    return NextResponse.json({ narrative, segments });
  } catch (error) {
    console.error("[report-narrative] erro na rota:", error);
    return NextResponse.json({ error: "Falha ao gerar a análise." }, { status: 500 });
  }
}
