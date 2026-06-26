import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { assertAuthenticatedRequest, UnauthorizedError } from "@/lib/auth";
import { listInscricoes } from "@/lib/db";
import { UP_DAY_CSV_COLUMNS } from "@/lib/inscricaoForm";
import { humanizeName } from "@/lib/utils";
import type { InscricaoItem, InscricaoStatus, OrderableField, OrderDirection } from "@/types/inscricao";

const EXPORT_PAGE_SIZE = 500;

const CSV_HEADERS = [
  "id",
  "criado_em",
  ...UP_DAY_CSV_COLUMNS.map((column) => column.header),
  "pagamento_info_visualizada",
  "dashboard_nome",
  "dashboard_telefone",
  "dashboard_cidade",
  "dashboard_profissao",
  "dashboard_treinamento_id",
  "dashboard_treinamento_nome",
  "dashboard_treinamento_data",
  "recrutador_codigo",
  "recrutador_nome",
  "tipo",
  "codigo_proprio",
  "nivel",
  "parent_inscricao_id",
  "is_virtual",
  "dashboard_status",
  "dashboard_stars",
  "etapa_comercial",
  "vendedor_email",
  "payload_json",
] as const;

type PresencaFilter = "aprovada" | "reprovada" | "validada" | "nao-validada";

function sanitize(value: string | null): string {
  return value?.trim() ?? "";
}

function parseOrderField(value: string | null): OrderableField {
  const allowed: OrderableField[] = ["id", "nome", "telefone", "cidade", "profissao", "treinamento", "recrutador", "criado_em"];
  return (value && allowed.includes(value as OrderableField)) ? value as OrderableField : "criado_em";
}

function parseDirection(value: string | null): OrderDirection {
  return value === "asc" ? "asc" : "desc";
}

function parseStatus(value: string | null): InscricaoStatus | undefined {
  const allowed: InscricaoStatus[] = ["aguardando", "aprovado", "rejeitado"];
  return (value && allowed.includes(value as InscricaoStatus)) ? value as InscricaoStatus : undefined;
}

function parsePresenca(value: string | null): PresencaFilter | undefined {
  const allowed: PresencaFilter[] = ["aprovada", "reprovada", "validada", "nao-validada"];
  return (value && allowed.includes(value as PresencaFilter)) ? value as PresencaFilter : undefined;
}

function escapeCsvValue(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  const raw = typeof value === "string" ? value : String(value);
  if (raw === "") return raw;
  if (/[",\n\r]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
  return raw;
}

function buildCsvRow(item: InscricaoItem): string {
  const payloadJson = JSON.stringify(item.payload ?? {});
  const upDayValues = UP_DAY_CSV_COLUMNS.map((column) => item.upDay?.[column.key] ?? null);
  const values: Array<string | number | boolean | null | undefined> = [
    item.id,
    item.criadoEm,
    ...upDayValues,
    item.upDay?.pagamentoInfoVisualizada ?? null,
    item.nome,
    item.telefone,
    item.cidade,
    item.profissao,
    item.treinamentoId,
    item.treinamentoNome,
    item.treinamentoData,
    item.recrutadorCodigo,
    humanizeName(item.recrutadorNome) ?? item.recrutadorNome,
    item.tipo,
    item.codigoProprio,
    typeof item.nivel === "number" ? item.nivel : null,
    item.parentInscricaoId,
    typeof item.isVirtual === "boolean" ? item.isVirtual : null,
    item.status ?? null,
    typeof item.stars === "number" ? item.stars : null,
    item.commercial?.stage ?? null,
    item.commercial?.assignedSellerEmail ?? null,
    payloadJson,
  ];
  return values.map(escapeCsvValue).join(",");
}

async function fetchAll(opts: Parameters<typeof listInscricoes>[0]): Promise<InscricaoItem[]> {
  const aggregated: InscricaoItem[] = [];
  let currentPage = 1;
  while (true) {
    const result = await listInscricoes({ ...opts, page: currentPage, pageSize: EXPORT_PAGE_SIZE });
    aggregated.push(...result.data);
    if (aggregated.length >= result.total || result.data.length === 0) break;
    currentPage += 1;
  }
  return aggregated;
}

function buildFilename(prefix = "inscricoes"): string {
  const iso = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `${prefix}-${iso}.csv`;
}

export async function GET(request: NextRequest) {
  try {
    assertAuthenticatedRequest(request, { requireSameOriginForSession: false });
  } catch (error) {
    if (error instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    throw error;
  }

  try {
    const sp = new URL(request.url).searchParams;

    // Multi-select training IDs (comma-separated)
    const treinamentosRaw = sanitize(sp.get("treinamentos"));
    const treinamentoIds = treinamentosRaw ? treinamentosRaw.split(",").filter(Boolean) : undefined;
    const treinamento = sanitize(sp.get("treinamento")) || undefined;

    const records = await fetchAll({
      orderBy: parseOrderField(sp.get("orderBy")),
      orderDirection: parseDirection(sp.get("orderDirection")),
      filters: {
        caracteristica: sanitize(sp.get("q")) || undefined,
        nome: sanitize(sp.get("nome")) || undefined,
        telefone: sanitize(sp.get("telefone")) || undefined,
        cidade: sanitize(sp.get("cidade")) || undefined,
        profissao: sanitize(sp.get("profissao")) || undefined,
        indicacao: sanitize(sp.get("indicacao")) || undefined,
        treinamento,
        treinamentoIds: !treinamento && treinamentoIds?.length ? treinamentoIds : undefined,
        dataTreinamento: sanitize(sp.get("data_treinamento")) || undefined,
        tamanhoCamiseta: sanitize(sp.get("tamanho_camiseta")) || undefined,
        status: parseStatus(sp.get("status")),
        presenca: parsePresenca(sp.get("presenca")),
        stars: sanitize(sp.get("stars")) || undefined,
        campaignSource: sanitize(sp.get("campaignSource")) || undefined,
        campaignName: sanitize(sp.get("campaignName")) || undefined,
      },
    });

    const source = sp.get("source") ?? "inscricoes";
    const lines = [CSV_HEADERS.join(","), ...records.map(buildCsvRow)];

    return new NextResponse(lines.join("\r\n"), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${buildFilename(source)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Failed to export inscrições", error);
    return NextResponse.json({ error: "Erro ao exportar inscrições" }, { status: 500 });
  }
}
