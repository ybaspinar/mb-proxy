/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const wranglerConfig = JSON.parse(readFileSync("wrangler.jsonc", "utf8")) as {
  kv_namespaces?: Array<Record<string, unknown>>;
  vars?: Record<string, unknown>;
  workers_dev?: boolean;
  preview_urls?: boolean;
  routes?: Array<Record<string, unknown>>;
};

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts?: Record<string, string>;
};

describe("forkable wrangler config", () => {
  it("does not hard-code a deployer-specific KV namespace id", () => {
    expect(wranglerConfig.kv_namespaces).toEqual([{ binding: "MB_CACHE" }]);
  });

  it("does not ship deployer-specific MusicBrainz identity defaults", () => {
    expect("vars" in wranglerConfig).toBe(false);
  });

  it("keeps dashboard-managed Worker variables during deploy", () => {
    expect(packageJson.scripts?.deploy).toContain("--keep-vars");
  });

  it("keeps deployment on the ybaspinar.dev custom domain only", () => {
    expect(wranglerConfig.workers_dev).toBe(false);
    expect(wranglerConfig.preview_urls).toBe(false);
    expect(wranglerConfig.routes).toEqual([
      {
        pattern: "mb-proxy.ybaspinar.dev",
        zone_name: "ybaspinar.dev",
        custom_domain: true,
      },
    ]);
  });
});
