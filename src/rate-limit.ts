// Token-bucket rate limiter that runs entirely in-memory per isolate.
// MusicBrainz asks for ≤ 1 req/sec for non-commercial use.
// We enforce conservative pacing: max 1 request per 1.2 seconds.

const MIN_INTERVAL_MS = 1_200;
let lastRequestMs = 0;
let waiters: Array<() => void> = [];

async function acquireMs(waitMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (waitMs <= 0) {
      resolve();
      return;
    }
    // Schedule waiter: it will be released after the required delay.
    const started = Date.now();
    const tryRelease = () => {
      const elapsed = Date.now() - started;
      if (elapsed >= waitMs) {
        resolve();
      } else {
        setTimeout(tryRelease, waitMs - elapsed);
      }
    };
    setTimeout(tryRelease, waitMs);
  });
}

export async function rateLimit(): Promise<void> {
  const nowMs = Date.now();
  const elapsed = nowMs - lastRequestMs;
  const waitMs = MIN_INTERVAL_MS - elapsed;

  lastRequestMs = nowMs + Math.max(0, waitMs);
  await acquireMs(waitMs);
}
