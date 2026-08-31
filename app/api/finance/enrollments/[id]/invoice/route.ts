import { NextResponse, type NextRequest } from "next/server";
import {
  getEnrollmentInvoice,
  saveEnrollmentInvoice,
  updateEnrollmentInvoice,
  type EnrollmentInvoiceInput,
} from "@/lib/finance";
import { auditFinance } from "@/lib/financeAudit";
import {
  financeError,
  parseId,
  readJsonBody,
  requireFinanceAccess,
  requireInvoicePermission,
} from "../../../utils";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Baixa o PDF/imagem da nota anexada à matrícula. */
export async function GET(request: NextRequest, context: RouteContext) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;

  try {
    const { id } = await context.params;
    const invoice = await getEnrollmentInvoice(parseId(id));
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

/**
 * Status de emissão da matrícula. Fica fora do PATCH da matrícula de propósito:
 * aquele recria as parcelas e se recusa a rodar quando já existe pagamento
 * lançado — que é exatamente a matrícula que precisa de nota.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;
  const permission = requireInvoicePermission(request);
  if (permission) return permission;

  try {
    const [{ id }, body] = await Promise.all([context.params, readJsonBody(request)]);
    const entityId = parseId(id);
    const input = body as unknown as EnrollmentInvoiceInput;
    await auditFinance(
      request,
      { entity: "enrollment", action: "status", entityId, note: `Nota fiscal: ${input.status ?? "?"}` },
      () => updateEnrollmentInvoice(entityId, input)
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return financeError(error, "Falha ao atualizar nota fiscal da matricula.");
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = requireFinanceAccess(request);
  if (auth) return auth;
  const permission = requireInvoicePermission(request);
  if (permission) return permission;

  try {
    const [{ id }, formData] = await Promise.all([context.params, request.formData()]);
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Arquivo obrigatorio." }, { status: 400 });
    }
    const entityId = parseId(id);
    const filename = file.name || "nota-fiscal";
    const buffer = Buffer.from(await file.arrayBuffer());
    await auditFinance(
      request,
      { entity: "enrollment", action: "attach", entityId, note: filename },
      () => saveEnrollmentInvoice(entityId, { buffer, filename, mime: file.type || "application/octet-stream" })
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return financeError(error, "Falha ao salvar nota fiscal.");
  }
}
