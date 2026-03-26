"use server";

import { cookies, headers } from "next/headers";
import {
  assertSameOrigin,
  assertToken,
  DASHBOARD_COOKIE_NAME,
  UnauthorizedError,
} from "@/lib/auth";
import { insertImportedInscricoes, type InsertImportedInscricoesResult } from "@/lib/db";
import {
  importSpreadsheet,
  sanitizeImportFilename,
  sanitizeImportedRecords,
  type ImportPayload,
} from "@/lib/importSpreadsheet";
import type { ImportActionState } from "./state";

const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15MB guard to avoid oversized uploads
const IMPORT_AUTH_ERROR_MESSAGE =
  "Sessão expirada ou origem inválida. Atualize a página e faça login novamente.";

function buildServerActionUrl(headerStore: Awaited<ReturnType<typeof headers>>): string {
  const forwardedProto = headerStore.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = headerStore.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || headerStore.get("host") || "localhost";

  if (forwardedProto) {
    return `${forwardedProto}://${host}/`;
  }

  const origin = headerStore.get("origin");
  if (origin) {
    try {
      return `${new URL(origin).protocol}//${host}/`;
    } catch {
      // Fall through to the default URL below.
    }
  }

  return `https://${host}/`;
}

async function assertAuthenticatedImportAction(): Promise<void> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const token = cookieStore.get(DASHBOARD_COOKIE_NAME)?.value;

  assertToken(token);
  assertSameOrigin({
    headers: headerStore,
    url: buildServerActionUrl(headerStore),
  });
}

function buildUnauthorizedImportState(): ImportActionState {
  return {
    status: "error",
    message: IMPORT_AUTH_ERROR_MESSAGE,
  };
}

export interface ConfirmImportInput {
  filename?: string | null;
  registros: ImportPayload[];
}

export interface ConfirmImportResponse {
  status: "success" | "error";
  message: string;
  summary?: InsertImportedInscricoesResult;
}

function buildUnauthorizedConfirmResponse(): ConfirmImportResponse {
  return {
    status: "error",
    message: IMPORT_AUTH_ERROR_MESSAGE,
  };
}

export async function previewImportAction(
  _prevState: ImportActionState,
  formData: FormData
): Promise<ImportActionState> {
  try {
    await assertAuthenticatedImportAction();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return buildUnauthorizedImportState();
    }

    throw error;
  }

  const file = formData.get("planilha");
  if (!file || !(file instanceof File)) {
    return {
      status: "error",
      message: "Selecione um arquivo XLS, XLSX ou CSV.",
    };
  }

  if (file.size === 0) {
    return {
      status: "error",
      message: "O arquivo está vazio.",
    };
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      status: "error",
      message: "Arquivo muito grande. Use um arquivo de até 15MB.",
    };
  }

  const sanitizedFilename = sanitizeImportFilename(file.name) ?? "planilha";

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = importSpreadsheet(bytes, { filename: sanitizedFilename });
    return {
      status: "success",
      message: `Pré-visualização pronta: ${result.importados.length} registros válidos`,
      filename: sanitizedFilename,
      result,
    };
  } catch (error) {
    console.error("Failed to preview spreadsheet", error);
    return {
      status: "error",
      message: "Não foi possível ler a planilha. Confirme o formato e tente novamente.",
    };
  }
}

export async function confirmImportAction(input: ConfirmImportInput): Promise<ConfirmImportResponse> {
  try {
    await assertAuthenticatedImportAction();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return buildUnauthorizedConfirmResponse();
    }

    throw error;
  }

  let registros: ImportPayload[];
  try {
    registros = sanitizeImportedRecords(input?.registros);
  } catch {
    return {
      status: "error",
      message: "Lote inválido. Gere a pré-visualização novamente antes de importar.",
    };
  }

  if (registros.length === 0) {
    return {
      status: "error",
      message: "Nenhum registro válido para importar.",
    };
  }

  try {
    const summary = await insertImportedInscricoes(registros, {
      filename: sanitizeImportFilename(input?.filename) ?? null,
    });

    const insertedLabel = `${summary.inserted} registro${summary.inserted === 1 ? "" : "s"} importado${
      summary.inserted === 1 ? "" : "s"
    }`;
    const skippedLabel = summary.skipped
      ? `${summary.skipped} duplicado${summary.skipped === 1 ? "" : "s"} ignorado${
          summary.skipped === 1 ? "" : "s"
        }`
      : null;
    const combinedMessage = skippedLabel ? `${insertedLabel} | ${skippedLabel}` : insertedLabel;
    const finalMessage = summary.inserted > 0 ? combinedMessage : skippedLabel ?? "Nenhum registro novo para importar.";

    return {
      status: summary.inserted > 0 ? "success" : "error",
      message: finalMessage,
      summary,
    };
  } catch (error) {
    console.error("Failed to confirm import", error);
    return {
      status: "error",
      message: "Não foi possível salvar os dados. Tente novamente em instantes.",
    };
  }
}
