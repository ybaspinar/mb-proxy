/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const wranglerConfig = JSON.parse(readFileSync("wrangler.jsonc", "utf8")) as {
  kv_namespaces?: Array<Record<string, unknown>>;
  vars?: Record<string, unknown>;
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
});
