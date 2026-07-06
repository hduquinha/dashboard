import { NextResponse, type NextRequest } from "next/server";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { canAccessDashboardPath } from "@/lib/permissions";

// Roda no runtime Node.js (nao Edge) porque lib/auth.ts usa node:crypto
// para decifrar o cookie de sessao (AES-256-GCM).
export const config = {
  runtime: "nodejs",
  matcher: [
    "/crm/:path*",
    "/vozup/:path*",
    "/financeiro/:path*",
    "/treinamentos/:path*",
    "/produtividade/:path*",
    "/distribuicao/:path*",
    "/recrutadores/:path*",
    "/rede/:path*",
    "/anamnese/:path*",
    "/relatorios/:path*",
    "/ranking/:path*",
    "/encontro-online/:path*",
    "/usuarios/:path*",
  ],
};

export function middleware(request: NextRequest) {
  const session = getDashboardSession(request.cookies.get(DASHBOARD_COOKIE_NAME)?.value);

  if (!canAccessDashboardPath(session?.user ?? null, request.nextUrl.pathname)) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}
