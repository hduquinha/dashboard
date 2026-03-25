import {
  assertAuthenticatedRequest,
  createSessionValue,
  DASHBOARD_COOKIE_NAME,
  isValidToken,
  UnauthorizedError,
} from "@/lib/auth";

function buildRequest(options?: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
}): Pick<Request, "headers" | "method" | "url"> {
  return {
    method: options?.method ?? "GET",
    url: options?.url ?? "https://dashboard.local/api/test",
    headers: new Headers(options?.headers),
  };
}

describe("lib/auth", () => {
  const originalToken = process.env.DASHBOARD_TOKEN;
  const originalSessionSecret = process.env.DASHBOARD_SESSION_SECRET;

  beforeEach(() => {
    process.env.DASHBOARD_TOKEN = "test-token";
    process.env.DASHBOARD_SESSION_SECRET = "test-session-secret";
  });

  afterAll(() => {
    process.env.DASHBOARD_TOKEN = originalToken;
    process.env.DASHBOARD_SESSION_SECRET = originalSessionSecret;
  });

  it("creates signed session values without exposing the raw token", () => {
    const now = Date.parse("2026-03-25T12:00:00.000Z");
    const sessionValue = createSessionValue(now);

    expect(sessionValue).not.toBeNull();
    expect(sessionValue).not.toBe("test-token");
    expect(isValidToken(sessionValue, now + 1_000)).toBe(true);
    expect(isValidToken("test-token", now + 1_000)).toBe(true);
    expect(isValidToken(sessionValue, now + 31 * 24 * 60 * 60 * 1000)).toBe(false);
  });

  it("accepts bearer authentication for mutating requests", () => {
    const request = buildRequest({
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
      },
    });

    expect(() => assertAuthenticatedRequest(request)).not.toThrow();
  });

  it("accepts same-origin cookie authentication for mutating requests", () => {
    const sessionValue = createSessionValue();
    const request = buildRequest({
      method: "POST",
      headers: {
        cookie: `${DASHBOARD_COOKIE_NAME}=${encodeURIComponent(sessionValue ?? "")}`,
        origin: "https://dashboard.local",
        "x-forwarded-host": "dashboard.local",
        "x-forwarded-proto": "https",
      },
    });

    expect(() => assertAuthenticatedRequest(request)).not.toThrow();
  });

  it("rejects cross-site cookie authentication for mutating requests", () => {
    const sessionValue = createSessionValue();
    const request = buildRequest({
      method: "POST",
      headers: {
        cookie: `${DASHBOARD_COOKIE_NAME}=${encodeURIComponent(sessionValue ?? "")}`,
        origin: "https://evil.local",
        "x-forwarded-host": "dashboard.local",
        "x-forwarded-proto": "https",
      },
    });

    expect(() => assertAuthenticatedRequest(request)).toThrow(UnauthorizedError);
  });

  it("accepts cookie authentication for safe GET requests without origin", () => {
    const sessionValue = createSessionValue();
    const request = buildRequest({
      method: "GET",
      headers: {
        cookie: `${DASHBOARD_COOKIE_NAME}=${encodeURIComponent(sessionValue ?? "")}`,
      },
    });

    expect(() =>
      assertAuthenticatedRequest(request, {
        requireSameOriginForSession: false,
      })
    ).not.toThrow();
  });
});
