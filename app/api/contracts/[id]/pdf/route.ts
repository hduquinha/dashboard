import { NextRequest, NextResponse } from "next/server";
import { getContractFile, registerContractDownload } from "@/lib/contracts";
import type { ContractPdfVariant } from "@/lib/contractDocument";
import { requireContractAccess } from "../../route";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * O arquivo do contrato.
 *
 * `?via=impressao` devolve a via de papel — com as linhas de assinatura da
 * escola, do contratante e das duas testemunhas, e sem a cláusula de
 * assinatura eletrônica, que só faz sentido em quem assina pelo link. Contrato
 * já assinado ignora o parâmetro: existe um único arquivo oficial, e é ele que
 * sai, seja o PDF assinado eletronicamente ou a digitalização da via de papel.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const { error, session } = await requireContractAccess(false);
  if (error) return error;

  const id = Number.parseInt((await context.params).id, 10);
  if (!Number.isFinite(id) || id < 1) {
    return NextResponse.json({ error: "Contrato invalido." }, { status: 400 });
  }

  const variant: ContractPdfVariant =
    request.nextUrl.searchParams.get("via") === "impressao" ? "impressao" : "digital";

  const document = await getContractFile(id, variant);
  if (!document) return NextResponse.json({ error: "Contrato nao encontrado." }, { status: 404 });

  // Baixar a via assinada e imprimir para colher assinatura são fatos que
  // valem registro; abrir a prévia digital é conferência de rotina e encheria
  // a trilha de ruído.
  if (document.signed || variant === "impressao") {
    await registerContractDownload(id, {
      actor: session.user,
      ip: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
      type: document.signed ? "downloaded" : "printed",
    });
  }

  return new NextResponse(new Uint8Array(document.file), {
    headers: {
      "Content-Type": document.mime,
      "Content-Disposition": `inline; filename="${document.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
