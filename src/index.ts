import type {
  WorkerEnv,
  MusicBrainzReleaseGroupSearch,
  MusicBrainzReleaseSearch,
  MusicBrainzRelease,
  CachedSearchResult,
  CachedAlbumItem,
  CachedTracklistResult,
  CachedTracklistItem,
} from "./types";
import { cacheGet, cachePut, CacheKeys, CacheTtl } from "./cache";
import { rateLimit } from "./rate-limit";

// ─── Constants ───

const MB_BASE = "https://musicbrainz.org/ws/2";
const CAA_BASE = "https://coverartarchive.org";
const UA = "AlbumPosterGenerator/1.0.0 (https://github.com/ybaspinar/album-poster-generator)";

// ─── Helpers ───

function jsonResponse(data: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Cache-Control": "public, max-age=300",
      ...extraHeaders,
    },
  });
}

function errorResponse(message: string, status = 500): Response {
  return jsonResponse({ error: message }, status);
}

function mbHeaders(): HeadersInit {
  return {
    "User-Agent": UA,
    Accept: "application/json",
  };
}

function formatMs(ms?: number): string | undefined {
  if (ms == null) return undefined;
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

function mapReleaseGroupToCached(rg: { id: string; title: string; "first-release-date"?: string; "primary-type"?: string; "artist-credit"?: Array<{ name: string; artist: { disambiguation?: string } }> }): CachedAlbumItem {
  return {
    id: rg.id,
    title: rg.title,
    artist: rg["artist-credit"]?.map((ac) => ac.name).join("") ?? "Unknown",
    year: rg["first-release-date"]?.slice(0, 4),
    type: rg["primary-type"],
    disambiguation: rg["artist-credit"]?.[0]?.artist?.disambiguation,
  };
}

function mapReleaseToCached(r: { id: string; title: string; date?: string; country?: string; "artist-credit"?: Array<{ name: string }>; media?: Array<{ format?: string; "track-count"?: number }> }): CachedAlbumItem {
  return {
    id: r.id,
    title: r.title,
    artist: r["artist-credit"]?.map((ac) => ac.name).join("") ?? "Unknown",
    year: r.date?.slice(0, 4),
    country: r.country,
    type: r.media?.[0]?.format,
    "track-count": r.media?.[0]?.["track-count"],
  };
}

// ─── Route handlers ───

async function handleSearch(
  env: WorkerEnv,
  url: URL,
): Promise<Response> {
  const query = url.searchParams.get("q")?.trim();
  const artist = url.searchParams.get("artist")?.trim();
  const title = url.searchParams.get("title")?.trim();
  const type = url.searchParams.get("type")?.trim();
  const offset = parseInt(url.searchParams.get("offset") ?? "0", 10) || 0;
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "25", 10) || 25, 100);

  if (!query && !artist && !title) {
    return errorResponse("Provide at least one of: q, artist, title", 400);
  }

  // Build the cache key from the full query set
  const cacheKey = CacheKeys.search(
    JSON.stringify({ query, artist, title, type, offset, limit }),
  );

  // Check cache
  const cached = await cacheGet<CachedSearchResult>(env, cacheKey);
  if (cached) {
    return jsonResponse(cached, 200, { "X-Cache": "HIT" });
  }

  // Build MusicBrainz query
  let mbQuery = "";
  if (query) {
    mbQuery = query;
  } else {
    const parts: string[] = [];
    if (artist) parts.push(`artist:${artist}`);
    if (title) parts.push(`release:${title}`);
    if (type) parts.push(`primarytype:${type}`);
    mbQuery = parts.join(" AND ");
  }

  const mbUrl = new URL(`${MB_BASE}/release-group/`);
  mbUrl.searchParams.set("query", mbQuery);
  mbUrl.searchParams.set("fmt", "json");
  mbUrl.searchParams.set("limit", String(limit));
  mbUrl.searchParams.set("offset", String(offset));

  await rateLimit();

  try {
    const res = await fetch(mbUrl.toString(), { headers: mbHeaders() });
    if (!res.ok) {
      return errorResponse(`MusicBrainz returned ${res.status}`, res.status);
    }
    const data = await res.json() as MusicBrainzReleaseGroupSearch;

    const result: CachedSearchResult = {
      meta: {
        count: data.count,
        offset: data.offset,
      },
      results: data["release-groups"].map(mapReleaseGroupToCached),
    };

    await cachePut(env, cacheKey, result, CacheTtl.search);
    return jsonResponse(result, 200, { "X-Cache": "MISS" });
  } catch (err) {
    return errorResponse(`Fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handleRelease(
  env: WorkerEnv,
  releaseId: string,
): Promise<Response> {
  const cacheKey = CacheKeys.release(releaseId);

  const cached = await cacheGet<MusicBrainzRelease>(env, cacheKey);
  if (cached) {
    return jsonResponse(cached, 200, { "X-Cache": "HIT" });
  }

  const mbUrl = `${MB_BASE}/release/${releaseId}?inc=artist-credit+recordings+media&fmt=json`;

  await rateLimit();

  try {
    const res = await fetch(mbUrl, { headers: mbHeaders() });
    if (!res.ok) {
      return errorResponse(`MusicBrainz returned ${res.status}`, res.status);
    }
    const data = await res.json() as MusicBrainzRelease;

    await cachePut(env, cacheKey, data, CacheTtl.release);
    return jsonResponse(data, 200, { "X-Cache": "MISS" });
  } catch (err) {
    return errorResponse(`Fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handleTracklist(
  env: WorkerEnv,
  releaseId: string,
): Promise<Response> {
  const cacheKey = CacheKeys.tracklist(releaseId);

  const cached = await cacheGet<CachedTracklistResult>(env, cacheKey);
  if (cached) {
    return jsonResponse(cached, 200, { "X-Cache": "HIT" });
  }

  const mbUrl = `${MB_BASE}/release/${releaseId}?inc=recordings+media&fmt=json`;

  await rateLimit();

  try {
    const res = await fetch(mbUrl, { headers: mbHeaders() });
    if (!res.ok) {
      return errorResponse(`MusicBrainz returned ${res.status}`, res.status);
    }
    const data = await res.json() as MusicBrainzRelease;

    const medium = data.media?.[0];
    const tracks: CachedTracklistItem[] = (medium?.tracks ?? []).map((t) => ({
      number: t.number ?? "",
      title: t.title,
      durationMs: t.length,
    }));

    const result: CachedTracklistResult = {
      releaseId,
      format: medium?.format ?? undefined,
      tracks,
    };

    await cachePut(env, cacheKey, result, CacheTtl.tracklist);
    return jsonResponse(result, 200, { "X-Cache": "MISS" });
  } catch (err) {
    return errorResponse(`Fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handleCoverArt(
  env: WorkerEnv,
  releaseId: string,
): Promise<Response> {
  const cacheKey = CacheKeys.cover(releaseId);

  const cached = await cacheGet<{ front: string | null; images: Array<{ front: boolean; image: string }> }>(env, cacheKey);
  if (cached) {
    return jsonResponse(cached, 200, { "X-Cache": "HIT" });
  }

  // Try Cover Art Archive
  const caaUrl = `${CAA_BASE}/release/${releaseId}`;

  const res = await fetch(caaUrl, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });

  if (res.status === 404) {
    const notFound = { front: null, images: [] };
    await cachePut(env, cacheKey, notFound, CacheTtl.cover);
    return jsonResponse(notFound, 200, { "X-Cache": "MISS" });
  }

  if (!res.ok) {
    return errorResponse(`Cover Art Archive returned ${res.status}`, res.status);
  }

  try {
    const data = await res.json() as {
      images?: Array<{ front: boolean; thumbnails?: { large?: string; small?: string }; image?: string }>;
    };

    const images = (data.images ?? []).map((img) => ({
      front: img.front,
      image: img.thumbnails?.large ?? img.thumbnails?.small ?? img.image ?? "",
    }));

    const front = images.find((i) => i.front)?.image ?? images[0]?.image ?? null;

    const result = { front, images };
    await cachePut(env, cacheKey, result, CacheTtl.cover);
    return jsonResponse(result, 200, { "X-Cache": "MISS" });
  } catch (err) {
    return errorResponse(`Parse failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ─── Worker entry point ───

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    if (request.method !== "GET") {
      return errorResponse("Method not allowed", 405);
    }

    // Health check
    if (pathname === "/" || pathname === "/health") {
      return jsonResponse({
        status: "ok",
        service: "mb-proxy",
        version: "1.0.0",
      });
    }

    // /search?q=...&artist=...&title=...&type=...&offset=...&limit=...
    if (pathname === "/search") {
      return handleSearch(env, url);
    }

    // /release/:id
    const releaseMatch = pathname.match(/^\/release\/([^/]+)$/);
    if (releaseMatch) {
      return handleRelease(env, releaseMatch[1]!);
    }

    // /tracklist/:id  — lighter than /release, just tracks
    const tracklistMatch = pathname.match(/^\/tracklist\/([^/]+)$/);
    if (tracklistMatch) {
      return handleTracklist(env, tracklistMatch[1]!);
    }

    // /cover/:releaseId  — cover art from Cover Art Archive
    const coverMatch = pathname.match(/^\/cover\/([^/]+)$/);
    if (coverMatch) {
      return handleCoverArt(env, coverMatch[1]!);
    }

    // /cover-group/:releaseGroupId  — look up a cover via release-group
    const coverGroupMatch = pathname.match(/^\/cover-group\/([^/]+)$/);
    if (coverGroupMatch) {
      // First find a release in the group, then get its cover art
      const rgId = coverGroupMatch[1]!;

      // Check cover cache by group id
      const cacheKey = CacheKeys.cover(`rg:${rgId}`);
      const cached = await cacheGet<{ front: string | null; images: Array<{ front: boolean; image: string }> }>(env, cacheKey);
      if (cached) {
        return jsonResponse(cached, 200, { "X-Cache": "HIT" });
      }

      // Find releases in this group
      await rateLimit();
      const mbUrl = `${MB_BASE}/release?release-group=${rgId}&fmt=json&limit=1`;
      const res = await fetch(mbUrl, { headers: mbHeaders() });
      if (!res.ok) {
        return errorResponse(`MusicBrainz returned ${res.status}`, res.status);
      }
      const data = await res.json() as MusicBrainzReleaseSearch;
      const firstRelease = data.releases?.[0];

      if (!firstRelease) {
        const notFound = { front: null, images: [] };
        await cachePut(env, cacheKey, notFound, CacheTtl.cover);
        return jsonResponse(notFound);
      }

      // Now use the release's cover, caching by group id too
      const releaseRes = await fetch(`${MB_BASE}/release/${firstRelease.id}?fmt=json`, { headers: mbHeaders() });
      // Use the release id for cover lookup, but cache by group id as well
      // Actually just delegate to cover art logic
      return handleCoverArt(env, firstRelease.id);
    }

    return errorResponse("Not found", 404);
  },
};
