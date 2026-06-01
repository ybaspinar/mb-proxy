import { describe, expect, it } from "vitest";
import app from "./index";
import { buildCacheKey } from "./cache";
import type { Env } from "./index";
import type { AlbumSearchResult } from "./types";

class MemoryKV {
  readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
}

function createEnv(kv: MemoryKV): Env {
  return {
    MB_CACHE: kv as unknown as KVNamespace,
    MB_RATE_LIMITER: {} as DurableObjectNamespace,
  };
}

describe("mb-proxy cache headers", () => {
  it("marks cached search responses as HIT", async () => {
    const kv = new MemoryKV();
    const cached: AlbumSearchResult[] = [
      {
        id: "b1392450-e666-3926-a536-22c65f834433",
        title: "OK Computer",
        artist: "Radiohead",
        releaseDate: "1997-05-21",
        primaryType: "Album",
      },
    ];
    const key = buildCacheKey(["v2", "search", "radiohead", "ok computer", "", ""]);
    await kv.put(key, JSON.stringify(cached));

    const response = await app.request("/search?artist=Radiohead&album=OK%20Computer", {}, createEnv(kv));

    expect(response.headers.get("X-Cache")).toBe("HIT");
    await expect(response.json()).resolves.toEqual(cached);
  });
});
