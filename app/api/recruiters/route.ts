import { NextResponse } from "next/server";
import { assertAuthenticatedRequest } from "@/lib/auth";
import {
  createRecruiterInscricao,
  findInscricaoIdByOwnCode,
  updateInscricao,
  type CreateRecruiterInscricaoInput,
  type UpdateInscricaoInput,
} from "@/lib/db";
import { normalizeRecruiterCode } from "@/lib/recruiters";

function parseOptionalString(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error("O valor precisa ser uma string");
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseOptionalNumber(value: unknown): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  throw new Error("Valor numerico invalido");
}

export async function POST(request: Request) {
  try {
    assertAuthenticatedRequest(request);
  } catch {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }

  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ error: "Dados invalidos" }, { status: 400 });
  }

  const record = payload as Record<string, unknown>;
  const modeRaw = typeof record.mode === "string" ? record.mode.trim().toLowerCase() : "create";
  const mode = modeRaw === "link" ? "link" : "create";

  let code = parseOptionalString(record.code);
  if (!code) {
    return NextResponse.json({ error: "O codigo do recrutador e obrigatorio" }, { status: 400 });
  }

  const normalizedCode = normalizeRecruiterCode(code);
  if (!normalizedCode) {
    return NextResponse.json({ error: "Codigo invalido" }, { status: 400 });
  }
  code = normalizedCode;

  const parentCodeRaw = parseOptionalString(record.parentCode);
  const parentCode = parentCodeRaw ? normalizeRecruiterCode(parentCodeRaw) ?? parentCodeRaw : null;
  const parentInscricaoId = parseOptionalNumber(record.parentInscricaoId);
  const nivel = parseOptionalNumber(record.nivel);

  try {
    if (mode === "link") {
      const inscricaoIdRaw = parseOptionalNumber(record.existingInscricaoId);
      if (inscricaoIdRaw === undefined || inscricaoIdRaw === null) {
        return NextResponse.json(
          { error: "Informe o ID da inscricao a ser promovida" },
          { status: 400 }
        );
      }

      const conflictId = await findInscricaoIdByOwnCode(code);
      if (conflictId && conflictId !== inscricaoIdRaw) {
        return NextResponse.json(
          { error: "Codigo ja esta associado a outro recrutador" },
          { status: 409 }
        );
      }

      const updates: UpdateInscricaoInput = {
        codigoProprio: code,
        tipo: "recrutador",
      };

      const nome = parseOptionalString(record.name);
      if (nome !== undefined) {
        updates.nome = nome;
      }

      const telefone = parseOptionalString(record.telefone);
      if (telefone !== undefined) {
        updates.telefone = telefone;
      }

      const cidade = parseOptionalString(record.cidade);
      if (cidade !== undefined) {
        updates.cidade = cidade;
      }

      if (parentCode !== undefined) {
        updates.trafficSource = parentCode;
      }

      if (parentInscricaoId !== undefined) {
        updates.parentInscricaoId = parentInscricaoId;
      }

      if (nivel !== undefined) {
        updates.nivel = nivel;
      }

      const inscricao = await updateInscricao(inscricaoIdRaw, updates);
      return NextResponse.json({ inscricao });
    }

    const createInput: CreateRecruiterInscricaoInput = {
      nome: record.name as string,
      codigo: code,
      telefone: parseOptionalString(record.telefone) ?? undefined,
      cidade: parseOptionalString(record.cidade) ?? undefined,
      parentCodigo: parentCode ?? undefined,
      parentInscricaoId: parentInscricaoId ?? undefined,
      nivel: nivel ?? undefined,
    };

    const inscricao = await createRecruiterInscricao(createInput);
    return NextResponse.json({ inscricao });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ error: "Erro inesperado" }, { status: 500 });
  }
}
