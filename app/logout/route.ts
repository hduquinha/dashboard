import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { DASHBOARD_COOKIE_NAME } from "@/lib/auth";

function shouldUseSecureCookie() {
  return process.env.DASHBOARD_COOKIE_SECURE !== "false" && process.env.NODE_ENV === "production";
}

function getRequestOrigin(request: NextRequest) {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost ?? request.headers.get("host");
  if (!host) {
    return new URL(request.url).origin;
  }

  const forwardedProto = request.headers.get("x-forwarded-proto");
  const protocol = forwardedProto ?? new URL(request.url).protocol.replace(/:$/, "");
  return `${protocol}://${host}`;
}

function expireCookie(response: NextResponse, name: string) {
  response.cookies.set(name, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookie(),
    path: "/",
    maxAge: 0,
  });
}

async function handleLogout(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/login", getRequestOrigin(request)));
  expireCookie(response, DASHBOARD_COOKIE_NAME);
  response.headers.set("Cache-Control", "no-store");

  return response;
}

export async function POST(request: NextRequest) {
  return handleLogout(request);
}

export async function GET(request: NextRequest) {
  return handleLogout(request);
}
