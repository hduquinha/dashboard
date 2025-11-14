import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getExpectedToken } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const expected = getExpectedToken();
  if (!expected) {
    console.error("DASHBOARD_TOKEN is not configured");
    return NextResponse.json({ error: "Configuração ausente" }, { status: 500 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  let providedToken: string | null = null;

  if (contentType.includes("application/json")) {
    const data = await request.json().catch(() => null);
    if (data && typeof data.token === "string") {
      providedToken = data.token;
    }
  } else {
    const formData = await request.formData();
    const token = formData.get("token");
    if (typeof token === "string") {
      providedToken = token;
    }
  }

  if (providedToken !== expected) {
    const url = new URL("/login", request.url);
    url.searchParams.set("error", "invalid");
    return NextResponse.redirect(url);
  }

  const response = NextResponse.redirect(new URL("/", request.url));
  response.cookies.set("dashboardToken", expected, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return response;
}
