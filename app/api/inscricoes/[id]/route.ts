import { NextResponse } from "next/server";
import {
  assertAuthenticatedRequest,
  getRequestDashboardSession,
  UnauthorizedError,
} from "@/lib/auth";
import {
  deleteInscricao,
  getInscricaoById,
  updateInscricao,
  type UpdateInscricaoInput,
} from "@/lib/db";
import { maskInscricaoForUser } from "@/lib/leadPermissions";
import { hasPermission, type PermissionKey } from "@/lib/permissions";

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
  return trimmed.length > 0 ? trimmed : null;
}

async function resolveInscricaoId(context: RouteContext): Promise<number | null> {
  const resolvedParams = await Promise.resolve(context.params);
  const id = Number.parseInt(resolvedParams?.id ?? "", 10);

  if (!Number.isFinite(id) || id < 1) {
    return null;
  }

  return id;
}

function handleUnauthorized(error: unknown) {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }

  throw error;
}

function permissionForPayloadKey(key: string): PermissionKey {
  const normalized = key.trim().toLowerCase();
  if (["nome", "name", "dashboard_nome"].includes(normalized)) return "field.edit.identity";
  if (["telefone", "phone", "celular", "whatsapp", "dashboard_telefone"].includes(normalized)) return "field.edit.phone";
  if (["email", "e_mail"].includes(normalized)) return "field.edit.email";
  if (["cidade", "city", "estado", "state", "bairro", "endereco", "address"].includes(normalized)) return "field.edit.city";
  if (["profissao", "profissao_area", "profissaoarea", "cargo", "job", "job_title", "empresa", "company"].includes(normalized)) return "field.edit.profession";
  if (normalized.includes("treinamento") || normalized.includes("training") || normalized === "data_treinamento") return "field.edit.training";
  if (
    normalized.includes("origem") ||
    normalized.includes("source") ||
    normalized.includes("campaign") ||
    normalized.includes("utm") ||
    normalized.includes("indicacao") ||
    normalized.includes("recrutador")
  ) {
    return "field.edit.source";
  }
  return "field.edit.extra";
}

function forbiddenPermissionResponse(permission: PermissionKey) {
  return NextResponse.json(
    { error: `Sem permissao para alterar este campo (${permission}).` },
    { status: 403 }
  );
}

export async function GET(request: Request, context: RouteContext) {
  try {
    assertAuthenticatedRequest(request, {
      requireSameOriginForSession: false,
    });
  } catch (error) {
    return handleUnauthorized(error);
  }

  const id = await resolveInscricaoId(context);
  if (!id) {
    return NextResponse.json({ error: "ID invalido" }, { status: 400 });
  }

  try {
    const inscricao = await getInscricaoById(id);
    if (!inscricao) {
      return NextResponse.json({ error: "Inscricao nao encontrada" }, { status: 404 });
    }

    const session = getRequestDashboardSession(request);
    return NextResponse.json({ inscricao: maskInscricaoForUser(inscricao, session?.user ?? null) });
  } catch (error) {
    console.error("Failed to load inscricao", error);
    return NextResponse.json({ error: "Erro ao carregar inscricao" }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    assertAuthenticatedRequest(request);
  } catch (error) {
    return handleUnauthorized(error);
  }

  const session = getRequestDashboardSession(request);
  if (session && !hasPermission(session.user, "crm.edit_leads")) {
    return NextResponse.json({ error: "Sem permissao para editar leads." }, { status: 403 });
  }

  const id = await resolveInscricaoId(context);
  if (!id) {
    return NextResponse.json({ error: "ID invalido" }, { status: 400 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }

  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ error: "Corpo da requisicao invalido" }, { status: 400 });
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

    return NextResponse.json({ error: "Dados invalidos" }, { status: 400 });
  }

  const fieldPermissionChecks: Array<[boolean, PermissionKey]> = [
    [nome !== undefined, "field.edit.identity"],
    [telefone !== undefined, "field.edit.phone"],
    [cidade !== undefined, "field.edit.city"],
    [profissao !== undefined, "field.edit.profession"],
    [treinamento !== undefined, "field.edit.training"],
    [indicacao !== undefined, "field.edit.source"],
  ];
  for (const [touched, permission] of fieldPermissionChecks) {
    if (touched && session && !hasPermission(session.user, permission)) {
      return forbiddenPermissionResponse(permission);
    }
  }

  let payloadUpdates: Record<string, string | null> | undefined;
  if (record.payloadUpdates && typeof record.payloadUpdates === "object" && !Array.isArray(record.payloadUpdates)) {
    payloadUpdates = {};
    for (const [k, v] of Object.entries(record.payloadUpdates as Record<string, unknown>)) {
      const permission = permissionForPayloadKey(k);
      if (session && !hasPermission(session.user, permission)) {
        return forbiddenPermissionResponse(permission);
      }
      if (typeof v === "string") payloadUpdates[k] = v.trim() || null;
      else if (v === null) payloadUpdates[k] = null;
    }
  }

  const updates: UpdateInscricaoInput = {
    nome,
    telefone,
    cidade,
    profissao,
    treinamento,
    trafficSource: indicacao,
    payloadUpdates,
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
    return NextResponse.json({ inscricao: maskInscricaoForUser(inscricao, session?.user ?? null) });
  } catch (error) {
    if (error instanceof Error && /encontrad/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    console.error("Failed to update inscricao", error);
    return NextResponse.json({ error: "Erro ao atualizar inscricao" }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    assertAuthenticatedRequest(request);
  } catch (error) {
    return handleUnauthorized(error);
  }

  const session = getRequestDashboardSession(request);
  if (session && !hasPermission(session.user, "crm.delete_leads")) {
    return NextResponse.json({ error: "Sem permissao para excluir leads." }, { status: 403 });
  }

  const id = await resolveInscricaoId(context);
  if (!id) {
    return NextResponse.json({ error: "ID invalido" }, { status: 400 });
  }

  try {
    await deleteInscricao(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && /encontrad/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    console.error("Failed to delete inscricao", error);
    return NextResponse.json({ error: "Erro ao excluir inscricao" }, { status: 500 });
  }
}
