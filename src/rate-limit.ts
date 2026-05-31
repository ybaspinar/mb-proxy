/**
 * Global rate limiter for upstream MusicBrainz API calls.
 *
 * Uses a module-level queue so all requests within a single Worker isolate
 * are serialized. For perfect global rate limiting across isolates, use a
 * Durable Object. For MVP traffic, per-isolate limiting + KV cache is enough.
 */

type PendingTask<T> = {
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  execute: () => Promise<T>;
};

export class RateLimiter {
  private queue: PendingTask<unknown>[] = [];
  private running = false;
  private minIntervalMs: number;
  private lastRun = 0;

  constructor(minIntervalMs = 1100) {
    this.minIntervalMs = minIntervalMs;
  }

  async schedule<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        resolve: resolve as (value: unknown) => void,
        reject,
        execute: fn,
      });
      this.process();
    });
  }

  private async process(): Promise<void> {
    if (this.running) return;
    this.running = true;

    while (this.queue.length > 0) {
      const task = this.queue.shift()!;
      const now = Date.now();
      const elapsed = now - this.lastRun;
      const delay = this.minIntervalMs - elapsed;

      if (delay > 0) {
        await sleep(delay);
      }

      this.lastRun = Date.now();

      try {
        const result = await task.execute();
        task.resolve(result);
      } catch (err) {
        task.reject(err);
      }
    }

    this.running = false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Singleton — module scope is isolate-scoped */
export const mbRateLimiter = new RateLimiter(1100);

/**
 * Fetch from MusicBrainz with rate limiting, timeout, and proper User-Agent.
 */
export async function fetchMusicBrainz(
  url: string,
  userAgent: string,
  timeoutMs = 8000,
): Promise<Response> {
  return mbRateLimiter.schedule(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": userAgent,
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  });
}
