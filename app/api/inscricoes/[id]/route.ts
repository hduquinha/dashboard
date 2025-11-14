import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { assertToken } from "@/lib/auth";
import { deleteInscricao, updateInscricao, type UpdateInscricaoInput } from "@/lib/db";

type RouteParams = {
  id: string;
};

type RouteContext = {
  params: RouteParams | Promise<RouteParams>;
};

function parseOptionalString(field: string, value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`O campo "${field}" precisa ser uma string.`);
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return trimmed;
}

async function resolveInscricaoId(context: RouteContext): Promise<number | null> {
  const resolvedParams = await Promise.resolve(context.params);
  const idRaw = resolvedParams?.id;
  const id = Number.parseInt(idRaw ?? "", 10);
  if (!Number.isFinite(id) || id < 1) {
    return null;
  }
  return id;
}

async function ensureAuthorizedToken(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("dashboardToken")?.value;

  try {
    assertToken(token);
  } catch {
    return null;
  }

  return token ?? null;
}

export async function PATCH(request: Request, context: RouteContext) {
  if (!(await ensureAuthorizedToken())) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const id = await resolveInscricaoId(context);
  if (!id) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ error: "Corpo da requisição inválido" }, { status: 400 });
  }

  const record = payload as Record<string, unknown>;

  let nome: string | null | undefined;
  let telefone: string | null | undefined;
  let cidade: string | null | undefined;
  let profissao: string | null | undefined;
  let indicacao: string | null | undefined;
  let treinamento: string | null | undefined;

  try {
    nome = parseOptionalString("nome", record.nome);
    telefone = parseOptionalString("telefone", record.telefone);
    cidade = parseOptionalString("cidade", record.cidade);
    profissao = parseOptionalString("profissao", record.profissao);
    indicacao = parseOptionalString("indicacao", record.indicacao ?? record.traffic_source);
    treinamento = parseOptionalString(
      "treinamento",
      record.treinamento ??
        record.training ??
        record.training_id ??
        record.trainingId ??
        record.training_code ??
        record.trainingCode
    );
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  }

  const updates: UpdateInscricaoInput = {
    nome,
    telefone,
    cidade,
    profissao,
    treinamento,
    trafficSource: indicacao,
  };

  const hasUpdates = Object.values(updates).some((value) => value !== undefined);

  if (!hasUpdates) {
    return NextResponse.json(
      { error: "Informe ao menos um campo para atualizar" },
      { status: 400 }
    );
  }

  try {
    const inscricao = await updateInscricao(id, updates);
    return NextResponse.json({ inscricao });
  } catch (error) {
    if (error instanceof Error && error.message.includes("não encontrada")) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    console.error("Failed to update inscrição", error);
    return NextResponse.json({ error: "Erro ao atualizar inscrição" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  if (!(await ensureAuthorizedToken())) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const id = await resolveInscricaoId(context);
  if (!id) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  try {
    await deleteInscricao(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message.includes("não encontrada")) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    console.error("Failed to delete inscrição", error);
    return NextResponse.json({ error: "Erro ao excluir inscrição" }, { status: 500 });
  }
}
