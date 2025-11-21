"use server";

import { insertImportedInscricoes, type InsertImportedInscricoesResult } from "@/lib/db";
import { importSpreadsheet, type ImportPayload } from "@/lib/importSpreadsheet";
import type { ImportActionState } from "./state";

const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15MB guard to avoid oversized uploads

export async function previewImportAction(
  _prevState: ImportActionState,
  formData: FormData
): Promise<ImportActionState> {
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

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = importSpreadsheet(bytes, { filename: file.name });
    return {
      status: "success",
      message: `Pré-visualização pronta: ${result.importados.length} registros válidos`,
      filename: file.name,
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

export interface ConfirmImportInput {
  filename?: string | null;
  registros: ImportPayload[];
}

export interface ConfirmImportResponse {
  status: "success" | "error";
  message: string;
  summary?: InsertImportedInscricoesResult;
}

export async function confirmImportAction(input: ConfirmImportInput): Promise<ConfirmImportResponse> {
  if (!input || !Array.isArray(input.registros) || input.registros.length === 0) {
    return {
      status: "error",
      message: "Nenhum registro válido para importar.",
    };
  }

  try {
    const summary = await insertImportedInscricoes(input.registros, {
      filename: input.filename ?? null,
    });

    const insertedLabel = `${summary.inserted} registro${summary.inserted === 1 ? "" : "s"} importado${
      summary.inserted === 1 ? "" : "s"
    }`;
    const skippedLabel = summary.skipped
      ? `${summary.skipped} duplicado${summary.skipped === 1 ? "" : "s"} ignorado${
          summary.skipped === 1 ? "" : "s"
        }`
      : null;
    const combinedMessage = skippedLabel ? `${insertedLabel} · ${skippedLabel}` : insertedLabel;
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
