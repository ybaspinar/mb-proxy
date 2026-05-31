// Token-bucket rate limiter that runs in-memory per isolate.
// MusicBrainz asks for ≤ 1 req/sec for non-commercial use.
// We enforce conservative pacing: max 1 request per 1.2 seconds.

const MIN_INTERVAL_MS = 1_200;
let lastRequestMs = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0) {
      resolve();
      return;
    }
    setTimeout(resolve, ms);
  });
}

export async function rateLimit(): Promise<void> {
  const nowMs = Date.now();
  const elapsed = nowMs - lastRequestMs;
  const waitMs = MIN_INTERVAL_MS - elapsed;

  lastRequestMs = nowMs + Math.max(0, waitMs);
  await sleep(waitMs);
}
