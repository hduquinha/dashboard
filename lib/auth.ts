import { createHmac, timingSafeEqual } from "node:crypto";

const AUTHORIZATION_PREFIX = "Bearer ";
const SESSION_VALUE_SEPARATOR = ".";
const SESSION_VERSION = "v1";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const SESSION_CLOCK_SKEW_SECONDS = 60;

export const DASHBOARD_COOKIE_NAME = "dashboardToken";

export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export function parseAuthorizationHeader(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed.toLowerCase().startsWith(AUTHORIZATION_PREFIX.toLowerCase())) {
    return null;
  }

  const token = trimmed.slice(AUTHORIZATION_PREFIX.length).trim();
  return token.length > 0 ? token : null;
}

export function getExpectedToken(): string | null {
  const token = process.env.DASHBOARD_TOKEN?.trim();
  return typeof token === "string" && token.length > 0 ? token : null;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function getSessionSecret(expectedToken: string): string {
  const configuredSecret = process.env.DASHBOARD_SESSION_SECRET?.trim();
  return configuredSecret && configuredSecret.length > 0 ? configuredSecret : expectedToken;
}

function signSessionPayload(payload: string, expectedToken: string): string {
  const sessionSecret = getSessionSecret(expectedToken);

  return createHmac("sha256", sessionSecret)
    .update(`${expectedToken}:${payload}`)
    .digest("base64url");
}

function parseSessionValue(candidate: string): { payload: string; signature: string } | null {
  const trimmed = candidate.trim();
  const separatorIndex = trimmed.lastIndexOf(SESSION_VALUE_SEPARATOR);

  if (separatorIndex <= 0 || separatorIndex === trimmed.length - 1) {
    return null;
  }

  return {
    payload: trimmed.slice(0, separatorIndex),
    signature: trimmed.slice(separatorIndex + 1),
  };
}

function decodeSessionPayload(encodedPayload: string): {
  version: string;
  issuedAtSeconds: number;
  expiresAtSeconds: number;
} | null {
  try {
    const payload = Buffer.from(encodedPayload, "base64url").toString("utf8");
    const [version, issuedAtRaw, expiresAtRaw] = payload.split(":");

    if (!version || !issuedAtRaw || !expiresAtRaw) {
      return null;
    }

    const issuedAtSeconds = Number.parseInt(issuedAtRaw, 10);
    const expiresAtSeconds = Number.parseInt(expiresAtRaw, 10);

    if (!Number.isFinite(issuedAtSeconds) || !Number.isFinite(expiresAtSeconds)) {
      return null;
    }

    return {
      version,
      issuedAtSeconds,
      expiresAtSeconds,
    };
  } catch {
    return null;
  }
}

export function isValidAccessToken(candidate?: string | null): boolean {
  const expected = getExpectedToken();
  if (!expected || !candidate) {
    return false;
  }

  return safeEqual(candidate, expected);
}

export function createSessionValue(now = Date.now()): string | null {
  const expected = getExpectedToken();
  if (!expected) {
    return null;
  }

  const issuedAtSeconds = Math.floor(now / 1000);
  const expiresAtSeconds = issuedAtSeconds + SESSION_TTL_SECONDS;
  const payload = Buffer.from(
    `${SESSION_VERSION}:${issuedAtSeconds}:${expiresAtSeconds}`,
    "utf8"
  ).toString("base64url");
  const signature = signSessionPayload(payload, expected);

  return `${payload}${SESSION_VALUE_SEPARATOR}${signature}`;
}

export function isValidToken(candidate?: string | null, now = Date.now()): boolean {
  const expected = getExpectedToken();
  if (!expected || !candidate) {
    return false;
  }

  if (safeEqual(candidate, expected)) {
    return true;
  }

  const session = parseSessionValue(candidate);
  if (!session) {
    return false;
  }

  const decoded = decodeSessionPayload(session.payload);
  if (!decoded || decoded.version !== SESSION_VERSION) {
    return false;
  }

  const expectedSignature = signSessionPayload(session.payload, expected);
  if (!safeEqual(session.signature, expectedSignature)) {
    return false;
  }

  const nowSeconds = Math.floor(now / 1000);
  if (decoded.issuedAtSeconds > nowSeconds + SESSION_CLOCK_SKEW_SECONDS) {
    return false;
  }

  if (decoded.expiresAtSeconds < nowSeconds - SESSION_CLOCK_SKEW_SECONDS) {
    return false;
  }

  return true;
}

export function isValidAuthorizationHeader(value?: string | null): boolean {
  return isValidAccessToken(parseAuthorizationHeader(value));
}

export function assertToken(candidate?: string | null): void {
  if (!isValidToken(candidate)) {
    throw new UnauthorizedError();
  }
}

export function assertAuthorizationHeader(value?: string | null): void {
  if (!isValidAuthorizationHeader(value)) {
    throw new UnauthorizedError();
  }
}

function readCookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) {
    return null;
  }

  const cookieEntries = cookieHeader.split(";");

  for (const entry of cookieEntries) {
    const [rawName, ...rawValueParts] = entry.trim().split("=");
    if (rawName !== name || rawValueParts.length === 0) {
      continue;
    }

    const rawValue = rawValueParts.join("=");
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }

  return null;
}

function getExpectedOrigin(request: Pick<Request, "headers" | "url">): string | null {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost ?? request.headers.get("host");
  if (!host) {
    return null;
  }

  const forwardedProto = request.headers.get("x-forwarded-proto");
  const protocol = forwardedProto?.split(",")[0]?.trim() || new URL(request.url).protocol.replace(":", "");

  return `${protocol}://${host}`;
}

export function assertSameOrigin(request: Pick<Request, "headers" | "url">): void {
  const origin = request.headers.get("origin");
  const expectedOrigin = getExpectedOrigin(request);

  if (!origin || !expectedOrigin) {
    throw new UnauthorizedError();
  }

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    throw new UnauthorizedError();
  }

  if (!safeEqual(parsedOrigin.origin, expectedOrigin)) {
    throw new UnauthorizedError();
  }
}

export function getRequestSessionToken(request: Pick<Request, "headers">): string | null {
  return readCookieValue(request.headers.get("cookie"), DASHBOARD_COOKIE_NAME);
}

export function assertAuthenticatedRequest(
  request: Pick<Request, "headers" | "method" | "url">,
  options?: {
    allowAuthorizationHeader?: boolean;
    allowSessionCookie?: boolean;
    requireSameOriginForSession?: boolean;
  }
): void {
  const allowAuthorizationHeader = options?.allowAuthorizationHeader ?? true;
  const allowSessionCookie = options?.allowSessionCookie ?? true;

  if (allowAuthorizationHeader && isValidAuthorizationHeader(request.headers.get("authorization"))) {
    return;
  }

  if (allowSessionCookie) {
    const sessionToken = getRequestSessionToken(request);
    if (isValidToken(sessionToken)) {
      const requireSameOriginForSession =
        options?.requireSameOriginForSession ?? !["GET", "HEAD", "OPTIONS"].includes(request.method);

      if (requireSameOriginForSession) {
        assertSameOrigin(request);
      }
      return;
    }
  }

  throw new UnauthorizedError();
}

export function getSessionCookieMaxAge(): number {
  return SESSION_TTL_SECONDS;
}
