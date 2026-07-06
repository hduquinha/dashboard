import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { assertAuthenticatedRequest } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { describeLeadSource } from "@/lib/leadFields";
import { parsePayload } from "@/lib/parsePayload";

export const dynamic = "force-dynamic";

const SCHEMA_NAME = "inscricoes";
const MAX_LEADS_PER_POLL = 20;

export interface NewLeadNotificationItem {
  id: number;
  nome: string | null;
  /** Rótulo pronto de origem: nome do formulário, landing page, origem ou fonte. */
  origem: string | null;
  criadoEm: string;
}

/**
 * Feed de leads novos para as notificações do navegador. O cliente guarda o
 * maior id já visto e consulta `?afterId=<n>`; leads chegam ao Postgres por
 * várias vias (API, Meta sync, n8n), então o cursor por id no banco cobre
 * todas. Sem `afterId`, devolve só o cursor atual (baseline pós-login, sem
 * rajada de notificações antigas).
 */
export async function GET(request: NextRequest) {
  try {
    assertAuthenticatedRequest(request);
  } catch {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }

  try {
    const afterIdRaw = request.nextUrl.searchParams.get("afterId");
    const afterId = Number.parseInt(afterIdRaw ?? "", 10);

    if (!Number.isFinite(afterId) || afterId < 0) {
      const { rows } = await getPool().query<{ latest_id: number | string | null }>(
        `SELECT COALESCE(MAX(id), 0) AS latest_id FROM ${SCHEMA_NAME}.inscricoes`
      );
      return NextResponse.json({ latestId: Number(rows[0]?.latest_id ?? 0), leads: [] });
    }

    const { rows } = await getPool().query<{
      id: number;
      payload: Record<string, unknown> | null;
      criado_em: Date | string;
    }>(
      `
        SELECT id, payload, criado_em
        FROM ${SCHEMA_NAME}.inscricoes
        WHERE id > $1
        ORDER BY id DESC
        LIMIT $2
      `,
      [afterId, MAX_LEADS_PER_POLL]
    );

    let latestId = afterId;
    const leads: NewLeadNotificationItem[] = rows.map((row) => {
      latestId = Math.max(latestId, row.id);
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      const parsed = parsePayload(payload);
      const source = describeLeadSource(payload);
      const criadoEm =
        row.criado_em instanceof Date ? row.criado_em.toISOString() : String(row.criado_em ?? "");
      return {
        id: row.id,
        nome: typeof parsed.nome === "string" && parsed.nome.trim() ? parsed.nome.trim() : null,
        origem: source.formName ?? source.origem ?? source.paginaOrigem ?? source.fonte ?? null,
        criadoEm,
      };
    });

    return NextResponse.json({ latestId, leads });
  } catch (error) {
    console.error("Erro ao buscar leads novos para notificacao:", error);
    return NextResponse.json({ error: "Falha ao buscar leads novos." }, { status: 500 });
  }
}
