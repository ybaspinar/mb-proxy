import { describe, expect, it } from "vitest";
import { createMusicBrainzConfig, runMusicBrainzOperation, type MusicBrainzClient } from "./musicbrainz-client";

describe("createMusicBrainzConfig", () => {
  it("uses deployer-provided app identity for MusicBrainz user agent", () => {
    expect(createMusicBrainzConfig({
      MB_APP_NAME: "my-fork",
      MB_APP_VERSION: "1.2.3",
      MB_APP_CONTACT: "https://example.com/contact",
    })).toEqual({
      appName: "my-fork",
      appVersion: "1.2.3",
      appContactInfo: "https://example.com/contact",
      disableRateLimiting: true,
    });
  });

  it("rejects missing app identity instead of falling back to repository defaults", () => {
    expect(() => createMusicBrainzConfig({})).toThrow(
      "Missing MusicBrainz app identity: MB_APP_NAME, MB_APP_VERSION, MB_APP_CONTACT",
    );
  });
});

describe("runMusicBrainzOperation", () => {
  it("uses musicbrainz-api search for release group searches", async () => {
    const calls: Array<{ entity: string; query: unknown }> = [];
    const searchResult = { "release-groups": [], count: 0, offset: 0, created: new Intl.DateTimeFormat() };
    const client: MusicBrainzClient = {
      async search(entity, query) {
        calls.push({ entity, query });
        return searchResult;
      },
      async browse() {
        throw new Error("browse should not be called");
      },
      async lookup() {
        throw new Error("lookup should not be called");
      },
    };

    const result = await runMusicBrainzOperation(
      { kind: "searchReleaseGroups", query: 'artist:"Radiohead" AND releasegroup:"OK Computer"', limit: 12 },
      client,
    );

    expect(result).toBe(searchResult);
    expect(calls).toEqual([
      {
        entity: "release-group",
        query: { query: 'artist:"Radiohead" AND releasegroup:"OK Computer"', limit: 12 },
      },
    ]);
  });
});
