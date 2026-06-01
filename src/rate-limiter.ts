/**
 * Durable Object that acts as a global rate limiter for MusicBrainz API calls.
 *
 * This ensures all Worker isolates share a single rate limit queue,
 * preventing any burst of cache misses from hammering MusicBrainz.
 *
 * Rate: 1 request per 1.1 seconds (MusicBrainz asks for max 1 req/sec)
 */

const MIN_INTERVAL_MS = 1100;
const DEFAULT_TIMEOUT_MS = 15000;
const MB_BASE = "https://musicbrainz.org/ws/2";

export class MbRateLimiter {
  private lastRun = 0;
  private queue: Array<{
    url: string;
    timeoutMs: number;
    resolve: (response: Response) => void;
    reject: (reason: unknown) => void;
  }> = [];
  private processing = false;

  constructor(private state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const { url, timeoutMs = DEFAULT_TIMEOUT_MS } = (await request.json()) as {
      url: string;
      timeoutMs?: number;
    };

    // Validate URL is MusicBrainz or Cover Art Archive
    if (!url.startsWith(MB_BASE) && !url.startsWith("https://coverartarchive.org")) {
      return Response.json({ error: "Invalid upstream URL" }, { status: 400 });
    }

    return new Promise<Response>((resolve, reject) => {
      this.queue.push({ url, timeoutMs, resolve, reject });
      this.process();
    });
  }

  private async process(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const task = this.queue.shift()!;

      // Enforce rate limit
      const now = Date.now();
      const elapsed = now - this.lastRun;
      const delay = MIN_INTERVAL_MS - elapsed;
      if (delay > 0) {
        await sleep(delay);
      }
      this.lastRun = Date.now();

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), task.timeoutMs);

        const res = await fetch(task.url, {
          headers: {
            Accept: "application/json",
            "User-Agent": "album-poster-generator/0.2.0 (https://github.com/ybaspinar/mb-proxy)",
          },
          signal: controller.signal,
        });

        clearTimeout(timer);
        task.resolve(res);
      } catch (err) {
        task.reject(err);
      }
    }

    this.processing = false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
