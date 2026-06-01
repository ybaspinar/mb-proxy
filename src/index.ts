import { Hono } from "hono";
import { CoverArtArchiveApi } from "musicbrainz-api";
import { createCache, buildCacheKey, TTL, type CacheStatus } from "./cache";
import { MbRateLimiter } from "./rate-limiter";
import type { AlbumSearchResult, AlbumEdition } from "./types";
import type { IBrowseReleasesResult, ICoversInfo, IRelease, IReleaseGroupList } from "musicbrainz-api";
import type { MusicBrainzConfigEnv, MusicBrainzOperation } from "./musicbrainz-client";

export interface Env extends MusicBrainzConfigEnv {
  MB_CACHE: KVNamespace;
  MB_RATE_LIMITER: DurableObjectNamespace;
  ALLOWED_ORIGINS?: string;
}

const SEARCH_LIMIT = 12;
const EDITIONS_LIMIT = 25;
const CACHE_CONTROL = "public, max-age=86400, stale-while-revalidate=604800";
const DEFAULT_ALLOWED_ORIGINS = "https://ybaspinar.dev";

const app = new Hono<{ Bindings: Env }>();
app.use("*", async (c, next) => {
  const origin = c.req.header("Origin");
  if (!isAllowedOrigin(c.env, origin)) {
    return c.json({ error: "Forbidden origin" }, 403);
  }

  if (c.req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(origin),
    });
  }

  await next();
  for (const [key, value] of Object.entries(corsHeaders(origin))) {
    c.res.headers.set(key, value);
  }
});

app.get("/", (c) => {
  return c.json({ ok: true, service: "mb-proxy", version: "0.2.0" });
});

// GET /search?artist=...&album=...&year=...&type=...
app.get("/search", async (c) => {
  const artist = c.req.query("artist")?.trim() ?? "";
  const album = c.req.query("album")?.trim() ?? "";
  const year = c.req.query("year")?.trim() ?? "";
  const type = c.req.query("type")?.trim() ?? "";

  if (!artist && !album) {
    return c.json({ error: "Provide at least artist or album" }, 400);
  }

  const cache = createCache({ kv: c.env.MB_CACHE });
  const cacheKey = buildCacheKey(["v2", "search", normalize(artist), normalize(album), year, normalize(type)]);

  const result = await cache.cachedWithStatus<AlbumSearchResult[]>(
    cacheKey,
    async () => {
      const query = buildSearchQuery({ artist, album, year, type });
      const mbData = await fetchWithRateLimit<IReleaseGroupList>(c.env, {
        kind: "searchReleaseGroups",
        query,
        limit: SEARCH_LIMIT,
      });

      return mbData["release-groups"]?.map((g) => ({
        id: g.id,
        title: g.title,
        artist: (g["artist-credit"] ?? []).map((ac) => ac.name).join(" & "),
        releaseDate: g["first-release-date"] ?? "",
        primaryType: g["primary-type"] ?? "",
      })) ?? [];
    },
    TTL.SEARCH,
  );

  return jsonWithCache(c, result.data, result.status);
});

// GET /release-group/:id/editions
app.get("/release-group/:id/editions", async (c) => {
  const id = c.req.param("id").trim();
  if (!id) return c.json({ error: "Missing release group ID" }, 400);

  const cache = createCache({ kv: c.env.MB_CACHE });
  const cacheKey = buildCacheKey(["v2", "editions", id]);

  const result = await cache.cachedWithStatus<AlbumEdition[]>(
    cacheKey,
    async () => {
      const mbData = await fetchWithRateLimit<IBrowseReleasesResult>(c.env, {
        kind: "browseReleaseGroupEditions",
        releaseGroupId: id,
        limit: EDITIONS_LIMIT,
      });

      return mbData.releases?.filter((r): r is IRelease & { id: string; title: string } => !!r.id && !!r.title)
        .map((r) => {
          const media = r.media ?? [];
          const formats = [...new Set(media.map((m) => m.format?.trim()).filter((format): format is string => !!format))];
          const trackCount = media.reduce((sum, medium) => sum + (medium["track-count"] ?? 0), 0);
          return {
            id: r.id,
            title: r.title,
            releaseDate: r.date ?? "",
            country: r.country ?? "",
            formats,
            trackCount,
          };
        }) ?? [];
    },
    TTL.RELEASE,
  );

  return jsonWithCache(c, result.data, result.status);
});

