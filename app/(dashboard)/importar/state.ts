export interface ImportActionState {
  status: "idle" | "success" | "error";
  message: string | null;
  filename?: string;
  result?: import("@/lib/importSpreadsheet").ImportResult;
}

export const initialImportState: ImportActionState = {
  status: "idle",
  message: null,
};
