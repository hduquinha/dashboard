import { NextResponse, type NextRequest } from "next/server";
import { createRevenue, getFinanceCatalog } from "@/lib/finance";
import { auditFinance } from "@/lib/financeAudit";
import {
  buildImportLists,
  buildRevenueImportTemplate,
  listInstitutoOrigins,
  parseRevenueImport,
  RevenueImportError,
  selectImportRows,
} from "@/lib/financeRevenueImport";
import { financeError, requireFinanceAccess } from "../../utils";

export const dynamic = "force-dynamic";

/** Limite do upload; a planilha modelo cheia não passa de algumas centenas de KB. */
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

async function currentLists() {
  const [catalog, origins] = await Promise.all([getFinanceCatalog(), listInstitutoOrigins()]);
  return buildImportLists(catalog, origins);
}

/** Planilha modelo, já com as listas suspensas do catálogo atual. */
export async function GET(request: NextRequest) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  try {
    const buffer = await buildRevenueImportTemplate(await currentLists());
    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="instituto-up-receitas-modelo-${stamp}.xlsx"`,
      },
    });
  } catch (error) {
    return financeError(error, "Falha ao gerar a planilha modelo.");
  }
}

/**
 * `mode=preview` (padrão) só valida e devolve a prévia; `mode=commit` grava.
 *
 * A confirmação reenvia o MESMO arquivo e ele é relido aqui: gravar a partir da
 * prévia que voltou do navegador deixaria valor e unidade editáveis por quem
 * chamasse a rota direto.
 */
export async function POST(request: NextRequest) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Selecione a planilha preenchida." }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "Arquivo maior que 8MB." }, { status: 400 });
    }

    const mode = String(formData.get("mode") ?? "preview") === "commit" ? "commit" : "preview";
    const includeDuplicates = String(formData.get("includeDuplicates") ?? "") === "true";
    // Competência para as linhas sem data (planilha de fora do modelo).
    const defaultDate = String(formData.get("defaultDate") ?? "").trim() || null;
    const filename = file.name || null;
    const buffer = Buffer.from(await file.arrayBuffer());
    const preview = await parseRevenueImport(buffer, filename, await currentLists(), { defaultDate });

    if (mode === "preview") {
      return NextResponse.json({ preview });
    }

    const selected = selectImportRows(preview, { includeDuplicates });
    if (selected.length === 0) {
      return NextResponse.json(
        { error: "Nenhuma linha válida para importar nas opções escolhidas." },
        { status: 400 }
      );
    }

    // Uma criação por vez, com o mesmo caminho do lançamento manual: cada
    // receita importada vira um evento próprio na auditoria financeira,
    // com o arquivo e a linha de origem na nota.
    const created: number[] = [];
    for (const row of selected) {
      const input = row.input;
      if (!input) continue;
      const id = await auditFinance(
        request,
        {
          entity: "revenue",
          action: "create",
          note: `Importação de planilha${filename ? ` · ${filename}` : ""} · linha ${row.line}`,
        },
        () => createRevenue(input)
      );
      created.push(id);
    }

    return NextResponse.json({
      ok: true,
      created: created.length,
      skipped: preview.totals.rows - created.length,
      totals: preview.totals,
    });
  } catch (error) {
    if (error instanceof RevenueImportError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return financeError(error, "Falha ao importar a planilha.");
  }
}
