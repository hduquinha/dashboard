import { NextRequest, NextResponse } from "next/server";
import { registerPaperSignature } from "@/lib/contracts";
import { validatePhysicalContractUpload } from "@/lib/contractRules";
import { requireContractAccess } from "../../route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * MIME pela extensão, não pelo que o navegador declara.
 *
 * O `type` de um `File` vem do sistema do cliente e some quando o arquivo
 * chega de alguns apps de celular (câmera, scanner) — cai como string vazia ou
 * "application/octet-stream". A extensão é o palpite mais confiável que resta;
 * `validatePhysicalContractUpload` já barrou o conteúdo antes daqui.
 */
const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

function resolveMime(file: File): string {
  const declared = (file.type || "").toLowerCase();
  if (declared && declared !== "application/octet-stream") return declared;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[extension] ?? "application/pdf";
}

/** Recebe a via impressa, assinada à mão e digitalizada (PDF ou foto). */
export async function POST(request: NextRequest, context: RouteContext) {
  const { error, session } = await requireContractAccess(true);
  if (error) return error;

  const id = Number.parseInt((await context.params).id, 10);
  if (!Number.isFinite(id) || id < 1) {
    return NextResponse.json({ error: "Contrato invalido." }, { status: 400 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Selecione o arquivo assinado." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const mime = resolveMime(file);
    const validationError = validatePhysicalContractUpload({
      name: file.name,
      type: mime,
      size: file.size,
      header: buffer.subarray(0, 5).toString("ascii"),
    });
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const signedDate = formData.get("signedDate");
    const signerName = formData.get("signerName");

    const contract = await registerPaperSignature(session.user, id, {
      file: buffer,
      mime,
      filename: file.name,
      signedDate: typeof signedDate === "string" && signedDate.trim() ? signedDate : null,
      signerName: typeof signerName === "string" && signerName.trim() ? signerName.trim() : null,
    });
    return NextResponse.json({ contract });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Nao foi possivel salvar o contrato assinado.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
