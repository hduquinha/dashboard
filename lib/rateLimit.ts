type RateLimitRecord = {
  hits: number[];
};

const stores = new Map<string, RateLimitRecord>();

function compactHits(hits: number[], windowMs: number, now: number): number[] {
  const threshold = now - windowMs;
  return hits.filter((timestamp) => timestamp > threshold);
}

export function getClientIp(request: Pick<Request, "headers">): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const forwardedIp = forwardedFor.split(",")[0]?.trim();
    if (forwardedIp) {
      return forwardedIp;
    }
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) {
    return realIp;
  }

  return "unknown";
}

export function consumeRateLimit(options: {
  key: string;
  maxHits: number;
  windowMs: number;
  now?: number;
}): { allowed: boolean; retryAfterSeconds: number } {
  const now = options.now ?? Date.now();
  const existingRecord = stores.get(options.key);
  const hits = compactHits(existingRecord?.hits ?? [], options.windowMs, now);

  if (hits.length >= options.maxHits) {
    const oldestHit = hits[0] ?? now;
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((oldestHit + options.windowMs - now) / 1000)
    );

    stores.set(options.key, { hits });
    return { allowed: false, retryAfterSeconds };
  }

  hits.push(now);
  stores.set(options.key, { hits });

  return { allowed: true, retryAfterSeconds: 0 };
}

export function peekRateLimit(options: {
  key: string;
  maxHits: number;
  windowMs: number;
  now?: number;
}): { allowed: boolean; retryAfterSeconds: number } {
  const now = options.now ?? Date.now();
  const existingRecord = stores.get(options.key);
  const hits = compactHits(existingRecord?.hits ?? [], options.windowMs, now);

  stores.set(options.key, { hits });

  if (hits.length < options.maxHits) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const oldestHit = hits[0] ?? now;
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((oldestHit + options.windowMs - now) / 1000)),
  };
}

export function resetRateLimit(key: string): void {
  stores.delete(key);
}
