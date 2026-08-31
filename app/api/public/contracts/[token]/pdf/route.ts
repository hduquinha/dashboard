import { NextRequest, NextResponse } from "next/server";
import { getContractFileByToken } from "@/lib/contracts";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ token: string }>;
}

/** Rota PÚBLICA: a via do aluno, baixada com o mesmo link da assinatura. */
export async function GET(_request: NextRequest, context: RouteContext) {
  const { token } = await context.params;
  const document = await getContractFileByToken(token);
  if (!document) {
    return NextResponse.json({ error: "Contrato nao encontrado." }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(document.file), {
    headers: {
      "Content-Type": document.mime,
      "Content-Disposition": `inline; filename="${document.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
