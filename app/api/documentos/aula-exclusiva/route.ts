import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { assertAuthenticatedRequest, UnauthorizedError } from "@/lib/auth";
import { buildExclusiveClassDocumentPdf } from "@/lib/exclusiveClassDocument";

export const runtime = "nodejs";

function parseCopies(value: string | null): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) ? Math.min(50, Math.max(1, parsed)) : 1;
}

export async function GET(request: NextRequest) {
  try {
    assertAuthenticatedRequest(request, { requireSameOriginForSession: false });

    const pdf = await buildExclusiveClassDocumentPdf({
      copies: parseCopies(request.nextUrl.searchParams.get("copias")),
      eventDate: request.nextUrl.searchParams.get("data") ?? undefined,
      location: request.nextUrl.searchParams.get("local") ?? undefined,
    });

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": 'attachment; filename="lista-presenca-aula-exclusiva.pdf"',
        "Content-Type": "application/pdf",
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("Exclusive class document PDF error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
