import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { assertAuthenticatedRequest } from "@/lib/auth";
import { searchInscricoesByName } from "@/lib/db";

function parseLimit(value: string | null): number {
  if (!value) {
    return 8;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return 8;
  }

  return Math.max(1, Math.min(25, parsed));
}

export async function GET(request: NextRequest) {
  try {
    assertAuthenticatedRequest(request, {
      requireSameOriginForSession: false,
    });
  } catch {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q") ?? "";
  const limit = parseLimit(searchParams.get("limit"));

  if (!query.trim()) {
    return NextResponse.json({ results: [] });
  }

  const results = await searchInscricoesByName(query, limit);
  return NextResponse.json({ results });
}
