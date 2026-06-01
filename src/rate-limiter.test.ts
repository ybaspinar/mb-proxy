import { afterEach, describe, expect, it, vi } from "vitest";
import { MbRateLimiter } from "./rate-limiter";

describe("MbRateLimiter", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("deduplicates concurrent identical MusicBrainz operations", async () => {
    vi.useFakeTimers();
    const limiter = new MbRateLimiter();
    let upstreamCalls = 0;

    vi.stubGlobal("fetch", () => {
      upstreamCalls += 1;
      return Promise.resolve(Response.json({ ok: true }));
    });

    const body = JSON.stringify({
      operation: {
        kind: "searchReleaseGroups",
        query: 'artist:"radiohead"',
        limit: 12,
      },
      timeoutMs: 15000,
      config: {
        MB_APP_NAME: "test-app",
        MB_APP_VERSION: "0.0.0",
        MB_APP_CONTACT: "https://example.com",
      },
    });

    const first = limiter.fetch(new Request("http://rate-limiter/fetch", { method: "POST", body }));
    const second = limiter.fetch(new Request("http://rate-limiter/fetch", { method: "POST", body }));

    await vi.runAllTimersAsync();
    const responses = await Promise.all([first, second]);

    expect(upstreamCalls).toBe(1);
    await expect(responses[0].json()).resolves.toEqual({ ok: true });
    await expect(responses[1].json()).resolves.toEqual({ ok: true });
  });
});
