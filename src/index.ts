import { Hono } from "hono";
import { cors } from "hono/cors";
import { createCache, buildCacheKey, TTL } from "./cache";
import { fetchMusicBrainz } from "./rate-limit";
import type {
  AlbumSearchResult,
  AlbumEdition,
  MusicBrainzReleaseGroupResponse,
  MusicBrainzReleaseListResponse,
  MusicBrainzReleaseDetailResponse,
  CoverArtResponse,
} from "./types";

export interface Env {
  MB_CACHE: KVNamespace;
  MB_USER_AGENT?: string;
}

const MB_BASE = "https://musicbrainz.org/ws/2";
const CAA_BASE = "https://coverartarchive.org";
const SEARCH_LIMIT = 12;
const EDITIONS_LIMIT = 25;

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

app.get("/", (c) => {
  return c.json({ ok: true, service: "mb-proxy", version: "0.1.0" });
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

  const ua = c.env.MB_USER_AGENT || "mb-proxy/0.1.0 (https://github.com/ybaspinar/mb-proxy)";
  const cache = createCache({ kv: c.env.MB_CACHE });
  const cacheKey = buildCacheKey([
    "mb", "search", normalize(artist), normalize(album), year, normalize(type),
  ]);

  const data = await cache.cached<AlbumSearchResult[]>(
    cacheKey,
    async () => {
      const clauses: string[] = [];
      if (artist) clauses.push(`artist:"${artist}"`);
      if (album) clauses.push(`releasegroup:"${album}"`);
      if (year) clauses.push(`date:${year}`);
      if (type) clauses.push(`primarytype:${capitalize(type)}`);

      const mbUrl = `${MB_BASE}/release-group?query=${encodeURIComponent(clauses.join(" AND "))}&fmt=json&limit=${SEARCH_LIMIT}`;
      const res = await fetchMusicBrainz(mbUrl, ua);

      if (res.status === 429 || res.status === 503) return [];
      if (!res.ok) throw new Error(`MusicBrainz error: ${res.status}`);

      const mbData = (await res.json()) as MusicBrainzReleaseGroupResponse;

      return (mbData["release-groups"] ?? [])
        .filter((g): g is { id: string; title: string } & typeof g => !!g.id && !!g.title)
        .map((g) => ({
          id: g.id!,
          title: g.title!,
          artist: g["artist-credit"]?.map((a) => a.name?.trim()).filter(Boolean).join(" & ") ?? "",
          releaseDate: g["first-release-date"] ?? "",
          primaryType: g["primary-type"] ?? "",
        }));
    },
    TTL.SEARCH,
  );

  return c.json(data);
});

// GET /release-group/:id/editions
app.get("/release-group/:id/editions", async (c) => {
  const id = c.req.param("id").trim();
  if (!id) return c.json({ error: "Missing release group ID" }, 400);

  const ua = c.env.MB_USER_AGENT || "mb-proxy/0.1.0";
  const cache = createCache({ kv: c.env.MB_CACHE });
  const cacheKey = buildCacheKey(["mb", "editions", id]);

  const data = await cache.cached<AlbumEdition[]>(
    cacheKey,
    async () => {
      const mbUrl = `${MB_BASE}/release?release-group=${encodeURIComponent(id)}&inc=media&format=json&limit=${EDITIONS_LIMIT}`;
      const res = await fetchMusicBrainz(mbUrl, ua);

      if (res.status === 429 || res.status === 503) return [];
      if (!res.ok) throw new Error(`MusicBrainz error: ${res.status}`);

      const mbData = (await res.json()) as MusicBrainzReleaseListResponse;

      return (mbData.releases ?? [])
        .filter((r): r is { id: string; title: string } & typeof r => !!r.id && !!r.title)
        .map((r) => ({
          id: r.id!,
          title: r.title!,
          releaseDate: r.date ?? "",
          country: r.country ?? "",
          formats: [...new Set((r.media ?? []).map((m) => m.format?.trim()).filter(Boolean) as string[])],
          trackCount: (r.media ?? []).reduce((sum, m) => sum + (m.tracks?.length ?? 0), 0),
        }));
    },
    TTL.RELEASE,
  );

  return c.json(data);
});

// GET /release/:id/tracklist
app.get("/release/:id/tracklist", async (c) => {
  const id = c.req.param("id").trim();
  if (!id) return c.json({ error: "Missing release ID" }, 400);

  const ua = c.env.MB_USER_AGENT || "mb-proxy/0.1.0";
  const cache = createCache({ kv: c.env.MB_CACHE });
  const cacheKey = buildCacheKey(["mb", "tracklist", id]);

  const data = await cache.cached<string[]>(
    cacheKey,
    async () => {
      const mbUrl = `${MB_BASE}/release/${encodeURIComponent(id)}?inc=recordings&fmt=json`;
      const res = await fetchMusicBrainz(mbUrl, ua);

      if (res.status === 429 || res.status === 503) return [];
      if (!res.ok) throw new Error(`MusicBrainz error: ${res.status}`);

      const mbData = (await res.json()) as MusicBrainzReleaseDetailResponse;

      return (mbData.media ?? []).flatMap((medium) =>
        (medium.tracks ?? [])
          .map((t) => t.title?.replace(/\s+/g, " ").trim())
          .filter((t): t is string => Boolean(t)),
      );
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
  c: { req: { param: (key: string) => string }; env: Env; json: (data: unknown, status?: number) => Response },
  type: "release" | "release-group",
) {
  const id = c.req.param("id").trim();
  if (!id) return c.json({ error: "Missing id" }, 400);

  const cache = createCache({ kv: c.env.MB_CACHE });
  const cacheKey = buildCacheKey(["mb", "cover", type, id]);

  const data = await cache.cached<{ artworkUrl: string; thumbnails: { large?: string; small?: string } }>(
    cacheKey,
    async () => {
      const url = `${CAA_BASE}/${type}/${encodeURIComponent(id)}`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });

      if (res.status === 404) return { artworkUrl: "", thumbnails: {} };
      if (!res.ok) throw new Error(`Cover Art Archive error: ${res.status}`);

      const caaData = (await res.json()) as CoverArtResponse;
      const images = caaData.images ?? [];
      const front = images.find((img) => img.front) ?? images[0];

      const artworkUrl = front?.image ?? "";
      return {
        artworkUrl,
        thumbnails: front?.thumbnails ?? {},
      };
    },
    TTL.COVER_ART,
  );

  return c.json(data);
}

// ── Helpers ───────────────────────────────────────────────────

function normalize(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function capitalize(input: string): string {
  if (!input) return "";
  return input.charAt(0).toUpperCase() + input.slice(1);
}

export default app;
