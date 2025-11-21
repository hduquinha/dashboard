"use server";

import { importSpreadsheet } from "@/lib/importSpreadsheet";
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
    const result = importSpreadsheet(bytes);
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
