/** Simple token-bucket rate limiter (requests per window). */
export class RateLimiter {
  private timestamps: number[] = [];

  constructor(
    private maxRequests: number,
    private windowMs = 10_000
  ) {}

  async acquire(): Promise<void> {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);
    if (this.timestamps.length >= this.maxRequests) {
      const wait = this.windowMs - (now - this.timestamps[0]) + 10;
      await new Promise((r) => setTimeout(r, Math.max(wait, 50)));
      return this.acquire();
    }
    this.timestamps.push(Date.now());
  }
}

export async function fetchJson<T>(
  url: string,
  opts: RequestInit & { limiter?: RateLimiter } = {}
): Promise<T | null> {
  const { limiter, ...init } = opts;
  if (limiter) await limiter.acquire();

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { Accept: "application/json", ...init.headers },
      });
      if (res.status >= 500) {
        await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 8000)));
        continue;
      }
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  return null;
}
