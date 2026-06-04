import {
  isMusicBrainzOperation,
  runMusicBrainzOperation,
  type MusicBrainzConfigEnv,
  type MusicBrainzOperation,
} from "./musicbrainz-client";

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

interface RateLimiterRequest {
  operation: MusicBrainzOperation;
  timeoutMs?: number;
  config?: MusicBrainzConfigEnv;
}

interface QueuedTask {
  key: string;
  operation: MusicBrainzOperation;
  timeoutMs: number;
  config: MusicBrainzConfigEnv | undefined;
  resolve: (response: Response) => void;
  reject: (reason: unknown) => void;
}

export class MbRateLimiter {
  private lastRun = 0;
  private queue: QueuedTask[] = [];
  private inFlight = new Map<string, Promise<Response>>();
  private processing = false;

  async fetch(request: Request): Promise<Response> {
    const payload = (await request.json()) as Partial<RateLimiterRequest>;
    if (!isMusicBrainzOperation(payload.operation)) {
      return Response.json({ error: "Invalid MusicBrainz operation" }, { status: 400 });
    }

    const timeoutMs = payload.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const key = JSON.stringify(payload.operation);
    let inFlight = this.inFlight.get(key);

    if (!inFlight) {
      const { promise, resolve, reject } = Promise.withResolvers<Response>();
      inFlight = promise.finally(() => {
        this.inFlight.delete(key);
      });
      this.inFlight.set(key, inFlight);
      this.queue.push({ key, operation: payload.operation, timeoutMs, config: payload.config, resolve, reject });
      void this.process();
    }

    const response = await inFlight;
    return response.clone();
  }

  private async process(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      while (this.queue.length > 0) {
        const task = this.queue.shift();
        if (!task) continue;

        const now = Date.now();
        const elapsed = now - this.lastRun;
        const delay = MIN_INTERVAL_MS - elapsed;
        if (delay > 0) {
          await sleep(delay);
        }
        this.lastRun = Date.now();

        try {
          const data = await withTimeout(runMusicBrainzOperation(task.operation, undefined, task.config), task.timeoutMs);
          task.resolve(Response.json(data));
        } catch (err) {
          const message = err instanceof Error ? err.message : "MusicBrainz request failed";
          task.resolve(Response.json({ error: message }, { status: 502 }));
        }
      }
    } finally {
      this.processing = false;
    }
  }
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  const timeout = Promise.withResolvers<never>();
  const timer = setTimeout(() => {
    timeout.reject(new DOMException("MusicBrainz operation timed out", "TimeoutError"));
  }, timeoutMs);

  try {
    return await Promise.race([operation, timeout.promise]);
  } finally {
    clearTimeout(timer);
  }
}
