import { describe, it, expect, beforeAll } from "vitest";
import worker from "../src/index";

// Helper to create a mock KV namespace
function createMockKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string, type?: string) => {
      const val = store.get(key);
      if (val == null) return null;
      if (type === "text") return val;
      if (type === "json") return JSON.parse(val);
      if (type === "arrayBuffer") return new TextEncoder().encode(val).buffer;
      return val;
    },
    put: async (key: string, value: string | ArrayBuffer | ReadableStream, opts?: any) => {
      if (typeof value === "string") {
        store.set(key, value);
      }
      return;
    },
    delete: async (key: string) => {
      store.delete(key);
      return;
    },
    list: async () => ({ keys: [], list_complete: true, cursor: undefined }),
    getWithMetadata: async () => ({ value: null, metadata: null, cacheStatus: null }),
  } as unknown as KVNamespace;
}

function createEnv(): any {
  return { MB_CACHE: createMockKV() };
}

describe("mb-proxy", () => {
  it("health check returns ok", async () => {
    const env = createEnv();
    const res = await worker.fetch(new Request("http://localhost/health"), env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe("ok");
    expect(body.service).toBe("mb-proxy");
  });

  it("returns 400 when search has no query", async () => {
    const env = createEnv();
    const res = await worker.fetch(new Request("http://localhost/search"), env);
    expect(res.status).toBe(400);
  });

  it("returns 405 for POST", async () => {
    const env = createEnv();
    const res = await worker.fetch(
      new Request("http://localhost/", { method: "POST" }),
      env,
    );
    expect(res.status).toBe(405);
  });

  it("returns 404 for unknown routes", async () => {
    const env = createEnv();
    const res = await worker.fetch(new Request("http://localhost/unknown"), env);
    expect(res.status).toBe(404);
  });

  it("handles CORS preflight", async () => {
    const env = createEnv();
    const res = await worker.fetch(
      new Request("http://localhost/search", { method: "OPTIONS" }),
      env,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
