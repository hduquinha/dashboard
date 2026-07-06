import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { assertAuthenticatedRequest } from "@/lib/auth";
import { listTrainingFilterOptions } from "@/lib/db";
import { listVozupBlockStats, vinculoPastaLabel, VOZUP_FOLDERS } from "@/lib/vozupFolders";

export const dynamic = "force-dynamic";

export interface VinculoPastaOptions {
  pasta: string;
  label: string;
  emoji: string;
  blocks: { value: string; label: string; count?: number }[];
}

/** Opções do seletor de vínculo da ficha: pastas VozUP + treinamentos Instituto. */
export async function GET(request: NextRequest) {
  try {
    assertAuthenticatedRequest(request, { requireSameOriginForSession: false });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [blockStats, trainingOptions] = await Promise.all([
      listVozupBlockStats(),
      listTrainingFilterOptions(),
    ]);

    const pastas: VinculoPastaOptions[] = VOZUP_FOLDERS.map((folder) => ({
      pasta: folder.key,
      label: folder.label,
      emoji: folder.emoji,
      blocks: blockStats
        .filter((b) => b.folderKey === folder.key)
        .map((b) => ({ value: b.bloco, label: b.bloco, count: b.total })),
    })).filter((p) => p.blocks.length > 0);

    const instituto = vinculoPastaLabel("instituto");
    pastas.push({
      pasta: "instituto",
      label: instituto.label,
      emoji: instituto.emoji,
      blocks: trainingOptions.map((t) => ({ value: t.id, label: t.label })),
    });

    return NextResponse.json({ pastas });
  } catch (error) {
    console.error("Erro ao listar opções de vínculo:", error);
    return NextResponse.json({ error: "Erro ao listar opções" }, { status: 500 });
  }
}
