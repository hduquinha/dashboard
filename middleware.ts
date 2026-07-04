import { NextResponse, type NextRequest } from "next/server";
import { DASHBOARD_COOKIE_NAME, getDashboardSession } from "@/lib/auth";

// Roda no runtime Node.js (nao Edge) porque lib/auth.ts usa node:crypto
// para decifrar o cookie de sessao (AES-256-GCM).
export const config = {
  runtime: "nodejs",
  matcher: ["/vozup/:path*"],
};

export function middleware(request: NextRequest) {
  const session = getDashboardSession(request.cookies.get(DASHBOARD_COOKIE_NAME)?.value);

  if (session?.user.institutoUpOnly) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}
