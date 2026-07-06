import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  DASHBOARD_COOKIE_NAME,
  createDashboardSessionValue,
  getSessionCookieMaxAge,
  type DashboardUser,
} from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { authenticateTeamMember } from "@/lib/teamAuth";
import {
  consumeRateLimit,
  getClientIp,
  peekRateLimit,
  resetRateLimit,
} from "@/lib/rateLimit";

const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;

type LoginErrorCode = "invalid" | "rate_limited" | "unavailable";

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

function setExpiredCookie(response: NextResponse, name: string) {
  response.cookies.set(name, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookie(),
    path: "/",
    maxAge: 0,
  });
}

function buildRedirect(request: NextRequest, path: string) {
  return NextResponse.redirect(new URL(path, getRequestOrigin(request)));
}

function buildErrorResponse(request: NextRequest, errorCode: LoginErrorCode) {
  const url = new URL("/login", getRequestOrigin(request));
  url.searchParams.set("error", errorCode);

  const response = NextResponse.redirect(url);
  setExpiredCookie(response, DASHBOARD_COOKIE_NAME);
  response.headers.set("Cache-Control", "no-store");

  return response;
}

async function readRequestData(request: NextRequest): Promise<Record<string, string>> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const data = await request.json().catch(() => null);
    if (!data || typeof data !== "object") {
      return {};
    }

    return Object.fromEntries(
      Object.entries(data as Record<string, unknown>)
        .filter(([, value]) => typeof value === "string")
        .map(([key, value]) => [key, String(value)])
    );
  }

  const formData = await request.formData();
  const entries: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") {
      entries[key] = value;
    }
  }

  return entries;
}

function consumeFailedAttempt(rateLimitKey: string) {
  return consumeRateLimit({
    key: rateLimitKey,
    maxHits: LOGIN_MAX_ATTEMPTS,
    windowMs: LOGIN_WINDOW_MS,
  });
}

export async function POST(request: NextRequest) {
  const clientIp = getClientIp(request);
  const rateLimitKey = `dashboard-login:${clientIp}`;
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

  const data = await readRequestData(request);
  const email = data.email?.trim() ?? "";
  const password = data.password ?? "";

  try {
    const member = await authenticateTeamMember(email, password);
    if (!member) {
      const failedAttempt = consumeFailedAttempt(rateLimitKey);
      const errorCode: LoginErrorCode = !failedAttempt.allowed ? "rate_limited" : "invalid";
      const response = buildErrorResponse(request, errorCode);
      if (!failedAttempt.allowed) {
        response.headers.set("Retry-After", String(failedAttempt.retryAfterSeconds));
      }
      return response;
    }

    const user: DashboardUser = {
      id: member.id,
      email: member.email,
      name: member.name,
      role: member.role,
      isSupervisor:
        member.role === "super_master" ||
        member.role === "admin" ||
        hasPermission(member, "crm.view_all_leads"),
      priorityLevel: member.priorityLevel,
      permissions: member.permissions,
      institutoUpOnly: member.institutoUpOnly,
    };

    const sessionValue = createDashboardSessionValue({ user });
    if (!sessionValue) {
      console.error("Failed to create dashboard session");
      return buildErrorResponse(request, "unavailable");
    }

    resetRateLimit(rateLimitKey);

    const response = buildRedirect(request, "/");
    response.cookies.set(DASHBOARD_COOKIE_NAME, sessionValue, {
      httpOnly: true,
      sameSite: "lax",
      secure: shouldUseSecureCookie(),
      path: "/",
      maxAge: getSessionCookieMaxAge(sessionValue),
      priority: "high",
    });
    response.headers.set("Cache-Control", "no-store");

    return response;
  } catch (error) {
    console.error("Login failed", error);
    const failedAttempt = consumeFailedAttempt(rateLimitKey);
    const errorCode: LoginErrorCode = !failedAttempt.allowed ? "rate_limited" : "unavailable";
    const response = buildErrorResponse(request, errorCode);
    if (!failedAttempt.allowed) {
      response.headers.set("Retry-After", String(failedAttempt.retryAfterSeconds));
    }
    return response;
  }
}
