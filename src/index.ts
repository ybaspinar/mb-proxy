import { Hono } from "hono";
import { cors } from "hono/cors";
import { createCache, buildCacheKey, TTL } from "./cache";
import { MbRateLimiter } from "./rate-limiter";
import type { AlbumSearchResult, AlbumEdition } from "./types";
import type { IReleaseGroupList, IRelease, ICoversInfo } from "musicbrainz-api";

export interface Env {
  MB_CACHE: KVNamespace;
  MB_RATE_LIMITER: DurableObjectNamespace;
  MB_USER_AGENT?: string;
}

const MB_BASE = "https://musicbrainz.org/ws/2";
const CAA_BASE = "https://coverartarchive.org";
const SEARCH_LIMIT = 12;
const EDITIONS_LIMIT = 25;

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

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

  const data = await cache.cached<AlbumSearchResult[]>(
    cacheKey,
    async () => {
      const query = buildSearchQuery({ artist, album, year, type });
      const url = `${MB_BASE}/release-group?query=${encodeURIComponent(query)}&fmt=json&limit=${SEARCH_LIMIT}`;

      const res = await fetchWithRateLimit(c.env, url);
      if (!res.ok) throw new Error(`MusicBrainz error: ${res.status}`);

      const mbData = (await res.json()) as IReleaseGroupList;

      return mbData["release-groups"]?.map((g) => ({
        id: g.id,
        title: g.title,
        artist: (g["artist-credit"] ?? [] as Array<{ name: string }>).map((ac) => ac.name).join(" & "),
        releaseDate: g["first-release-date"] ?? "",
        primaryType: g["primary-type"] ?? "",
      })) ?? [];
    },
    TTL.SEARCH,
  );

  return c.json(data);
});

// GET /release-group/:id/editions
app.get("/release-group/:id/editions", async (c) => {
  const id = c.req.param("id").trim();
  if (!id) return c.json({ error: "Missing release group ID" }, 400);

  const cache = createCache({ kv: c.env.MB_CACHE });
  const cacheKey = buildCacheKey(["v2", "editions", id]);

  const data = await cache.cached<AlbumEdition[]>(
    cacheKey,
    async () => {
      const url = `${MB_BASE}/release?release-group=${encodeURIComponent(id)}&inc=media&format=json&limit=${EDITIONS_LIMIT}`;
      const res = await fetchWithRateLimit(c.env, url);
      if (!res.ok) throw new Error(`MusicBrainz error: ${res.status}`);

      const mbData = (await res.json()) as { releases?: IRelease[] };

      return mbData.releases?.filter((r): r is IRelease & { id: string; title: string } => !!r.id && !!r.title)
        .map((r) => {
          const media = r.media ?? [];
          const formats = [...new Set(media.map((m: { format?: string }) => m.format?.trim()).filter(Boolean) as string[])];
          const trackCount = media.reduce((s: number, m: { "track-count"?: number }) => s + (m["track-count"] ?? 0), 0);
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

  return c.json(data);
});

// GET /release/:id/tracklist
app.get("/release/:id/tracklist", async (c) => {
  const id = c.req.param("id").trim();
  if (!id) return c.json({ error: "Missing release ID" }, 400);

  const cache = createCache({ kv: c.env.MB_CACHE });
  const cacheKey = buildCacheKey(["v2", "tracklist", id]);

  const data = await cache.cached<string[]>(
    cacheKey,
    async () => {
      const url = `${MB_BASE}/release/${encodeURIComponent(id)}?inc=recordings&fmt=json`;
      const res = await fetchWithRateLimit(c.env, url);
      if (!res.ok) throw new Error(`MusicBrainz error: ${res.status}`);

      const mbData = (await res.json()) as {
        media?: Array<{ tracks?: Array<{ title?: string }> }>;
      };

      return mbData.media?.flatMap((medium) =>
        medium.tracks?.map((t) => t.title?.replace(/\s+/g, " ").trim()).filter((t): t is string => !!t) ?? []
      ) ?? [];
    },
    TTL.TRACKLIST,
  );

  return c.json(data);
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

  const data = await cache.cached<{
    artworkUrl: string;
    thumbnails: { large?: string; small?: string };
  }>(
    cacheKey,
    async () => {
      const url = `${CAA_BASE}/${type}/${encodeURIComponent(id)}`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });

      if (res.status === 404) return { artworkUrl: "", thumbnails: {} };
      if (!res.ok) throw new Error(`Cover Art Archive error: ${res.status}`);

      const caaData = (await res.json()) as ICoversInfo;
      const images = caaData.images ?? [];
      const front = images.find((img: { front: boolean }) => img.front) ?? images[0];

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

  return c.json(data);
}

// ── Helpers ───────────────────────────────────────────────────

async function fetchWithRateLimit(env: Env, url: string, timeoutMs = 15000): Promise<Response> {
  const id = env.MB_RATE_LIMITER.idFromName("global");
  const stub = env.MB_RATE_LIMITER.get(id);
  return stub.fetch("http://rate-limiter/fetch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, timeoutMs }),
  });
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

export { MbRateLimiter };
export default app;
