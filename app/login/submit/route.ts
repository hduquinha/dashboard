import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  DASHBOARD_COOKIE_NAME,
  DASHBOARD_MFA_COOKIE_NAME,
  createChatwootSessionValue,
  createMfaChallengeValue,
  getSessionCookieMaxAge,
  readMfaChallengeValue,
} from "@/lib/auth";
import { ChatwootAuthError, signInWithChatwoot } from "@/lib/chatwootAuth";
import {
  consumeRateLimit,
  getClientIp,
  peekRateLimit,
  resetRateLimit,
} from "@/lib/rateLimit";

const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const MFA_COOKIE_MAX_AGE_SECONDS = 5 * 60;

type LoginErrorCode =
  | "config"
  | "forbidden"
  | "invalid"
  | "mfa_invalid"
  | "rate_limited"
  | "unavailable";

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

function splitMfaCode(rawCode?: string | null): { otpCode?: string; backupCode?: string } {
  const code = rawCode?.trim();
  if (!code) {
    return {};
  }

  return /^\d{6}$/.test(code) ? { otpCode: code } : { backupCode: code };
}

function consumeFailedAttempt(rateLimitKey: string) {
  return consumeRateLimit({
    key: rateLimitKey,
    maxHits: LOGIN_MAX_ATTEMPTS,
    windowMs: LOGIN_WINDOW_MS,
  });
}

function mapAuthError(error: unknown, hasMfaChallenge: boolean): LoginErrorCode {
  if (!(error instanceof ChatwootAuthError)) {
    return "unavailable";
  }

  switch (error.code) {
    case "configuration":
      return "config";
    case "forbidden":
      return "forbidden";
    case "rate_limited":
      return "rate_limited";
    case "unavailable":
      return "unavailable";
    case "invalid":
      return hasMfaChallenge ? "mfa_invalid" : "invalid";
    case "mfa_required":
      return "invalid";
    default:
      return "invalid";
  }
}

export async function POST(request: NextRequest) {
  const clientIp = getClientIp(request);
  const rateLimitKey = `chatwoot-login:${clientIp}`;
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
  const mfaChallenge = readMfaChallengeValue(
    request.cookies.get(DASHBOARD_MFA_COOKIE_NAME)?.value
  );

  try {
    const result = mfaChallenge
      ? await signInWithChatwoot({
          mfaToken: mfaChallenge.token,
          ...splitMfaCode(data.code),
        })
      : await signInWithChatwoot({
          email: data.email?.trim() ?? "",
          password: data.password ?? "",
        });

    const sessionValue = createChatwootSessionValue(result);
    if (!sessionValue) {
      console.error("Failed to create Chatwoot dashboard session");
      return buildErrorResponse(request, "config");
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
    setExpiredCookie(response, DASHBOARD_MFA_COOKIE_NAME);
    response.headers.set("Cache-Control", "no-store");

    return response;
  } catch (error) {
    if (error instanceof ChatwootAuthError && error.code === "mfa_required" && error.mfaToken) {
      const challengeValue = createMfaChallengeValue(error.mfaToken, data.email?.trim());
      if (!challengeValue) {
        return buildErrorResponse(request, "config");
      }

      const response = buildRedirect(request, "/login?step=mfa");
      response.cookies.set(DASHBOARD_MFA_COOKIE_NAME, challengeValue, {
        httpOnly: true,
        sameSite: "lax",
        secure: shouldUseSecureCookie(),
        path: "/",
        maxAge: MFA_COOKIE_MAX_AGE_SECONDS,
        priority: "high",
      });
      setExpiredCookie(response, DASHBOARD_COOKIE_NAME);
      response.headers.set("Cache-Control", "no-store");
      return response;
    }

    const failedAttempt = consumeFailedAttempt(rateLimitKey);
    const errorCode = !failedAttempt.allowed
      ? "rate_limited"
      : mapAuthError(error, Boolean(mfaChallenge));

    const response = buildErrorResponse(request, errorCode);
    if (error instanceof ChatwootAuthError && error.retryAfterSeconds) {
      response.headers.set("Retry-After", String(error.retryAfterSeconds));
    } else if (!failedAttempt.allowed) {
      response.headers.set("Retry-After", String(failedAttempt.retryAfterSeconds));
    }

    if (!mfaChallenge) {
      setExpiredCookie(response, DASHBOARD_MFA_COOKIE_NAME);
    }

    return response;
  }
}
