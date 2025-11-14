import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { assertAuthorizationHeader, UnauthorizedError } from "@/lib/auth";
import { listInscricoes } from "@/lib/db";
import type { OrderDirection, OrderableField } from "@/types/inscricao";

interface RequestContext {
  authorization?: string | null;
  searchParams: URLSearchParams;
}

function parseNumber(value: string | null, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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

export async function handleInscricoesRequest({
  authorization,
  searchParams,
}: RequestContext) {
  try {
    assertAuthorizationHeader(authorization);

    const page = parseNumber(searchParams.get("page"), 1);
    const pageSize = Math.min(parseNumber(searchParams.get("pageSize"), 10), 50);
    const orderBy = parseOrderField(searchParams.get("orderBy"));
    const orderDirection = parseDirection(searchParams.get("orderDirection"));
    const nome = searchParams.get("nome") ?? "";
    const telefone = searchParams.get("telefone") ?? "";
    const indicacao = searchParams.get("indicacao") ?? "";
    const treinamento = searchParams.get("treinamento") ?? "";

    const result = await listInscricoes({
      page,
      pageSize,
      orderBy,
      orderDirection,
      filters: {
        nome,
        telefone,
        indicacao,
        treinamento,
      },
    });

    return {
      status: 200,
      body: result,
    } as const;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return {
        status: 401,
        body: { error: "Unauthorized" },
      } as const;
    }

    console.error("Failed to handle inscricoes request", error);
    return {
      status: 500,
      body: { error: "Erro ao carregar inscrições" },
    } as const;
  }
}

export async function GET(request: NextRequest) {
  const context = {
    authorization: request.headers.get("authorization"),
    searchParams: new URL(request.url).searchParams,
  } satisfies RequestContext;

  const result = await handleInscricoesRequest(context);
  return NextResponse.json(result.body, { status: result.status });
}
