// Cache key builder and TTL config for MusicBrainz KV cache.

export interface CacheConfig {
  kv: KVNamespace;
  defaultTtl?: number;
}

// TTLs in seconds — MusicBrainz data changes rarely
export const TTL = {
  SEARCH: 60 * 60 * 24 * 7,          // 7 days
  RELEASE_GROUP: 60 * 60 * 24 * 30,   // 30 days
  RELEASE: 60 * 60 * 24 * 30,         // 30 days
  TRACKLIST: 60 * 60 * 24 * 30,       // 30 days
  COVER_ART: 60 * 60 * 24 * 14,       // 14 days
  NOT_FOUND: 60 * 60 * 24 * 60,       // 60 days
} as const;

export function buildCacheKey(parts: string[]): string {
  const raw = parts.filter(Boolean).join(":");
  // KV keys max 512 bytes — hash long keys
  if (new TextEncoder().encode(raw).length > 400) {
    return raw.substring(0, 64) + ":" + simpleHash(raw);
  }
  return raw;
}

function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash).toString(36);
}

export function createCache(config: CacheConfig) {
  const { kv, defaultTtl = TTL.SEARCH } = config;

  return {
    async get<T>(key: string): Promise<T | null> {
      try {
        const raw = await kv.get(key, "text");
        if (!raw) return null;
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    },

    async put(key: string, data: unknown, ttl?: number): Promise<void> {
      try {
        await kv.put(key, JSON.stringify(data), {
          expirationTtl: ttl ?? defaultTtl,
        });
      } catch {
        // Cache writes are best-effort
      }
    },

    async cached<T>(
      key: string,
      fetcher: () => Promise<T>,
      ttl?: number,
    ): Promise<T> {
      const hit = await this.get<T>(key);
      if (hit) return hit;
      const data = await fetcher();
      await this.put(key, data, ttl);
      return data;
    },
  };
}
