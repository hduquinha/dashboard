import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  assertAuthenticatedRequest,
  assertAuthorizationHeader,
  UnauthorizedError,
} from "@/lib/auth";
import { insertInscricao, listInscricoes } from "@/lib/db";
import { ttlCache } from "@/lib/serverCache";
import { LEAD_FIELD_CATALOG } from "@/lib/leadFields";
import type { InscricaoStatus, OrderDirection, OrderableField } from "@/types/inscricao";

const CREATABLE_FIELD_KEYS = new Set(LEAD_FIELD_CATALOG.map((f) => f.key));

interface RequestContext {
  authorization?: string | null;
  isAlreadyAuthorized?: boolean;
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

function parseStatus(value: string | null): InscricaoStatus | undefined {
  const allowed: InscricaoStatus[] = ["aguardando", "aprovado", "rejeitado"];
  return value && allowed.includes(value as InscricaoStatus) ? (value as InscricaoStatus) : undefined;
}

export async function handleInscricoesRequest({
  authorization,
  isAlreadyAuthorized,
  searchParams,
}: RequestContext) {
  try {
    if (!isAlreadyAuthorized) {
      assertAuthorizationHeader(authorization);
    }

    const page = parseNumber(searchParams.get("page"), 1);
    const pageSize = Math.min(parseNumber(searchParams.get("pageSize"), 10), 50);
    const orderBy = parseOrderField(searchParams.get("orderBy"));
    const orderDirection = parseDirection(searchParams.get("orderDirection"));
    const caracteristica = searchParams.get("q") ?? searchParams.get("caracteristica") ?? "";
    const nome = searchParams.get("nome") ?? "";
    const telefone = searchParams.get("telefone") ?? "";
    const cidade = searchParams.get("cidade") ?? "";
    const profissao = searchParams.get("profissao") ?? "";
    const indicacao = searchParams.get("indicacao") ?? "";
    const treinamento = searchParams.get("treinamento") ?? "";
    const dataTreinamento = searchParams.get("data_treinamento") ?? "";
    const tamanhoCamiseta = searchParams.get("tamanho_camiseta") ?? "";
    const status = parseStatus(searchParams.get("status"));
    const stars = searchParams.get("stars") ?? "";

    const queryKey = JSON.stringify({
      page,
      pageSize,
      orderBy,
      orderDirection,
      caracteristica,
      nome,
      telefone,
      cidade,
      profissao,
      indicacao,
      treinamento,
      dataTreinamento,
      tamanhoCamiseta,
      status,
      stars,
    });

    const result = await ttlCache(`dashboard:api:inscricoes:${queryKey}`, 5_000, () =>
      listInscricoes({
        page,
        pageSize,
        orderBy,
        orderDirection,
        filters: {
          caracteristica,
          nome,
          telefone,
          cidade,
          profissao,
          indicacao,
          treinamento,
          dataTreinamento,
          tamanhoCamiseta,
          status,
          stars,
        },
      })
    );

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
  try {
    assertAuthenticatedRequest(request, {
      requireSameOriginForSession: false,
    });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const context = {
    authorization: request.headers.get("authorization"),
    isAlreadyAuthorized: true,
    searchParams: new URL(request.url).searchParams,
  } satisfies RequestContext;

  const result = await handleInscricoesRequest(context);
  return NextResponse.json(result.body, { status: result.status });
}

export async function POST(request: NextRequest) {
  try {
    assertAuthenticatedRequest(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Corpo da requisição inválido" }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  const nome = typeof record.nome === "string" ? record.nome.trim() : "";
  if (!nome) {
    return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 });
  }

  const telefone = typeof record.telefone === "string" ? record.telefone.trim() : "";
  const produto = record.produto === "vozup" ? "vozup" : record.produto === "instituto" ? "instituto" : undefined;

  const fields: Record<string, string> = {};
  if (record.fields && typeof record.fields === "object" && !Array.isArray(record.fields)) {
    for (const [key, value] of Object.entries(record.fields as Record<string, unknown>)) {
      if (key === "nome" || key === "telefone") continue;
      if (!CREATABLE_FIELD_KEYS.has(key)) continue;
      if (typeof value !== "string") continue;
      const trimmed = value.trim();
      if (trimmed) fields[key] = trimmed;
    }
  }

  try {
    const { inscricao, merged } = await insertInscricao({
      nome,
      telefone: telefone || undefined,
      produto,
      fields,
    });
    return NextResponse.json({ inscricao, merged }, { status: 201 });
  } catch (error) {
    console.error("Failed to create inscricao", error);
    return NextResponse.json({ error: "Erro ao criar lead" }, { status: 500 });
  }
}
