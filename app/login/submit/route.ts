import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  DASHBOARD_COOKIE_NAME,
  createSessionValue,
  getExpectedToken,
  getSessionCookieMaxAge,
  isValidAccessToken,
} from "@/lib/auth";
import {
  consumeRateLimit,
  getClientIp,
  peekRateLimit,
  resetRateLimit,
} from "@/lib/rateLimit";

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;

function buildErrorResponse(request: NextRequest, errorCode: "invalid" | "rate_limited") {
  const url = new URL("/login", request.url);
  url.searchParams.set("error", errorCode);

  const response = NextResponse.redirect(url);
  response.cookies.set(DASHBOARD_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  response.headers.set("Cache-Control", "no-store");

  return response;
}

export async function POST(request: NextRequest) {
  const expected = getExpectedToken();
  if (!expected) {
    console.error("DASHBOARD_TOKEN is not configured");
    return NextResponse.json({ error: "Configuracao ausente" }, { status: 500 });
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

  const clientIp = getClientIp(request);
  const rateLimitKey = `login:${clientIp}`;
  const rateLimitStatus = peekRateLimit({
    key: rateLimitKey,
    maxHits: LOGIN_MAX_ATTEMPTS,
    windowMs: LOGIN_WINDOW_MS,
  });

  if (!rateLimitStatus.allowed) {
    const response = buildErrorResponse(request, "rate_limited");
    response.headers.set("Retry-After", String(rateLimitStatus.retryAfterSeconds));
    return response;
  }

  if (!isValidAccessToken(providedToken)) {
    const failedAttempt = consumeRateLimit({
      key: rateLimitKey,
      maxHits: LOGIN_MAX_ATTEMPTS,
      windowMs: LOGIN_WINDOW_MS,
    });

    if (!failedAttempt.allowed) {
      const response = buildErrorResponse(request, "rate_limited");
      response.headers.set("Retry-After", String(failedAttempt.retryAfterSeconds));
      return response;
    }

    return buildErrorResponse(request, "invalid");
  }

  resetRateLimit(rateLimitKey);

  const sessionValue = createSessionValue();
  if (!sessionValue) {
    console.error("Failed to create dashboard session");
    return NextResponse.json({ error: "Configuracao ausente" }, { status: 500 });
  }

  const response = NextResponse.redirect(new URL("/", request.url));
  response.cookies.set(DASHBOARD_COOKIE_NAME, sessionValue, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: getSessionCookieMaxAge(),
    priority: "high",
  });
  response.headers.set("Cache-Control", "no-store");

  return response;
}
