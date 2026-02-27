import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { assertToken, UnauthorizedError } from "@/lib/auth";
import { listInscricoes } from "@/lib/db";
import { humanizeName } from "@/lib/utils";
import type { InscricaoItem, OrderableField, OrderDirection } from "@/types/inscricao";

const EXPORT_PAGE_SIZE = 500;
const CSV_HEADERS = [
  "id",
  "criado_em",
  "nome",
  "telefone",
  "cidade",
  "profissao",
  "treinamento_id",
  "treinamento_nome",
  "treinamento_data",
  "recrutador_codigo",
  "recrutador_nome",
  "tipo",
  "codigo_proprio",
  "nivel",
  "parent_inscricao_id",
  "is_virtual",
  "payload_json",
] as const;

interface ExportFilters {
  nome: string;
  telefone: string;
  indicacao: string;
  treinamento: string;
}

interface ExportOptions {
  orderBy: OrderableField;
  orderDirection: OrderDirection;
  filters: ExportFilters;
}

function sanitizeParam(value: string | null): string {
  return value?.trim() ?? "";
}

function parseOrderField(value: string | null): OrderableField {
  const allowed: OrderableField[] = [
    "id",
    "nome",
    "telefone",
    "cidade",
    "profissao",
    "treinamento",
    "recrutador",
    "criado_em",
  ];
  if (value && allowed.includes(value as OrderableField)) {
    return value as OrderableField;
  }
  return "criado_em";
}

function parseDirection(value: string | null): OrderDirection {
  return value === "asc" ? "asc" : "desc";
}

function escapeCsvValue(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  const raw = typeof value === "string" ? value : String(value);
  if (raw === "") {
    return raw;
  }
  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function buildCsvRow(item: InscricaoItem): string {
  const payloadJson = JSON.stringify(item.payload ?? {});
  const values: Array<string | number | boolean | null | undefined> = [
    item.id,
    item.criadoEm,
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
    payloadJson,
  ];

  return values.map((value) => escapeCsvValue(value)).join(",");
}

async function fetchAllInscricoes(options: ExportOptions): Promise<InscricaoItem[]> {
  const aggregated: InscricaoItem[] = [];
  let currentPage = 1;

  while (true) {
    const result = await listInscricoes({
      page: currentPage,
      pageSize: EXPORT_PAGE_SIZE,
      orderBy: options.orderBy,
      orderDirection: options.orderDirection,
      filters: options.filters,
    });

    aggregated.push(...result.data);

    if (aggregated.length >= result.total || result.data.length === 0) {
      break;
    }

    currentPage += 1;
  }

  return aggregated;
}

function buildFilename(): string {
  const iso = new Date().toISOString().replace(/[:.]/g, "-");
  return `inscricoes-${iso}.csv`;
}

export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("dashboardToken")?.value;
    assertToken(token);

    const url = new URL(request.url);
    const searchParams = url.searchParams;

    const filters: ExportFilters = {
      nome: sanitizeParam(searchParams.get("nome")),
      telefone: sanitizeParam(searchParams.get("telefone")),
      indicacao: sanitizeParam(searchParams.get("indicacao")),
      treinamento: sanitizeParam(searchParams.get("treinamento")),
    };

    const options: ExportOptions = {
      orderBy: parseOrderField(searchParams.get("orderBy")),
      orderDirection: parseDirection(searchParams.get("orderDirection")),
      filters,
    };

    const records = await fetchAllInscricoes(options);
    const lines = [CSV_HEADERS.join(","), ...records.map((record) => buildCsvRow(record))];
    const csvContent = lines.join("\r\n");
    const filename = buildFilename();

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("Failed to export inscrições", error);
    return NextResponse.json({ error: "Erro ao exportar inscrições" }, { status: 500 });
  }
}
