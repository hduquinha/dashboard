import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const AUTHORIZATION_PREFIX = "Bearer ";
const SESSION_VALUE_SEPARATOR = ".";
const SESSION_VERSION = "v1";
const CHATWOOT_SESSION_VERSION = "cw1";
const CHATWOOT_SESSION_PREFIX = "cw1";
const MFA_CHALLENGE_VERSION = "mfa1";
const MFA_CHALLENGE_PREFIX = "mfa1";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const SESSION_CLOCK_SKEW_SECONDS = 60;
const MFA_CHALLENGE_TTL_SECONDS = 5 * 60;

export const DASHBOARD_COOKIE_NAME = "dashboardToken";
export const DASHBOARD_MFA_COOKIE_NAME = "dashboardChatwootMfa";

export interface DashboardUserAccount {
  id: number;
  name?: string | null;
  status?: string | null;
  role?: string | null;
  permissions?: string[] | null;
}

export interface DashboardUser {
  id: number;
  email: string;
  name: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  role?: string | null;
  accountId?: number | null;
  accounts?: DashboardUserAccount[];
}

export interface DashboardChatwootAuthHeaders {
  accessToken: string;
  tokenType: string;
  client: string;
  expiry: string;
  uid: string;
}

export interface DashboardSession {
  version: typeof CHATWOOT_SESSION_VERSION;
  issuedAtSeconds: number;
  expiresAtSeconds: number;
  auth: DashboardChatwootAuthHeaders;
  user: DashboardUser;
}

export interface MfaChallenge {
  version: typeof MFA_CHALLENGE_VERSION;
  issuedAtSeconds: number;
  expiresAtSeconds: number;
  token: string;
  email?: string | null;
}

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

function getDashboardSessionSecret(): string | null {
  const configuredSecret = process.env.DASHBOARD_SESSION_SECRET?.trim();
  if (configuredSecret && configuredSecret.length > 0) {
    return configuredSecret;
  }

  return getExpectedToken();
}

function getEncryptionKey(): Buffer | null {
  const secret = getDashboardSessionSecret();
  if (!secret) {
    return null;
  }

  return createHash("sha256").update(secret).digest();
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

function encodeEncryptedPayload(prefix: string, payload: unknown): string | null {
  const key = getEncryptionKey();
  if (!key) {
    return null;
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(prefix, "utf8"));

  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    prefix,
    iv.toString("base64url"),
    encrypted.toString("base64url"),
    tag.toString("base64url"),
  ].join(SESSION_VALUE_SEPARATOR);
}