// GET /release/:id/tracklist
app.get("/release/:id/tracklist", async (c) => {
  const id = c.req.param("id").trim();
  if (!id) return c.json({ error: "Missing release ID" }, 400);

  const cache = createCache({ kv: c.env.MB_CACHE });
  const cacheKey = buildCacheKey(["v2", "tracklist", id]);

  const result = await cache.cachedWithStatus<string[]>(
    cacheKey,
    async () => {
      const mbData = await fetchWithRateLimit<IRelease>(c.env, {
        kind: "lookupReleaseTracklist",
        releaseId: id,
      });

      return mbData.media?.flatMap((medium) =>
        medium.tracks?.map((track) => track.title?.replace(/\s+/g, " ").trim()).filter((title): title is string => !!title) ?? []
      ) ?? [];
    },
    TTL.TRACKLIST,
  );

  return jsonWithCache(c, result.data, result.status);
});

// GET /release/:id/cover
app.get("/release/:id/cover", async (c) => {
  return handleCover(c, "release");
});

// GET /release-group/:id/cover
app.get("/release-group/:id/cover", async (c) => {
  return handleCover(c, "release-group");
});

async function handleCover(
  c: {
    req: { param: (key: string) => string };
    env: Env;
    json: (data: unknown, status?: number) => Response;
  },
  type: "release" | "release-group",
): Promise<Response> {
  const id = c.req.param("id").trim();
  if (!id) return c.json({ error: "Missing id" }, 400);

  const cache = createCache({ kv: c.env.MB_CACHE });
  const cacheKey = buildCacheKey(["v2", "cover", type, id]);

  const result = await cache.cachedWithStatus<{
    artworkUrl: string;
    thumbnails: { large?: string; small?: string };
  }>(
    cacheKey,
    async () => {
      const caa = new CoverArtArchiveApi();
      const caaData = type === "release"
        ? await caa.getReleaseCovers(id)
        : await caa.getReleaseGroupCovers(id);

      if (!hasCoverImages(caaData)) return { artworkUrl: "", thumbnails: {} };

      const front = caaData.images.find((img) => img.front) ?? caaData.images[0];

      return {
        artworkUrl: front?.image ?? "",
        thumbnails: {
          large: front?.thumbnails?.large ?? "",
          small: front?.thumbnails?.small ?? "",
        },
      };
    },
    TTL.COVER_ART,
  );

  return jsonWithCache(c, result.data, result.status);
}

// ── Helpers ───────────────────────────────────────────────────

async function fetchWithRateLimit<T>(env: Env, operation: MusicBrainzOperation, timeoutMs = 15000): Promise<T> {
  const id = env.MB_RATE_LIMITER.idFromName("global");
  const stub = env.MB_RATE_LIMITER.get(id);
  const response = await stub.fetch("http://rate-limiter/fetch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation, timeoutMs, config: musicBrainzConfigFromEnv(env) }),
  });

  if (!response.ok) throw new Error(`MusicBrainz error: ${response.status}`);
  return response.json() as Promise<T>;
}

function musicBrainzConfigFromEnv(env: Env): MusicBrainzConfigEnv {
  return {
    MB_APP_NAME: env.MB_APP_NAME,
    MB_APP_VERSION: env.MB_APP_VERSION,
    MB_APP_CONTACT: env.MB_APP_CONTACT,
  };
}

function isAllowedOrigin(env: Env, origin: string | undefined): origin is string {
  if (!origin) return false;
  const allowedOrigins = (env.ALLOWED_ORIGINS ?? DEFAULT_ALLOWED_ORIGINS).split(",");
  for (const allowedOrigin of allowedOrigins) {
    if (origin === allowedOrigin.trim()) return true;
  }
  return false;
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function jsonWithCache(
  c: { json: (data: unknown) => Response },
  data: unknown,
  status: CacheStatus,
): Response {
  const response = c.json(data);
  response.headers.set("X-Cache", status);
  response.headers.set("Cache-Control", CACHE_CONTROL);
  return response;
}

function buildSearchQuery(params: { artist: string; album: string; year: string; type: string }): string {
  const clauses: string[] = [];
  if (params.artist) clauses.push(`artist:"${params.artist}"`);
  if (params.album) clauses.push(`releasegroup:"${params.album}"`);
  if (params.year) clauses.push(`date:${params.year}`);
  if (params.type) clauses.push(`primarytype:${capitalize(params.type)}`);
  return clauses.join(" AND ");
}

function normalize(input: string): string {
  return input.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").replace(/\s+/g, " ").trim();
}

function capitalize(input: string): string {
  if (!input) return "";
  return input.charAt(0).toUpperCase() + input.slice(1);
}

function hasCoverImages(value: unknown): value is ICoversInfo {
  return typeof value === "object" && value !== null && Array.isArray((value as { images?: unknown }).images);
}

export { MbRateLimiter };
export default app;
