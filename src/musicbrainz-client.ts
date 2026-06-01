import { MusicBrainzApi } from "musicbrainz-api";
import type { IRelease, IReleaseGroupList, IBrowseReleasesResult } from "musicbrainz-api";

export interface MusicBrainzConfigEnv {
  MB_APP_NAME?: string;
  MB_APP_VERSION?: string;
  MB_APP_CONTACT?: string;
}


export type MusicBrainzOperation =
  | { kind: "searchReleaseGroups"; query: string; limit: number }
  | { kind: "browseReleaseGroupEditions"; releaseGroupId: string; limit: number }
  | { kind: "lookupReleaseTracklist"; releaseId: string };

export type MusicBrainzOperationResult = IReleaseGroupList | IBrowseReleasesResult | IRelease;

export interface MusicBrainzClient {
  search(entity: "release-group", query: { query: string; limit: number }): Promise<IReleaseGroupList>;
  browse(
    entity: "release",
    query: { "release-group": string; limit: number },
    inc: ["media"],
  ): Promise<IBrowseReleasesResult>;
  lookup(entity: "release", mbid: string, inc: ["recordings"]): Promise<IRelease>;
}

export function createMusicBrainzConfig(env: MusicBrainzConfigEnv = {}) {
  const missing = missingMusicBrainzConfig(env);
  if (missing.length > 0) {
    throw new Error(`Missing MusicBrainz app identity: ${missing.join(", ")}`);
  }

  return {
    appName: env.MB_APP_NAME,
    appVersion: env.MB_APP_VERSION,
    appContactInfo: env.MB_APP_CONTACT,
    disableRateLimiting: true,
  };
}

function missingMusicBrainzConfig(env: MusicBrainzConfigEnv): string[] {
  const missing: string[] = [];
  if (!env.MB_APP_NAME) missing.push("MB_APP_NAME");
  if (!env.MB_APP_VERSION) missing.push("MB_APP_VERSION");
  if (!env.MB_APP_CONTACT) missing.push("MB_APP_CONTACT");
  return missing;
}

export function createMusicBrainzClient(env?: MusicBrainzConfigEnv): MusicBrainzClient {
  return new MusicBrainzApi(createMusicBrainzConfig(env));
}

export function isMusicBrainzOperation(value: unknown): value is MusicBrainzOperation {
  if (!value || typeof value !== "object") return false;
  const operation = value as Partial<MusicBrainzOperation>;
  switch (operation.kind) {
    case "searchReleaseGroups":
      return typeof operation.query === "string" && typeof operation.limit === "number";
    case "browseReleaseGroupEditions":
      return typeof operation.releaseGroupId === "string" && typeof operation.limit === "number";
    case "lookupReleaseTracklist":
      return typeof operation.releaseId === "string";
    default:
      return false;
  }
}

export async function runMusicBrainzOperation(
  operation: MusicBrainzOperation,
  client?: MusicBrainzClient,
  env?: MusicBrainzConfigEnv,
): Promise<MusicBrainzOperationResult> {
  const musicBrainzClient = client ?? createMusicBrainzClient(env);
  switch (operation.kind) {
    case "searchReleaseGroups":
      return musicBrainzClient.search("release-group", {
        query: operation.query,
        limit: operation.limit,
      });
    case "browseReleaseGroupEditions":
      return musicBrainzClient.browse(
        "release",
        { "release-group": operation.releaseGroupId, limit: operation.limit },
        ["media"],
      );
    case "lookupReleaseTracklist":
      return musicBrainzClient.lookup("release", operation.releaseId, ["recordings"]);
  }
}
