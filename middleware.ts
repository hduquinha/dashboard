import { NextResponse, type NextRequest } from "next/server";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";
import { canAccessDashboardPath, canViewNavLink } from "@/lib/permissions";
import { NAV_LINKS } from "@/lib/navLinks";

// Roda no runtime Node.js (nao Edge) porque lib/auth.ts usa node:crypto
// para decifrar o cookie de sessao (AES-256-GCM).
export const config = {
  runtime: "nodejs",
  matcher: [
    "/",
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

/** Home ("/") nunca teve permissao dedicada — usuarios restritos a uma unica
 *  tela (ex.: acesso so ao mapa de rotas) precisam ser desviados dela. */
function firstAccessiblePath(user: Parameters<typeof canViewNavLink>[0]): string | null {
  const link = NAV_LINKS.find((candidate) => candidate.href !== "/" && canViewNavLink(user, candidate.key));
  return link?.href ?? null;
}

export function middleware(request: NextRequest) {
  const session = getDashboardSession(request.cookies.get(DASHBOARD_COOKIE_NAME)?.value);
  const pathname = request.nextUrl.pathname;

  if (pathname === "/" && session?.user && !canViewNavLink(session.user, "home")) {
    const fallback = firstAccessiblePath(session.user);
    if (fallback) {
      return NextResponse.redirect(new URL(fallback, request.url));
    }
  }

  if (!canAccessDashboardPath(session?.user ?? null, pathname)) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}
