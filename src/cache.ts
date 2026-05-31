import type { CacheEntry, WorkerEnv } from "./types";

// TTLs in seconds — per MusicBrainz data stability
const TTL_SEARCH = 60 * 60 * 24; // 24 hours for search results
const TTL_RELEASE = 60 * 60 * 24 * 7; // 7 days for release data
const TTL_TRACKLIST = 60 * 60 * 24 * 14; // 14 days for tracklists
const TTL_COVER = 60 * 60 * 24 * 30; // 30 days for cover art lookups

function buildKey(...parts: string[]): string {
  return parts.join(":");
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}

export async function cacheGet<T>(env: WorkerEnv, key: string): Promise<T | null> {
  const raw = await env.MB_CACHE.get(key, "text");
  if (!raw) return null;

  try {
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (entry.expiresAt < now()) {
      // Don't await — fire and forget deletion
      void env.MB_CACHE.delete(key);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

export async function cachePut<T>(
  env: WorkerEnv,
  key: string,
  data: T,
  ttlSeconds: number,
): Promise<void> {
  const entry: CacheEntry<T> = {
    data,
    cachedAt: now(),
    expiresAt: now() + ttlSeconds,
  };
  await env.MB_CACHE.put(key, JSON.stringify(entry), {
    expirationTtl: ttlSeconds,
  });
}

export const CacheKeys = {
  search: (query: string) => buildKey("search", query.toLowerCase().trim()),
  release: (id: string) => buildKey("release", id),
  tracklist: (id: string) => buildKey("tracklist", id),
  cover: (id: string) => buildKey("cover", id),
};

export const CacheTtl = {
  search: TTL_SEARCH,
  release: TTL_RELEASE,
  tracklist: TTL_TRACKLIST,
  cover: TTL_COVER,
};
