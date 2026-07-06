import { NextResponse, type NextRequest } from "next/server";
import { getFixedExpenseInvoice, saveFixedExpenseInvoice } from "@/lib/finance";
import { financeError, parseId, requireFinanceAccess } from "../../../utils";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  try {
    const { id } = await context.params;
    const invoice = await getFixedExpenseInvoice(parseId(id));
    if (!invoice) {
      return NextResponse.json({ error: "Nota fiscal nao encontrada." }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(invoice.buffer), {
      headers: {
        "Content-Type": invoice.mime,
        "Content-Disposition": `attachment; filename="${invoice.filename.replace(/"/g, "")}"`,
      },
    });
  } catch (error) {
    return financeError(error, "Falha ao baixar nota fiscal.");
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  try {
    const [{ id }, formData] = await Promise.all([context.params, request.formData()]);
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Arquivo obrigatorio." }, { status: 400 });
    }
    await saveFixedExpenseInvoice(parseId(id), {
      buffer: Buffer.from(await file.arrayBuffer()),
      filename: file.name || "nota-fiscal",
      mime: file.type || "application/octet-stream",
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return financeError(error, "Falha ao salvar nota fiscal.");
  }
}