function decodeEncryptedPayload<T>(prefix: string, candidate?: string | null): T | null {
  if (!candidate) {
    return null;
  }

  const parts = candidate.trim().split(SESSION_VALUE_SEPARATOR);
  if (parts.length !== 4 || parts[0] !== prefix) {
    return null;
  }

  const key = getEncryptionKey();
  if (!key) {
    return null;
  }

  try {
    const iv = Buffer.from(parts[1], "base64url");
    const encrypted = Buffer.from(parts[2], "base64url");
    const tag = Buffer.from(parts[3], "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(prefix, "utf8"));
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return JSON.parse(decrypted.toString("utf8")) as T;
  } catch {
    return null;
  }
}

function isDashboardSessionPayload(value: unknown): value is DashboardSession {
  if (!value || typeof value !== "object") {
    return false;
  }

  const session = value as DashboardSession;
  return (
    session.version === CHATWOOT_SESSION_VERSION &&
    typeof session.issuedAtSeconds === "number" &&
    typeof session.expiresAtSeconds === "number" &&
    Boolean(session.auth) &&
    typeof session.auth.accessToken === "string" &&
    typeof session.auth.tokenType === "string" &&
    typeof session.auth.client === "string" &&
    typeof session.auth.expiry === "string" &&
    typeof session.auth.uid === "string" &&
    Boolean(session.user) &&
    typeof session.user.id === "number" &&
    typeof session.user.email === "string" &&
    typeof session.user.name === "string"
  );
}

function isMfaChallengePayload(value: unknown): value is MfaChallenge {
  if (!value || typeof value !== "object") {
    return false;
  }

  const challenge = value as MfaChallenge;
  return (
    challenge.version === MFA_CHALLENGE_VERSION &&
    typeof challenge.issuedAtSeconds === "number" &&
    typeof challenge.expiresAtSeconds === "number" &&
    typeof challenge.token === "string" &&
    challenge.token.length > 0
  );
}

function isWithinWindow(
  issuedAtSeconds: number,
  expiresAtSeconds: number,
  now = Date.now()
): boolean {
  const nowSeconds = Math.floor(now / 1000);
  if (issuedAtSeconds > nowSeconds + SESSION_CLOCK_SKEW_SECONDS) {
    return false;
  }

  if (expiresAtSeconds < nowSeconds - SESSION_CLOCK_SKEW_SECONDS) {
    return false;
  }

  return true;
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

export function createChatwootSessionValue(
  input: {
    auth: DashboardChatwootAuthHeaders;
    user: DashboardUser;
  },
  now = Date.now()
): string | null {
  const issuedAtSeconds = Math.floor(now / 1000);
  const headerExpirySeconds = Number.parseInt(input.auth.expiry, 10);
  const expiresAtSeconds = Number.isFinite(headerExpirySeconds)
    ? headerExpirySeconds
    : issuedAtSeconds + SESSION_TTL_SECONDS;

  if (expiresAtSeconds <= issuedAtSeconds) {
    return null;
  }

  return encodeEncryptedPayload(CHATWOOT_SESSION_PREFIX, {
    version: CHATWOOT_SESSION_VERSION,
    issuedAtSeconds,
    expiresAtSeconds,
    auth: input.auth,
    user: input.user,
  } satisfies DashboardSession);
}

export function getDashboardSession(candidate?: string | null, now = Date.now()): DashboardSession | null {
  const session = decodeEncryptedPayload<DashboardSession>(CHATWOOT_SESSION_PREFIX, candidate);
  if (!isDashboardSessionPayload(session)) {
    return null;
  }

  if (!isWithinWindow(session.issuedAtSeconds, session.expiresAtSeconds, now)) {
    return null;
  }

  return session;
}

export function createMfaChallengeValue(
  token: string,
  email?: string | null,
  now = Date.now()
): string | null {
  if (!token.trim()) {
    return null;
  }

  const issuedAtSeconds = Math.floor(now / 1000);
  return encodeEncryptedPayload(MFA_CHALLENGE_PREFIX, {
    version: MFA_CHALLENGE_VERSION,
    issuedAtSeconds,
    expiresAtSeconds: issuedAtSeconds + MFA_CHALLENGE_TTL_SECONDS,
    token,
    email: email ?? null,
  } satisfies MfaChallenge);
}

export function readMfaChallengeValue(candidate?: string | null, now = Date.now()): MfaChallenge | null {
  const challenge = decodeEncryptedPayload<MfaChallenge>(MFA_CHALLENGE_PREFIX, candidate);
  if (!isMfaChallengePayload(challenge)) {
    return null;
  }

  if (!isWithinWindow(challenge.issuedAtSeconds, challenge.expiresAtSeconds, now)) {
    return null;
  }

  return challenge;
}

export function isValidToken(candidate?: string | null, now = Date.now()): boolean {
  if (getDashboardSession(candidate, now)) {
    return true;
  }

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

  if (!isWithinWindow(decoded.issuedAtSeconds, decoded.expiresAtSeconds, now)) {
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

export function getRequestDashboardSession(
  request: Pick<Request, "headers">,
  now = Date.now()
): DashboardSession | null {
  return getDashboardSession(getRequestSessionToken(request), now);
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

export function getSessionCookieMaxAge(candidate?: string | null, now = Date.now()): number {
  const session = getDashboardSession(candidate, now);
  if (session) {
    return Math.max(0, session.expiresAtSeconds - Math.floor(now / 1000));
  }

  return SESSION_TTL_SECONDS;
}
