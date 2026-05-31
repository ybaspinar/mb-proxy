// ─── MusicBrainz API response types ───

export interface MusicBrainzArtist {
  id: string;
  name: string;
  "sort-name"?: string;
  disambiguation?: string;
}

export interface MusicBrainzArtistCredit {
  artist: MusicBrainzArtist;
  joinphrase?: string;
  name: string;
}

export interface MusicBrainzReleaseGroup {
  id: string;
  title: string;
  "primary-type"?: string;
  "secondary-types"?: string[];
  "first-release-date"?: string;
  "artist-credit"?: MusicBrainzArtistCredit[];
}

export interface MusicBrainzRelease {
  id: string;
  title: string;
  status?: string;
  date?: string;
  country?: string;
  "release-group"?: MusicBrainzReleaseGroup;
  "artist-credit"?: MusicBrainzArtistCredit[];
  media?: MusicBrainzMedium[];
}

export interface MusicBrainzMedium {
  format?: string;
  "track-count"?: number;
  tracks?: MusicBrainzTrack[];
}

export interface MusicBrainzTrack {
  id: string;
  title: string;
  number?: string;
  length?: number;
  recording?: {
    id: string;
    title: string;
    length?: number;
    "artist-credit"?: MusicBrainzArtistCredit[];
  };
}

export interface MusicBrainzReleaseGroupSearch {
  count: number;
  offset: number;
  "release-groups": MusicBrainzReleaseGroup[];
}

export interface MusicBrainzReleaseSearch {
  count: number;
  offset: number;
  releases: MusicBrainzRelease[];
}

// ─── Worker types ───

export interface WorkerEnv {
  MB_CACHE: KVNamespace;
}

export interface CacheEntry<T> {
  data: T;
  cachedAt: number;
  expiresAt: number;
}

export interface CachedSearchMeta {
  count: number;
  offset: number;
}

export interface CachedSearchResult {
  meta: CachedSearchMeta;
  results: CachedAlbumItem[];
}

export interface CachedAlbumItem {
  id: string;
  title: string;
  artist: string;
  year?: string;
  type?: string;
  country?: string;
  "track-count"?: number;
  disambiguation?: string;
}

export interface CachedTracklistItem {
  number: string;
  title: string;
  durationMs?: number;
}

export interface CachedTracklistResult {
  releaseId: string;
  format?: string;
  tracks: CachedTracklistItem[];
}
