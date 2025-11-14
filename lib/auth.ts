const AUTHORIZATION_PREFIX = "Bearer ";

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
  const token = process.env.DASHBOARD_TOKEN;
  return typeof token === "string" && token.length > 0 ? token : null;
}

export function isValidToken(candidate?: string | null): boolean {
  const expected = getExpectedToken();
  if (!expected) {
    return false;
  }
  return candidate === expected;
}

export function isValidAuthorizationHeader(value?: string | null): boolean {
  return isValidToken(parseAuthorizationHeader(value));
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
