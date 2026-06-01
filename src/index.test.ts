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
    ALLOWED_ORIGINS: "https://ybaspinar.dev",
  };
}

function createEnvWithoutAllowedOrigins(kv: MemoryKV): Env {
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

    const response = await app.request(
      "/search?artist=Radiohead&album=OK%20Computer",
      { headers: { Origin: "https://ybaspinar.dev" } },
      createEnv(kv),
    );

    expect(response.headers.get("X-Cache")).toBe("HIT");
    await expect(response.json()).resolves.toEqual(cached);
  });

  it("allows ybaspinar.dev by default when no origin env is configured", async () => {
    const kv = new MemoryKV();
    const cached: AlbumSearchResult[] = [];
    const key = buildCacheKey(["v2", "search", "radiohead", "ok computer", "", ""]);
    await kv.put(key, JSON.stringify(cached));

    const response = await app.request(
      "/search?artist=Radiohead&album=OK%20Computer",
      { headers: { Origin: "https://ybaspinar.dev" } },
      createEnvWithoutAllowedOrigins(kv),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://ybaspinar.dev");
  });

  it("rejects API requests from other origins", async () => {
    const response = await app.request(
      "/search?artist=Radiohead&album=OK%20Computer",
      { headers: { Origin: "https://evil.example" } },
      createEnv(new MemoryKV()),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden origin" });
  });

  it("rejects API requests without an origin", async () => {
    const response = await app.request("/search?artist=Radiohead&album=OK%20Computer", {}, createEnv(new MemoryKV()));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden origin" });
  });

  it("allows preflight requests from ybaspinar.dev", async () => {
    const response = await app.request(
      "/search?artist=Radiohead&album=OK%20Computer",
      {
        method: "OPTIONS",
        headers: {
          Origin: "https://ybaspinar.dev",
          "Access-Control-Request-Method": "GET",
        },
      },
      createEnv(new MemoryKV()),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://ybaspinar.dev");
  });
});
